import {describe, expect, it} from 'vitest';
import {accelerateGround, advanceActor, DUCK_SECONDS, UNDUCK_SECONDS, idleInput, STEP, UNIT, type ActorKinematics} from './actor-physics';
import fixture from './native-movement-fixture.json';

const standing = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0},
  velocity: {x: 0, z: 0}, yaw: 0, feet: 0, verticalVelocity: 0,
  eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false});

describe('installed-build movement arithmetic', () => {
  it('matches the 240 offline native acceleration cases, including tagged and crouched motion', () => {
    for (const sample of fixture.cases) {
      const result = accelerateGround(sample.current * UNIT, 0, 1, 0, sample.wishSpeed * UNIT, sample.dt,
        {weaponSpeed: sample.weaponSpeed * UNIT, ducking: sample.stance === 'crouch', walking: sample.stance === 'walk'});
      expect(result.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.result, 4);
      expect(result.z).toBe(0);
    }
  });

  it.each([150, 215, 225, 240, 250])('can reach the full %s u/s weapon crouch cap from rest', speed => {
    let actor = standing();
    for (let i = 0; i < 256; i++) actor = advanceActor(actor, {...idleInput(), crouch: true, side: 1}, speed * UNIT, STEP);
    expect(actor.velocity.x / UNIT).toBeCloseTo(speed * .34, 5);
  });

  it('uses the native maximum 6.4/s down and 8/s up rates when crouch speed is recovered', () => {
    let actor = standing();
    actor.crouchHeld = true;
    actor = advanceActor(actor, {...idleInput(), crouch: true}, 215 * UNIT, DUCK_SECONDS / 2);
    expect(actor.duckAmount).toBeCloseTo(.5);
    actor = advanceActor(actor, {...idleInput(), crouch: true}, 215 * UNIT, DUCK_SECONDS / 2);
    expect(actor.duckAmount).toBe(1);
    actor.crouchHeld = false;
    actor = advanceActor(actor, idleInput(), 215 * UNIT, UNDUCK_SECONDS / 2);
    expect(actor.duckAmount).toBeCloseTo(.5);
    actor = advanceActor(actor, idleInput(), 215 * UNIT, UNDUCK_SECONDS / 2);
    expect(actor.duckAmount).toBe(0);
    expect(actor.eyeHeight).toBe(64 * UNIT);
  });

  it('consumes speed on both crouch edges, recovers at rest and prevents crouch spam', () => {
    let actor = advanceActor(standing(), {...idleInput(), crouch: true}, 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBeCloseTo(6 + 3 * STEP);
    expect(actor.duckAmount).toBeCloseTo((6 + 3 * STEP) * .8 * STEP);
    actor = advanceActor(actor, idleInput(), 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBeCloseTo(4 + 6 * STEP);
    for (let i = 0; i < 20; i++) actor = advanceActor(actor, {...idleInput(), crouch: i % 2 === 0}, 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBeLessThan(1.5);
    expect(actor.duckAmount).toBe(0);
    for (let i = 0; i < 384; i++) actor = advanceActor(actor, idleInput(), 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBe(8);
  });

  it('does not let repeated crouch/jump edges manufacture vertical momentum', () => {
    let actor = standing();
    let maxFeet = 0;
    for (let i = 0; i < 256; i++) {
      actor = advanceActor(actor, {...idleInput(), crouch: i % 8 < 4, jump: i < 180}, 215 * UNIT, STEP);
      maxFeet = Math.max(maxFeet, actor.feet);
      expect(Number.isFinite(actor.position.y)).toBe(true);
    }
    expect(maxFeet).toBeLessThan(76 * UNIT);
    expect(actor.feet).toBe(0);
    expect(actor.verticalVelocity).toBe(0);
  });

  it('retains momentum on release and counterstrafes faster without instantly reversing', () => {
    let released = {...standing(), velocity: {x: 215 * UNIT, z: 0}};
    let reversed = {...standing(), velocity: {x: 215 * UNIT, z: 0}};
    let releaseTicks = 0, reverseTicks = 0;
    while (released.velocity.x > 215 * .34 * UNIT) {
      released = advanceActor(released, idleInput(), 215 * UNIT, STEP); releaseTicks++;
    }
    while (reversed.velocity.x > 215 * .34 * UNIT) {
      reversed = advanceActor(reversed, {...idleInput(), side: -1}, 215 * UNIT, STEP); reverseTicks++;
    }
    expect(reverseTicks).toBeGreaterThan(1);
    expect(reverseTicks).toBeLessThan(releaseTicks);
    expect(reversed.velocity.x).toBeGreaterThan(0);
  });
});
