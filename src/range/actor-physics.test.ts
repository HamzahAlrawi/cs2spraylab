import {describe, expect, it} from 'vitest';
import {advanceActor, DUCK_SECONDS, STEP, UNIT, idleInput, type ActorKinematics} from './actor-physics';
import {traceActor} from './duel/geometry';

const standing = (): ActorKinematics => ({
  position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
  feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false,
});

describe('shared actor crouch stance', () => {
  it('returns only kinematics so parent bookkeeping cannot be overwritten by Object.assign', () => {
    const source = {...standing(), stepDistance: 1, health: 100, command: {fireHeld: true}};
    const next = advanceActor(source, idleInput(), 250 * UNIT, STEP);
    expect(next).not.toHaveProperty('stepDistance');
    expect(next).not.toHaveProperty('health'); expect(next).not.toHaveProperty('command');
    expect(next).toHaveProperty('movementTime');
  });
  it('moves the camera and hull gradually and caps crouched travel speed', () => {
    let actor = standing();
    const input = {...idleInput(), crouch: true, forward: 1};
    actor = advanceActor(actor, input, 250 * UNIT, STEP);
    expect(actor.duckAmount).toBeGreaterThan(0);
    expect(actor.duckAmount).toBeLessThan(1);
    expect(actor.position.y).toBeLessThan(64 * UNIT);
    expect(actor.position.y).toBeGreaterThan(46 * UNIT);
    for (let step = 0; step < (DUCK_SECONDS + .5) / STEP; step++) actor = advanceActor(actor, input, 250 * UNIT, STEP);
    expect(actor.duckAmount).toBe(1);
    expect(actor.eyeHeight).toBeCloseTo(46 * UNIT);
    expect(actor.position.z).toBeLessThan(-.2);
    expect(Math.hypot(actor.velocity.x, actor.velocity.z)).toBeLessThan(250 * UNIT * .35);
  });

  it('does not stand into a low ceiling after Ctrl is released', () => {
    let actor = standing();
    for (let step = 0; step < 1 / STEP; step++) actor = advanceActor(actor, {...idleInput(), crouch: true}, 250 * UNIT, STEP);
    const underCeiling = (_position: ActorKinematics['position'], _feet: number, height: number) => height <= 1.48;
    for (let step = 0; step < 1 / STEP; step++) actor = advanceActor(actor, idleInput(), 250 * UNIT, STEP,
      (_from, desired) => desired, underCeiling);
    expect(actor.duckAmount).toBe(1);
    expect(actor.eyeHeight).toBeLessThan(56 * UNIT);
  });

  it('interpolates head hit zones with stance instead of teleporting them', () => {
    const shot = (height: number, duck: number) => traceActor({x: 0, y: height, z: -3},
      {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: 0}, duck).group;
    expect(shot(1.62, 0)).toBe('head');
    expect(shot(1.395, .5)).toBe('head');
    expect(shot(1.17, 1)).toBe('head');
    expect(shot(1.62, 1)).toBeUndefined();
  });
});
