import {describe,expect,it} from 'vitest';
import fixture from './native-grenade-blast-fixture.json';
import {nativeHEBlastDamage,nativeHEArmorDamage,nativeHEStats} from './grenade-native-blast';
import {UtilitySimulation,UTILITY_RULES} from './utilities';
import {testArena} from './geometry';
import {UNIT} from '../actor-physics';
import {nativeUtilityDefault} from './native-utility-defaults';

describe('installed native HE arithmetic',()=>{
  it.each(fixture.curveCases)('matches native SSE curve at $distanceUnits units, exposure $exposure',sample=>{
    expect(nativeHEBlastDamage(sample.distanceUnits,sample.exposure)).toBe(sample.damage);
  });
  it.each(fixture.armorCases)('matches native blast armor for damage=$damage armor=$armor',sample=>{
    expect(nativeHEArmorDamage(sample.damage,sample.armor)).toEqual({healthDamage:sample.healthDamage,armorDamage:sample.armorDamage});
  });
  it('uses the current extracted HE fields and does not misread radius as damage',()=>{
    expect(nativeHEStats).toEqual({damage:99,radiusUnits:350,armorRatio:1.2});
    expect(nativeHEArmorDamage(99,0)).toEqual({healthDamage:99,armorDamage:0});
    expect(nativeHEBlastDamage(NaN)).toBe(0);expect(nativeHEBlastDamage(-1)).toBe(0);
  });
  it('does not pretend the curve itself has a body-point cutoff at 350 units',()=>{
    expect(nativeHEBlastDamage(350)).toBeGreaterThan(1);expect(nativeHEBlastDamage(400)).toBeGreaterThan(0);
  });
});

describe('verified native utility defaults and smoke detonation',()=>{
  it('sources fire configuration from fresh registration evidence and fails on unknowns',()=>{
    expect(UTILITY_RULES.fireTick).toBe(nativeUtilityDefault('inferno_damage_timer'));
    expect(UTILITY_RULES.fireFuse).toBe(2);expect(UTILITY_RULES.molotovRadius).toBe(150*UNIT);
    expect(()=>nativeUtilityDefault('unknown_guess')).toThrow();
  });
  it('does not pop a settled smoke at the old arbitrary 200ms threshold',()=>{
    const sim=new UtilitySimulation(),arena=testArena();
    sim.throw({actorId:0,side:'player',kind:'smoke',origin:{x:0,y:.06,z:0},direction:{x:0,y:-1,z:0},
      velocity:{x:0,y:UTILITY_RULES.throwSpeed*.3/1.25,z:0},strength:0,time:0});
    for(let i=1;i<=150;i++)sim.advance(1/128,i/128,arena,[]);
    expect(sim.effects).toHaveLength(0);expect(sim.projectiles).toHaveLength(1);
    for(let i=151;i<=160;i++)sim.advance(1/128,i/128,arena,[]);
    expect(sim.effects[0]?.type).toBe('smoke');expect(sim.effects[0].startedAt).toBeGreaterThanOrEqual(Math.fround(1.188));
  });
});
