import type {NativeMapDefinition} from './native-map-schema';
import type {PrefireCatalog} from './schema';
import {angleIdentity,prefireCandidates} from './occupancy';
import {setupKey} from '../setup-key';

export const MAP_ACCEPTANCE_GATES={
  'native-source':'native-reference', 'geometry-materials':'native-regression',
  'collision-utility':'native-regression', 'route-motor':'native-regression',
  'entry-protection':'native-regression', 'hold-placement':'native-regression',
  'bot-combat':'native-simulation', 'duel-layout':'native-simulation',
  'coverage-review':'reference-review', 'visual-reference':'reference-review',
  'radar-guidance':'browser', 'rendered-aim':'browser', 'awareness-distribution':'native-simulation',
  'loading-performance':'browser', 'chunk-handoff':'browser', 'mode-isolation':'browser',
  'playtest':'reference-review',
} as const;
export type MapAcceptanceGate=keyof typeof MAP_ACCEPTANCE_GATES;
export type MapEvidenceKind=typeof MAP_ACCEPTANCE_GATES[MapAcceptanceGate];
export type MapReviewPlan={schemaVersion:1;mapId:string;revision:string;
  native:{gameBuild:string;resourceSha256:Record<string,string>;extractorRevision:string;extractionMethod:string;
    coordinateTransform:string;collisionMasks:string;referenceCapture:string};
  weighting:'authored-coverage'|'regional-support'|'measured-encounters';
  scopeReview:{reviewer:string;reference:string;approved:boolean};
  references:{id:string;kind:'native'|'coordinates'|'expert'|'statistics';independentGroup:string;reference:string;revision:string;license:string}[];
  areas:{id:string;name:string;routeIds:string[];pockets:{id:string;name:string;angleIds:string[];referenceIds:string[];
    status:'pending'|'accepted'|'excluded';reviewer:string;note:string}[]}[]};
export type MapAcceptanceCase={id:string;gate:MapAcceptanceGate;scope:string};
export type MapCaseResult=MapAcceptanceCase & {status:'passed'|'failed'|'pending';kind:MapEvidenceKind;
  assertions:number;note:string;artifactSha256:string;measurements?:Record<string,number>};
export type MapAcceptanceReceipt={schemaVersion:1;mapId:string;revision:string;packageKey:string;catalogSha256:string;
  planSha256:string;evidenceSha256:string;evidenceFile:string;areaIds:string[];caseCount:number;gateCounts:Record<MapAcceptanceGate,number>;
  reviewers:string[];sourceSha256:Record<string,string>};
const sha=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0;
const unique=(xs:readonly string[])=>new Set(xs).size===xs.length;

function packagePinErrors(map:NativeMapDefinition):string[]{
  const errors:string[]=[];
  const delivery=(asset:NativeMapDefinition['fullDelivery'])=>!!asset&&sha(asset.sha256)&&sha(asset.decodedSha256)&&
    Number.isSafeInteger(asset.bytes)&&asset.bytes>0&&Number.isSafeInteger(asset.decodedBytes)&&asset.decodedBytes>0&&
    ['gzip','identity'].includes(asset.encoding)&&new RegExp(`^/maps/${map.assetId}/duel/objects/${asset.sha256}\\.(bin|gz)$`).test(asset.url);
  if(!delivery(map.fullDelivery))errors.push('Missing/invalid content-addressed whole-map package.');
  if(!map.radar||map.radar.map!==map.assetId||!delivery(map.radar.delivery)||
    ![map.radar.metadata.pos_x,map.radar.metadata.pos_y,map.radar.metadata.scale].every(Number.isFinite)||map.radar.metadata.scale<=0)
    errors.push('Missing/invalid native radar package.');
  for(const chunk of map.chunks){
    const pin=map.release.chunks[chunk.id];
    if(!pin||pin.id!==chunk.id||pin.map!==map.assetId||pin.routeId!==chunk.routeId||
      ![pin.sourceCollisionSha256,pin.collisionManifestSha256,pin.visualManifestSha256,pin.navigationSha256].every(sha)||!delivery(pin.delivery)||
      JSON.stringify(pin.sourceMin)!==JSON.stringify(chunk.sourceMin)||JSON.stringify(pin.sourceMax)!==JSON.stringify(chunk.sourceMax)||pin.contextPaddingUnits!==chunk.contextPaddingUnits)
      errors.push(`Missing/mismatched chunk package pins: ${chunk.id}.`);
  }
  return errors;
}

