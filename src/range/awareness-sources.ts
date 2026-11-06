import {UNIT,type Vec} from './actor-physics';
import {canFitInArena,type Arena} from './duel/geometry';
import {clearSegment} from './duel/navigation';
import type {AwarenessLocation} from './awareness-map';
import {moveOnTerrain} from './actor-collision';

export const AWARENESS_SOURCE_RADIUS=28,AWARENESS_RELOCATE_DISTANCE=8;
export const AWARENESS_DENSITY_POLICY={holdShare:.65,maxAttempts:96,maxSamples:24,maxMoves:384,cutoffSigma:2.5,recentSources:8} as const;
export type RecentAwarenessSource={point:Vec;apparent:Vec};

/** Soft exercise-spacing penalty, not a change to the underlying common-position prior. */
export function awarenessNovelty(point:Vec,apparent:Vec,listener:Vec,recent:readonly RecentAwarenessSource[]) {
  let weight=1;
  for(let i=recent.length-1;i>=0;i--){
    const old=recent[i],age=recent.length-1-i,decay=Math.exp(-age/2.5);
    const distance=Math.hypot(point.x-old.point.x,point.y-old.point.y,point.z-old.point.z);
    const spatial=Math.exp(-distance*distance/(2*2.5*2.5));
    const a={x:apparent.x-listener.x,z:apparent.z-listener.z},b={x:old.apparent.x-listener.x,z:old.apparent.z-listener.z};
    const al=Math.hypot(a.x,a.z),bl=Math.hypot(b.x,b.z);
    const angle=al>.01&&bl>.01?Math.acos(Math.max(-1,Math.min(1,(a.x*b.x+a.z*b.z)/(al*bl)))):Math.PI;
    const bearing=Math.exp(-angle*angle/(2*.22*.22))*Math.exp(-((al-bl)**2)/32);
    weight*=1-.94*decay*Math.max(spatial,.75*bearing);
  }
  return Math.max(.002,weight);
}
function finish<T>(work:Generator<void,T>){let result=work.next();while(!result.done)result=work.next();return result.value;}
export function* rankAwarenessSourceWork(candidates:readonly [string,AwarenessLocation][],listener:Vec,recent:readonly RecentAwarenessSource[],random:()=>number,
  apparent:(point:Vec)=>Vec=point=>point) {
  const ranked:{candidate:[string,AwarenessLocation];priority:number}[]=[];
  for(const candidate of candidates){
    yield;
    const point={...candidate[1].feet,y:candidate[1].feet.y+1.2};
    const novelty=recent.length?awarenessNovelty(point,apparent(point),listener,recent):1;
    ranked.push({candidate,priority:-Math.log(Math.max(Number.EPSILON,Math.min(1-Number.EPSILON,random())))/novelty});
  }
  return ranked.sort((a,b)=>a.priority-b.priority).map(row=>row.candidate);
}
export function rankAwarenessSources(...args:Parameters<typeof rankAwarenessSourceWork>) {
  return finish(rankAwarenessSourceWork(...args));
}

/** Local mixture weights: common-hold kernels dominate; routes retain coverage. */
export function awarenessMixtureWeights(locations:readonly AwarenessLocation[]) {
  const weights=locations.map(p=>Number.isFinite(p.weight)&&p.weight!>0?p.weight!:1);
  const total=(route:boolean)=>weights.reduce((sum,w,i)=>sum+((locations[i].kind==='route')===route?w:0),0);
  const holds=total(false),routes=total(true);
  return weights.map((w,i)=>locations[i].kind==='route'?w/routes*(holds?1-AWARENESS_DENSITY_POLICY.holdShare:1):
    w/holds*(routes?AWARENESS_DENSITY_POLICY.holdShare:1));
}

