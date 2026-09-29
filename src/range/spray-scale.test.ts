import {describe, expect, it} from 'vitest';
import {gameData, weaponIds} from './config';
import {UNIT} from './actor-physics';
import {WeaponRecovery} from './ballistics';
import {shotDirection} from './shot-model';
import {nativeRecoilPattern} from './recoil';

describe('angular spray at physical distances', () => {
  it.each(weaponIds)('%s expands in metres with distance, never with target or viewport size', id => {
    const weapon = gameData.weapons[id], recovery = new WeaponRecovery(weapon);
    for (const recoil of nativeRecoilPattern(weapon)) {
      const dir = shotDirection({yaw: 0, pitch: 0, recoil, weapon, recovery, speedRatio: 0,
        walking: false, airborne: false, verticalSpeedUnits: 0, spread: false});
      const wall = (metres: number) => ({x: dir.x * metres / -dir.z, y: dir.y * metres / -dir.z});
      const base = wall(5);
      for (const distance of [10, 25, 50, 90]) {
        expect(wall(distance).x).toBeCloseTo(base.x * distance / 5, 8);
        expect(wall(distance).y).toBeCloseTo(base.y * distance / 5, 8);
        expect(wall(distance / UNIT).y * UNIT).toBeCloseTo(wall(distance).y, 8);
      }
    }
  });
});