/** Bounded identity key; evidence bodies and code dependencies are separately SHA-256 pinned. */
export function mapPackageKey(map:NativeMapDefinition){return setupKey({id:map.id,assetId:map.assetId,revision:map.revision,base:map.base,sharedTextureBase:map.sharedTextureBase,
  index:map.index,full:map.fullDelivery,radar:map.radar,
  chunks:map.chunks.map(chunk=>({id:chunk.id,min:chunk.sourceMin,max:chunk.sourceMax,route:chunk.routeId,
    collision:map.release.chunks[chunk.id]?.collisionManifestSha256,visual:map.release.chunks[chunk.id]?.visualManifestSha256,
    source:map.release.chunks[chunk.id]?.sourceCollisionSha256,navigation:map.release.chunks[chunk.id]?.navigationSha256,
    delivery:map.release.chunks[chunk.id]?.delivery})),context:map.release.context});}
export async function catalogSha256(catalog:PrefireCatalog){
  const bytes=new TextEncoder().encode(JSON.stringify(catalog));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function validateMapCatalogScope(map:NativeMapDefinition,catalog:PrefireCatalog):string[]{
  const errors:string[]=[];
  for(const route of catalog.routes){
    const raw=[...route.angles,...route.alternatives??[]],pool=new Map<string,string>();
    if(!raw.length)errors.push(`Route has no reviewable holds: ${route.id}.`);
    for(const angle of raw){
      const id=angleIdentity(angle),body=JSON.stringify(angle);
      if(pool.has(id)&&pool.get(id)!==body)errors.push(`Conflicting hold identity: ${route.id}/${id}.`);
      pool.set(id,body);
      if(!angle.id?.startsWith(`${map.id}:`)||angle.source&&(!angle.source.dataset||angle.source.dataset==='openprefire'))
        errors.push(`Unscoped hold/source behavior identity: ${route.id}/${id}.`);
    }
    for(const lineup of route.lineups??[])for(const angle of lineup.angles)
      if(pool.get(angleIdentity(angle))!==JSON.stringify(angle))errors.push(`Lineup hold is absent/different from the audited pool: ${route.id}/${lineup.id}/${angleIdentity(angle)}.`);
  }
  return errors;
}
export function requiredMapCases(map:NativeMapDefinition,catalog:PrefireCatalog|undefined,areaIds:readonly string[]):MapAcceptanceCase[]{
  const cases:MapAcceptanceCase[]=[],add=(gate:MapAcceptanceGate,scope:string)=>cases.push({id:`${gate}:${scope}`,gate,scope});
  for(const gate of ['native-source','geometry-materials','radar-guidance','rendered-aim','mode-isolation','playtest'] as const)add(gate,'full-map');
  for(const scope of ['full-map',...map.chunks.map(c=>c.id)]){
    add('collision-utility',scope);
    for(const profile of ['desktop','mobile','cpu-throttled'])add('loading-performance',`${scope}/${profile}`);
  }
  for(const route of map.index.routes){
    add('route-motor',route.id);add('entry-protection',route.id);
    for(const skill of [1,5,10])for(const bots of [1,3,5])for(const seed of [7,42])
      add('bot-combat',`${route.id}/skill-${skill}/bots-${bots}/seed-${seed}`);
    const actual=catalog?.routes.find(r=>r.id===route.id);
    for(const angle of actual?prefireCandidates(actual):[]){
      add('hold-placement',`${route.id}/${angleIdentity(angle)}`);add('bot-combat',`${route.id}/hold/${angleIdentity(angle)}`);
    }
  }
  for(const chunk of map.chunks){
    for(const skill of [1,5,10])for(const bots of [1,3,5])add('duel-layout',`${chunk.id}/skill-${skill}/bots-${bots}`);
    for(const next of map.chunks)if(next.id!==chunk.id)add('chunk-handoff',`${chunk.id}>${next.id}`);
  }
  // A one-chunk map must still demonstrate a repeated/cached handoff.
  if(map.chunks.length===1)add('chunk-handoff',`${map.chunks[0].id}>${map.chunks[0].id}`);
  for(const area of areaIds)for(const gate of ['coverage-review','visual-reference','awareness-distribution'] as const)add(gate,area);
  return cases;
}
export function validateMapReviewPlan(map:NativeMapDefinition,catalog:PrefireCatalog,plan:MapReviewPlan):string[]{
  const errors:string[]=[],routes=new Map(catalog.routes.map(r=>[r.id,r])),angles=new Set(catalog.routes.flatMap(r=>prefireCandidates(r).map(angleIdentity)));
  try{
    if(plan.schemaVersion!==1||plan.mapId!==map.id||plan.revision!==map.revision)errors.push('Plan identity/revision is stale.');
    if(!plan.native||![plan.native.gameBuild,plan.native.extractorRevision,plan.native.extractionMethod,
      plan.native.coordinateTransform,plan.native.collisionMasks,plan.native.referenceCapture].every(text)||
      !Object.keys(plan.native.resourceSha256).length||!Object.values(plan.native.resourceSha256).every(sha))errors.push('Incomplete native build/extraction/reference record.');
    if(!plan.scopeReview.approved||!text(plan.scopeReview.reviewer)||!text(plan.scopeReview.reference))errors.push('Independent whole-map coverage brief has not been reviewed.');
    if(!plan.references.length||!unique(plan.references.map(r=>r.id)))errors.push('Missing/duplicate position references.');
    for(const ref of plan.references)if(![ref.id,ref.independentGroup,ref.reference,ref.revision,ref.license].every(text)||
      !['native','coordinates','expert','statistics'].includes(ref.kind))errors.push(`Invalid source reference: ${ref.id}.`);
    const refs=new Map(plan.references.map(r=>[r.id,r]));
    if(!plan.areas.length||!unique(plan.areas.map(a=>a.id)))errors.push('An independently authored area/angle coverage matrix is required.');
    const coveredRoutes=new Set<string>(),coveredAngles=new Set<string>();
    for(const area of plan.areas){
      if(!text(area.id)||!text(area.name)||!area.routeIds.length||!unique(area.routeIds)||area.routeIds.some(id=>!routes.has(id)))errors.push(`Invalid area/approach mapping: ${area.id}.`);
      area.routeIds.forEach(id=>coveredRoutes.add(id));
      if(!area.pockets.length||!unique(area.pockets.map(p=>p.id)))errors.push(`Missing/duplicate required pockets: ${area.id}.`);
      const groups=new Set<string>();
      for(const pocket of area.pockets){
        for(const id of pocket.referenceIds){const ref=refs.get(id);if(ref)groups.add(ref.independentGroup);else errors.push(`Unknown reference: ${id}.`);}
        if(!text(pocket.id)||!text(pocket.name)||!pocket.referenceIds.length||!text(pocket.reviewer)||!text(pocket.note)||
          !['accepted','excluded'].includes(pocket.status))errors.push(`Unreviewed required pocket: ${area.id}/${pocket.id}.`);
        if(pocket.status==='accepted'&&(!pocket.angleIds.length||pocket.angleIds.some(id=>!angles.has(id)||
          !area.routeIds.some(route=>routes.has(route)&&prefireCandidates(routes.get(route)!).some(a=>angleIdentity(a)===id)))))errors.push(`Pocket has no admitted approach-specific hold: ${area.id}/${pocket.id}.`);
        if(pocket.status==='excluded'&&pocket.angleIds.length)errors.push(`Excluded pocket still maps to a live hold: ${area.id}/${pocket.id}.`);
        if(pocket.status==='accepted')for(const route of area.routeIds)for(const angle of routes.has(route)?prefireCandidates(routes.get(route)!):[])
          if(pocket.angleIds.includes(angleIdentity(angle)))coveredAngles.add(`${route}/${angleIdentity(angle)}`);
      }
      if(groups.size<2)errors.push(`Area requires two independent reference groups: ${area.id}.`);
    }
    for(const route of routes.keys())if(!coveredRoutes.has(route))errors.push(`Approach missing from coverage review: ${route}.`);
    for(const route of catalog.routes)for(const angle of prefireCandidates(route))
      if(!coveredAngles.has(`${route.id}/${angleIdentity(angle)}`))errors.push(`Live hold missing from approach-specific coverage review: ${route.id}/${angleIdentity(angle)}.`);
    if(!['authored-coverage','regional-support','measured-encounters'].includes(plan.weighting))errors.push('Unknown probability/evidence policy.');
    if(plan.weighting==='regional-support'&&!catalog.density)errors.push('Regional weighting requires actual density evidence.');
    if(plan.weighting==='measured-encounters'&&!catalog.encounters)errors.push('Measured encounter claims require contextual encounter evidence, not kill heatmaps.');
  }catch{errors.push('Malformed onboarding plan.');}
  return errors;
}
export function validateMapCaseResults(required:readonly MapAcceptanceCase[],results:readonly MapCaseResult[]):string[]{
  const errors:string[]=[],ids=new Set(required.map(c=>c.id));
  if(!Array.isArray(results)||results.some(r=>!r||typeof r!=='object'))return ['Malformed acceptance case results.'];
  for(const result of results)if(!ids.has(result.id))errors.push(`Unexpected/stale case: ${result.id}.`);
  for(const check of required){
    const matches=results.filter(r=>r.id===check.id),r=matches[0];
    if(matches.length!==1||!r||r.gate!==check.gate||r.scope!==check.scope||r.status!=='passed'||
      r.kind!==MAP_ACCEPTANCE_GATES[check.gate]||!Number.isSafeInteger(r.assertions)||r.assertions<1||!sha(r.artifactSha256)||!text(r.note))
      errors.push(`Missing, failed or insufficient evidence: ${check.id}.`);
    else if(check.gate==='loading-performance'||check.gate==='chunk-handoff'){
      const m=r.measurements,frameBudget=check.scope.endsWith('/desktop')?20:50;
      if(!m||!['warmNetworkRequests','p95FrameMs','p99FrameMs','warmHandoffMs','observedSeconds','peakResidentMiB'].every(k=>Number.isFinite(m[k])&&m[k]>=0)||
        m.warmNetworkRequests!==0||m.warmHandoffMs>=500||m.observedSeconds<5||m.p95FrameMs>frameBudget||m.p99FrameMs>Math.max(50,frameBudget*2)||m.peakResidentMiB<=0)
        errors.push(`Loading/frame/cache budget failed or unmeasured: ${check.id}.`);
    }
  }
  return errors;
}
/** Runtime receipt validation is admission metadata, not proof that an assertion is scientifically true. */
export function validateMapAcceptance(map:NativeMapDefinition,receipt:MapAcceptanceReceipt|undefined,catalog?:PrefireCatalog):string[]{
  try{
    if(!receipt||receipt.schemaVersion!==1||receipt.mapId!==map.id||receipt.revision!==map.revision||receipt.packageKey!==mapPackageKey(map)||
      ![receipt.catalogSha256,receipt.planSha256,receipt.evidenceSha256].every(sha)||!/^docs\/map-acceptance\/[a-z0-9_\/-]+\.json$/.test(receipt.evidenceFile)||
      receipt.evidenceFile.includes('..')||!receipt.areaIds.length||receipt.areaIds.some(a=>!text(a))||!unique(receipt.areaIds)||
      !receipt.reviewers.length||receipt.reviewers.some(r=>!text(r))||!Object.keys(receipt.sourceSha256).length||
      Object.values(receipt.sourceSha256).some(h=>!sha(h)))return ['Missing, malformed or stale map acceptance receipt.'];
    const cases=requiredMapCases(map,catalog,receipt.areaIds),errors:string[]=packagePinErrors(map);
    for(const gate of Object.keys(MAP_ACCEPTANCE_GATES) as MapAcceptanceGate[]){
      const minimum=cases.filter(c=>c.gate===gate).length;
      if(!Number.isSafeInteger(receipt.gateCounts[gate])||receipt.gateCounts[gate]<Math.max(1,minimum))errors.push(`Incomplete acceptance scope: ${gate}.`);
    }
    if(Object.keys(receipt.gateCounts).some(g=>!(g in MAP_ACCEPTANCE_GATES))||!Number.isSafeInteger(receipt.caseCount)||
      receipt.caseCount!==Object.values(receipt.gateCounts).reduce((a,b)=>a+b,0))errors.push('Invalid acceptance case count.');
    if(catalog&&receipt.caseCount!==cases.length)errors.push('Acceptance cases do not match the current catalog.');
    return errors;
  }catch{return ['Malformed map acceptance receipt.'];}
}
