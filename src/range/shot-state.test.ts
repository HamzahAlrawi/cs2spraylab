import {describe, expect, it} from 'vitest';
import {describeShotState, shotConeDegrees, type ShotState} from './shot-state';
import {gameData} from './config';
import {STEP, UNIT} from './actor-physics';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';

const state = (patch: Partial<ShotState> = {}): ShotState => ({speedUnits: 0, grounded: true,
  movementInaccuracy: 0, inaccuracy: .006, recoveringInaccuracy: 0, spread: .001, recoil: {yaw: 0, pitch: 0}, ...patch});
const actor = () => ({position: {x: 0, y: 64 * UNIT, z: 0}, yaw: 0, pitch: 0, feet: 0,
  velocity: {x: 0, z: 0}, verticalVelocity: 0, duckAmount: 0, grounded: true});

describe('measured firing-state feedback', () => {
  it('separates air, moving accuracy and retained recoil without claiming every settled shot hits', () => {
    expect(describeShotState(state({grounded: false, movementInaccuracy: .05})).label).toBe('Shot while airborne');
    expect(describeShotState(state({speedUnits: 140, movementInaccuracy: .05})).label).toBe('Shot while moving / 140 u/s');
    expect(describeShotState(state({recoil: {yaw: 0, pitch: 2}})).label).toBe('Settled / recoil still active');
    expect(describeShotState(state({recoveringInaccuracy: .002})).label).toBe('Settled / accuracy recovering');
    expect(describeShotState(state()).tip).toContain('not guaranteed');
    expect(shotConeDegrees(state())).toBeCloseTo(Math.atan(.007) * 180 / Math.PI, 12);
  });
  it('captures the pre-fire state instead of counting this bullet\'s new penalty', () => {
    const gun = new DuelWeaponState('ak47', () => .5), p = actor();
    const shot = gun.advance(0, 0, {...idleCommand(), firePressed: true}, p)!;
    expect(shot.accuracy?.inaccuracy).toBe(gameData.weapons.ak47.stand);
    expect(shot.accuracy?.recoil).toEqual({yaw: 0, pitch: 0});
    const sample = JSON.stringify(shot.accuracy);
    gun.advance(.1, .1, {...idleCommand(), firePressed: true}, p);
    expect(gun.recovery.penalty).toBeGreaterThan(shot.accuracy!.inaccuracy);
    expect(JSON.stringify(shot.accuracy)).toBe(sample);
  });
  it('reports native movement penalties and float32 crouch-cutoff eligibility', () => {
    const moving = new DuelWeaponState('ak47', () => .5), p = actor(); p.velocity.x = 150 * UNIT;
    expect(moving.advance(0, 0, {...idleCommand(), firePressed: true}, p)!.accuracy!.movementInaccuracy).toBeGreaterThan(0);
    const crouched = new DuelWeaponState('m4a4', () => .5); p.duckAmount = 1; p.velocity.x = 73.1 * UNIT;
    expect(crouched.advance(0, 0, {...idleCommand(), firePressed: true, crouch: true}, p)!.accuracy!.movementInaccuracy).toBe(0);
  });
  it('retains scoped accuracy metadata after an AWP automatically unscopes', () => {
    const gun = new DuelWeaponState('awp', () => .5), p = actor();
    gun.actions.zoom = 1;
    gun.advance(1, 1, idleCommand(), p);
    const inaccuracy = gun.recovery.penalty, spread = gun.actions.stats.spread;
    const shot = gun.advance(1, 0, {...idleCommand(), firePressed: true}, p)!;
    expect(gun.actions.zoom).toBe(0);
    expect(shot.accuracy).toMatchObject({inaccuracy, spread});
  });
  it('captures retained recoil on rapid taps, independently of current key state', () => {
    const gun = new DuelWeaponState('deagle', () => .5), p = actor();
    gun.advance(0, 0, {...idleCommand(), firePressed: true}, p);
    gun.advance(STEP, STEP, idleCommand(), p);
    const shot = gun.advance(.25, .25 - STEP, {...idleCommand(), firePressed: true}, p)!;
    expect(shot.accuracy!.inaccuracy).toBeGreaterThan(gameData.weapons.deagle.stand);
    expect(shot.accuracy!.recoil.pitch).toBeGreaterThan(0);
    expect(shot.accuracy!.recoveringInaccuracy).toBeGreaterThan(0);
    expect(Math.hypot(shot.accuracy!.recoil.yaw, shot.accuracy!.recoil.pitch)).toBeGreaterThan(.2);
    expect(describeShotState(shot.accuracy!).label).toBe('Settled / recoil still active');
  });
});
