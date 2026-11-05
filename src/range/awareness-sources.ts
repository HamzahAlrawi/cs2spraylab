import {UNIT,type Vec} from './actor-physics';
import {canFitInArena,type Arena} from './duel/geometry';
import {clearSegment} from './duel/navigation';
import type {AwarenessLocation} from './awareness-map';
import {moveOnTerrain} from './actor-collision';

export const AWARENESS_SOURCE_RADIUS=28,AWARENESS_RELOCATE_DISTANCE=8;
export const AWARENESS_DENSITY_POLICY={holdShare:.8,maxAttempts:96,maxSamples:32,maxMoves:384,cutoffSigma:2.5} as const;

/** Local mixture weights: common-hold kernels dominate; routes retain coverage. */
export function awarenessMixtureWeights(locations:readonly AwarenessLocation[]) {
  const weights=locations.map(p=>Number.isFinite(p.weight)&&p.weight!>0?p.weight!:1);
  const total=(route:boolean)=>weights.reduce((sum,w,i)=>sum+((locations[i].kind==='route')===route?w:0),0);
  const holds=total(false),routes=total(true);
  return weights.map((w,i)=>locations[i].kind==='route'?w/routes*(holds?1-AWARENESS_DENSITY_POLICY.holdShare:1):
    w/holds*(routes?AWARENESS_DENSITY_POLICY.holdShare:1));
}

/** Walk the whole local offset, never project through a wall or onto a lower exterior floor. */
export function walkAwarenessOffset(anchor:Vec,dx:number,dz:number,arena:Arena,budget={moves:AWARENESS_DENSITY_POLICY.maxMoves as number}):Vec|undefined {
  const height=canFitInArena(anchor,anchor.y,72*UNIT,arena)?72*UNIT:54*UNIT;
  if(!canFitInArena(anchor,anchor.y,height,arena))return;
  if(arena.native){
    const floor=arena.native.vertical(anchor,anchor.y+.015,anchor.y-.05,height);
    if(!floor.grounded||Math.abs(floor.feet-anchor.y)>.05)return;
  }
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.3));let from={...anchor};
  const world={solids:arena.solids,native:arena.native,bounds:arena,floor:arena.native?null:0};
  for(let i=1;i<=steps;i++){
    if(--budget.moves<0)return;
    const to={x:anchor.x+dx*i/steps,y:from.y,z:anchor.z+dz*i/steps};
    const move=moveOnTerrain(from,to,height,world,true);
    if(!move.grounded||Math.abs(move.position.y-from.y)>18*UNIT+.005||Math.hypot(move.position.x-to.x,move.position.z-to.z)>.025||
      !canFitInArena(move.position,move.position.y,height,arena))return;
    from=move.position;
  }
  return from;
}

export function nearbyAwarenessSources(listener:Vec,arena:Arena,authored:readonly AwarenessLocation[],random:()=>number) {
  const radius=AWARENESS_SOURCE_RADIUS,local=authored.filter(({feet:p})=>
    Math.hypot(p.x-listener.x,p.y-listener.y,p.z-listener.z)<=radius+2);
  if(!local.length)return [];
  const weights=awarenessMixtureWeights(local),candidates:AwarenessLocation[]=[],budget={moves:AWARENESS_DENSITY_POLICY.maxMoves as number};
  const draw=()=>Math.min(1-Number.EPSILON,Math.max(Number.EPSILON,random()));
  for(let attempt=0;attempt<AWARENESS_DENSITY_POLICY.maxAttempts&&candidates.length<AWARENESS_DENSITY_POLICY.maxSamples&&budget.moves>0;attempt++){
    let ticket=draw(),index=0;
    for(;index<weights.length-1;index++){ticket-=weights[index];if(ticket<0)break;}
    const kernel=local[index],spread=kernel.spread??.65;
    // Box-Muller samples a continuous local density, not a bearing around the listener.
    const r=Math.sqrt(-2*Math.log(draw())),theta=2*Math.PI*draw();if(r>AWARENESS_DENSITY_POLICY.cutoffSigma)continue;
    const feet=walkAwarenessOffset(kernel.feet,r*Math.cos(theta)*spread,r*Math.sin(theta)*spread,arena,budget);
    if(!feet||Math.hypot(feet.x-listener.x,feet.z-listener.z)<2||Math.hypot(feet.x-listener.x,feet.y-listener.y,feet.z-listener.z)>radius)continue;
    candidates.push({...kernel,feet,edge:kernel.edge?{x:kernel.edge.x+feet.x-kernel.feet.x,
      y:kernel.edge.y+feet.y-kernel.feet.y,z:kernel.edge.z+feet.z-kernel.feet.z}:undefined});
  }
  return [...new Map(candidates.map(p=>[`${p.feet.x.toFixed(2)}:${p.feet.y.toFixed(2)}:${p.feet.z.toFixed(2)}`,p])).entries()];
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
