import type {Input, Vec} from './simulation';
import {movementInaccuracy, type AccuracyParameters} from './ballistics';
import {accuracySpeedUnits} from './shot-model';
import {readCoachingSummary, type CoachingSummary, type SkillMetric} from './coaching-types';

export type DrillMode = 'peek' | 'precision' | 'burst';
export type PeekScenario = 'mixed' | 'common' | 'deep' | 'off-angle' | 'elevated';
export type Cover = {id: string; center: Vec; size: Vec};
export type Exposure = 'open' | 'left' | 'right' | 'head';
export const exposureNames:Record<Exposure,string>={open:'Open target',left:'Left half exposed',right:'Right half exposed',head:'Head only'};
export type Scenario = {
  name: string; kind: Exclude<PeekScenario, 'mixed'>; target: Vec; spawn: Vec;
  yaw: number; pitch: number; side: number; covered: boolean; exposure:Exposure; covers: Cover[];
};
export const HEAD_HEIGHT = 1.63;
export const HEAD_RADIUS = .115;
export const PEEK_WALLS: Cover[] = [-7.5, -2.5, 2.5, 7.5].map((x, i) => ({
  id: `station-${i}`, center: {x, y: 1.3, z: -83}, size: {x: 2.4, y: 2.6, z: .8}
}));
export const RANGE_WALLS: Cover[] = [-6.5,-3.5,3.5,6.5].map((x,i)=>({
  id:`range-cover-${i}`,center:{x,y:1.15,z:Math.abs(x)>5?-93:-91},size:{x:1.7,y:2.3,z:.55}
}));
export const REPOSITION_SHOTS = 6;
export const EXCESS_MOUSE_LIMIT = 2.4;
const RAD = Math.PI / 180;
const distance = (a: Vec, b: Vec) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const bound = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const isDrillMode = (mode: string): mode is DrillMode => ['peek', 'precision', 'burst'].includes(mode);
export function exposedHead(s:Pick<Scenario,'target'|'exposure'>):Vec {
  return {...s.target,x:s.target.x+(s.exposure==='left'?-.055:s.exposure==='right'?.055:0),y:s.target.y+HEAD_HEIGHT};
}

export function angleTo(origin: Vec, target: Vec) {
  return {yaw: Math.atan2(origin.x-target.x, origin.z-target.z), pitch: Math.atan2(target.y-origin.y, Math.hypot(target.x-origin.x, target.z-origin.z))};
}
export function aimError(origin: Vec, yaw: number, pitch: number, target: Vec) {
  const d = distance(origin, target);
  if (!d) return 0;
  const dot = (-Math.sin(yaw)*Math.cos(pitch)*(target.x-origin.x) + Math.sin(pitch)*(target.y-origin.y) - Math.cos(yaw)*Math.cos(pitch)*(target.z-origin.z)) / d;
  return Math.acos(bound(dot, -1, 1)) / RAD;
}
export function segmentBlocked(origin: Vec, target: Vec, covers: Cover[]) {
  return covers.some(c => {
    let near = 0, far = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
      const delta = target[axis]-origin[axis], lo = c.center[axis]-c.size[axis]/2, hi = c.center[axis]+c.size[axis]/2;
      if (Math.abs(delta) < 1e-10) { if (origin[axis] < lo || origin[axis] > hi) return false; }
      else {
        const a = (lo-origin[axis])/delta, b = (hi-origin[axis])/delta;
        near = Math.max(near, Math.min(a,b)); far = Math.min(far, Math.max(a,b));
        if (near > far) return false;
      }
    }
    return far > .0001 && near < .9999;
  });
}
export function headVisible(origin: Vec, target: Vec, covers: Cover[]) {
  return [-.075, 0, .075].some(x => !segmentBlocked(origin, {x: target.x+x, y: target.y+HEAD_HEIGHT, z: target.z}, covers));
}

export function peekDirection(origin:Vec,yaw:number,s:Scenario):number {
  const head=exposedHead(s);
  const clear=(p:Vec)=>[-.02,0,.02].every(x=>!segmentBlocked(p,{...head,x:head.x+x},s.covers));
  if(clear(origin))return 0;
  const positions=[{...origin},{...origin}];
  for(let step=0;step<60;step++)for(const [index,side] of [-1,1].entries()){
    const from=positions[index],next={...from,x:from.x+side*Math.cos(yaw)*.1,z:from.z-side*Math.sin(yaw)*.1};
    if(Math.abs(next.x)>11.3 || next.z< -97.8)continue;
    positions[index]=moveWithCover(from,next,s.covers,0,1.83);
    if(clear(positions[index]))return side;
  }
  return s.side;
}

