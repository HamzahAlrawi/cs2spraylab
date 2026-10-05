import {UNIT,type ActorEnvironment} from '../actor-physics';
import type {ContactActor} from '../actor-contact';
import type {TerrainSolid} from '../terrain';
import type {Arena} from './geometry';
import {blocksMovement} from './environment';
import {actorHeight} from '../actor-contact';
import {moveOnTerrain} from '../actor-collision';
import type {Vec} from '../actor-physics';

const terrainCache=new WeakMap<Arena,{source:Arena['solids'];volumes:Arena['traversalVolumes'];solids:TerrainSolid[]}>();

export function arenaTerrain(arena:Arena):TerrainSolid[] {
  const cached=terrainCache.get(arena);
  if(cached?.source===arena.solids&&cached.volumes===arena.traversalVolumes)return cached.solids;
  const solids:TerrainSolid[]=arena.solids.filter(blocksMovement).map(solid=>({center:solid.center,size:solid.size,id:solid.id,
    traversal:solid.shape?{kind:'ramp',axis:solid.shape.axis,rise:solid.size.y,direction:solid.shape.highSide}:undefined}));
  for(const volume of arena.traversalVolumes??[]) solids.push({id:volume.id,center:volume.center,size:volume.size,
    traversal:volume.kind==='water'?{kind:'water',surfaceY:volume.water?.surfaceY}:{kind:'ladder',normal:{x:volume.ladder?.axis==='x'?(volume.ladder.facing??1):0,
      y:0,z:volume.ladder?.axis==='z'?(volume.ladder.facing??1):0}}});
  terrainCache.set(arena,{source:arena.solids,volumes:arena.traversalVolumes,solids});
  return solids;
}

export function arenaMovementEnvironment(arena:Arena,actors:readonly ContactActor[],selfId:number,time:number,pitch:number):ActorEnvironment {
  return {solids:arenaTerrain(arena),bounds:arena,floor:0,actors,selfId,time,pitch,
    jumpRules:{bhopWindow:1/128,spamTime:1/64,autoBhop:false,enableBunnyhopping:false}};
}

export const actorBody=(actor:ContactActor)=>({center:{x:actor.position.x,y:actor.feet+actorHeight(actor)/2,z:actor.position.z},
  size:{x:32*UNIT,y:actorHeight(actor),z:32*UNIT}});

export function canWalkTo(from:Vec,to:Vec,arena:Arena) {
  const length=Math.hypot(to.x-from.x,to.z-from.z);
  if(length>12)return false;
  const world={solids:arenaTerrain(arena),floor:0,bounds:arena};
  let at={...from};const steps=Math.max(1,Math.ceil(length/.12));
  for(let step=1;step<=steps;step++) {
    const moved=moveOnTerrain(at,{x:from.x+(to.x-from.x)*step/steps,y:at.y,z:from.z+(to.z-from.z)*step/steps},72*UNIT,world,true);
    if(!moved.grounded)return false;
    at=moved.position;
  }
  return Math.hypot(at.x-to.x,at.z-to.z)<.15&&Math.abs(at.y-to.y)<.06;
}
