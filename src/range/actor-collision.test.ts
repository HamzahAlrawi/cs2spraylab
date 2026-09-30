import {describe, expect, it} from 'vitest';
import {advanceActor, GRAVITY, idleInput, JUMP_SPEED, STEP, UNIT, type ActorKinematics} from './actor-physics';
import {fitsHull, verticalContact} from './actor-collision';

const actor = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0},
  yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false});
const box = {center: {x: 0, y: .5, z: 0}, size: {x: 2, y: 1, z: 2}};
const contact = (position: ActorKinematics['position'], from: number, to: number, height: number) =>
  verticalContact(position, from, to, height, [box]);

describe('shared vertical movement', () => {
  it('tucks the feet without pulling the airborne eye down', () => {
    let standing = actor(), ducking = actor();
    // A fresh key edge consumes crouch speed; allow the resulting transition
    // to finish rather than assuming an always-rested 6.4/s transition.
    for (let tick = 0; tick < 32; tick++) {
      standing = advanceActor(standing, {...idleInput(), jump: true}, 250 * UNIT, STEP);
      ducking = advanceActor(ducking, {...idleInput(), jump: true, crouch: true}, 250 * UNIT, STEP);
      expect(ducking.position.y).toBeCloseTo(standing.position.y, 8);
    }
    expect(ducking.feet - standing.feet).toBeCloseTo(18 * UNIT);
    expect(ducking.duckAmount).toBe(1);
  });

  it('untucks in air without adding a camera jolt or vertical impulse', () => {
    let a = actor();
    for (let tick = 0; tick < 20; tick++) a = advanceActor(a, {...idleInput(), jump: true, crouch: true}, 250 * UNIT, STEP);
    const next = advanceActor(a, idleInput(), 250 * UNIT, STEP);
    expect(next.position.y - a.position.y).toBeCloseTo(a.verticalVelocity * STEP - GRAVITY * STEP * STEP / 2, 8);
    expect(next.verticalVelocity).toBeCloseTo(a.verticalVelocity - GRAVITY * STEP);
  });

  it('lands on the highest crossed prop and can jump from its top', () => {
    let a = {...actor(), feet: 1.05, verticalVelocity: -3};
    for (let tick = 0; tick < 8; tick++) a = advanceActor(a, idleInput(), 250 * UNIT, STEP, undefined, undefined, contact);
    expect(a.feet).toBe(1); expect(a.grounded).toBe(true);
    expect(a.position.y).toBeCloseTo(1 + 64 * UNIT);
    const jumping = advanceActor(a, {...idleInput(), jump: true}, 250 * UNIT, STEP, undefined, undefined, contact);
    expect(jumping.grounded).toBe(false);
    expect(jumping.verticalVelocity).toBeCloseTo(JUMP_SPEED - GRAVITY * STEP);
  });

  it('falls when walking off a prop, even if the previous tick was grounded', () => {
    let a: ActorKinematics = {...actor(), feet: 1, position: {x: 1.45, y: 1 + 64 * UNIT, z: 0}, grounded: true};
    a = advanceActor(a, idleInput(), 250 * UNIT, STEP, undefined, undefined, contact);
    expect(a.grounded).toBe(false); expect(a.feet).toBeLessThan(1);
  });

  it('stops upward movement at a ceiling without passing through it', () => {
    const roof = {center: {x: 0, y: 2.3, z: 0}, size: {x: 3, y: .2, z: 3}};
    let a = actor();
    let hit = false;
    for (let tick = 0; tick < 40; tick++) {
      a = advanceActor(a, {...idleInput(), jump: true}, 250 * UNIT, STEP, undefined, undefined,
        (p, from, to, height) => verticalContact(p, from, to, height, [roof]));
      expect(a.feet + 72 * UNIT).toBeLessThanOrEqual(2.2 + 1e-8);
      hit ||= a.feet > .1 && a.verticalVelocity === 0;
    }
    expect(hit).toBe(true);
  });

  it('does not grant extra air acceleration by toggling crouch', () => {
    const initial = {...actor(), feet: .8, verticalVelocity: 1};
    const a = advanceActor(initial, {...idleInput(), side: 1}, 250 * UNIT, STEP);
    const b = advanceActor(initial, {...idleInput(), side: 1, crouch: true}, 250 * UNIT, STEP);
    expect(a.velocity).toEqual(b.velocity);
  });

  it('requires a full standing hull when releasing crouch under a ceiling', () => {
    const roof = {center: {x: 0, y: 1.6, z: 0}, size: {x: 3, y: .2, z: 3}};
    const a = advanceActor({...actor(), duckAmount: 1}, idleInput(), 250 * UNIT, STEP, undefined,
      (p, feet, height) => fitsHull(p, feet, height, [roof]));
    expect(a.duckAmount).toBe(1);
  });
});
