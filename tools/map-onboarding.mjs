// Source-only admission metadata; native inspection never loads or attaches to the game.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {digest,sourceDigest,jsonDigest,inside,writeNew,dependencies,validateDependencies,validateReports,readDelivered} from './map-onboarding-lib.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const command=process.argv[2]??'status',arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
if(!['status','init','cases','native','check','source','beta'].includes(command))throw Error('Use maps:status, maps:init, maps:cases, maps:native, maps:check, maps:beta or maps:source.');
const vite=await createServer({root,cacheDir:'node_modules/.vite-onboarding',server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
let collision;
try{
  const {nativeMaps}=await vite.ssrLoadModule('/src/range/prefire/maps/index.ts');
  const api=await vite.ssrLoadModule('/src/range/prefire/map-onboarding.ts');
  const snapshot=()=>dependencies(root);
  const read=file=>JSON.parse(fs.readFileSync(inside(root,file),'utf8'));
  const requireClean=errors=>{
    if(!errors.length)return;
    if(arg('diagnostics'))writeNew(root,arg('diagnostics'),{passed:false,errors});
    throw Error(`${errors.length} map acceptance error(s):\n${errors.slice(0,20).join('\n')}${errors.length>20?'\nMore errors omitted; use --diagnostics=<new-file.json> for the complete list.':''}`);
  };
  const verifyBeta=(map,catalog,report)=>{
    const errors=[];
    if(report.mapId!==map.id||report.revision!==map.revision||report.packageKey!==api.mapPackageKey(map)||report.catalogSha256!==jsonDigest(catalog)||
      report.complete!==true||!Array.isArray(report.findings)||report.findings.length)errors.push('Stale, incomplete or failed beta native audit.');
    errors.push(...api.validateMapCatalogScope(map,catalog),...validateDependencies(report.dependencies,snapshot()));
    errors.push(...api.validateMapCaseResults(api.requiredBetaCases(map,catalog),(report.results??[]).map(r=>({...r,artifactSha256:jsonDigest(report)}))));
    return errors;
  };
  const verify=(map,catalog,archive)=>{
    const errors=[...api.validateMapReviewPlan(map,catalog,archive.plan),...api.validateMapCatalogScope(map,catalog)],current=snapshot();
    const identity={mapId:map.id,revision:map.revision,packageKey:api.mapPackageKey(map),catalogSha256:jsonDigest(catalog),planSha256:jsonDigest(archive.plan)};
    if(archive.schemaVersion!==1)errors.push('Unknown evidence archive version.');
    errors.push(...validateDependencies(archive.dependencies,current));
    const proof=validateReports(archive.reports,identity,current);
    errors.push(...proof.errors,...api.validateMapCaseResults(api.requiredMapCases(map,catalog,archive.plan.areas.map(a=>a.id)),proof.results));
    return {errors,identity,proof};
  };
  if(command==='status')console.log(JSON.stringify(nativeMaps.candidates(),null,2));
  else if(command==='source'){
    const errors=[];
    for(const candidate of nativeMaps.candidates()){
      const map=nativeMaps.forAuthoring(candidate.id);
      if(candidate.state==='draft')continue; // Authoring-only; never selectable.
      errors.push(...candidate.errors.map(e=>`${candidate.id}: ${e}`));
      if(candidate.state==='provisional'){console.log(`${candidate.id}: provisional legacy map, not a fidelity certificate.`);continue;}
      if(candidate.state==='beta'){
        try{
          const receipt=map.onboarding.beta,catalog=await nativeMaps.loadCatalogForAuthoring(map.id),bytes=fs.readFileSync(inside(root,receipt.evidenceFile)),report=JSON.parse(bytes);
          errors.push(...api.validateMapBeta(map,receipt,catalog),...verifyBeta(map,catalog,report));
          if(sourceDigest(bytes)!==receipt.evidenceSha256||report.inputs.collisionSha256!==receipt.nativeCollisionSha256||report.inputs.gameBuild!==receipt.nativeBuild)
            errors.push(`${map.id}: beta proof/native source mismatch.`);
          console.log(`${map.id}: user-authorized beta, basic geometry verified; full acceptance remains incomplete.`);
        }catch(e){errors.push(`${map.id}: ${e.message}`);}
        continue;
      }
      try{
        const receipt=map.onboarding.acceptance,catalog=await nativeMaps.loadCatalogForAuthoring(map.id),
          bytes=fs.readFileSync(inside(root,receipt.evidenceFile)),archive=JSON.parse(bytes),result=verify(map,catalog,archive);
        errors.push(...result.errors,...api.validateMapAcceptance(map,receipt,catalog));
        if(sourceDigest(bytes)!==receipt.evidenceSha256||result.identity.planSha256!==receipt.planSha256||result.identity.catalogSha256!==receipt.catalogSha256)
          errors.push(`${map.id}: evidence archive/plan/catalog checksum mismatch.`);
        if(JSON.stringify(receipt.areaIds)!==JSON.stringify(archive.plan.areas.map(a=>a.id)))errors.push(`${map.id}: area scope mismatch.`);
        errors.push(...validateDependencies(receipt.sourceSha256,snapshot()));
        const reviewers=[...result.proof.reviewers].sort();
        if(JSON.stringify([...receipt.reviewers].sort())!==JSON.stringify(reviewers))errors.push(`${map.id}: reviewer snapshot mismatch.`);
        for(const [gate,count] of Object.entries(receipt.gateCounts))if(count!==result.proof.results.filter(r=>r.gate===gate).length)errors.push(`${map.id}: receipt gate count mismatch: ${gate}.`);
      }catch(error){errors.push(`${map.id}: ${error.message}`);}
    }
    requireClean(errors);
    console.log('Map admission source checks passed.');
  }else{
    if(!arg('map'))throw Error('Explicit --map=<registered-map-id> is required; no default-map fallback in authoring.');
    const map=nativeMaps.forAuthoring(arg('map')),catalog=await nativeMaps.loadCatalogForAuthoring(map.id);
    if(command==='init'){
      if(!arg('out'))throw Error('Use --out=research/map-onboarding/<map>/plan.json');
      writeNew(root,arg('out'),{schemaVersion:1,mapId:map.id,revision:map.revision,weighting:'authored-coverage',
        native:{gameBuild:'',resourceSha256:{},extractorRevision:'',extractionMethod:'',coordinateTransform:'',collisionMasks:'',referenceCapture:''},
        scopeReview:{reviewer:'',reference:'',approved:false},references:[],areas:[]});
      console.log('Created pending plan. Author the coverage matrix independently of existing bot coordinates; see docs/map-onboarding.md.');
    }else{
      if(!arg('plan'))throw Error('--plan=<review-plan.json> is required.');
      const plan=read(arg('plan'));
      if(plan.mapId!==map.id||plan.revision!==map.revision)throw Error('Plan identity/revision mismatch.');
      const identity={mapId:map.id,revision:map.revision,packageKey:api.mapPackageKey(map),catalogSha256:jsonDigest(catalog),planSha256:jsonDigest(plan)};
      if(command==='cases'){
        const report={schemaVersion:1,...identity,complete:false,findings:['Pending actual evidence'],dependencies:snapshot(),inputs:{},reviewer:'',
          results:api.requiredMapCases(map,catalog,plan.areas.map(a=>a.id)).map(c=>({...c,kind:api.MAP_ACCEPTANCE_GATES[c.gate],status:'pending',assertions:0,note:''}))};
        if(arg('out'))writeNew(root,arg('out'),report);else console.log(JSON.stringify(report,null,2));
      }else if(command==='native'){
        if(!arg('out'))throw Error('--out=<new-report.json> is required.');
        const {NativeMapCollision}=await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
        const {auditOnboardingRoutes}=await vite.ssrLoadModule('/src/range/prefire/onboarding-native-audit.ts');
        const base=`public/revamp${map.base}`,manifestBytes=fs.readFileSync(inside(root,`${base}collision.json`)),manifest=JSON.parse(manifestBytes),bytes=fs.readFileSync(inside(root,`${base}collision.bin`));
        if(digest(bytes)!==manifest.collisionSha256)throw Error('Native collision binary checksum mismatch.');
        const full=JSON.parse(readDelivered(root,map.fullDelivery));
        if(full.files?.['collision.json']?.decodedSha256!==digest(manifestBytes)||full.files?.['collision.bin']?.decodedSha256!==digest(bytes))
          throw Error('Audited collision differs from the pinned whole-map delivery package.');
        collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
        const result=auditOnboardingRoutes(map,catalog,collision,arg('routes')?.split(','));
        const report={schemaVersion:1,...identity,...result,dependencies:snapshot(),inputs:{gameBuild:manifest.build,
          collisionSha256:manifest.collisionSha256,sourcePhysicsSha256:manifest.sourceSha256,manifestSha256:digest(manifestBytes)},findings:result.results.filter(r=>r.status!=='passed').map(r=>r.id)};
        writeNew(root,arg('out'),report);
        console.log(JSON.stringify({complete:result.complete,cases:result.results.length,findings:report.findings},null,2));
        if(report.findings.length)process.exitCode=1;
      }else if(command==='beta'){
        if(!arg('report')||!arg('limitations')||!/^docs\/map-beta\/[a-z0-9_\/-]+\.json$/.test(arg('out')??''))throw Error('Use --report=<native.json> --limitations=<json-array.json> --out=docs/map-beta/<map>/<revision>.json');
        const report=read(arg('report'));requireClean(verifyBeta(map,catalog,report));
        const unresolved=read(arg('limitations')),serialized=JSON.stringify(report,null,2)+'\n';
        const receipt={schemaVersion:1,mapId:map.id,revision:map.revision,packageKey:api.mapPackageKey(map),catalogSha256:jsonDigest(catalog),
          evidenceFile:arg('out'),evidenceSha256:sourceDigest(serialized),nativeCollisionSha256:report.inputs.collisionSha256,nativeBuild:report.inputs.gameBuild,
          caseCount:report.results.length,unresolved};
        requireClean(api.validateMapBeta(map,receipt,catalog));
        const receiptFile=arg('out').replace(/\.json$/,'.receipt.json');
        if(fs.existsSync(inside(root,arg('out')))||fs.existsSync(inside(root,receiptFile)))throw Error('Refusing to overwrite beta proof.');
        writeNew(root,arg('out'),report);writeNew(root,receiptFile,receipt);
        console.log(`Basic geometry proof saved. This is a beta receipt, not full map approval: ${receiptFile}`);
      }else{
        if(!arg('reports')||!/^docs\/map-acceptance\/[a-z0-9_\/-]+\.json$/.test(arg('out')??''))throw Error('Use --reports=a.json,b.json --out=docs/map-acceptance/<map>/<revision>.json');
        const reports=arg('reports').split(',').map(file=>{const body=fs.readFileSync(inside(root,file),'utf8');return {sha256:digest(body),body};});
        const archive={schemaVersion:1,plan,dependencies:snapshot(),reports},result=verify(map,catalog,archive);
        requireClean(result.errors);
        const gateCounts=Object.fromEntries(Object.keys(api.MAP_ACCEPTANCE_GATES).map(g=>[g,result.proof.results.filter(r=>r.gate===g).length]));
        const evidenceBytes=JSON.stringify(archive,null,2)+'\n';
        const receipt={schemaVersion:1,...identity,evidenceSha256:sourceDigest(evidenceBytes),evidenceFile:arg('out'),areaIds:plan.areas.map(a=>a.id),
          caseCount:result.proof.results.length,gateCounts,reviewers:result.proof.reviewers,sourceSha256:archive.dependencies};
        const receiptErrors=api.validateMapAcceptance(map,receipt,catalog);
        requireClean(receiptErrors);
        const receiptFile=arg('out').replace(/\.json$/,'.receipt.json');
        if(fs.existsSync(inside(root,arg('out')))||fs.existsSync(inside(root,receiptFile)))throw Error('Refusing to overwrite acceptance records.');
        writeNew(root,arg('out'),archive);writeNew(root,receiptFile,receipt);
        console.log(`Evidence accepted: ${receipt.caseCount} cases. Import ${receiptFile} into the map descriptor to approve it; then run npm run check.`);
      }
    }
  }
}finally{collision?.dispose();await vite.close();}
