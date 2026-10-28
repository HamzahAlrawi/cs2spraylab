import {describe,expect,it,vi} from 'vitest';
import native from './native-grenade-launch-fixture.json';
import {nativeGrenadePitch,nativeGrenadeVelocity,nativeGrenadeThrowVelocity} from './grenade-native-launch';
import {utilityLaunchPose} from './utility-ballistics';
import {testArena} from './geometry';
import {UNIT,DEG} from '../actor-physics';
import {utilityKinds} from './utility-loadout';

const world=(v:number[])=>({x:v[0]*UNIT,y:v[2]*UNIT,z:-v[1]*UNIT});
describe('installed CS2 grenade launch arithmetic',()=>{
  it.each(native.cases)('matches native pitch=$pitchUpDegrees strength=$strength speed=$throwVelocity',sample=>{
    const eye=world(sample.eye),arena=testArena();
    const sweep=vi.fn((from:{x:number;y:number;z:number},to:typeof from)=>({
      position:{x:from.x+(to.x-from.x)*sample.traceFraction,y:from.y+(to.y-from.y)*sample.traceFraction,z:from.z+(to.z-from.z)*sample.traceFraction},
      fraction:sample.traceFraction,startSolid:false}));
    Object.assign(arena,{native:{sweepGrenade:sweep}});
    const launch=utilityLaunchPose(eye,0,sample.pitchUpDegrees*DEG,arena,sample.strength);
    const velocity=nativeGrenadeVelocity(launch.direction,sample.strength,world(sample.actorVelocity),sample.throwVelocity);
    expect(nativeGrenadePitch(sample.pitchUpDegrees*DEG)/DEG).toBeCloseTo(-sample.adjustedPitchDownDegrees,5);
    for(const axis of ['x','y','z']as const){
      expect(launch.origin[axis]).toBeCloseTo(world(sample.origin)[axis],5);
      expect(velocity[axis]).toBeCloseTo(world(sample.velocity)[axis],5);
    }
    expect(sweep.mock.calls[0][0]).toEqual(world(sample.traceSource));
    expect((sweep.mock.calls[0]as unknown[])[2]).toBeCloseTo(2.02*UNIT,8);
  });
  it('uses the extracted per-grenade velocity rather than hardcoding weapon identity',()=>{
    for(const kind of utilityKinds)expect(nativeGrenadeThrowVelocity(kind)).toBe(750);
  });
});
