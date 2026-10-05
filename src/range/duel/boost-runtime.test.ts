import {describe,expect,it} from 'vitest';
import {advanceActor,idleInput,STEP,UNIT,type ActorKinematics} from '../actor-physics';
import {BoostPlanner,type TacticalPeer} from './coordination';
import {environmentPOIs,placePOI} from './arena-pois';
import {arenaBoostPOIs,environmentTerrainWorld} from './environment';
import {DuelSimulation} from './simulation';
import {testArena} from './geometry';

describe('coordinated boost executes real movement',()=>{
  it.each([false,true])('mounts a crouched partner and reaches the loft; ground stair approach = %s',fromGround=>{
    const placed=placePOI(environmentPOIs.find(poi=>poi.id==='freight-container-loft')!,{x:0,y:0,z:0},1,1,'fixture',0);
    const arena={...testArena(),solids:placed.solids,traversalVolumes:placed.volumes,traversalLinks:placed.links};
    const poi=arenaBoostPOIs(arena)[0],approach=placed.links.find(link=>link.id===poi.approachLinkId)!;
    const world=environmentTerrainWorld(arena),planner=new BoostPlanner(),snapshots=new DuelSimulation().snapshot();
    const peers:TacticalPeer[]=[1,2].map((id,index)=>({actor:{...snapshots[1],id,position:{...(index?poi.mount:poi.base),y:poi.base.y+64*UNIT},feet:poi.base.y,
      grounded:true,duckAmount:index?0:1,velocity:{x:0,z:0}},level:8}));
    if(fromGround)for(let index=0;index<2;index++)Object.assign(peers[index].actor,{position:{x:approach.from.x,y:64*UNIT,z:approach.from.z-index},feet:0,duckAmount:0});
    const bodies:ActorKinematics[]=peers.map(peer=>({...peer.actor,verticalVelocity:0,jumpHeld:false,eyeHeight:64*UNIT}));
    const opportunity={...poi,approachFrom:approach.from,approachTo:approach.to};
    let held=false,mounted=false;
    for(let tick=0;tick<128*10;tick++) {
      const plan=planner.plan(tick*STEP,peers,[opportunity],()=>true);
      if(plan?.phase==='hold'){held=true;break;}
      for(let index=0;index<2;index++) {
        const peer=peers[index],command=plan?.commands.find(item=>item.actorId===peer.actor.id)?.command??{};
        bodies[index]=advanceActor(bodies[index],{...idleInput(),...command},250*UNIT,STEP,undefined,undefined,undefined,
          {...world,time:tick*STEP,selfId:peer.actor.id,actors:bodies.map((body,i)=>({...body,id:peers[i].actor.id,alive:true}))});
        const support=bodies[index].supportId;
        Object.assign(peer.actor,bodies[index]);peer.actor.supportingActor=typeof support==='number'?support:undefined;
        mounted||=index===1&&bodies[index].supportId===1;
      }
    }
    expect(mounted,JSON.stringify(bodies)).toBe(true);expect(held,JSON.stringify(bodies)).toBe(true);
    expect(bodies[1].feet).toBeCloseTo(poi.perch.y,5);
  });
});
