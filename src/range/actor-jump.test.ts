import {describe, expect, it} from 'vitest';
import {advanceActor, GRAVITY, idleInput, JUMP_SPEED, resetActorMovementHistory, STEP, UNIT, type ActorKinematics} from './actor-physics';
import {acceptedJumpPress, ballisticContactTime, groundLandingFactor, isBhopPress, jumpLandingFactor} from './actor-jump';
import native from './native-terrain-fixture.json';

const standing = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0, eyeHeight: 64 * UNIT,
  velocity: {x: 0, z: 0}, verticalVelocity: 0, yaw: 0, jumpHeld: false});
const input = {...idleInput(), jump: true};

describe('post-January-2026 jump rules', () => {
  it.each(native.cases)('matches inspected native $kind-factor arithmetic for $impactUnitsPerSecond u/s at $seconds seconds', sample => {
    const factor = sample.kind === 'jump' ? jumpLandingFactor : groundLandingFactor;
    expect(factor(sample.impactUnitsPerSecond * UNIT, sample.seconds)).toBeCloseTo(sample.result, 6);
  });
  it('uses landing velocity and elapsed contact time, not legacy stamina', () => {
    expect(groundLandingFactor(-300 * UNIT, 0)).toBeCloseTo(.85 ** 2);
    expect(groundLandingFactor(-300 * UNIT, .3)).toBe(1);
    expect(jumpLandingFactor(-100 * UNIT, 0)).toBeGreaterThan(jumpLandingFactor(-300 * UNIT, 0));
  });
  it('uses a centered 7.8125 ms window, not 7.8125 ms on each side', () => {
    expect(isBhopPress(1 - STEP / 2, 1)).toBe(true);
    expect(isBhopPress(1 + STEP / 2, 1)).toBe(true);
    expect(isBhopPress(1 - STEP / 2 - .000001, 1)).toBe(false);
    expect(isBhopPress(1 + STEP / 2 + .000001, 1)).toBe(false);
  });
  it('rejects presses at or below the inclusive spam threshold', () => {
    expect(acceptedJumpPress(.015625, 0)).toBe(false);
    expect(acceptedJumpPress(.015626, 0)).toBe(true);
  });
  it('calculates a flat landing contact inside the simulation slice', () => {
    expect(ballisticContactTime(.003, 0, -1, GRAVITY, STEP)).toBeCloseTo(.0029137431, 7);
  });
  it('does not autojump merely because jump is held', () => {
    let actor = standing();
    let jumps = 0;
    for (let i = 0; i < 200; i++) {
      const next = advanceActor(actor, input, 250 * UNIT, STEP);
      if (actor.verticalVelocity <= 0 && next.verticalVelocity > 0) jumps++;
      actor = next;
    }
    expect(jumps).toBe(1); expect(actor.feet).toBe(0);
  });
  it('accepts a fresh jump press shortly before contact and bounces in the remainder', () => {
    const actor = {...standing(), feet: .003, verticalVelocity: -1};
    const next = advanceActor(actor, input, 250 * UNIT, STEP);
    expect(next.grounded).toBe(false); expect(next.verticalVelocity).toBeGreaterThan(7);
    expect(next.feet).toBeGreaterThan(0); expect(next.landedAt).toBeGreaterThan(0);
  });
  it('does not buffer an early airborne press beyond the bhop window', () => {
    const actor = {...standing(), feet: .008, verticalVelocity: -1};
    const next = advanceActor(actor, input, 250 * UNIT, STEP);
    expect(next.grounded).toBe(true); expect(next.verticalVelocity).toBe(0);
  });
  it('rejects a spam-penalized prelanding press', () => {
    const actor = {...standing(), feet: .003, verticalVelocity: -1, lastJumpPressTime: -.01};
    const next = advanceActor(actor, input, 250 * UNIT, STEP);
    expect(next.grounded).toBe(true); expect(next.verticalVelocity).toBe(0);
  });
  it('processes explicit wheel presses even with jumpHeld true', () => {
    const actor = {...standing(), jumpHeld: true};
    const next = advanceActor(actor, {...input, jumpPressed: true}, 250 * UNIT, STEP);
    expect(next.verticalVelocity).toBeCloseTo(JUMP_SPEED - GRAVITY * STEP);
  });
  it('preserves timestamped jump behavior when the input edge falls inside a slice', () => {
    const a = advanceActor(standing(), {...input, jumpPressOffset: STEP / 2}, 250 * UNIT, STEP);
    const before = advanceActor(standing(), idleInput(), 250 * UNIT, STEP / 2);
    const b = advanceActor(before, input, 250 * UNIT, STEP / 2);
    expect(a.feet).toBeCloseTo(b.feet, 10); expect(a.verticalVelocity).toBeCloseTo(b.verticalVelocity, 10);
    expect(a.lastJumpPressTime).toBeCloseTo(STEP / 2);
  });
  it('does not lose a jump press exactly at the slice boundary', () => {
    const actor = advanceActor(standing(), {...input, jumpPressOffset: STEP}, 250 * UNIT, STEP);
    expect(actor.verticalVelocity).toBe(JUMP_SPEED); expect(actor.lastJumpPressTime).toBe(STEP);
  });
  it('permits autobhop only when the environment explicitly enables it', () => {
    let actor = standing(), jumps = 0;
    for (let i = 0; i < 180; i++) {
      const next = advanceActor(actor, input, 250 * UNIT, STEP, undefined, undefined, undefined,
        {solids: [], jumpRules: {autoBhop: true}});
      if (actor.verticalVelocity <= 0 && next.verticalVelocity > 0) jumps++;
      actor = next;
    }
    expect(jumps).toBeGreaterThan(1);
  });
  it('clears contact history on respawn without changing coordinates or stance', () => {
    const actor = {...standing(), lastJumpPressTime: 4, landedAt: 4, landingVelocity: -10,
      pendingJumpPressTime: 4, supportId: 2};
    const reset = resetActorMovementHistory(actor);
    expect(reset.lastJumpPressTime).toBeUndefined(); expect(reset.landedAt).toBeUndefined();
    expect(reset.supportId).toBeUndefined(); expect(reset.position).toEqual(actor.position);
    expect(advanceActor(reset, input, 250 * UNIT, STEP).verticalVelocity).toBeCloseTo(JUMP_SPEED - GRAVITY * STEP);
  });
  it('keeps flat callback and terrain-context movement identical through repeated jumps and crouch', () => {
    let callbacks = standing(), terrain = standing();
    for (let i = 0; i < 640; i++) {
      const command = {...idleInput(), jump: i % 80 < 3, crouch: i % 120 >= 60, side: i % 160 < 80 ? 1 : -1};
      callbacks = advanceActor(callbacks, command, 250 * UNIT, STEP);
      terrain = advanceActor(terrain, command, 250 * UNIT, STEP, undefined, undefined, undefined, {solids: []});
      expect(terrain.feet, `tick ${i}`).toBeCloseTo(callbacks.feet, 10);
      expect(terrain.verticalVelocity, `tick ${i}`).toBeCloseTo(callbacks.verticalVelocity, 10);
      expect(terrain.velocity.x, `tick ${i}`).toBeCloseTo(callbacks.velocity.x, 10);
      expect(terrain.position.x, `tick ${i}`).toBeCloseTo(callbacks.position.x, 10);
      expect(terrain.duckAmount).toBe(callbacks.duckAmount);
    }
  });
});
