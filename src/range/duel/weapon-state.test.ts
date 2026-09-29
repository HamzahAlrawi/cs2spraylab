import {describe, expect, it} from 'vitest';
import {STEP, UNIT, idleInput} from '../actor-physics';
import {defaults, gameData, weaponIds} from '../config';
import {Simulation} from '../simulation';
import {DuelWeaponState} from './weapon-state';
import {idleCommand} from './types';

const actor = () => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
  pitch: 0, feet: 0, verticalVelocity: 0, duckAmount: 0});

describe('duel and range ballistic parity', () => {
  for (const weapon of weaponIds) it(`${weapon}: preserves fractional automatic cadence and shared recoil`, () => {
    const range = new Simulation({...defaults, mode: 'guided', weapon, spread: false, burst: 0});
    const duel = new DuelWeaponState(weapon, () => 0);
    const command = {...idleCommand(), fireHeld: true, firePressed: true};
    const rangeShots: {time: number; direction: {x: number; y: number; z: number}}[] = [];
    const duelShots: typeof rangeShots = [];
    range.onShot = shot => rangeShots.push({time: shot.at, direction: shot.direction});
    range.active = true; range.start(true);
    for (let tick = 0; tick < Math.ceil(gameData.weapons[weapon].magazine * gameData.weapons[weapon].cycle / STEP); tick++) {
      const time = tick * STEP;
      if (tick) range.step(STEP);
      const shot = duel.advance(time, tick ? STEP : 0, command, actor());
      command.firePressed = false;
      if (shot) duelShots.push({time, direction: shot.direction});
      if (duel.ammo === 0) break;
    }
    expect(duelShots).toHaveLength(gameData.weapons[weapon].magazine);
    expect(rangeShots).toHaveLength(duelShots.length);
    duelShots.forEach((shot, i) => {
      expect(shot.time - i * gameData.weapons[weapon].cycle).toBeGreaterThanOrEqual(-1e-8);
      expect(shot.time - i * gameData.weapons[weapon].cycle).toBeLessThan(STEP + 1e-8);
      expect(shot.time).toBeCloseTo(rangeShots[i].time, 8);
      for (const axis of ['x', 'y', 'z'] as const) expect(shot.direction[axis]).toBeCloseTo(rangeShots[i].direction[axis], 7);
    });
  });

  it('does not bank shots across a trigger gap or reload', () => {
    const duel = new DuelWeaponState('ak47', () => 0);
    const command = {...idleCommand(), fireHeld: true};
    duel.advance(0, 0, command, actor());
    command.fireHeld = false;
    for (let i = 1; i <= 128; i++) duel.advance(i * STEP, STEP, command, actor());
    command.fireHeld = true;
    expect(duel.advance(129 * STEP, STEP, command, actor())).toBeDefined();
    expect(duel.nextShotAt).toBeCloseTo(129 * STEP + gameData.weapons.ak47.cycle);
    command.reloadPressed = true;
    duel.advance(130 * STEP, STEP, command, actor());
    command.reloadPressed = false;
    for (let i = 131; i < 600; i++) {
      if (duel.advance(i * STEP, STEP, command, actor())) {
        expect(duel.nextShotAt).toBeCloseTo(i * STEP + gameData.weapons.ak47.cycle); break;
      }
    }
  });

  it('keeps shot cadence and recoil continuous through a wide strafe, brake, crouch and retreat', () => {
    const range = new Simulation({...defaults, mode: 'guided', weapon: 'ak47', spread: false});
    range.position.z = -60;
    const duel = new DuelWeaponState('ak47', () => 0), command = {...idleCommand(), fireHeld: true};
    const shots: {at: number; direction: {x: number; y: number; z: number}; origin: {x: number; y: number; z: number}}[] = [];
    range.onShot = shot => shots.push(shot); range.start(true);
    duel.advance(0, 0, command, range);
    for (let tick = 1; tick <= 160; tick++) {
      range.input = {...idleInput(), side: tick < 40 ? 1 : tick < 57 ? -1 : tick > 95 ? -1 : 0, crouch: tick >= 52};
      range.step(STEP);
      const shot = duel.advance(tick * STEP, STEP, {...command, ...range.input}, range);
      if (shot) {
        expect(shot.origin).toEqual(shots[shots.length - 1].origin);
        for (const axis of ['x','y','z'] as const) expect(shot.direction[axis]).toBeCloseTo(shots[shots.length - 1].direction[axis], 7);
      }
      expect(duel.recovery.recoil).toEqual(range.recovery.recoil);
    }
    expect(shots).toHaveLength(13);
    expect(shots[shots.length - 1].origin.y).toBeCloseTo(46 * UNIT, 6);
    shots.forEach((shot, i) => expect(shot.at - i * .1).toBeLessThan(STEP + 1e-8));
  });
});
