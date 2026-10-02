import {describe, expect, it} from 'vitest';
import fixture from './aim-punch-native-fixture.json';
import {DamagePunch, damagePunch, recoverDamagePunch} from './aim-punch';
import {DEG, STEP} from './actor-physics';
import type {Hitgroup} from './duel/types';
import {gameData} from './config';
import {WeaponRecovery} from './ballistics';
import {direction, shotDirection} from './shot-model';

describe('native damage punch', () => {
  it.each(fixture.cases.map((value, index) => [index, value] as const))('matches offline hitgroup fixture %s', (_, value) => {
    const punch = damagePunch({...value, group: value.group as Hitgroup}, () => value.random);
    for (const axis of ['pitch', 'yaw', 'roll'] as const) expect(punch[axis]).toBeCloseTo(value.angle[axis], 5);
  });

  it.each(fixture.recovery.map((value, index) => [index, value] as const))('matches offline recovery fixture %s', (_, value) => {
    const angle = recoverDamagePunch(value.before, STEP);
    for (const axis of ['pitch', 'yaw', 'roll'] as const) expect(angle[axis]).toBeCloseTo(value.after[axis], 5);
  });

  it('uses raw hit damage, retains a small armored torso punch, and suppresses helmet head punch', () => {
    const bare = damagePunch({group: 'chest', rawDamage: 36, armor: 0, helmet: false}, () => .5);
    const vest = damagePunch({group: 'chest', rawDamage: 36, armor: 100, helmet: true}, () => .5);
    expect(bare.pitch).toBeGreaterThan(vest.pitch * 6); expect(vest.pitch).toBeGreaterThan(0);
    expect(damagePunch({group: 'head', rawDamage: 144, armor: 100, helmet: true}, () => .5).pitch).toBe(0);
  });

  it('recovers all three axes together without reversing or drifting the base aim', () => {
    const punch = new DamagePunch(() => .8);
    punch.hit({group: 'head', rawDamage: 20, armor: 0, helmet: false});
    const original = {...punch.angle}, ratio = original.roll / original.pitch;
    for (let tick = 0; tick < 512; tick++) {
      const before = {...punch.angle}; punch.advance(STEP);
      expect(punch.angle.pitch).toBeLessThanOrEqual(before.pitch);
      expect(punch.angle.roll).toBeLessThanOrEqual(before.roll);
      if (punch.angle.pitch > .001) expect(punch.angle.roll / punch.angle.pitch).toBeCloseTo(ratio, 5);
      expect(punch.angle.pitch).toBeGreaterThanOrEqual(0);
    }
    expect(punch.angle).toEqual({pitch: 0, yaw: 0, roll: 0});
  });

  it('stacks successive hits and predicts a fraction without mutating authoritative punch', () => {
    const punch = new DamagePunch(() => .5), hit = {group: 'chest' as const, rawDamage: 36, armor: 100, helmet: true};
    punch.hit(hit); const first = {...punch.angle};
    punch.advance(STEP); punch.hit(hit); expect(punch.angle.pitch).toBeGreaterThan(first.pitch);
    const before = {...punch.angle};
    const midpoint = punch.predict(STEP / 2), next = recoverDamagePunch(before, STEP);
    expect(midpoint.pitch).toBeCloseTo(before.pitch + next.pitch, 5);
    expect(punch.angle).toEqual(before);
  });

  it('suppresses sub-threshold visible angles without discarding the recovery cache', () => {
    const punch = new DamagePunch(); punch.angle = {pitch: .02, yaw: 0, roll: .01};
    expect(punch.shot).toEqual({pitch: 0, yaw: 0, roll: 0});
    expect(punch.angle.pitch).toBe(.02);
  });

  it('recovers damage and recoil in one shared cache instead of subtracting linear decay twice', () => {
    const punch = new DamagePunch(), base = {pitch: 6, yaw: -4};
    punch.angle = {pitch: .54, yaw: 0, roll: .2};
    const expected = recoverDamagePunch({pitch: Math.fround(6 + .54), yaw: -4, roll: .2}, STEP);
    const withoutHit = recoverDamagePunch({...base, roll: 0}, STEP);
    const independent = recoverDamagePunch(punch.angle, STEP);
    punch.advance(STEP, base);
    expect(punch.angle.pitch + withoutHit.pitch).toBeCloseTo(expected.pitch, 5);
    expect(punch.angle.yaw + withoutHit.yaw).toBeCloseTo(expected.yaw, 5);
    expect(punch.angle.roll).toBeCloseTo(expected.roll, 5);
    expect(punch.angle.pitch).toBeGreaterThan(independent.pitch);
  });

  it('preserves zero-damage recoil exactly and retains small punch during an active spray', () => {
    const punch = new DamagePunch(), base = {pitch: 7, yaw: 3};
    punch.advance(STEP, base);
    expect(punch.shotFor(base)).toEqual({pitch: 0, yaw: 0, roll: 0});
    expect(base).toEqual({pitch: 7, yaw: 3});
    punch.angle.pitch = .02;
    expect(punch.shot.pitch).toBe(0);
    expect(punch.shotFor(base).pitch).toBeCloseTo(.04, 5);
  });

  it('adds physical punch once to the shot ray without altering recoil, spread recovery or old impacts', () => {
    const weapon = gameData.weapons.ak47, recovery = new WeaponRecovery(weapon);
    const aim = {yaw: .3, pitch: -.1, recoil: {yaw: .4, pitch: 1}, weapon, recovery,
      speedRatio: 0, walking: false, airborne: false, verticalSpeedUnits: 0, spread: false};
    const normal = shotDirection(aim), storedImpact = {...normal}, punch = {yaw: .2, pitch: 3};
    const punched = shotDirection({...aim, punch});
    expect(punched).toEqual(direction(.3 - .6 * DEG, -.1 + 4 * DEG));
    expect(punched.y).toBeGreaterThan(normal.y);
    expect(normal).toEqual(storedImpact); expect(recovery.recoil).toEqual({yaw: 0, pitch: 0});
  });

  it('rotates the spread plane with head-hit roll without changing cone size', () => {
    const weapon = gameData.weapons.ak47, recovery = new WeaponRecovery(weapon);
    const aim = {yaw: 0, pitch: 0, recoil: {yaw: 0, pitch: 0}, weapon, recovery,
      speedRatio: 0, walking: false, airborne: false, verticalSpeedUnits: 0, spread: true};
    const random = () => {let index = 0; return () => [0, 0, 1, 0][index++ % 4];};
    const horizontal = shotDirection(aim, random());
    const rolled = shotDirection({...aim, punch: {yaw: 0, pitch: 0, roll: 90}}, random());
    expect(horizontal.x).toBeGreaterThan(0); expect(horizontal.y).toBe(0);
    expect(rolled.x).toBeCloseTo(0, 8); expect(rolled.y).toBeCloseTo(horizontal.x, 8);
    expect(rolled.z).toBeCloseTo(horizontal.z, 8);
  });
});