/** Walk the whole local offset, never project through a wall or onto a lower exterior floor. */
function* walkAwarenessWork(anchor:Vec,dx:number,dz:number,arena:Arena,budget={moves:AWARENESS_DENSITY_POLICY.maxMoves as number}):Generator<void,Vec|undefined> {
  const height=canFitInArena(anchor,anchor.y,72*UNIT,arena)?72*UNIT:54*UNIT;
  if(!canFitInArena(anchor,anchor.y,height,arena))return;
  if(arena.native){
    const floor=arena.native.vertical(anchor,anchor.y+.015,anchor.y-.05,height);
    if(!floor.grounded||Math.abs(floor.feet-anchor.y)>.05)return;
  }
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.3));let from={...anchor};
  const world={solids:arena.solids,native:arena.native,bounds:arena,floor:arena.native?null:0};
  for(let i=1;i<=steps;i++){
    yield;
    if(--budget.moves<0)return;
    const to={x:anchor.x+dx*i/steps,y:from.y,z:anchor.z+dz*i/steps};
    const move=moveOnTerrain(from,to,height,world,true);
    if(!move.grounded||Math.abs(move.position.y-from.y)>18*UNIT+.005||Math.hypot(move.position.x-to.x,move.position.z-to.z)>.025||
      !canFitInArena(move.position,move.position.y,height,arena))return;
    from=move.position;
  }
  return from;
}
export function walkAwarenessOffset(...args:Parameters<typeof walkAwarenessWork>) {
  return finish(walkAwarenessWork(...args));
}

export function* awarenessSourceWork(listener:Vec,arena:Arena,authored:readonly AwarenessLocation[],random:()=>number):Generator<void,[string,AwarenessLocation][]> {
  const radius=AWARENESS_SOURCE_RADIUS,local=authored.filter(({feet:p,spread=1.8})=>
    Math.hypot(p.x-listener.x,p.y-listener.y,p.z-listener.z)<=radius+spread*AWARENESS_DENSITY_POLICY.cutoffSigma);
  if(!local.length)return [];
  const weights=awarenessMixtureWeights(local),candidates:AwarenessLocation[]=[],budget={moves:AWARENESS_DENSITY_POLICY.maxMoves as number};
  const draw=()=>Math.min(1-Number.EPSILON,Math.max(Number.EPSILON,random()));
  for(let attempt=0;attempt<AWARENESS_DENSITY_POLICY.maxAttempts&&candidates.length<AWARENESS_DENSITY_POLICY.maxSamples&&budget.moves>0;attempt++){
    yield;
    let ticket=draw(),index=0;
    for(;index<weights.length-1;index++){ticket-=weights[index];if(ticket<0)break;}
    const kernel=local[index],spread=kernel.spread??1.8;
    // Box-Muller samples a continuous local density, not a bearing around the listener.
    const r=Math.sqrt(-2*Math.log(draw())),theta=2*Math.PI*draw();if(r>AWARENESS_DENSITY_POLICY.cutoffSigma)continue;
    const feet=yield* walkAwarenessWork(kernel.feet,r*Math.cos(theta)*spread,r*Math.sin(theta)*spread,arena,budget);
    if(!feet||Math.hypot(feet.x-listener.x,feet.z-listener.z)<2||Math.hypot(feet.x-listener.x,feet.y-listener.y,feet.z-listener.z)>radius)continue;
    candidates.push({...kernel,feet,edge:kernel.edge?{x:kernel.edge.x+feet.x-kernel.feet.x,
      y:kernel.edge.y+feet.y-kernel.feet.y,z:kernel.edge.z+feet.z-kernel.feet.z}:undefined});
  }
  return [...new Map(candidates.map(p=>[`${p.feet.x.toFixed(2)}:${p.feet.y.toFixed(2)}:${p.feet.z.toFixed(2)}`,p])).entries()];
}
export function nearbyAwarenessSources(...args:Parameters<typeof awarenessSourceWork>) {
  return finish(awarenessSourceWork(...args));
}
export function awarenessRunEdge(feet:Vec,arena:Arena,authored?:Vec):Vec|undefined {
  if(authored&&Math.hypot(authored.x-feet.x,authored.z-feet.z)>=.65&&
    Math.hypot(authored.x-feet.x,authored.z-feet.z)<=4&&clearSegment(feet,authored,arena))return authored;
  if(!arena.native)return;
  for(const [x,z] of [[1.6,0],[-1.6,0],[0,1.6],[0,-1.6]]){
    const p={x:feet.x+x,y:feet.y,z:feet.z+z},floor=arena.native.vertical(p,p.y+.15,p.y-.45,72*UNIT);
    if(!floor.grounded)continue;const edge={...p,y:floor.feet};
    if(canFitInArena(edge,edge.y,72*UNIT,arena)&&clearSegment(feet,edge,arena))return edge;
  }
}
