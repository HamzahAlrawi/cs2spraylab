import {describe,expect,it} from 'vitest';
import {createNativeMapRegistry,type NativeMapDefinition} from './native-map-schema';
import {catalogSha256,mapPackageKey,requiredMapCases,validateMapAcceptance,validateMapCaseResults,validateMapReviewPlan,validateMapCatalogScope,
  MAP_ACCEPTANCE_GATES,validateMapBeta,requiredBetaCases,type MapBetaReceipt,type MapAcceptanceReceipt,type MapReviewPlan,type MapCaseResult} from './map-onboarding';
import type {PrefireCatalog} from './schema';

const hash='a'.repeat(64);
function fixture(){
  const id='de_fixture',revision='test-v1',route={id:'entry',name:'Entry',spawn:[0,0,0] as const,look:[100,0,64] as const,
    path:[[50,0,0] as const],angles:[{id:`${id}:corner`,name:'Corner',position:[100,0,0] as const,source:{dataset:'fixture-coordinates',profile:'corner',index:0}}]};
  const catalog:PrefireCatalog={id,name:'Fixture',revision,routes:[route],sources:[]};
  const chunk={mapId:id,id:'lane',name:'Lane',routeId:route.id,sourceMin:[-100,-100,-100],sourceMax:[200,200,200],contextPaddingUnits:64};
  const delivery={url:`/maps/fixture/duel/objects/${hash}.bin`,bytes:1,decodedBytes:1,sha256:hash,decodedSha256:hash,encoding:'identity' as const};
  const map:NativeMapDefinition={id,name:'Fixture',assetId:'fixture',base:'/maps/fixture/',revision,chunks:[chunk],fullDelivery:delivery,
    radar:{build:'synthetic',map:'fixture',metadata:{pos_x:0,pos_y:0,scale:1},delivery},
    index:{id,revision,routes:[{id:route.id,name:route.name}],aliases:{},approaches:{lane:[{id:route.id,name:route.name}]}},
    release:{version:1,map:'fixture',chunks:{lane:{version:1,id:'lane',map:'fixture',routeId:route.id,sourceMin:chunk.sourceMin,sourceMax:chunk.sourceMax,
      contextPaddingUnits:64,sourceCollisionSha256:hash,collisionManifestSha256:hash,visualManifestSha256:hash,navigationSha256:hash,delivery}}},loadCatalog:async()=>catalog};
  const plan:MapReviewPlan={schemaVersion:1,mapId:id,revision,weighting:'authored-coverage',
    native:{gameBuild:'synthetic',resourceSha256:{'fixture.bin':hash},extractorRevision:'fixture-only',extractionMethod:'Synthetic test, not native proof',
      coordinateTransform:'fixture',collisionMasks:'fixture',referenceCapture:'fixture'},
    scopeReview:{approved:true,reviewer:'Synthetic reviewer',reference:'Synthetic independent brief'},
    references:['one','two'].map(id=>({id,kind:'expert',independentGroup:id,reference:`fixture:${id}`,revision:'test',license:'Synthetic'})),
    areas:[{id:'yard',name:'Yard',routeIds:[route.id],pockets:[{id:'corner',name:'Corner',angleIds:[route.angles[0].id],referenceIds:['one','two'],
      status:'accepted',reviewer:'Synthetic reviewer',note:'Synthetic fixture only'}]}]};
  const cases=requiredMapCases(map,catalog,['yard']),results:MapCaseResult[]=cases.map(c=>({...c,status:'passed',kind:MAP_ACCEPTANCE_GATES[c.gate],
    assertions:1,note:'Synthetic structural test only',artifactSha256:hash,measurements:{warmNetworkRequests:0,p95FrameMs:16,p99FrameMs:25,warmHandoffMs:250,observedSeconds:10,peakResidentMiB:200}}));
  return {map,catalog,plan,cases,results};
}
async function approved(){const f=fixture(),gateCounts=Object.fromEntries(Object.keys(MAP_ACCEPTANCE_GATES).map(g=>[g,f.cases.filter(c=>c.gate===g).length])) as MapAcceptanceReceipt['gateCounts'];
  const receipt:MapAcceptanceReceipt={schemaVersion:1,mapId:f.map.id,revision:f.map.revision,packageKey:mapPackageKey(f.map),catalogSha256:await catalogSha256(f.catalog),
    planSha256:hash,evidenceSha256:hash,evidenceFile:'docs/map-acceptance/fixture/test.json',areaIds:['yard'],caseCount:f.cases.length,gateCounts,
    reviewers:['Synthetic reviewer'],sourceSha256:{'fixture.ts':hash}};
  return {...f,receipt,map:{...f.map,onboarding:{state:'approved' as const,note:'Synthetic',acceptance:receipt}}};}

