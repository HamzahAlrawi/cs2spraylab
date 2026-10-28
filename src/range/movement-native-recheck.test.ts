import {describe, expect, it} from 'vitest';
import {accelerateGround, advanceActor, airVelocity, GRAVITY, groundVelocity, idleInput, JUMP_SPEED, movementWishSpeed,
  STEP, UNIT, type ActorKinematics} from './actor-physics';
import native from './native-movement-recheck-fixture.json';
import type {TerrainSolid} from './terrain';

const standing = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0},
  velocity: {x: 0, z: 0}, yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT,
  duckAmount: 0, jumpHeld: false});
const airborne = (): ActorKinematics => ({...standing(), feet: 2, position: {x: 0, y: 2 + 64 * UNIT, z: 0}});

describe('build 2000930 isolated native movement arithmetic', () => {
  it('uses the static registered gravity and full-precision jump impulse, not the rounded console text', () => {
    expect(GRAVITY / UNIT).toBe(native.registeredDefaults.sv_gravity);
    expect(JUMP_SPEED / UNIT).toBe(native.registeredDefaults.sv_jump_impulse);
  });
  it('matches all 720 ground acceleration cases, including surface friction', () => {
    for (const sample of native.acceleration) {
      const v = accelerateGround(sample.current * UNIT, 0, 1, 0, sample.wishSpeed * UNIT, sample.dt,
        {weaponSpeed: sample.weaponSpeed * UNIT, ducking: sample.stance === 'crouch',
          walking: sample.stance === 'walk', surfaceFriction: sample.surfaceFriction});
      expect(v.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.result, 4);
      expect(v.z).toBe(0);
    }
  });

  it('matches native ground friction, including the low-speed cutoff and zero-friction contact', () => {
    for (const sample of native.friction) {
      const v = groundVelocity(sample.current * UNIT, 0, 0, 0, 215 * UNIT, sample.dt,
        {weaponSpeed: 215 * UNIT, ducking: false, walking: false, surfaceFriction: sample.surfaceFriction});
      expect(v.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.result, 4);
      expect(v.z).toBe(0);
    }
  });

  it('scales the crouched command cap by raw duck amount, with crouch taking priority over walk', () => {
    for (const sample of native.crouch) {
      const cap = movementWishSpeed(sample.weaponSpeed * UNIT, sample.duckAmount, true, true, 0);
      expect(cap / UNIT).toBeCloseTo(sample.result, 4);
      expect(sample.forward).toBe(sample.result);
    }
  });

  it('activates the walk cap below, but not at or above, cap plus 25 u/s', () => {
    for (const sample of native.walk) {
      expect(movementWishSpeed(sample.weaponSpeed * UNIT, 0, false, true, sample.currentSpeed * UNIT) / UNIT,
        JSON.stringify(sample)).toBeCloseTo(sample.result, 4);
    }
  });
});

