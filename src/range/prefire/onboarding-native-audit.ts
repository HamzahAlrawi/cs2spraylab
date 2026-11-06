import type {NativeMapCollision} from './native-collision';
import type {NativeMapDefinition} from './native-map-schema';
import type {PrefireCatalog} from './schema';
import {angleIdentity,prefireCandidates} from './occupancy';
import {placePrefireTarget} from './placement';
import {prefireBodyExposed,prefireSpawnEyes,prefireUpperBodySamples,prefireUpperBodyExtrema,
  walkPrefireAuditPath,auditPrefireMotorPath,nativeSightBlocked} from './spawn-audit';
import {actorHeadPoint} from '../duel/geometry';
import {UNIT} from '../actor-physics';
import {createPrefireBotPlan,prefireRouteViews} from './bot-behavior';
import type {MapCaseResult,MapAcceptanceGate} from './map-onboarding';

export type NativeMapCase=Omit<MapCaseResult,'artifactSha256'>;
/** Offline geometry checks only. This cannot certify rendered hitboxes, native parity or bot intelligence. */
export function auditOnboardingRoutes(map:NativeMapDefinition,catalog:PrefireCatalog,collision:NativeMapCollision,routeIds?:readonly string[]) {
  if(catalog.id!==map.id||catalog.revision!==map.revision)throw Error('Native audit map/catalog mismatch.');
  if(routeIds?.some(id=>!catalog.routes.some(r=>r.id===id)))throw Error('Unknown audit route filter.');
  const results:NativeMapCase[]=[];
  const run=(gate:MapAcceptanceGate,scope:string,test:()=>number)=>{
    try{const assertions=test();results.push({id:`${gate}:${scope}`,gate,scope,status:'passed',kind:'native-regression',assertions,note:'Passed shared trainer hull/motor and native extracted collision queries; not an in-game capture comparison.'});}
    catch(error){results.push({id:`${gate}:${scope}`,gate,scope,status:'failed',kind:'native-regression',assertions:0,note:error instanceof Error?error.message:String(error)});}
  };
  for(const route of catalog.routes.filter(r=>!routeIds||routeIds.includes(r.id))){
    let walked:ReturnType<typeof walkPrefireAuditPath>=[];
    run('route-motor',route.id,()=>{
      walked=walkPrefireAuditPath(collision,[route.spawn,...route.path]);
      walkPrefireAuditPath(collision,[route.spawn,...route.path],true);
      auditPrefireMotorPath(collision,[route.spawn,...route.path]);return 3;
    });
    const candidates=prefireCandidates(route);
    run('entry-protection',route.id,()=>{
      if(!walked.length)throw Error('Cannot certify entry protection without a supported route.');
      const spawn=placePrefireTarget(collision,route.spawn),eyes=prefireSpawnEyes(spawn);
      const bodies=candidates.map(a=>prefireUpperBodySamples(placePrefireTarget(collision,a.position,a.crouched),a.crouched));
      if(prefireBodyExposed(collision,eyes,bodies))throw Error('A bot silhouette is visible from the entry/stance safety envelope.');
      const extrema=candidates.map(a=>prefireUpperBodyExtrema(placePrefireTarget(collision,a.position,a.crouched),a.crouched));
      let traveled=0,assertions=1;
      for(let i=1;i<walked.length;i++){
        traveled+=Math.hypot(walked[i].x-walked[i-1].x,walked[i].z-walked[i-1].z);
        if(traveled>32*UNIT)break;
        if(prefireBodyExposed(collision,prefireSpawnEyes(walked[i]),extrema))throw Error('Entry exposes a bot during the protected first 32 units.');
        assertions++;
      }
      if(assertions===1)throw Error('Insufficient protected movement samples.');return assertions;
    });
    for(const angle of candidates)run('hold-placement',`${route.id}/${angleIdentity(angle)}`,()=>{
      const feet=placePrefireTarget(collision,angle.position,angle.crouched),yaw=angle.rotation?(angle.rotation[1]-90)*Math.PI/180:0;
      if(!walked.length)throw Error('No supported route views for hold hittability.');
      const reachable=(position:typeof feet,crouched:boolean)=>{
        const head=actorHeadPoint(position,crouched?1:0,yaw);
        return walked.some(p=>[46,64].some(height=>!nativeSightBlocked(collision,{...p,y:p.y+height*UNIT},head)));
      };
      let visible=reachable(feet,!!angle.crouched);
      if(!visible){
        // A crouch-hider/peeker can deliberately conceal its source head. Only a
        // real controller plan may supply the hittable combat pose, never a guessed relocation.
        const plan=createPrefireBotPlan(collision,angle,true,prefireRouteViews([route.spawn,...route.path],collision),[]);
        if(plan.kind==='crouch-hide'&&collision.fits(feet,feet.y,72*UNIT))visible=reachable(feet,false);
        if(!visible&&plan.exposure)visible=reachable(plan.exposure,plan.sourceCrouched);
      }
      if(!visible)throw Error('Head has no unblocked native shot ray from the approach.');return 2;
    });
  }
  return {complete:!routeIds||catalog.routes.every(r=>routeIds.includes(r.id)),results};
}