describe('map onboarding admission (synthetic structural fixtures, not native parity)',()=>{
  it('requires explicit beta authorization, native proof and visible limitations without full approval',async()=>{
    const f=fixture(),receipt:MapBetaReceipt={schemaVersion:1,mapId:f.map.id,revision:f.map.revision,packageKey:mapPackageKey(f.map),
      catalogSha256:await catalogSha256(f.catalog),evidenceFile:'docs/map-beta/fixture/native.json',evidenceSha256:hash,nativeCollisionSha256:hash,
      nativeBuild:'synthetic',caseCount:requiredBetaCases(f.map,f.catalog).length,unresolved:['Synthetic: reference review pending']};
    const map={...f.map,name:'Fixture (Beta)',onboarding:{state:'beta' as const,note:'Synthetic beta only',beta:receipt}};
    expect(validateMapBeta(map,receipt,f.catalog)).toEqual([]);
    expect(createNativeMapRegistry([map],{requireApproval:true}).has(map.id)).toBe(false);
    const registry=createNativeMapRegistry([map],{requireApproval:true,betaIds:[map.id]});
    expect(await registry.loadCatalog(map.id)).toBe(f.catalog);
    expect(validateMapAcceptance(map,receipt as unknown as MapAcceptanceReceipt,f.catalog).length).toBeGreaterThan(0);
    for(const bad of [{...receipt,unresolved:[]},{...receipt,caseCount:0},{...receipt,packageKey:'stale'}])
      expect(validateMapBeta(map,bad,f.catalog).length).toBeGreaterThan(0);
    expect(validateMapBeta({...map,name:'Unlabeled fixture'},receipt,f.catalog).length).toBeGreaterThan(0);
  });
  it('keeps drafts available for authoring but out of runtime selection',async()=>{
    const {map,catalog}=fixture(),registry=createNativeMapRegistry([map],{requireApproval:true});
    expect(registry.list()).toEqual([]);expect(registry.has(map.id)).toBe(false);expect(registry.forAuthoring(map.id)).toBe(map);
    expect(await registry.loadCatalogForAuthoring(map.id)).toBe(catalog);
    expect(()=>registry.get(map.id)).toThrow('not admitted');await expect(registry.loadCatalog(map.id)).rejects.toThrow('not admitted');
  });
  it('only permits an explicit, documented legacy provisional exception',()=>{
    const {map}=fixture(),legacy={...map,onboarding:{state:'provisional' as const,note:'Unresolved fidelity debt'}};
    expect(createNativeMapRegistry([legacy],{requireApproval:true}).list()).toEqual([]);
    expect(createNativeMapRegistry([legacy],{requireApproval:true,provisionalIds:[map.id]}).list()).toEqual([legacy]);
  });
  it('loads approved catalogs lazily and refuses changed content even at the same revision',async()=>{
    const {map,catalog}=await approved();
    expect(await createNativeMapRegistry([map],{requireApproval:true}).loadCatalog(map.id)).toBe(catalog);
    const changed={...catalog,routes:catalog.routes.map(r=>({...r,spawn:[1,0,0] as const}))};
    await expect(createNativeMapRegistry([{...map,loadCatalog:async()=>changed}],{requireApproval:true}).loadCatalog(map.id)).rejects.toThrow('snapshot changed');
  });
  it('rejects future-map hold identities that could pick up Dust 2 behavior profiles',async()=>{
    const f=await approved(),catalog={...f.catalog,routes:f.catalog.routes.map(r=>({...r,angles:r.angles.map(a=>({...a,id:'a_long/2'}))}))};
    const map={...f.map,loadCatalog:async()=>catalog,onboarding:{...f.map.onboarding,acceptance:{...f.receipt,catalogSha256:await catalogSha256(catalog)}}};
    await expect(createNativeMapRegistry([map],{requireApproval:true}).loadCatalog(map.id)).rejects.toThrow('Unscoped');
  });
  it('prevents unaudited lineup-only holds and conflicting duplicate identities',()=>{
    const {map,catalog}=fixture(),route=catalog.routes[0],angle=route.angles[0];
    expect(validateMapCatalogScope(map,catalog)).toEqual([]);
    for(const changed of [{...route,lineups:[{id:'hidden',name:'Hidden',angles:[{...angle,position:[999,0,0] as const}]}]},
      {...route,alternatives:[{...angle,crouched:true}]}])
      expect(validateMapCatalogScope(map,{...catalog,routes:[changed]}).length).toBeGreaterThan(0);
  });
  it('invalidates geometry, routes, base paths, chunk bounds and radar/package pins',async()=>{
    const {map,receipt,catalog}=await approved();expect(validateMapAcceptance(map,receipt,catalog)).toEqual([]);
    for(const changed of [{...map,base:'/maps/elsewhere/'},{...map,revision:'new'},{...map,chunks:map.chunks.map(c=>({...c,sourceMax:[201,200,200]}))},
      {...map,release:{...map.release,chunks:{lane:{...map.release.chunks.lane,navigationSha256:'b'.repeat(64)}}}}])
      expect(validateMapAcceptance(changed,receipt,catalog).length).toBeGreaterThan(0);
    expect(validateMapAcceptance(map,{...receipt,gateCounts:{...receipt.gateCounts,'bot-combat':0}},catalog).join(' ')).toContain('bot-combat');
    expect(validateMapAcceptance(map,{...receipt,evidenceFile:'../../escape.json'},catalog).length).toBeGreaterThan(0);
  });
  it('does not approve self-consistent receipts over missing or foreign package resources',async()=>{
    const {map,receipt,catalog}=await approved();
    for(const bad of [{...map,fullDelivery:undefined},{...map,radar:undefined},{...map,release:{...map.release,chunks:{}}},
      {...map,fullDelivery:{...map.fullDelivery!,url:'/maps/foreign/duel/objects/'+hash+'.bin'}}])
      expect(validateMapAcceptance(bad,{...receipt,packageKey:mapPackageKey(bad)},catalog).length).toBeGreaterThan(0);
  });
  it('requires a reviewed independent region/pocket matrix and native extraction record',()=>{
    const {map,catalog,plan}=fixture();expect(validateMapReviewPlan(map,catalog,plan)).toEqual([]);
    for(const bad of [{...plan,areas:[]},{...plan,scopeReview:{...plan.scopeReview,approved:false}},
      {...plan,references:plan.references.map(r=>({...r,independentGroup:'same upstream'}))},
      {...plan,native:{...plan.native,resourceSha256:{}}},
      {...plan,areas:plan.areas.map(a=>({...a,pockets:a.pockets.map(p=>({...p,status:'pending' as const}))}))},
      {...plan,areas:plan.areas.map(a=>({...a,routeIds:['unknown']}))},
      {...plan,weighting:'measured-encounters' as const}])expect(validateMapReviewPlan(map,catalog,bad).length).toBeGreaterThan(0);
  });
  it('does not let review on one approach cover the same hold on another approach',()=>{
    const {map,catalog,plan}=fixture(),second={...catalog.routes[0],id:'second'};
    const changed={...catalog,routes:[...catalog.routes,second]};
    const withEmptyArea={...plan,areas:[...plan.areas,{id:'second-area',name:'Second',routeIds:['second'],pockets:[{...plan.areas[0].pockets[0],
      id:'excluded',angleIds:[],status:'excluded' as const,note:'Synthetic exclusion'}]}]};
    expect(validateMapReviewPlan(map,changed,withEmptyArea).join(' ')).toContain('approach-specific');
  });
  it('enumerates all holds, skill/count/seed scenarios, profiles and handoff pairs',()=>{
    const {cases}=fixture();expect(cases.filter(c=>c.gate==='bot-combat')).toHaveLength(19);
    expect(cases.filter(c=>c.gate==='loading-performance')).toHaveLength(6);
    expect(cases).toContainEqual({id:'chunk-handoff:lane>lane',gate:'chunk-handoff',scope:'lane>lane'});
    expect(new Set(cases.map(c=>c.id)).size).toBe(cases.length);
  });
  it('fails missing, duplicated, partial, wrong-kind and malformed case evidence',()=>{
    const {cases,results}=fixture();expect(validateMapCaseResults(cases,results)).toEqual([]);
    for(const invalid of [results.slice(1),[...results,results[0]],results.map(r=>({...r,status:'pending' as const})),
      results.map(r=>({...r,kind:'reference-review' as const})),results.map(r=>({...r,assertions:0})),[null] as unknown as MapCaseResult[]])
      expect(validateMapCaseResults(cases,invalid).length).toBeGreaterThan(0);
  });
  it('enforces zero warm downloads, sub-500ms handoffs and measured frame budgets',()=>{
    const {cases,results}=fixture();
    const metrics:Record<string,number>[]=[{warmNetworkRequests:1},{warmHandoffMs:500},{p95FrameMs:90},{observedSeconds:1},{peakResidentMiB:0}];
    for(const metric of metrics){
      const changed=results.map(r=>r.gate==='loading-performance'?{...r,measurements:{...r.measurements,...metric}}:r);
      expect(validateMapCaseResults(cases,changed).join(' ')).toContain('budget');
    }
  });
});
