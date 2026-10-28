import {describe,expect,it} from 'vitest';
import fixture from './native-grenade-flight-fixture.json';
import {clipNativeGrenadeVelocity,nativeGrenadeContact,nativeGrenadeThinkTick,nativeGrenadeNextThinkTick,NATIVE_GRENADE_FLIGHT} from './grenade-native-flight';
import {UNIT} from '../actor-physics';
import {UtilitySimulation} from './utilities';
import {testArena} from './geometry';

const convert=(v:number[])=>({x:v[0],y:v[2],z:-v[1]});
describe('native grenade contact and independent think clock',()=>{
  it.each(fixture.clipCases)('matches isolated native clip $velocitySourceUnits against $normalSource',sample=>{
    const result=clipNativeGrenadeVelocity(convert(sample.velocitySourceUnits),convert(sample.normalSource)),expected=convert(sample.clippedSourceUnits);
    for(const axis of ['x','y','z']as const)expect(result[axis]).toBeCloseTo(expected[axis],5);
  });
  it.each(fixture.thinkCases)('matches native requested-time quantization at $requested',sample=>{
    expect(nativeGrenadeThinkTick(sample.requested)).toBe(sample.tick);
  });
  it('uses a normal velocity bias, not a positional offset or arbitrary component zeroing',()=>{
    expect(clipNativeGrenadeVelocity({x:0,y:0,z:0},{x:0,y:1,z:0}).y).toBe(.03125);
    expect(NATIVE_GRENADE_FLIGHT.gravity).toBe(320);
  });
  it('settles slow floor contact but not a slow wall or ineligible actor contact',()=>{
    const v={x:0,y:-5*UNIT,z:0},floor={x:0,y:1,z:0};
    expect(nativeGrenadeContact(v,floor).resting).toBe(true);
    expect(nativeGrenadeContact(v,floor,false).resting).toBe(false);
    expect(nativeGrenadeContact({x:-5*UNIT,y:0,z:0},{x:1,y:0,z:0}).resting).toBe(false);
  });
  it('attenuates steep high-speed floor rebounds only on the support branch',()=>{
    const v={x:0,y:-1000*UNIT,z:0},n={x:0,y:1,z:0};
    const floor=nativeGrenadeContact(v,n),unsupported=nativeGrenadeContact(v,n,false);
    expect(floor.resting).toBe(false);expect(floor.velocity.y/UNIT).toBeCloseTo(225.007,2);
    expect(unsupported.velocity.y).toBeCloseTo(floor.velocity.y*2,5);
  });
  it('keeps the fuse deadline separate from tick-rounded think polling',()=>{
    expect(nativeGrenadeNextThinkTick(0)).toBe(13);
    const sim=new UtilitySimulation(),arena=testArena();
    sim.throw({actorId:0,side:'player',kind:'he',origin:{x:0,y:1,z:0},direction:{x:1,y:0,z:0},strength:0,time:0});
    let detonated=false;
    for(let i=1;i<=192;i++)detonated=sim.advance(1/128,i/128,arena,[]).some(e=>e.type==='detonate')||detonated;
    expect(detonated).toBe(false);
    for(let i=193;i<=224;i++)detonated=sim.advance(1/128,i/128,arena,[]).some(e=>e.type==='detonate')||detonated;
    expect(detonated).toBe(true);
  });
  it('does not bounce from an artificial native chunk extent without a physical collider',()=>{
    const sim=new UtilitySimulation(),arena=testArena();
    Object.assign(arena,{native:{sweepGrenade:(_from:unknown,to:unknown)=>({position:to,fraction:1,startSolid:false})}});
    sim.throw({actorId:0,side:'player',kind:'he',origin:{x:arena.maxX-.01,y:1,z:0},direction:{x:1,y:0,z:0},strength:1,time:0});
    const events=sim.advance(1/128,1/128,arena,[]);
    expect(sim.projectiles[0].position.x).toBeGreaterThan(arena.maxX);
    expect(events.some(event=>event.type==='bounce')).toBe(false);
  });
});
