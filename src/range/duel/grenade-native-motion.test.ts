import {describe,it,expect} from 'vitest';
import fixture from './native-grenade-motion-fixture.json';
import {UNIT,type Vec} from '../actor-physics';
import {nativeGrenadeContact,nativeGrenadeFlightStep,nativeGrenadeResidualDelta,nativeGrenadeSecondaryDelta} from './grenade-native-flight';
import {UtilitySimulation} from './utilities';
import {testArena} from './geometry';

const world=(v:number[])=>({x:v[0]*UNIT,y:v[2]*UNIT,z:-v[1]*UNIT});
const normal=(v:number[])=>({x:v[0],y:v[2],z:-v[1]});
const close=(actual:Vec,expected:number[])=>{
  const v=world(expected);for(const axis of ['x','y','z']as const)expect(actual[axis]).toBeCloseTo(v[axis],9);
};
describe('installed 2000942 grenade motion arithmetic',()=>{
  it.each(fixture.smokes)('keeps the native smoke age/speed gate at age=$age speed=$speed',sample=>{
    expect(sample.age>=Math.fround(1.188)&&sample.speed<=Math.fround(.1)).toBe(sample.detonated);
  });
  it.each(fixture.integration)('matches native integration at $dt with $velocity',sample=>{
    const move=nativeGrenadeFlightStep(world(sample.velocity),sample.dt);
    close(move.delta,sample.delta);close(move.velocity,sample.after);
  });
  it.each(fixture.contacts)('matches native response and residual pushes: $velocity, $normal, secondary=$secondaryFraction',sample=>{
    const response=nativeGrenadeContact(world(sample.velocity),normal(sample.normal),sample.supportEligible);
    close(response.velocity,sample.after);expect(response.resting).toBe(sample.resting);
    const pushes:Vec[]=[];
    if(!response.resting){
      pushes.push(nativeGrenadeResidualDelta(response.velocity,sample.dt,sample.fraction));
      if(!response.supported&&sample.secondaryFraction<.5)
        pushes.push(nativeGrenadeSecondaryDelta(pushes[0],sample.secondaryFraction,normal(sample.secondaryNormal)));
    }
    expect(pushes).toHaveLength(sample.pushes.length);pushes.forEach((delta,i)=>close(delta,sample.pushes[i]));
  });
  it('does not apply full restitution twice at a wall/floor corner within one substep',()=>{
    const sim=new UtilitySimulation(),arena=testArena();let queries=0;
    const traceNormals=[{x:-1,y:0,z:0},{x:0,y:1,z:0}],fractions=[.4,.2];
    Object.assign(arena,{native:{sweepGrenade:(from:Vec,to:Vec)=>{
      const index=queries++,fraction=fractions[index]??1;
      return{position:{x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction,z:from.z+(to.z-from.z)*fraction},
        fraction,startSolid:false,contact:index<2?{normal:traceNormals[index]}:undefined};
    }}});
    sim.throw({actorId:0,side:'player',kind:'smoke',origin:{x:0,y:2,z:0},direction:{x:1,y:0,z:0},strength:1,time:0});
    const before={...sim.projectiles[0].velocity};
    const expected=nativeGrenadeContact(nativeGrenadeFlightStep(before,1/128).velocity,traceNormals[0]);
    const events=sim.advance(1/128,1/128,arena,[]);
    expect(queries).toBe(3);expect(events.filter(e=>e.type==='bounce')).toHaveLength(1);
    expect(sim.projectiles[0].velocity).toEqual(expected.velocity);expect(sim.projectiles[0].bounces).toBe(1);
  });
  it('does not delete a high jump smoke after eight seconds before its native settle gate',()=>{
    const sim=new UtilitySimulation(),arena={...testArena(),minX:-200,maxX:200,minZ:-200,maxZ:200};
    sim.throw({actorId:0,side:'player',kind:'smoke',origin:{x:0,y:2,z:0},direction:{x:0,y:1,z:0},
      velocity:{x:100/1.25*UNIT,y:(950-675)/1.25*UNIT,z:0},strength:1,time:0});
    let detonated=false;
    for(let tick=1;tick<=8*128;tick++)
      detonated ||= sim.advance(1/128,tick/128,arena,[]).some(event=>event.type==='detonate');
    expect(detonated).toBe(false);expect(sim.projectiles).toHaveLength(1);
    for(let tick=8*128+1;tick<=12*128&&!detonated;tick++)
      detonated=sim.advance(1/128,tick/128,arena,[]).some(event=>event.type==='detonate');
    expect(detonated).toBe(true);expect(sim.projectiles).toHaveLength(0);
  });
});
