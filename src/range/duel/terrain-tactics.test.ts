import {describe,expect,it} from 'vitest';
import {advanceActor,idleInput,STEP,UNIT,type ActorKinematics} from '../actor-physics';
import {TerrainTactics} from './terrain-tactics';
import {environmentPOIs,placePOI} from './arena-pois';
import {createEnvironmentState,environmentTerrainWorld} from './environment';
import {DuelSimulation} from './simulation';
import {testArena} from './geometry';
import type {TacticalPeer} from './coordination';

function fixture(kind:'stairs'|'ladder') {
  const placed=placePOI(environmentPOIs.find(poi=>poi.id==='freight-container-loft')!,{x:0,y:0,z:0},1,1,'fixture',0);
  const link=placed.links.find(link=>link.kind===kind)!;
  const arena={...testArena(),solids:placed.solids,traversalVolumes:placed.volumes,traversalLinks:[link]};
  const peer:TacticalPeer={actor:{...new DuelSimulation().snapshot()[1],position:{...link.from,y:64*UNIT},feet:0,grounded:true,velocity:{x:0,z:0}},level:8,behavior:'patient'};
  return {arena,peer,link,state:createEnvironmentState(arena)};
}

describe('terrain-aware scouting',()=>{
  it.each(['stairs','ladder'] as const)('executes a %s route using the same actor physics as the player',kind=>{
    const f=fixture(kind),planner=new TerrainTactics(3),world=environmentTerrainWorld(f.arena);
    let actor:ActorKinematics={...f.peer.actor,eyeHeight:64*UNIT,verticalVelocity:0,jumpHeld:false},reached=false;
    for(let tick=0;tick<128*40;tick++) {
      const time=2+tick*STEP,plan=planner.plan(time,[f.peer],f.arena,f.state);
      actor=advanceActor(actor,{...idleInput(),...plan?.command},225*UNIT,STEP,undefined,undefined,undefined,{...world,time,pitch:0});
      Object.assign(f.peer.actor,actor);
      if(actor.grounded&&Math.abs(actor.feet-f.link.to.y)<.15&&Math.hypot(actor.position.x-f.link.to.x,actor.position.z-f.link.to.z)<.3){reached=true;break;}
    }
    expect(reached,JSON.stringify(actor)).toBe(true);
  });
  it('does not route novices or ignore a recently sensed enemy',()=>{
    const f=fixture('stairs'),planner=new TerrainTactics(1);f.peer.level=3;
    for(let time=2;time<100;time++)expect(planner.plan(time,[f.peer],f.arena,f.state)).toBeUndefined();
    f.peer.level=8;f.peer.contactAt=101;
    expect(planner.plan(101,[f.peer],f.arena,f.state)).toBeUndefined();
  });
});