// Resolve each horizontal axis against the same boxes used for occlusion/rendering.
// Player hull: 32 Source units wide; substeps keep it from tunnelling through a wall.
export function moveWithCover(from: Vec, next: Vec, covers: Cover[], feet: number, height: number): Vec {
  const radius = 16 * .0254;
  const result = {...from};
  for (const axis of ['x','z'] as const) {
    result[axis] = next[axis];
    const other = axis === 'x' ? 'z' : 'x';
    for (const c of covers) {
      if (feet >= c.center.y+c.size.y/2 || feet+height <= c.center.y-c.size.y/2) continue;
      const lo = c.center[axis]-c.size[axis]/2-radius, hi = c.center[axis]+c.size[axis]/2+radius;
      if (Math.abs(result[other]-c.center[other]) >= c.size[other]/2+radius) continue;
      if (from[axis] <= lo && result[axis] > lo) result[axis] = lo;
      else if (from[axis] >= hi && result[axis] < hi) result[axis] = hi;
    }
  }
  return {...result, y: next.y};
}

export function createScenario(mode: DrillMode, round: number, selection: PeekScenario, random = Math.random): Scenario {
  const side = round % 2 ? -1 : 1;
  const kind = selection === 'mixed' ? (['common','deep','off-angle','elevated'] as const)[Math.floor(random()*4)] : selection;
  const roll=random();
  const exposure:Exposure=mode!=='peek'?'open':roll<.325?'left':roll<.65?'right':roll<.8?'head':'open';
  const covered = exposure!=='open';
  const wall = PEEK_WALLS[round % PEEK_WALLS.length];
  const spawn = mode === 'peek' ? {x: wall.center.x, y: 64*.0254, z: -80.5} : {x: 0, y: 64*.0254, z: -84};
  const firingX = spawn.x + side*2.05;
  const target = mode === 'peek'
    ? {x: bound(wall.center.x+side*.6+(kind === 'off-angle' ? side*(1.1+random()*.65) : (random()-.5)*.16), -10, 10), y: kind === 'elevated' ? .5 : 0, z: kind === 'deep' ? -99 : -91-random()*4}
    : {x: (random()-.5)*12, y: random() < .25 ? .4 : 0, z: -94-random()*5};
  const preaim = exposedHead({target:{...target,x:mode==='peek'?wall.center.x+side*.6:0},exposure});
  const angles = mode === 'peek' ? angleTo({...spawn, x: firingX}, preaim) : {yaw: 0, pitch: 0};
  if (mode === 'peek') {
    // Keep a plausible pre-aim, with a small height correction that strafing alone cannot erase.
    angles.yaw += (random() - .5) * .7 * RAD;
    angles.pitch += (random() < .5 ? -1 : 1) * (.65 + random() * .45) * RAD;
  }
  const covers = mode === 'peek' ? PEEK_WALLS.map(c => ({...c, center: {...c.center}, size: {...c.size}})) : [];
  if (covered) {
    const depth=.45,thickness=.25;
    // Align the vertical edge from the intended firing lane, then keep it world-fixed.
    const edge=target.x+(firingX-target.x)*(depth+thickness/2)/(spawn.z-target.z);
    const height=target.y+(exposure==='head'?1.48:2.3);
    const x=exposure==='head'?target.x:edge+(exposure==='left'?1:-1)*1.05;
    covers.push({id:'target-cover',center:{x,y:height/2,z:target.z+depth},size:{x:2.1,y:height,z:thickness}});
  }
  if (target.y > 0) covers.push({id: 'platform', center: {x: target.x, y: target.y/2, z: target.z}, size: {x: 2, y: target.y, z: 1.6}});
  return {name: mode === 'peek' ? `${kind === 'off-angle' ? 'Off-angle' : kind === 'deep' ? 'Deep hold' : kind === 'elevated' ? 'Elevated hold' : 'Common angle'} / ${side > 0 ? 'right' : 'left'}` : mode === 'precision' ? 'Counterstrafing practice' : 'Burst & reposition', kind, target, spawn, ...angles, side, covered, exposure, covers};
}

