import {describe, expect, it} from 'vitest';
import {DEG, UNIT, type Vec} from './actor-physics';
import {WeaponRecovery} from './ballistics';
import {gameData, weaponIds} from './config';
import {direction, shotDirection, type ShotAim} from './shot-model';

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
      const r = .8 * params.weapon.stand, q = .4 * params.weapon.spread;
      const x = Math.cos(.1 * Math.PI * 2) * r + Math.cos(.65 * Math.PI * 2) * q;
      const y = Math.sin(.1 * Math.PI * 2) * r + Math.sin(.65 * Math.PI * 2) * q;
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
