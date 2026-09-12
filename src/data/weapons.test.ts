import { describe, expect, it } from 'vitest';
import { ahkDerivedSprays } from './ahkDerivedSprays';
import { getImpactPatternForLength, getPatternForLength, getPatternForWeakSegment, getSprayCount, getWeapon, weapons } from './weapons';

describe('weapon recoil data', () => {
  it('contains digitized guide patterns for the supported rifle set', () => {
    expect(weapons.map((weapon) => weapon.id)).toEqual([
      'ak47', 'm4a4', 'm4a1s', 'famas', 'galil', 'sg553'
    ]);

    for (const weapon of weapons) {
      expect(weapon.pattern.length).toBe(weapon.magazineSize);
      expect(weapon.impactPattern.length).toBe(weapon.magazineSize);
      expect(weapon.refireMs).toBeCloseTo(60_000 / weapon.fireRateRpm, 1);
      expect(weapon.pattern[0]).toMatchObject({ bullet: 1, x: 0, y: 0, timeMs: 0 });
      weapon.pattern.forEach((point, index) => {
        expect(point.bullet).toBe(index + 1);
        expect(point.timeMs).toBeCloseTo(index * weapon.refireMs, 1);
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(weapon.impactPattern[index].x).toBe(-point.x);
        expect(weapon.impactPattern[index].y).toBe(-point.y);
      });
    }
  });

  it('uses CS2-style public fire cadence constants', () => {
    expect(getWeapon('ak47').refireMs).toBeCloseTo(100, 1);
    expect(getWeapon('m4a1s').refireMs).toBeCloseTo(100, 1);
    expect(getWeapon('m4a4').refireMs).toBeCloseTo(90, 0);
    expect(getWeapon('sg553').refireMs).toBeCloseTo(110, 0);
  });

  it('uses the best available anchor source per weapon', () => {
    expect(getWeapon('ak47').pattern[9]).toMatchObject(ahkDerivedSprays.ak47[9]);
    const akSegmentDistances = getWeapon('ak47').pattern.slice(1).map((point, index) => Math.hypot(point.x - getWeapon('ak47').pattern[index].x, point.y - getWeapon('ak47').pattern[index].y));
    expect(Math.max(...akSegmentDistances) - Math.min(...akSegmentDistances)).toBeGreaterThan(14);
    expect(getWeapon('m4a1s').pattern[19]).toMatchObject(ahkDerivedSprays.m4a1s[19]);
    expect(getWeapon('galil').pattern[10]).toMatchObject(ahkDerivedSprays.galil[10]);
    expect(getWeapon('famas').pattern[12]).toMatchObject(ahkDerivedSprays.famas[12]);
    expect(getWeapon('sg553').pattern[20]).toMatchObject(ahkDerivedSprays.sg553[20]);
    expect(getWeapon('galil').pattern).toHaveLength(35);
  });

  it('has movement speed and stance inaccuracy profiles for movement/crouch simulation', () => {
    for (const weapon of weapons) {
      expect(weapon.movementSpeed).toBeGreaterThanOrEqual(210);
      expect(weapon.inaccuracy.standPx).toBeGreaterThan(0);
      expect(weapon.inaccuracy.movePx).toBeGreaterThan(weapon.inaccuracy.standPx * 5);
      expect(weapon.inaccuracy.crouchMultiplier).toBeGreaterThan(0);
      expect(weapon.inaccuracy.crouchMultiplier).toBeLessThan(1);
      expect(weapon.inaccuracy.accurateMoveSpeedRatio).toBeGreaterThan(0);
      expect(weapon.inaccuracy.accurateMoveSpeedRatio).toBeLessThan(0.5);
    }
  });

  it('limits patterns by selected spray length', () => {
    const ak = getWeapon('ak47');
    expect(getSprayCount('full', ak)).toBe(30);
    expect(getPatternForLength(ak, 5)).toHaveLength(5);
    expect(getImpactPatternForLength(ak, 5)).toHaveLength(5);
    expect(getPatternForLength(ak, 'full')).toHaveLength(30);
  });

  it('normalizes weak-section drills so they begin at the local origin and keep the weapon refire cadence', () => {
    const ak = getWeapon('ak47');
    const drill = getPatternForWeakSegment(ak, { from: 8, to: 13, averageError: 30 });
    expect(drill).toHaveLength(6);
    expect(drill[0]).toMatchObject({ bullet: 8, x: 0, y: 0, timeMs: 0 });
    expect(drill[1].timeMs).toBeCloseTo(ak.refireMs, 1);
  });
});
