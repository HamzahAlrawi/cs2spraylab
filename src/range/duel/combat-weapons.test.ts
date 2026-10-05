import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {equipmentStats, SHELL_RELOAD_FINISH, SHELL_RELOAD_START, ZEUS_RECHARGE_SECONDS} from '../equipment';
import {idleCommand} from './types';
import {DuelWeaponState} from './weapon-state';

const actor = {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
  pitch: 0, feet: 0, verticalVelocity: 0, grounded: true};
const press = () => ({...idleCommand(), firePressed: true, fireHeld: true});

describe('shotgun discharge contract', () => {
  it.each(['nova', 'xm1014', 'mag7', 'sawedoff'] as const)('%s consumes one shell/recoil impulse for native-count physical pellet rays', id => {
    let seed = 13; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const weapon = new DuelWeaponState(id, random), shot = weapon.advance(0, 0, press(), actor)!;
    expect(shot.kind).toBe('pellets'); expect(shot.pelletDirections).toHaveLength(equipmentStats(id).pellets);
    expect(shot.direction).toEqual(shot.pelletDirections![0]); expect(shot.maxDistance).toBe(equipmentStats(id).range * UNIT);
    expect(weapon.ammo).toBe(equipmentStats(id).magazine - 1); expect(weapon.recovery.index).toBe(1);
    for (const ray of shot.pelletDirections!) expect(Math.hypot(ray.x, ray.y, ray.z)).toBeCloseTo(1, 10);
    expect(new Set(shot.pelletDirections!.map(ray => JSON.stringify(ray))).size).toBe(equipmentStats(id).pellets);
    actor.position.x = 3; expect(shot.origin.x).toBe(0); actor.position.x = 0;
  });
  it('XM1014 repeats on hold with fractional native cadence; pump shotguns require a new press', () => {
    for (const id of ['nova', 'xm1014', 'mag7', 'sawedoff'] as const) {
      const weapon = new DuelWeaponState(id, () => 0); weapon.advance(0, 0, press(), actor);
      let shots = 1;
      for (let i = 1; i <= Math.ceil(equipmentStats(id).cycle * 2 / STEP); i++)
        if (weapon.advance(i * STEP, STEP, {...idleCommand(), fireHeld: true}, actor)) shots++;
      expect(shots).toBe(id === 'xm1014' ? 3 : 1);
    }
  });
  it('cannot bypass the pump cycle with reload/silent reload/holster', () => {
    const weapon = new DuelWeaponState('nova', () => 0); weapon.advance(0, 0, press(), actor);
    weapon.advance(.01, .01, {...idleCommand(), reloadPressed: true, reloadHeld: true}, actor);
    weapon.holster();
    expect(weapon.advance(.1, .09, press(), actor)).toBeUndefined();
    expect(weapon.advance(.88, .78, idleCommand(), actor)).toBeDefined();
    expect(weapon.pumpUntil).toBeCloseTo(1.76); expect(weapon.reserve).toBe(32);
  });
  it('queues shell-reload interruption until the first shell and finish transition are complete', () => {
    const weapon = new DuelWeaponState('nova', () => 0); weapon.ammo = 0;
    weapon.advance(0, 0, {...idleCommand(), reloadPressed: true}, actor);
    expect(weapon.advance(.1, .1, press(), actor)).toBeUndefined();
    const shellAt = SHELL_RELOAD_START + equipmentStats('nova').reload;
    expect(weapon.advance(shellAt, shellAt - .1, idleCommand(), actor)).toBeUndefined();
    expect(weapon.reloadPhase).toBe('finish');
    expect(weapon.advance(shellAt + SHELL_RELOAD_FINISH, SHELL_RELOAD_FINISH, idleCommand(), actor)).toBeDefined();
    expect(weapon.ammo).toBe(0); expect(weapon.reserve).toBe(31);
    expect(weapon.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-shell', 'reload-end']);
  });
});

describe('knife attacks and Zeus recharge', () => {
  it('distinguishes first/follow-up primary slashes and held secondary attacks', () => {
    const weapon = new DuelWeaponState('knife', () => 0);
    const first = weapon.advance(0, 0, press(), actor)!;
    expect(first).toMatchObject({kind: 'melee', attack: 'primary', firstSlash: true, maxDistance: 48 * UNIT});
    weapon.resolveMeleeHit(first.ordinal, true); expect(weapon.nextShotAt).toBe(.4);
    const second = weapon.advance(.4, .4, press(), actor)!; expect(second.firstSlash).toBe(false);
    weapon.resolveMeleeHit(first.ordinal, false); expect(weapon.nextShotAt).toBe(.9);
    weapon.holster();
    const reset = weapon.advance(1.3, .9, press(), actor)!; expect(reset.firstSlash).toBe(true);
    const stab = weapon.advance(2, .7, {...idleCommand(), secondaryHeld: true}, actor)!;
    expect(stab).toMatchObject({attack: 'secondary', maxDistance: 32 * UNIT});
    weapon.resolveMeleeHit(stab.ordinal, true); expect(weapon.nextShotAt).toBeCloseTo(3.1);
    expect(weapon.advance(3, 1, {...idleCommand(), secondaryHeld: true}, actor)).toBeUndefined();
    expect(weapon.advance(3.1, .1, {...idleCommand(), secondaryHeld: true}, actor)).toBeDefined();
  });
  it('recharges Zeus in absolute simulation time, does not reload, and requires another press', () => {
    const weapon = new DuelWeaponState('zeus', () => 0);
    expect(weapon.advance(0, 0, press(), actor)).toMatchObject({kind: 'zeus', maxDistance: 120 * UNIT});
    expect(weapon.rechargeUntil).toBe(ZEUS_RECHARGE_SECONDS); expect(weapon.ammo).toBe(0);
    weapon.holster();
    expect(weapon.advance(10, 10, {...idleCommand(), reloadPressed: true, reloadHeld: true}, actor)).toBeUndefined();
    expect(weapon.reloadUntil).toBe(0); expect(weapon.reserve).toBe(0);
    expect(weapon.advance(30, 20, {...idleCommand(), fireHeld: true}, actor)).toBeUndefined(); expect(weapon.ammo).toBe(1);
    expect(weapon.recovery.penalty).toBe(.06);
    expect(weapon.drainActionEvents().map(e => e.kind)).toEqual(['zeus-discharge', 'zeus-ready']);
    expect(weapon.advance(30.1, .1, press(), actor)).toBeDefined();
  });
  it('passively recharges holstered Zeus and protects active shots from legacy zero-recovery advancement', () => {
    const weapon = new DuelWeaponState('zeus', () => 0);
    weapon.advance(0, 0, press(), actor); weapon.holster();
    weapon.advancePassive(30, 30, true); expect(weapon.ammo).toBe(1); expect(weapon.recovery.penalty).toBe(.05);
    weapon.recovery.advance(0, false, false);
    const shot = weapon.advance(31, 1, press(), actor)!;
    expect(Object.values(shot.direction).every(Number.isFinite)).toBe(true);
    expect(weapon.drainActionEvents().map(e => e.kind)).toEqual(['zeus-discharge', 'zeus-ready', 'zeus-discharge']);
  });
});