export type DrillMetrics = {
  scenario: string; covered: boolean; passed: boolean; shots: number; hits: number; heads: number;
  accurateShots: number; settledShots:number; accuracyVerified:boolean; counterStrafed: boolean; stoppedOnTarget: boolean; speedAtShot: number;
  entryError: number | null; shotError: number; stopError: number | null;
  mouseCorrection: number; excessCorrection: number; exposureMs: number | null; stopToShotMs: number | null;
  diagonal: boolean; feedback: string; verdict: string;
  peakSpeed?:number; movementScore?:number; entrySpeedRatio?:number;
  firstSettled?:boolean; firstAirborne?:boolean; firstHit?:boolean; firstHead?:boolean;
  speedLimit?:number; aimTarget?:'head'|'body'|'target'; aimRadiusDegrees?:number;
  entryAimRatio?:number; shotAimRatio?:number; stopAimRatio?:number;
  earlyShots?:number; earlyHits?:number; lateShots?:number; lateHits?:number;
  coaching?:CoachingSummary;
};
export type CoachSample = {
  time: number; position: Vec; yaw: number; pitch: number; velocity: {x:number;z:number}; speedCap: number;
  input: Input; feet: number; grounded?: boolean; equipment?:string; accuracyStats?:AccuracyParameters;
  walking?:boolean; crouching?:boolean; aimTarget?:{point:Vec;radius:number;label:'head'|'body'};
};
export function readDrillMetrics(raw: unknown): DrillMetrics | undefined {
  if(!raw||typeof raw!=='object')return undefined;
  const m=raw as Record<string,unknown>;
  if(!['scenario','verdict','feedback'].every(k=>typeof m[k]==='string'&&(m[k] as string).length<=500))return undefined;
  if(!['covered','passed','counterStrafed','stoppedOnTarget','diagonal'].every(k=>typeof m[k]==='boolean'))return undefined;
  if(!['shots','hits','heads','accurateShots','speedAtShot','shotError','mouseCorrection','excessCorrection'].every(k=>typeof m[k]==='number'&&Number.isFinite(m[k])&&(m[k] as number)>=0))return undefined;
  if(!['entryError','stopError','exposureMs','stopToShotMs'].every(k=>m[k]===null||typeof m[k]==='number'&&Number.isFinite(m[k])&&(m[k] as number)>=0))return undefined;
  if(m.settledShots!==undefined && (typeof m.settledShots!=='number'||!Number.isFinite(m.settledShots)||m.settledShots<0||m.settledShots>(m.shots as number)))return undefined;
  if(m.accuracyVerified!==undefined && typeof m.accuracyVerified!=='boolean')return undefined;
  for(const key of ['peakSpeed','movementScore','entrySpeedRatio'])if(m[key]!==undefined&&(typeof m[key]!=='number'||!Number.isFinite(m[key])||(m[key] as number)<0))return undefined;
  if(typeof m.movementScore==='number'&&m.movementScore>100)return undefined;
  if((m.hits as number)>(m.shots as number)||(m.heads as number)>(m.hits as number)||(m.accurateShots as number)>(m.shots as number))return undefined;
  if(m.settledShots!==undefined && ((m.accurateShots as number)>(m.hits as number)||(m.accurateShots as number)>m.settledShots))return undefined;
  // Old history recorded movement eligibility, not the intersection of hits and settled shots.
  const verified=m.settledShots!==undefined && m.accuracyVerified!==false;
  const result={...raw as DrillMetrics,settledShots:(m.settledShots ?? m.accurateShots) as number,accurateShots:verified?m.accurateShots as number:0,accuracyVerified:verified};
  // Optional new telemetry must not invalidate a readable older repetition.
  for(const key of ['firstSettled','firstAirborne','firstHit','firstHead'] as const)if(typeof m[key]!=='boolean')delete result[key];
  for(const key of ['speedLimit','aimRadiusDegrees','entryAimRatio','shotAimRatio','stopAimRatio','earlyShots','earlyHits','lateShots','lateHits'] as const)
    if(typeof m[key]!=='number'||!Number.isFinite(m[key])||(m[key] as number)<0)delete result[key];
  if(m.aimTarget!=='head'&&m.aimTarget!=='body'&&m.aimTarget!=='target')delete result.aimTarget;
  for(const [shots,hits] of [['earlyShots','earlyHits'],['lateShots','lateHits']] as const){
    const count=result[shots],hitCount=result[hits];
    if(count===undefined||!Number.isInteger(count)||count>3||count>result.shots||hitCount===undefined||!Number.isInteger(hitCount)||hitCount>count){delete result[shots];delete result[hits];}
  }
  const coaching=verified?readCoachingSummary(m.coaching):undefined;
  if(coaching)result.coaching=coaching;else delete result.coaching;
  return result;
}

