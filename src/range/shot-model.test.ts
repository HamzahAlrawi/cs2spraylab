import {describe, expect, it} from 'vitest';
import {DEG, UNIT, type Vec} from './actor-physics';
import {WeaponRecovery} from './ballistics';
import {gameData, weaponIds} from './config';
import {direction, sampleShotSpread, shotDirection, shotDirections, type ShotAim} from './shot-model';

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const sequence = () => {let i = 0; const values = [.1, .65, .8, .4]; return () => values[i++ % values.length];};
const aim = (yaw = 0, pitch = 0): ShotAim => ({yaw, pitch, recoil: {yaw: 0, pitch: 0},
  weapon: gameData.weapons.ak47, recovery: new WeaponRecovery(gameData.weapons.ak47),
  speedRatio: 0, walking: false, airborne: false, verticalSpeedUnits: 0, spread: true});

describe('physical long-range shot geometry', () => {
  it('keeps the spread cone circular at steep pitch and after camera rotation', () => {
    let reference = 0;
    for (const [yaw, pitch] of [[0, 0], [.7, 70 * DEG], [-1.1, -80 * DEG]]) {
      const shot = shotDirection(aim(yaw, pitch), sequence());
      expect(Math.hypot(shot.x, shot.y, shot.z)).toBeCloseTo(1, 12);
      const cosine = dot(shot, direction(yaw, pitch));
      if (reference) expect(cosine).toBeCloseTo(reference, 14);
      reference = cosine;
    }
  });

  it('projects the exact inaccuracy/spread slopes to metres at 10, 30, 80 and 100 m', () => {
    for (const distance of [10, 30, 80, 100]) {
      const params = aim();
      const {horizontal: x, vertical: y} = sampleShotSpread({inaccuracy: params.weapon.stand,
        spread: params.weapon.spread}, sequence());
      const shot = shotDirection(params, sequence());
      expect(shot.x * -distance / shot.z).toBeCloseTo(distance * x, 12);
      expect(shot.y * -distance / shot.z).toBeCloseTo(distance * y, 12);
      // Source-unit and metre projections must describe the same physical point.
      expect(shot.x * -(distance / UNIT) / shot.z * UNIT).toBeCloseTo(distance * x, 12);
    }
  });

  it.each(weaponIds)('%s compensation stays on the same head point through a full magazine at any range', id => {
    const weapon = gameData.weapons[id], recovery = new WeaponRecovery(weapon);
    for (let bullet = 0; bullet < weapon.magazine; bullet++) {
      const recoil = recovery.recoil;
      const shot = shotDirection({...aim(), weapon, recovery, recoil, spread: false,
        yaw: recoil.yaw * DEG, pitch: -recoil.pitch * DEG});
      for (const distance of [10, 30, 80, 100]) {
        expect(shot.x * -distance / shot.z).toBeCloseTo(0, 12);
        expect(64 * UNIT + shot.y * -distance / shot.z).toBeCloseTo(64 * UNIT, 12);
      }
      recovery.fire(); recovery.advance(weapon.cycle);
    }
  });
});

