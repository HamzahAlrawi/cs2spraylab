import {UNIT,type Vec} from './actor-physics';
import {canFitInArena,type Arena} from './duel/geometry';
import {clearSegment} from './duel/navigation';
import type {AwarenessLocation} from './awareness-map';

export const AWARENESS_SOURCE_RADIUS=28,AWARENESS_RELOCATE_DISTANCE=8;
export function nearbyAwarenessSources(listener:Vec,arena:Arena,authored:readonly AwarenessLocation[],random:()=>number) {
  const radius=AWARENESS_SOURCE_RADIUS;
  const candidates=authored.filter(({feet:p})=>Math.hypot(p.x-listener.x,p.y-listener.y,p.z-listener.z)<=radius&&
    Math.hypot(p.x-listener.x,p.z-listener.z)>=2).map(point=>({point,order:random()})).sort((a,b)=>a.order-b.order)
    .slice(0,32).map(({point})=>point);
  // Local support samples cover walkable areas between the authored training routes.
  if(arena.native){
    const rotation=random()*Math.PI*2;
    for(let i=0;i<32;i++){
      const angle=rotation+i*Math.PI*(3-Math.sqrt(5)),distance=[3,6,10,16,24][i%5];
      const p={x:listener.x+Math.cos(angle)*distance,y:listener.y,z:listener.z+Math.sin(angle)*distance};
      const floor=arena.native.vertical(p,p.y+1.25,p.y-5,72*UNIT);
      if(!floor.grounded)continue;const feet={...p,y:floor.feet};
      if(canFitInArena(feet,feet.y,54*UNIT,arena))candidates.push({feet});
    }
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