describe('shared movement integration regressions (not whole-engine native fixtures)', () => {
  it.each([0, .5, 1])('uses the supporting surface friction factor %s for braking and acceleration', friction => {
    const ground: TerrainSolid = {center: {x: 0, y: -.25, z: 0}, size: {x: 100, y: .5, z: 100},
      traversal: {kind: 'solid', friction}};
    const actor = {...standing(), velocity: {x: 215 * UNIT, z: 0}};
    const next = advanceActor(actor, {...idleInput(), forward: 1}, 215 * UNIT, STEP,
      undefined, undefined, undefined, {solids: [ground], floor: null});
    const expected = groundVelocity(actor.velocity.x, 0, 0, -1, 215 * UNIT, STEP,
      {weaponSpeed: 215 * UNIT, ducking: false, walking: false, surfaceFriction: friction});
    expect(next.grounded).toBe(true);
    expect(next.velocity.x).toBeCloseTo(expected.x, 10);
    expect(next.velocity.z).toBeCloseTo(expected.z, 10);
  });

  it('scales crouched air steering without erasing existing airborne momentum', () => {
    const actor = {...airborne(), velocity: {x: 200 * UNIT, z: 0}, duckAmount: 1, crouchHeld: true,
      eyeHeight: 46 * UNIT};
    const next = advanceActor(actor, {...idleInput(), forward: 1, crouch: true}, 215 * UNIT, STEP);
    expect(next.velocity.x).toBe(actor.velocity.x);
    expect(next.velocity.z / UNIT).toBeCloseTo(-12 * 215 * .34 * STEP, 10);
    expect(next.grounded).toBe(false);
  });

  it('uses the walk cap in air only while the native three-dimensional speed gate is satisfied', () => {
    const input = {...idleInput(), side: 1, walk: true};
    const slow = advanceActor(airborne(), input, 215 * UNIT, STEP);
    const fastFall = advanceActor({...airborne(), verticalVelocity: -200 * UNIT}, input, 215 * UNIT, STEP);
    expect(slow.velocity.x / UNIT).toBeCloseTo(12 * 215 * .52 * STEP, 10);
    expect(fastFall.velocity.x / UNIT).toBeCloseTo(12 * 215 * STEP, 10);
  });

  it('does not turn damage tagging into an airborne cap or drag', () => {
    const actor = {...airborne(), velocity: {x: 200 * UNIT, z: 0}, duckAmount: 1, crouchHeld: true};
    const input = {...idleInput(), forward: 1, crouch: true};
    const normal = advanceActor(actor, input, 215 * UNIT, STEP);
    const tagged = advanceActor({...actor, velocityModifier: .35}, input, 215 * UNIT, STEP);
    expect(tagged.velocity).toEqual(normal.velocity);
  });

  it('uses the gated walk cap, not an instant walk-tag clamp at running speed', () => {
    const actor = {...standing(), velocity: {x: 215 * UNIT, z: 0}, velocityModifier: .35};
    const next = advanceActor(actor, {...idleInput(), walk: true}, 215 * UNIT, STEP);
    expect(next.velocity.x / UNIT).toBeCloseTo(215 * .35, 8);
    const slower = advanceActor(next, {...idleInput(), walk: true}, 215 * UNIT, STEP);
    expect(slower.velocity.x / UNIT).toBeCloseTo(215 * .52 * .35, 8);
  });

  it('keeps diagonal commands normalized to the weapon cap', () => {
    let actor = standing();
    for (let i = 0; i < 256; i++) actor = advanceActor(actor, {...idleInput(), forward: 1, side: 1}, 215 * UNIT, STEP);
    expect(Math.hypot(actor.velocity.x, actor.velocity.z) / UNIT).toBeCloseTo(215, 8);
    expect(actor.velocity.x).toBeCloseTo(-actor.velocity.z, 10);
  });

  it('does not restore old landing momentum for a jump press when already airborne', () => {
    const actor = {...airborne(), velocity: {x: 100 * UNIT, z: 0}, verticalVelocity: 100 * UNIT,
      movementTime: .001, landedAt: 0, landingVelocity: -100 * UNIT,
      landingVelocityXY: {x: 200 * UNIT, z: 0}};
    const next = advanceActor(actor, {...idleInput(), jumpPressed: true}, 215 * UNIT, STEP);
    expect(next.velocity).toEqual(actor.velocity);
  });

  it('preserves fresh steering on a supported bhop instead of overwriting it with landing momentum', () => {
    const actor = {...standing(), velocity: {x: 50 * UNIT, z: 0}, movementTime: .001,
      landedAt: 0, landingVelocity: 0, landingVelocityXY: {x: 200 * UNIT, z: 0}};
    const input = {...idleInput(), jumpPressed: true, forward: 1};
    const next = advanceActor(actor, input, 215 * UNIT, STEP);
    expect(next.velocity).toEqual(airVelocity(200 * UNIT, 0, 0, -1, 215 * UNIT, STEP));
    expect(next.verticalVelocity).toBeGreaterThan(0);
    expect(next.grounded).toBe(false);
  });

  it('does not restore landing momentum after a spam-rejected jump press', () => {
    const actor = {...standing(), velocity: {x: 50 * UNIT, z: 0}, movementTime: .001,
      lastJumpPressTime: 0, landedAt: 0, landingVelocity: 0, landingVelocityXY: {x: 200 * UNIT, z: 0}};
    const next = advanceActor(actor, {...idleInput(), jumpPressed: true}, 215 * UNIT, STEP);
    expect(next.velocity.x).toBeCloseTo(groundVelocity(actor.velocity.x, 0, 0, 0, 215 * UNIT, STEP).x, 10);
    expect(next.grounded).toBe(true);
  });
});