describe('native spread sampling', () => {
  it('draws radii before angles and uses uniformly sampled radius, not uniform area', () => {
    const result = sampleShotSpread({inaccuracy: 1, spread: 0}, () => .25);
    expect(result.horizontal).toBeCloseTo(0, 6);
    expect(result.vertical).toBeCloseTo(.25, 7);
  });
  it('transforms both Negev radii for the first three recoil-index bands', () => {
    for (const [index, expected] of [[0, 1 - .5 ** 8], [1, 1 - .5 ** 4], [2, 1 - .5 ** 2], [3, .5], [1.5, 1 - .5 ** 4]]) {
      let draw = 0;
      const result = sampleShotSpread({inaccuracy: 1, spread: 1, weaponId: 'negev', recoilIndex: index},
        () => [ .5, 0, .5, 0 ][draw++]);
      expect(result.horizontal).toBeCloseTo(expected * 2, 7);
      expect(result.vertical).toBe(0);
    }
  });
  it('applies the revolver transform only in alternate fire', () => {
    const sample = {inaccuracy: 1, spread: 1, weaponId: 'revolver'};
    const random = () => {let i = 0; return () => [.5, 0, .5, 0][i++];};
    expect(sampleShotSpread(sample, random()).horizontal).toBe(1);
    expect(sampleShotSpread({...sample, alternateFire: true}, random()).horizontal).toBe(1.5);
  });
  it('replays numeric shot seeds without depending on Math.random', () => {
    const params = {...aim(), seed: 42};
    expect(shotDirection(params)).toEqual(shotDirection(params));
    expect(shotDirection(params)).not.toEqual(shotDirection({...params, seed: 43}));
  });
  it('shares one inaccuracy sample with random patterns disabled', () => {
    const params = {...aim(), weapon: {...gameData.weapons.ak47, spread: 0}, seed: 99, shotgunPatterns: false};
    const pellets = shotDirections(params, 8);
    expect(pellets.every(p => JSON.stringify(p) === JSON.stringify(pellets[0]))).toBe(true);
    expect(shotDirections({...params, weapon: {...params.weapon, spread: .04}}, 8)).toHaveLength(8);
  });
  it('resamples inaccuracy per pellet with native patterns enabled', () => {
    const params = {...aim(), weapon: {...gameData.weapons.ak47, spread: 0, spreadSeed: 17514}, seed: 99};
    const pellets = shotDirections(params, 9);
    expect(new Set(pellets.map(p => p.x)).size).toBe(9);
    const random = shotDirections({...params, shotgunPatterns: false}, 9);
    expect(new Set(random.map(p => p.x)).size).toBe(1);
  });
  it('supports supplied patterns and extracted spread-seed tables without mutating aim', () => {
    const params = {...aim(), seed: 99, weapon: {...gameData.weapons.ak47, stand: 0, spread: .1}};
    params.recovery.penalty = 0;
    const pattern = [{horizontal: 1, vertical: 0}, {horizontal: -1, vertical: 0}];
    const pellets = shotDirections(params, 2, undefined, pattern);
    expect(pellets[0].x).toBeCloseTo(-pellets[1].x, 12);
    const native = {...params, weapon: {...params.weapon, spreadSeed: 17514}};
    expect(shotDirections(native, 9)).toEqual(shotDirections(native, 9));
    expect(new Set(shotDirections(native, 9).map(p => p.x)).size).toBe(9);
    expect(params.pelletPattern).toBeUndefined();
    expect(pattern).toEqual([{horizontal: 1, vertical: 0}, {horizontal: -1, vertical: 0}]);
  });
  it('falls back to random shotgun spread beyond the native 64-entry table, without wrapping', () => {
    const params = {...aim(), seed: 99, weapon: {...gameData.weapons.ak47, spreadSeed: 17514}, recoilIndex: 8};
    expect(shotDirections(params, 9)).not.toEqual(shotDirections({...params, recoilIndex: 0}, 9));
    expect(shotDirections(params, 9)).not.toEqual(shotDirections({...params, shotgunPatterns: false}, 9));
  });
  it('does not draw randomness with spread disabled, even for pellets', () => {
    let draws = 0;
    const result = shotDirections({...aim(), spread: false}, 9, () => {draws++; return .5;});
    expect(draws).toBe(0); expect(result.every(p => p.z === -1)).toBe(true);
  });
  it('rejects invalid pellet counts and mismatched pattern lengths', () => {
    expect(() => shotDirections(aim(), 0)).toThrow(RangeError);
    expect(() => shotDirections(aim(), 65)).toThrow(RangeError);
    expect(() => shotDirections(aim(), 2, undefined, [])).toThrow(RangeError);
  });
});