const score=(fraction:number)=>Math.round(bound(fraction,0,1)*100);
const ratioScore=(ratio:number|undefined)=>ratio===undefined?null:score(1-bound((ratio-1)/3,0,1));
const weighted=(parts:[number|null,number][])=>{
  const observed=parts.filter((part):part is [number,number]=>part[0]!==null);
  const total=observed.reduce((sum,[,weight])=>sum+weight,0);
  return total?Math.round(observed.reduce((sum,[value,weight])=>sum+value*weight,0)/total):null;
};
const ratioText=(value:number|undefined)=>value===undefined?'Not measured':`${value.toFixed(1)} target radii`;
const BODY_AIM_WEAPONS=new Set(['awp','g3sg1','scar20','nova','xm1014','mag7','sawedoff','zeus']);
function aimAnchor(s:CoachSample,scenario:Scenario){
  if(s.aimTarget)return s.aimTarget;
  const body=s.equipment!==undefined&&BODY_AIM_WEAPONS.has(s.equipment)&&scenario.exposure!=='head';
  return {point:body?{...exposedHead(scenario),y:scenario.target.y+1.15}:exposedHead(scenario),radius:body?.23:HEAD_RADIUS,
    label:body?'body' as const:s.equipment?'head' as const:'target' as const};
}
function movementState(s:CoachSample){
  const speed=accuracySpeedUnits(s.velocity),cap=Math.fround(s.accuracyStats?.speed??s.speedCap/.0254);
  const limit=Math.fround(cap*Math.fround(.34));
  const airborne=!(s.grounded??s.feet<=.001);
  const moving=s.accuracyStats?movementInaccuracy(s.accuracyStats,speed/cap,s.walking??s.input.walk,speed)>0:speed>limit;
  return {speed,cap,limit,airborne,settled:!airborne&&!moving};
}

