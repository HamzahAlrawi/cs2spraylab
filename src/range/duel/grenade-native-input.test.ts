import {describe,expect,it} from 'vitest';
import native from './native-grenade-input-fixture.json';
import {approachGrenadeStrength,releasedGrenadeStrength,nativeGrenadeReleaseAt} from './grenade-native-input';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';

describe('installed native grenade input arithmetic',()=>{
  it.each(native.approachCases)('matches native strength $current -> $target',sample=>{
    expect(approachGrenadeStrength(sample.current,sample.target,1/64)).toBe(sample.result);
  });
  it.each(native.releaseCases)('matches native release timestamp $releasedAt',sample=>{
    expect(nativeGrenadeReleaseAt(sample.releasedAt)).toBe(sample.throwAt);
  });
  it('snaps near-middle releases using native float32 comparisons',()=>{
    expect(releasedGrenadeStrength(.59)).toBe(.5);expect(releasedGrenadeStrength(.41)).toBe(.5);
    expect(releasedGrenadeStrength(.6)).toBe(Math.fround(.6));expect(releasedGrenadeStrength(.39)).toBe(Math.fround(.39));
  });
  it('releases promptly after a short click rather than waiting for the pin animation',()=>{
    const sim=new DuelSimulation(sanitizeDuelConfig({botUtilities:false,utilityLoadout:['he'],playerHealth:500}),24,testArena());
    sim.command(1,{});sim.selectUtility('he');sim.start();
    sim.command(0,{fireHeld:true});sim.step();const primedAt=sim.time;
    sim.command(0,{fireHeld:false});
    for(let i=0;i<16;i++)sim.step();
    expect(sim.time-primedAt).toBeLessThan(.15);expect(sim.utilities.projectiles).toHaveLength(1);
    expect(sim.utilityInventory().he).toBe(0);expect(sim.actors[0].weapon.ammo).toBe(30);
  });
  it('approaches a changed hold strength instead of instantly switching to a different throw',()=>{
    const sim=new DuelSimulation(sanitizeDuelConfig({botUtilities:false,utilityLoadout:['he'],playerHealth:500}),24,testArena());
    sim.command(1,{});sim.selectUtility('he');sim.start();sim.command(0,{fireHeld:true});sim.step();
    sim.command(0,{fireHeld:true,secondaryHeld:true});sim.step();
    expect(sim.utilityPresentation()?.strength).toBeGreaterThan(.9);
    for(let i=0;i<50;i++)sim.step();expect(sim.utilityPresentation()?.strength).toBe(.5);
  });
  it('does not postpone a queued release when a touch button is tapped repeatedly',()=>{
    const sim=new DuelSimulation(sanitizeDuelConfig({botUtilities:false,utilityLoadout:['he']}),24,testArena());
    sim.command(1,{});sim.selectUtility('he');sim.start();sim.queueUtilityThrow(0);
    const at=sim.utilityPresentation()!.releaseAt;sim.step();sim.queueUtilityThrow(0);
    expect(sim.utilityPresentation()!.releaseAt).toBe(at);
  });
});
