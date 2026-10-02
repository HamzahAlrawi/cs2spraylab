import {describe, expect, it} from 'vitest';
import {AnimationClip, Bone, Object3D, VectorKeyframeTrack} from 'three';
import {DEG, STEP, UNIT} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {interpolateActors} from './presentation';
import {DuelSimulation} from './simulation';
import {DuelAnimator, locomotionWeights} from './animation';
import {aimStep} from './motor';
import {fullyOccluded} from './visibility';
import {BOT_COLLAPSE_SECONDS} from './round-flow';

describe('duel frame presentation', () => {
  it('restores constant death tracks after blending from the hit pose', () => {
    const model = new Object3D(), bone = new Bone(); bone.name = 'spine'; model.add(bone);
    const idle = new AnimationClip('animation/anims/world/idle_rifle', 0,
      [new VectorKeyframeTrack('spine.position', [0], [1, 0, 0])]);
    const death = new AnimationClip('animation/anims/world/death_chest_b', 1,
      [new VectorKeyframeTrack('spine.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
    const animator = new DuelAnimator(model, [idle, death]), actor = new DuelSimulation().snapshot()[1];
    animator.update(actor, 0); expect(bone.position.x).toBe(1);
    actor.alive = false;
    animator.update(actor, .02, .02); expect(bone.position.x).toBeCloseTo(.75);
    animator.update(actor, .1, BOT_COLLAPSE_SECONDS); expect(bone.position.x).toBeCloseTo(0);
    animator.update(actor, .1, 2); expect(bone.position.x).toBeCloseTo(0);
    animator.dispose();
  });

  it('samples death clips in real seconds without compressing them, then holds the final pose', () => {
    const model = new Object3D();
    const clip = new AnimationClip('animation/anims/world/death_chest_b', 3,
      [new VectorKeyframeTrack('.position', [0, 3], [0, 0, 0, 3, 0, 0])]);
    const animator = new DuelAnimator(model, [clip]);
    const actor = new DuelSimulation().snapshot()[1]; actor.alive = false;
    animator.update(actor, 0, 0);
    expect(model.position.x).toBe(0);
    animator.update(actor, .1, BOT_COLLAPSE_SECONDS / 2);
    expect(model.position.x).toBeCloseTo(BOT_COLLAPSE_SECONDS / 2, 3);
    animator.update(actor, .1, BOT_COLLAPSE_SECONDS);
    expect(model.position.x).toBeCloseTo(BOT_COLLAPSE_SECONDS, 3);
    animator.update(actor, .1, 3);
    expect(model.position.x).toBeCloseTo(3, 3);
    const settled = model.position.clone();
    animator.update(actor, .1, 4);
    expect(model.position).toEqual(settled);
    animator.dispose();
  });

  it('blends the standing and crouching baked falls at the victim stance and freezes the choice', () => {
    const model = new Object3D(), pelvis = new Bone(); pelvis.name = 'pelvis'; model.add(pelvis);
    const clip = (name: string, start: number) => new AnimationClip(`animation/anims/world/shared/${name}`, 1.4,
      [new VectorKeyframeTrack('pelvis.position', [0, 1.4], [0, start, 0, 0, .2, 1])]);
    const animator = new DuelAnimator(model, [clip('death_fall_b', 1), clip('death_crouch_fall_b', .6)]);
    const actor = new DuelSimulation().snapshot()[1]; actor.alive = false; actor.duckAmount = .5;
    animator.update(actor, 0, 0); animator.update(actor, .1, .1);
    expect(pelvis.position.y).toBeCloseTo(.8 + (.2 - .8) * .1 / 1.4, 4);
    actor.duckAmount = 0;
    animator.update(actor, .1, .2);
    expect(pelvis.position.y).toBeCloseTo(.8 + (.2 - .8) * .2 / 1.4, 4);
    animator.update(actor, .1, 2);
    expect(pelvis.position.y).toBeCloseTo(.2, 4);
    animator.dispose();
  });

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
  it('keeps native pistol weapon layers additive instead of replacing the locomotion pose', () => {
    const model = new Object3D();
    const base = new AnimationClip('animation/anims/world/idle_pistol', 0,
      [new VectorKeyframeTrack('.position', [0], [0, 1, 0])]);
    const layer = new AnimationClip('animation/anims/world/idle_usp', 1,
      [new VectorKeyframeTrack('.position', [0, 1], [0, 50, 0, 0, 51, 0])]);
    const actor = new DuelSimulation().snapshot()[1]; actor.equipment = 'usp';
    const animator = new DuelAnimator(model, [base, layer]);
    animator.update(actor, 0);
    expect(model.position.y).toBeCloseTo(1);
    animator.update(actor, 1);
    expect(model.position.y).toBeCloseTo(1.167);
    animator.dispose();
  });
  it('selects pistol walking and crouching clips without changing normalized gait weights', () => {
    const actor = new DuelSimulation().snapshot()[1]; actor.equipment = 'deagle';
    actor.yaw = 0; actor.velocity = {x: 2, z: 0}; actor.duckAmount = .6;
    const {weights} = locomotionWeights(actor, 'pistol');
    expect([...weights.keys()].every(name => name.endsWith('_pistol'))).toBe(true);
    expect([...weights.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(weights.get('crouch_e_pistol')).toBeGreaterThan(.6);
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
