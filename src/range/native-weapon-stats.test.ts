import {describe,expect,it} from 'vitest';
import fixture from './native-weapon-stats-fixture.json';
import {gameData,weaponIds} from './config';
import {resolveDamage} from './duel/damage';
import {UNIT} from './actor-physics';

describe('independent installed-archive weapon stats',()=>{
  it('covers every selectable firearm and pins its exact export/build',()=>{
    expect(Object.keys(fixture.weapons).sort()).toEqual([...weaponIds].sort());
    expect(fixture.build).toBe(gameData.build);expect(fixture.sha256).toBe(gameData.sha256);
  });
  it.each(weaponIds)('%s matches the native primary, alternate and control fields',id=>{
    const expected=fixture.weapons[id];
    expect(gameData.weapons[id]).toMatchObject(expected.primary);
    expect(gameData.weapons[id].alternate).toEqual(expected.alternate);
    const {primary:_,alternate:__,...flags}=expected;
    expect(gameData.weapons[id]).toMatchObject(flags);
  });
});
describe('weapon damage and armor arithmetic',()=>{
  it.each(weaponIds)('%s applies native damage, falloff, head multiplier and armor ratio in world units',id=>{
    const data=fixture.weapons[id].primary;
    for(const distance of [0,500*UNIT,25,50,100]) {
      const base=data.damage*Math.pow(data.rangeModifier,distance/(500*UNIT));
      expect(resolveDamage(id,'chest',distance,0,false).healthDamage).toBeCloseTo(base,8);
      expect(resolveDamage(id,'head',distance,0,false).healthDamage).toBeCloseTo(base*data.headshotMultiplier,8);
      expect(resolveDamage(id,'stomach',distance,0,false).healthDamage).toBeCloseTo(base*1.25,8);
      const leg=resolveDamage(id,'leg',distance,100,true);
      expect(leg.healthDamage).toBeCloseTo(base*.75,8);expect(leg.armorDamage).toBe(0);
      const head=resolveDamage(id,'head',distance,100,true);
      const chest=resolveDamage(id,'chest',distance,100,false);
      expect(chest.healthDamage).toBeCloseTo(base*Math.min(1,data.armorRatio/2),8);
      expect(head.healthDamage+head.armorDamage*2).toBeCloseTo(base*data.headshotMultiplier,8);
      expect(resolveDamage(id,'head',distance,100,false).healthDamage).toBeCloseTo(base*data.headshotMultiplier,8);
    }
  });
  it('AWP kills with a close armored chest hit, but not a leg hit; SSG needs a head hit',()=>{
    expect(resolveDamage('awp','chest',10,100,true).healthDamage).toBeGreaterThan(100);
    expect(resolveDamage('awp','leg',10,100,true).healthDamage).toBeLessThan(100);
    expect(resolveDamage('ssg08','chest',10,100,true).healthDamage).toBeLessThan(100);
    expect(resolveDamage('ssg08','head',10,100,true).healthDamage).toBeGreaterThan(100);
  });
  it('depletes low armor without inventing additional protection',()=>{
    const raw=resolveDamage('glock','chest',0,0,false).healthDamage;
    expect(resolveDamage('glock','chest',0,1,false)).toEqual({healthDamage:raw-2,armorDamage:1});
  });
});
