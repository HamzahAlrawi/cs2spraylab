import type {Input, Vec} from './simulation';

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
};
export type CoachSample = {time: number; position: Vec; yaw: number; pitch: number; velocity: {x:number;z:number}; speedCap: number; input: Input; feet: number; grounded?: boolean};
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
  return {...raw as DrillMetrics,settledShots:(m.settledShots ?? m.accurateShots) as number,accurateShots:verified?m.accurateShots as number:0,accuracyVerified:verified};
}
export class DrillCoach {
  seenAt: number | null = null; entryError: number | null = null;
  stopAt: number | null = null; stopError: number | null = null; counterAt: number | null = null;
  mouseCorrection = 0; travelled = 0; diagonal = false; peakSpeed = 0;
  visible = false; error = 0; accurate = true; wasFast = false;
  shots = 0; hits = 0; heads = 0; accurateShots = 0; settledShots = 0;
  first?: DrillMetrics;
  firstShotAt: number | null = null;
  lastPosition: Vec; finished = false;
  constructor(public mode: DrillMode, public scenario: Scenario, public beganAt: number) { this.lastPosition = {...scenario.spawn}; }
  interruptMovement() { this.wasFast = false; this.stopAt = this.stopError = this.counterAt = null; this.peakSpeed=0; }
  mouse(degrees: number) { if (this.seenAt !== null && !this.first) this.mouseCorrection += degrees; }
  update(s: CoachSample) {
    if (this.finished) return;
    const head = exposedHead(this.scenario);
    this.error = aimError(s.position, s.yaw, s.pitch, head);
    this.visible = headVisible(s.position, this.scenario.target, this.scenario.covers);
    if (this.visible && this.seenAt === null) { this.seenAt = s.time; this.entryError = this.error; }
    const speed = Math.hypot(s.velocity.x,s.velocity.z);
    this.peakSpeed = Math.max(this.peakSpeed,speed);
    this.accurate = speed <= s.speedCap*.34 && (s.grounded ?? s.feet <= .001);
    this.travelled += Math.hypot(s.position.x-this.lastPosition.x,s.position.z-this.lastPosition.z);
    this.lastPosition = {...s.position};
    this.diagonal ||= this.visible && Math.abs(s.input.side)>0 && Math.abs(s.input.forward)>0;
    const lateral = s.velocity.x*Math.cos(s.yaw)-s.velocity.z*Math.sin(s.yaw);
    if (s.input.side*lateral < -.5 && speed > s.speedCap*.34 && this.counterAt === null) this.counterAt = s.time;
    if (this.wasFast && this.accurate) { this.stopAt = s.time; this.stopError = this.error; }
    if (!this.accurate && !this.wasFast) { this.stopAt = this.stopError = this.counterAt = null; }
    this.wasFast = !this.accurate;
  }
  record(s: CoachSample, hit: boolean, head: boolean): DrillMetrics {
    this.update(s);
    this.shots++; this.hits += +hit; this.heads += +(head&&hit); this.settledShots += +this.accurate; this.accurateShots += +(this.accurate&&hit);
    if (!this.first) {
      this.firstShotAt = s.time;
      const headAngle = Math.atan2(HEAD_RADIUS, distance(s.position, exposedHead(this.scenario)))/RAD;
      const counterStrafed = this.counterAt !== null && this.stopAt !== null && this.stopAt >= this.counterAt && s.time-this.stopAt <= .35;
      const entrySpeedRatio=this.peakSpeed/s.speedCap;
      const stopQuality=bound(1-Math.hypot(s.velocity.x,s.velocity.z)/(s.speedCap*.34),0,1);
      const movementScore=entrySpeedRatio<.34?0:Math.round(Math.min(this.accurate?100:30,40*bound(entrySpeedRatio/.9,0,1)+40*stopQuality+(counterStrafed?15:0)+(head&&hit?5:hit?2:0)));
      this.first = {scenario:this.scenario.name, covered:this.scenario.covered, passed:false, shots:0,hits:0,heads:0,accurateShots:0,settledShots:0,accuracyVerified:true,
        peakSpeed:this.peakSpeed/.0254,entrySpeedRatio,movementScore,
        counterStrafed, stoppedOnTarget:this.stopError !== null && this.stopError <= headAngle,
        speedAtShot:Math.hypot(s.velocity.x,s.velocity.z)/.0254, entryError:this.entryError, shotError:this.error, stopError:this.stopError,
        mouseCorrection:this.mouseCorrection, excessCorrection:Math.max(0,this.mouseCorrection-(this.entryError || 0)),
        exposureMs:this.seenAt === null ? null : (s.time-this.seenAt)*1000, stopToShotMs:this.stopAt === null ? null : (s.time-this.stopAt)*1000,
        diagonal:this.diagonal, feedback:'',verdict:''};
    }
    return this.result();
  }
  result(timeout = false): DrillMetrics {
    const m: DrillMetrics = {...(this.first || {scenario:this.scenario.name,covered:this.scenario.covered,counterStrafed:false,stoppedOnTarget:false,speedAtShot:0,entryError:this.entryError,shotError:this.error,stopError:this.stopError,mouseCorrection:this.mouseCorrection,excessCorrection:0,exposureMs:null,stopToShotMs:null,diagonal:this.diagonal}),
      shots:this.shots,hits:this.hits,heads:this.heads,accurateShots:this.accurateShots,settledShots:this.settledShots,accuracyVerified:true,passed:false,feedback:'',verdict:''};
    const settled = this.shots>0 && this.settledShots===this.shots;
    m.passed = !timeout && settled && (this.mode === 'burst' ? this.hits>=Math.ceil(REPOSITION_SHOTS*2/3) : this.heads>0) && (this.mode === 'burst' || m.counterStrafed && this.travelled>.4 && (this.mode!=='precision'||(m.entrySpeedRatio ?? 0)>=.65));
    if (timeout) { m.verdict='Angle held too long'; m.feedback='Clear the angle, brake, then commit to the shot. Reset behind cover for the next rep.'; }
    else if (this.mode==='peek' && m.entryError===null) {m.verdict='Target still behind cover';m.feedback='Clear the edge before committing the shot. Use the strafe to expose the angle, then brake.';}
    else if (this.mode==='precision' && (m.entrySpeedRatio ?? 0)<.65) {m.verdict='Build speed before the shot';m.feedback='Strafe to at least 65% running speed, then counter-strafe. Standing still for the whole rep does not train braking.';}
    else if (!settled) { m.verdict='Shot before stopping'; m.feedback='Release the strafe key, tap the opposite key, and shoot as your speed settles.'; }
    else if ((this.mode==='peek'||this.mode==='precision') && !m.counterStrafed) { m.verdict='Stopped without a clean counter-strafe'; m.feedback='Build lateral speed, then tap the opposite direction. Coasting to a stop is accurate but slower.'; }
    else if (m.diagonal && this.mode!=='precision') { m.verdict='Diagonal entry'; m.feedback='Set your path before the corner. A single lateral direction is easier to brake consistently.'; }
    else if (!this.hits) { m.verdict='Aim missed'; m.feedback='Set head height before exposing the angle. Correct the remaining error once the target is visible.'; }
    else if (!this.heads && this.mode!=='burst') { m.verdict='Body hit'; m.feedback='Raise the initial pre-aim to head height; let the strafe bring the head onto the crosshair.'; }
    else if (this.mode==='peek' && !m.stoppedOnTarget) { m.verdict=m.passed?'Clean stop, aim still settling':'Aim after the stop'; m.feedback=this.scenario.kind==='off-angle'?'The off-angle needs a deliberate correction. Keep the clean stop and settle on the head before firing.':'Keep the same stopping timing; prepare the common angle earlier so the crosshair is on the head as you brake.'; }
    else if (m.excessCorrection>EXCESS_MOUSE_LIMIT) { m.verdict=m.passed?'Hit with extra correction':'Over-corrected'; m.feedback='Pre-aim at head height, then let your strafe finish the alignment. Use a small mouse correction for an unexpected angle; do not force zero mouse movement.'; }
    else { m.verdict=m.passed?'Clean rep':'Keep refining'; m.feedback=this.mode==='burst'?'Move laterally before the next burst. Stop again before firing.':this.scenario.kind==='off-angle'?'Good stop and deliberate correction for the unexpected position.':'Good preparation and shot timing. Repeat the same movement without rushing the trigger.'; }
    return m;
  }
}