/** Targets and weights are local practice heuristics, not professional-player benchmarks. */
export function drillCoaching(mode:DrillMode,m:DrillMetrics):CoachingSummary {
  const verified=m.accuracyVerified!==false;
  const firstSettled=m.firstSettled??(verified&&m.shots===1?m.settledShots===1:undefined);
  const firstHit=m.firstHit??(m.shots===1?m.hits>0:undefined);
  const settleRate=verified&&m.shots?score(m.settledShots/m.shots):null;
  const firstBrake=firstSettled===undefined?null:firstSettled?100:0;
  const entry=m.entrySpeedRatio===undefined?null:score(m.entrySpeedRatio/.65);
  const counter=m.shots?m.counterStrafed?100:0:null;
  const opening=firstHit===undefined?null:firstHit?100:0;
  const offAngle=m.scenario.startsWith('Off-angle');
  const alignment=ratioScore(mode==='peek'&&!offAngle?m.stopAimRatio:m.shotAimRatio);
  const timing=m.stopToShotMs===null||firstSettled===undefined||m.shotAimRatio===undefined?null:
    firstSettled&&m.shotAimRatio<=1?score(m.stopToShotMs<=250?1:250/m.stopToShotMs):0;
  const early=m.earlyShots?score((m.earlyHits??0)/m.earlyShots):null;
  const late=m.lateShots?score((m.lateHits??0)/m.lateShots):null;
  let overall=mode==='precision'?weighted([[m.movementScore??null,75],[ratioScore(m.shotAimRatio),15],[opening,10]]):
    mode==='burst'?weighted([[opening,25],[early,25],[late,35],[settleRate,15]]):
      weighted([[firstBrake,25],[alignment,20],[counter,15],[opening,15],[settleRate,15],[timing,10]]);
  if(!m.shots||!verified||m.firstSettled===undefined||m.firstHit===undefined||mode==='burst'&&(m.earlyShots!==3||m.lateShots!==3))overall=null;
  else if(mode==='precision'&&(m.entrySpeedRatio??0)<.65&&overall!==null)overall=Math.min(30,overall);
  else if(firstSettled===false&&overall!==null)overall=Math.min(35,overall);
  else if(mode==='peek'&&!m.counterStrafed&&overall!==null)overall=Math.min(65,overall);
  const target=m.aimTarget==='body'?'visible chest':m.aimTarget==='head'?'visible head':'visible target';
  const speedEvidence=m.speedLimit===undefined?`${Math.round(m.speedAtShot)} u/s at the opening shot`:
    `${Math.round(m.speedAtShot)} u/s at the opening shot; movement threshold ${Math.round(m.speedLimit)} u/s`;
  const metrics:SkillMetric[]=[{label:'Opening brake',value:firstSettled===undefined?'Not measured':m.firstAirborne?'Airborne':firstSettled?'Settled':'Moving',score:firstBrake,
    detail:`${speedEvidence}. Low speed is separate from an observed opposite-key brake; this does not measure recoil or spread recovery.`}];
  if(mode==='precision')metrics.push({label:'Entry speed',value:m.entrySpeedRatio===undefined?'Not measured':`${Math.round(m.entrySpeedRatio*100)}% running speed`,score:entry,
    detail:'Practice target: at least 65% running speed before braking. A stationary hit does not train counter-strafing.'},
    {label:'Movement sequence',value:m.movementScore===undefined?'Not measured':`${m.movementScore}/100`,score:m.movementScore??null,
      detail:'35 points for reaching the 65% entry target, 45 for reducing residual opening speed, 20 for an observed opposite-key brake. Under-speed entries are capped; hits cannot inflate movement quality.'});
  if(mode==='precision'||mode==='peek')metrics.push({label:'Opposite-key brake',value:m.counterStrafed?'Observed':'Not observed',score:counter,
    detail:'Requires an opposite movement input while travelling, followed by a settled opening shot within 350 ms of the stop. A coasting stop is not counted as a counter-strafe.'});
  if(mode!=='burst')metrics.push({label:mode==='peek'&&!offAngle?'Aim at the stop':'Aim at the opening shot',value:ratioText(mode==='peek'&&!offAngle?m.stopAimRatio:m.shotAimRatio),score:alignment,
    detail:`Error relative to the ${target}'s angular radius at the sampled distance. Full local credit within 1 radius, falling to zero at 4. This measures crosshair preparation, not the actual bullet.`});
  if(mode==='burst')metrics.push({label:'First three shots',value:m.earlyShots?`${m.earlyHits}/${m.earlyShots} hits`:'Not measured',score:early,
    detail:'Actual impacts from shots 1-3. Body hits count: controlled bursts do not require every hit to be a headshot.'},
    {label:'Last three shots',value:m.lateShots?`${m.lateHits}/${m.lateShots} hits`:'Not measured',score:late,
    detail:'Actual impacts from shots 4-6. Comparing both halves separates finding the opening from maintaining control; misses alone do not reveal a pull direction.'});
  else metrics.push({label:'Opening hit',value:firstHit===undefined?'Not measured':firstHit?'Hit':'Miss',score:opening,detail:'The first physical shot result; later hits cannot overwrite a missed opening.'});
  metrics.push({label:'Settled shots',value:verified?`${m.settledShots}/${m.shots}`:'Older rep: unverified',score:settleRate,
    detail:'Grounded shots without a movement-inaccuracy penalty. Standing recoil, shot spread and weapon recovery are separate.'});
  if(mode==='peek')metrics.push({label:'Stop to opening shot',value:m.stopToShotMs===null?'No stop recorded':`${Math.round(m.stopToShotMs)} ms`,score:timing,
    detail:'Local timing target: within 250 ms after stopping, only when both settled and aligned. Includes any necessary mouse correction, not reaction time or proof of hesitation. An aligned shot can still miss from spread.'});
  let focus=m.passed?'Repeat the controlled entry':'Make the stopped shot deliberate';
  let evidence=`${m.hits}/${m.shots} physical shots hit; ${verified?`${m.settledShots}/${m.shots} were settled`:'movement eligibility was not verified in this older rep'}.`;
  let action=`Pre-aim the ${target}, counter-strafe, finish the correction and fire. Stop first, aim before clicking; a stopped miss can still come from spread or recoil.`;
  let goal=mode==='precision'?'Next 5 reps: enter at 65%+ running speed, observe an opposite-key brake, then land the settled opening shot.':
    mode==='burst'?'Next burst: all 6 shots settled, at least 4/6 hits, including at least 2 of the final 3. Reposition 0.9 m before the next burst.':
      `Next 5 entries: a settled opening hit with the crosshair inside one ${m.aimTarget==='body'?'chest':'target'} radius before firing.`;
  if(!m.shots){focus='Complete an observed opening';evidence='No shot was recorded; aim and shot timing cannot be graded.';action='Pre-aim, strafe out far enough to see the target, counter-strafe and fire once. Use practice pace to learn the angle first.';}
  else if(mode==='peek'&&m.entryError===null&&firstHit!==true){focus='Clear the cover first';evidence=`${m.shots} shots recorded without a clear target-head sightline sample; ${m.hits} hits. No head sample does not prove every shot was blocked.`;action='Clear the wall edge before committing. Follow the peek arrow and aim at the exposed head or body, not the silhouette behind cover.';goal='Next 3 entries: obtain a clear sightline before the first shot.';}
  else if(mode==='precision'&&(m.entrySpeedRatio??0)<.65){focus='Build a real entry';evidence=`Peak entry speed ${Math.round((m.entrySpeedRatio??0)*100)}% of running speed; this drill requires at least 65%. ${speedEvidence}.`;action='Build sideways speed, release the strafe key and tap the opposite direction to counter-strafe. Fire after the stop; a stationary hit skips this drill\'s movement practice.';}
  else if(m.firstAirborne){focus='Land before the opening shot';evidence=`The opening shot was airborne at ${Math.round(m.speedAtShot)} u/s horizontal speed; low horizontal speed does not remove jump inaccuracy.`;action='Land before taking the shot. A jump spot is for information: get the info, return to cover, then take a separate shooting peek.';}
  else if(firstSettled===false){focus='Brake before the opening shot';evidence=`${speedEvidence}; the first shot was not movement-settled. ${m.hits}/${m.shots} hits do not make that opening reliable.`;action='Counter-strafe before firing: release your strafe key and tap the opposite direction. Stop any forward/back movement too; crouching is not an instant brake.';goal='Next 5 reps: zero moving opening shots. Keep the same aim and delay only the trigger until the brake is complete.';}
  else if(verified&&m.settledShots<m.shots){focus='Keep the burst settled';evidence=`${m.shots-m.settledShots}/${m.shots} shots were fired with movement or airborne inaccuracy after the opening.`;action='Finish this burst before strafing again. To disengage, release fire, move to cover, then counter-strafe for the next burst; do not drag a rifle spray through the reposition.';goal='Next burst: no movement-penalized shots; reposition only after releasing the trigger.';}
  else if(mode==='burst'&&m.shots<REPOSITION_SHOTS){focus='Complete the six-shot sample';evidence=`${m.shots}/6 shots recorded, ${m.hits} hits; the final three-shot segment is incomplete.`;action='Complete all six rounds so you can compare the opening with the late burst. Use a firearm with enough rounds for this exercise.';}
  else if((mode==='peek'||mode==='precision')&&!m.counterStrafed){focus='Use the opposite key';evidence=`${speedEvidence}; low speed was recorded, but no completed opposite-key brake was observed.`;action='Practise an actual counter-strafe: build sideways speed, release that key, briefly tap the opposite direction, then shoot. Coasting can be accurate, but it skips the brake this drill measures.';goal='Next 3 entries: an observed opposite-key brake followed by a settled opening hit.';}
  else if(mode==='burst'&&(m.earlyShots??0)>=3&&(m.lateShots??0)>=3&&(m.earlyHits??0)>=2&&(m.lateHits??0)<=1){focus='Hold the last three shots';evidence=`Shots 1-3: ${m.earlyHits}/3 hits; shots 4-6: ${m.lateHits}/3 hits. All ${m.settledShots}/${m.shots} shots were movement-settled.`;action='Keep the good opening and work on shots 4-6. Check the late impact group before changing your pull; hit counts alone do not tell whether you overpulled or let the spray climb.';}
  else if(mode==='peek'&&!offAngle&&m.stopAimRatio!==undefined&&m.stopAimRatio>1){focus='Prepare the common angle';evidence=`At the stop, your crosshair was ${m.stopAimRatio.toFixed(1)} target radii from the ${target}; opening-shot error ${ratioText(m.shotAimRatio)}.`;action=`Pre-aim this angle before leaving cover. Keep the crosshair at the ${target}'s height, strafe into the line, then counter-strafe and finish the small correction.`;}
  else if(mode!=='burst'&&m.shotAimRatio!==undefined&&m.shotAimRatio>1){focus='Finish the correction before firing';evidence=`Opening-shot crosshair error ${m.shotAimRatio.toFixed(1)} target radii (${m.shotError.toFixed(1)} deg); ${firstHit?'the physical shot hit':'the opening shot missed'}.`;action=offAngle?'Off-angle: correct with the mouse before clicking. Keep the counter-strafe; do not force movement-only aiming when the opponent is not where you pre-aimed.':`Aim before you click. Keep the stop, correct onto the ${target}, then fire; use the mouse for height or unexpected positions.`;}
  else if(firstHit===false||mode==='burst'&&m.hits<4){focus='Find the opening hit';evidence=`${firstHit===false?'Opening shot missed. ':''}${m.hits}/${m.shots} physical shots hit${mode==='burst'?`; first three ${m.earlyHits??'--'}/${m.earlyShots??'--'}, last three ${m.lateHits??'--'}/${m.lateShots??'--'}`:''}.`;action=m.covered?'Aim at the exposed part and check the impact. Seeing a head does not mean the covered body is hittable.':'Keep the stop and take a deliberate first bullet. Check weapon recovery and the impact; one stopped miss is not proof of bad movement or low crosshair placement.';}
  else if(mode==='peek'&&!offAngle&&timing!==null&&timing<100){focus='Commit after alignment';evidence=`Your stopped and aligned opening took ${Math.round(m.stopToShotMs!)} ms after the stop; opening ${firstHit?'hit':'unmeasured'}.`;action='Keep the pre-aim and clean stop. Aim to fire promptly once both are ready; do not rush the click before the correction is finished.';goal='Next 3 clean entries: stay accurate and bring stop-to-shot below the local 250 ms practice target; do not rush a miss.';}
  else if(mode==='burst'){focus='Repeat the controlled burst';evidence=`${m.hits}/${m.shots} hits; first three ${m.earlyHits??'--'}/${m.earlyShots??'--'}, last three ${m.lateHits??'--'}/${m.lateShots??'--'}; ${m.settledShots}/${m.shots} settled.`;action='Good burst control. Release fire, strafe 0.9 m, then counter-strafe for the next burst. In a long-range fight, compare shorter bursts with a reset rather than forcing six rounds.';}
  else if(m.passed){evidence=`${speedEvidence}; opposite-key brake observed; opening ${firstHit?'hit':'not measured'}${m.shotAimRatio===undefined?'':`; aim error ${ratioText(m.shotAimRatio)}`}.`;action=offAngle?'Keep that clean stop and deliberate off-angle correction. Try another angle; necessary mouse movement is not a mistake.':'Good pre-aim and counter-strafe. Repeat at another angle before increasing the pace; keep the first bullet deliberate.';}
  const fullOpening=m.firstSettled!==undefined&&m.firstHit!==undefined&&m.shotAimRatio!==undefined;
  const confidence=!m.shots?'No shooting sample.':!verified?'Older rep: movement eligibility and new opening metrics are unverified.':
    `${fullOpening?'Opening measured from actual shot and velocity.':'Partial rep: some opening metrics were not recorded.'} ${m.shots} shot${m.shots===1?'':'s'}; do not treat one rep as a stable skill rating.`;
  const strength=firstSettled&&m.counterStrafed?'Counter-strafe confirmed: you braked before the first bullet.':mode==='burst'&&early!==null&&early>=67?'At least two of your first three shots connected. Keep that opening.':undefined;
  const weights=mode==='precision'?'Movement sequence 75%, opening aim 15%, opening hit 10%.':mode==='burst'?
    'Opening hit 25%, first three 25%, last three 35%, settled shots 15%.':
    'Opening speed 25%, ready aim 20%, observed brake 15%, opening hit 15%, settled shots 15%, aligned timing 10%.';
  return {score:overall,focus,evidence,action,goal,strength,confidence:`${confidence} ${weights} Local targets, not rank benchmarks.`,metrics};
}
export class DrillCoach {
  seenAt: number | null = null; entryError: number | null = null;
  stopAt: number | null = null; stopError: number | null = null; counterAt: number | null = null;
  mouseCorrection = 0; travelled = 0; diagonal = false; peakSpeed = 0;
  visible = false; error = 0; accurate = true; wasFast = false;
  shots = 0; hits = 0; heads = 0; accurateShots = 0; settledShots = 0;
  earlyShots = 0; earlyHits = 0; lateShots = 0; lateHits = 0;
  entryAimRatio?:number; stopAimRatio?:number; aimRadiusDegrees=0; aimTarget:'head'|'body'|'target'='target';
  first?: DrillMetrics;
  private cachedResult?:DrillMetrics;
  firstShotAt: number | null = null;
  lastPosition: Vec; finished = false;
  constructor(public mode: DrillMode, public scenario: Scenario, public beganAt: number) { this.lastPosition = {...scenario.spawn}; }
  interruptMovement() { this.wasFast = false; this.stopAt = this.stopError = this.counterAt = null; this.stopAimRatio=undefined; this.peakSpeed=0; }
  mouse(degrees: number) { if (this.seenAt !== null && !this.first) this.mouseCorrection += degrees; }
  update(s: CoachSample) {
    if (this.finished) return;
    const anchor=aimAnchor(s,this.scenario),movement=movementState(s);
    this.error = aimError(s.position, s.yaw, s.pitch, anchor.point);
    this.aimRadiusDegrees=Math.atan2(anchor.radius,distance(s.position,anchor.point))/RAD;
    this.aimTarget=anchor.label;
    this.visible = headVisible(s.position, this.scenario.target, this.scenario.covers);
    if (this.visible && this.seenAt === null) { this.seenAt = s.time; this.entryError = this.error; this.entryAimRatio=this.error/this.aimRadiusDegrees; }
    const speed = Math.hypot(s.velocity.x,s.velocity.z);
    this.peakSpeed = Math.max(this.peakSpeed,speed);
    this.accurate = movement.settled;
    this.travelled += Math.hypot(s.position.x-this.lastPosition.x,s.position.z-this.lastPosition.z);
    this.lastPosition = {...s.position};
    this.diagonal ||= this.visible && Math.abs(s.input.side)>0 && Math.abs(s.input.forward)>0;
    const lateral = s.velocity.x*Math.cos(s.yaw)-s.velocity.z*Math.sin(s.yaw);
    const forward=-s.velocity.x*Math.sin(s.yaw)-s.velocity.z*Math.cos(s.yaw);
    if (s.input.side*lateral+s.input.forward*forward < -.5 && movement.speed>movement.limit && !movement.airborne && this.counterAt === null) this.counterAt = s.time;
    if (this.wasFast && this.accurate) { this.stopAt = s.time; this.stopError = this.error; this.stopAimRatio=this.error/this.aimRadiusDegrees; }
    if (!this.accurate && !this.wasFast) { this.stopAt = this.stopError = this.counterAt = null; this.stopAimRatio=undefined; }
    this.wasFast = !this.accurate;
  }
  record(s: CoachSample, hit: boolean, head: boolean): DrillMetrics {
    this.update(s);
    this.shots++; this.hits += +hit; this.heads += +(head&&hit); this.settledShots += +this.accurate; this.accurateShots += +(this.accurate&&hit);
    if(this.shots<=3){this.earlyShots++;this.earlyHits+=+hit;}
    else if(this.shots<=6){this.lateShots++;this.lateHits+=+hit;}
    if (!this.first) {
      this.firstShotAt = s.time;
      const movement=movementState(s);
      const counterStrafed = this.counterAt !== null && this.stopAt !== null && this.stopAt >= this.counterAt && s.time-this.stopAt <= .35;
      const entrySpeedRatio=this.peakSpeed/(movement.cap*.0254);
      const stopQuality=bound(1-movement.speed/movement.limit,0,1);
      const movementScore=entrySpeedRatio<.34?0:Math.round(Math.min(!this.accurate?30:entrySpeedRatio<.65?49:100,
        35*bound(entrySpeedRatio/.65,0,1)+45*stopQuality+(counterStrafed?20:0)));
      this.first = {scenario:this.scenario.name, covered:this.scenario.covered, passed:false, shots:0,hits:0,heads:0,accurateShots:0,settledShots:0,accuracyVerified:true,
        peakSpeed:this.peakSpeed/.0254,entrySpeedRatio,movementScore,
        firstSettled:this.accurate,firstAirborne:movement.airborne,firstHit:hit,firstHead:head&&hit,speedLimit:movement.limit,
        aimTarget:this.aimTarget,aimRadiusDegrees:this.aimRadiusDegrees,entryAimRatio:this.entryAimRatio,shotAimRatio:this.error/this.aimRadiusDegrees,stopAimRatio:this.stopAimRatio,
        counterStrafed, stoppedOnTarget:this.stopAimRatio!==undefined&&this.stopAimRatio<=1,
        speedAtShot:movement.speed, entryError:this.entryError, shotError:this.error, stopError:this.stopError,
        mouseCorrection:this.mouseCorrection, excessCorrection:Math.max(0,this.mouseCorrection-(this.entryError || 0)),
        exposureMs:this.seenAt === null ? null : (s.time-this.seenAt)*1000, stopToShotMs:this.stopAt === null ? null : (s.time-this.stopAt)*1000,
        diagonal:this.diagonal, feedback:'',verdict:''};
    }
    return this.result();
  }
  result(timeout = false): DrillMetrics {
    if(this.finished&&this.cachedResult)return this.cachedResult;
    const m: DrillMetrics = {...(this.first || {scenario:this.scenario.name,covered:this.scenario.covered,counterStrafed:false,stoppedOnTarget:false,speedAtShot:0,entryError:this.entryError,shotError:this.error,stopError:this.stopError,mouseCorrection:this.mouseCorrection,excessCorrection:0,exposureMs:null,stopToShotMs:null,diagonal:this.diagonal}),
      shots:this.shots,hits:this.hits,heads:this.heads,accurateShots:this.accurateShots,settledShots:this.settledShots,accuracyVerified:true,
      earlyShots:this.earlyShots,earlyHits:this.earlyHits,lateShots:this.lateShots,lateHits:this.lateHits,passed:false,feedback:'',verdict:''};
    const settled = this.shots>0 && this.settledShots===this.shots;
    m.passed = !timeout && settled && (this.mode === 'burst' ? this.shots===REPOSITION_SHOTS&&this.hits>=Math.ceil(REPOSITION_SHOTS*2/3)&&this.lateHits>=2 : !!m.firstHit) &&
      (this.mode === 'burst' || m.counterStrafed && this.travelled>.4 && (this.mode!=='precision'||(m.entrySpeedRatio ?? 0)>=.65));
    m.coaching=drillCoaching(this.mode,m);
    m.verdict=m.coaching.focus;
    m.feedback=m.coaching.action;
    this.cachedResult=m;
    return m;
  }
}
