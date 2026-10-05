import {UNIT,type Vec} from '../actor-physics';
import {rayBox,traceActor} from './geometry';
import type {DuelActorSnapshot,Hitgroup} from './types';

export function traceMelee(origin:Vec,direction:Vec,actor:Pick<DuelActorSnapshot,'position'|'feet'|'duckAmount'>,range:number) {
  const feet={...actor.position,y:actor.feet};
  const line=traceActor(origin,direction,feet,actor.duckAmount,range);
  if(line.group)return line;
  // The knife retries a miss with a swept hull. Keep this separate from gun hitboxes.
  const halfWidth=16*UNIT,sweep=16*UNIT,height=(72-18*actor.duckAmount)*UNIT;
  const distance=rayBox(origin,direction,{x:feet.x-halfWidth-sweep,y:feet.y-sweep,z:feet.z-halfWidth-sweep},
    {x:feet.x+halfWidth+sweep,y:feet.y+height+sweep,z:feet.z+halfWidth+sweep},range);
  return {distance,group:Number.isFinite(distance)?'chest' as Hitgroup:undefined};
}
