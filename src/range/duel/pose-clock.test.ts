import {describe, expect, it} from 'vitest';
import {ActorPoseClock} from './pose-clock';
import {DuelAnimator} from './animation';
import {Group, Bone, AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack} from 'three';
import type {DuelActorSnapshot} from './types';

describe('simulation pose clock', () => {
  it('does not let render-ahead, repeated shots or out-of-order sensors advance recorded state', () => {
    const clock = new ActorPoseClock(.2), input = {id: 1, generation: 1, cyclesPerSecond: 1.4, airborne: false, jumpClip: 'jump_stand_rifle'};
    for (let tick = 0; tick <= 128; tick++) clock.record(input, tick / 128);
    const shot = clock.sample(input, 1);
    clock.sample(input, 1.007); clock.sample(input, .95); clock.sample(input, 1);
    expect(clock.sample(input, 1)).toEqual(shot);
    expect(shot!.gait).toBeCloseTo(.6, 10);
    clock.record(input, 1); expect(clock.sample(input, 1)).toEqual(shot);
  });
  it('records jump and crouch-air state without inheriting a future rendering query', () => {
    const clock = new ActorPoseClock(), base = {id: 1, generation: 1, cyclesPerSecond: 0, airborne: false, jumpClip: 'jump_stand_rifle'};
    clock.record(base, 0); clock.record({...base, airborne: true, jumpClip: 'jump_e_rifle'}, .1);
    clock.record({...base, airborne: true}, .2);
    expect(clock.sample({...base, airborne: true}, .2)).toMatchObject({air: .1, jumpClip: 'jump_e_rifle'});
    clock.sample(base, .3);
    expect(clock.sample({...base, airborne: true}, .2)!.air).toBe(.1);
    expect(clock.sample({...base, generation: 2}, .2)).toBeUndefined();
  });
  it('produces the same animated hit pose after future and older view sampling', () => {
    const root = new Group(), pelvis = new Bone(); pelvis.name = 'pelvis'; root.add(pelvis);
    const q = new QuaternionKeyframeTrack('pelvis.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const t = new VectorKeyframeTrack('pelvis.position', [0, .5, 1], [0, 0, 0, .04, .03, 0, 0, 0, 0]);
    const animator = new DuelAnimator(root, [new AnimationClip('native/world/run_n_rifle', 1, [q, t]),
      new AnimationClip('native/world/idle_rifle', 1, [q.clone(), t.clone()])], .1, 'ak47');
    const actor: DuelActorSnapshot = {id: 1, generation: 1, side: 'enemy', alive: true, health: 100, armor: 100, helmet: true,
      position: {x: 0, y: 1.6256, z: -4}, feet: 0, velocity: {x: 0, z: -3.5}, yaw: 0, pitch: 0,
      crouched: false, duckAmount: 0, grounded: true, equipment: 'ak47', ammo: 30, reloading: false};
    for (let tick = 0; tick <= 128; tick++) animator.recordPose(actor, tick / 128);
    animator.update(actor, 0, undefined, {poseTime: 1}); const original = pelvis.position.toArray();
    animator.update(actor, .007, undefined, {poseTime: 1.007}); animator.update(actor, 0, undefined, {poseTime: .95});
    animator.update(actor, 0, undefined, {poseTime: 1});
    expect(pelvis.position.toArray()).toEqual(original);
    animator.dispose();
  });
});
