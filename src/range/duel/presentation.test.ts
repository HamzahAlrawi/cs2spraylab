import {describe, expect, it} from 'vitest';
import {AnimationClip, Object3D, VectorKeyframeTrack} from 'three';
import {DEG, STEP, UNIT} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {interpolateActors} from './presentation';
import {DuelSimulation} from './simulation';
import {DuelAnimator, locomotionWeights} from './animation';
import {aimStep} from './motor';
import {fullyOccluded} from './visibility';

describe('duel frame presentation', () => {
  it('samples a native single-frame idle pose at zero instead of taking modulo zero', () => {
    const model = new Object3D();
    const clip = new AnimationClip('animation/anims/world/idle_rifle', 0,
      [new VectorKeyframeTrack('.position', [0], [0, 1, 0])]);
    const animator = new DuelAnimator(model, [clip]);
    const actor = new DuelSimulation().snapshot()[1];
    for (let frame = 0; frame < 60; frame++) animator.update(actor, 1 / 60);
    expect(animator.mixer.clipAction(clip).time).toBe(0);
    expect(model.position.y).toBe(1);
    animator.dispose();
  });
  it('uses the native 96 u/s crouch animation reference instead of the weapon speed cap', () => {
    const actor = new DuelSimulation().snapshot()[1];
    actor.duckAmount = 1; actor.velocity = {x: 73.1 * UNIT, z: 0};
    expect(locomotionWeights(actor).authoredSpeed / UNIT).toBeCloseTo(96);
  });
  it('presents evenly spaced motion at 240 Hz without changing authoritative physics', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({}), 1, testArena());
    sim.command(1, {side: 1}); sim.start();
    for (let i = 0; i < 128; i++) sim.step();
    const positions: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      sim.advance(1 / 240);
      const before = sim.snapshot();
      positions.push(sim.renderSnapshot()[1].position.x);
      expect(sim.snapshot()).toEqual(before);
    }
    const steps = positions.slice(1).map((x, i) => Math.abs(x - positions[i]));
    expect(Math.min(...steps)).toBeGreaterThan(.02);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(.00001);
  });

  it('shows unconsumed mouse look immediately without double applying it at the next tick', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({}), 2, testArena());
    sim.start(); sim.command(0, {yawDelta: .2, pitchDelta: -.1});
    expect(sim.renderSnapshot()[0].yaw).toBeCloseTo(.2);
    expect(sim.snapshot()[0].yaw).toBe(0);
    sim.advance(STEP);
    expect(sim.renderSnapshot()[0].yaw).toBeCloseTo(.2);
    expect(sim.renderSnapshot()[0].pitch).toBeCloseTo(-.1);
  });

  it('interpolates turns across the angle seam and keeps deaths immediate', () => {
    const sim = new DuelSimulation();
    const before = sim.snapshot(), after = sim.snapshot();
    before[1].yaw = 179 * DEG; after[1].yaw = -179 * DEG;
    const middle = interpolateActors(before, after, STEP / 2);
    expect(Math.abs(middle[1].yaw)).toBeCloseTo(Math.PI);
    after[1].alive = false;
    expect(interpolateActors(before, after, 0)[1].alive).toBe(false);
  });

  it('blends diagonals and crouch continuously with normalized weights', () => {
    const actor = new DuelSimulation().snapshot()[1];
    actor.yaw = 0;
    const samples = [];
    for (const angle of [44.9, 45, 45.1]) {
      actor.velocity = {x: Math.sin(angle * DEG) * 4, z: -Math.cos(angle * DEG) * 4};
      actor.duckAmount = .5;
      const {weights} = locomotionWeights(actor);
      expect([...weights.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
      expect(weights.get('crouch_ne_rifle')).toBeGreaterThan(.498);
      expect((weights.get('crouch_n_rifle') ?? 0) + (weights.get('crouch_e_rifle') ?? 0)).toBeLessThan(.002);
      samples.push(weights.get('crouch_ne_rifle')!);
    }
    expect(samples[2] - samples[0]).toBeLessThan(.002);
  });

  it('settles aim without snapping its angular velocity on a target reversal', () => {
    const motor = {yawRate: 0, pitchRate: 0};
    let yaw = 0, previousRate = 0;
    const maxAcceleration = 350 * DEG / (.22 * .4);
    for (let tick = 0; tick < 256; tick++) {
      const target = tick < 64 ? 80 * DEG : -20 * DEG;
      const {yawDelta} = aimStep(motor, target - yaw, 0, 220);
      yaw += yawDelta;
      expect(Math.abs(motor.yawRate - previousRate)).toBeLessThanOrEqual(maxAcceleration * STEP + 1e-9);
      previousRate = motor.yawRate;
    }
    expect(yaw / DEG).toBeCloseTo(-20, 2);
  });

  it('culls only full character bounds hidden by a single wall', () => {
    const actor = new DuelSimulation().snapshot()[1];
    actor.position = {x: 0, y: 1.6, z: -5};
    const eye = {x: 0, y: 1.6, z: 5};
    const arena = {...testArena(), solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 5, y: 3, z: .5}}]};
    expect(fullyOccluded(eye, actor, arena)).toBe(true);
    actor.position.x = 4;
    expect(fullyOccluded(eye, actor, arena)).toBe(false);
    actor.position.x = 0;
    arena.solids[0].size.y = 1;
    arena.solids[0].center.y = .5;
    expect(fullyOccluded(eye, actor, arena)).toBe(false);
  });
});
