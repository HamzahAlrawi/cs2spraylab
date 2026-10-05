import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {DuelAnimator, nativeGestureName, nativeGestureClips} from './animation';
import type {DuelActorSnapshot} from './types';

const actor = (): DuelActorSnapshot => ({id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 0, z: 0},
  feet: 0, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
function fixture() {
  const model = new THREE.Group(), hip = new THREE.Bone(), spine = new THREE.Bone(), head = new THREE.Bone();
  hip.name = 'pelvis'; hip.position.y = 1; spine.name = 'spine_2'; spine.position.y = .3; head.name = 'head_0'; head.position.y = .3;
  model.add(hip); hip.add(spine); spine.add(head);
  const clips = [new THREE.AnimationClip('animation/anims/world/idle_rifle', 0, [
    new THREE.QuaternionKeyframeTrack('spine_2.quaternion', [0], [0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack('head_0.quaternion', [0], [0, 0, 0, 1]),
  ]), new THREE.AnimationClip('animation/anims/world/presentation/gesture_reload_ak47', 1, [
    new THREE.QuaternionKeyframeTrack('spine_2.quaternion', [0, .5, 1], [0, 0, 0, 1, .3, 0, 0, Math.sqrt(.91), 0, 0, 0, 1]),
    new THREE.VectorKeyframeTrack('pelvis.position', [0, 1], [0, 40, 0, 0, 50, 0]),
  ])];
  return {model, hip, spine, head, animator: new DuelAnimator(model, clips, 0, 'ak47')};
}
describe('native weapon layers and dynamic death hooks', () => {
  it('keeps a sleeping corpse pose without remapping joints, and compensates root transforms if they change', () => {
    const f = fixture(), a = actor(); a.alive = false;
    f.animator.setDeathWorld({floor: 0});
    for (let frame = 0; frame < 160; frame++) f.animator.update(a, 1 / 15);
    const head = f.head.getWorldPosition(new THREE.Vector3());
    const update = vi.spyOn(f.head, 'updateWorldMatrix');
    for (let frame = 0; frame < 10; frame++) f.animator.update(a, 1 / 60);
    expect(update).not.toHaveBeenCalled();
    f.model.position.x += 1; f.animator.update(a, 1 / 60);
    expect(update).toHaveBeenCalled();
    expect(f.head.getWorldPosition(new THREE.Vector3()).distanceTo(head)).toBeLessThan(1e-6);
    f.animator.dispose();
  });
  it('selects stance and Dualies side without inventing unavailable gestures', () => {
    expect(nativeGestureName('ak47', 'reload', {crouched: true})).toBe('gesture_reload_crouch_ak47');
    expect(nativeGestureName('elite', 'fire', {side: 'left', lastShot: true})).toBe('gesture_fire-left-last_elite');
    expect(nativeGestureName('ak47', 'unknown')).toBe(null);
  });
  it('layers native reload over locomotion without applying root/pelvis tracks', () => {
    const f = fixture(), a = actor(); a.reloading = true;
    expect(f.animator.playAction('ak47', 'reload', {duration: 2})).toBe(true);
    f.animator.update(a, .01, undefined, {reloadDuration: 2, reloadRemaining: 1});
    expect(f.spine.quaternion.x).toBeGreaterThan(.2); expect(f.hip.position.y).toBe(1);
    a.reloading = false; f.animator.update(a, .01); expect(f.spine.quaternion.x).toBeCloseTo(0);
    expect(f.animator.playAction('ak47', 'draw')).toBe(false); f.animator.dispose();
  });
  it('does not accumulate procedural aim on constant native bone tracks', () => {
    const f = fixture(), a = actor(); a.pitch = .8;
    for (let n = 0; n < 100; n++) f.animator.update(a, 1 / 60);
    expect(f.spine.quaternion.x).toBeCloseTo(Math.sin(.8 * .35 / 2), 5);
    a.pitch = 0; f.animator.update(a, 0); expect(f.spine.quaternion.x).toBeCloseTo(0); f.animator.dispose();
  });
  it('refreshes only the required aim chains without changing world-space pitch', () => {
    const f = fixture(); f.animator.dispose();
    const low = new THREE.Bone(), middle = new THREE.Bone(); low.name = 'spine_0'; middle.name = 'spine_1';
    f.hip.remove(f.spine); f.hip.add(low); low.add(middle); middle.add(f.spine);
    low.rotation.z = .12; middle.rotation.y = -.23; f.model.rotation.set(.08, .5, -.1);
    const clip = new THREE.AnimationClip('animation/anims/world/idle_rifle', 0,
      [low, middle, f.spine, f.head].map(bone =>
        new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0], bone.quaternion.toArray())));
    const animator = new DuelAnimator(f.model, [clip], 0, 'ak47'), a = actor(); animator.update(a, 0);
    const before = f.head.getWorldQuaternion(new THREE.Quaternion());
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(f.model.getWorldQuaternion(new THREE.Quaternion()));
    const update = vi.spyOn(f.head, 'updateWorldMatrix'); a.pitch = .72; animator.update(a, 1 / 60);
    expect(update.mock.calls.filter(([, children]) => children)).toHaveLength(0);
    const expected = before.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(axis, a.pitch));
    expect(f.head.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)).toBeLessThan(1e-6);
    animator.dispose();
  });
  it('moves both native weapon anchors with the hands and restores the additive idle after reload', () => {
    const model = new THREE.Group(), pivot = new THREE.Bone(), weapon = new THREE.Bone();
    pivot.name = 'wpnPivot'; weapon.name = 'wpn'; model.add(pivot); pivot.add(weapon);
    const clip = (name: string, height: number, offset: number) => new THREE.AnimationClip(`animation/anims/world/${name}`, 1, [
      new THREE.VectorKeyframeTrack('wpnPivot.position', [0, 1], [0, height, 0, 0, height, 0]),
      new THREE.VectorKeyframeTrack('wpn.position', [0, 1], [offset, 0, 0, offset, 0, 0]),
    ]);
    const idle = clip('gesture_idle_ak47', .2, .02); idle.blendMode = THREE.AdditiveAnimationBlendMode;
    const animator = new DuelAnimator(model, [clip('idle_rifle', 1, 0),
      idle, clip('gesture_reload_ak47', 1.5, .1)], 0, 'ak47');
    const a = actor(); animator.update(a, 0);
    expect(pivot.position.y).toBeCloseTo(1.2); expect(weapon.position.x).toBeCloseTo(.02);
    a.reloading = true; animator.playAction('ak47', 'reload', {duration: 2});
    animator.update(a, 0, undefined, {reloadDuration: 2, reloadRemaining: 1});
    expect(pivot.position.y).toBeCloseTo(1.5); expect(weapon.position.x).toBeCloseTo(.1);
    a.reloading = false; animator.update(a, 0);
    expect(pivot.position.y).toBeCloseTo(1.2); expect(weapon.position.x).toBeCloseTo(.02);
    animator.dispose();
  });
  it('preserves native additive metadata instead of subtracting a second reference pose', () => {
    const clips = ['idle', 'reload', 'composed'].map(name => new THREE.AnimationClip(name, 1, []));
    nativeGestureClips({animations: clips, parser: {json: {animations: [{extras: {additive: true}}, {},
      {extras: {additive: true, additive_composed: true}}]}}});
    expect(clips.map(clip => clip.blendMode)).toEqual([THREE.AdditiveAnimationBlendMode, THREE.NormalAnimationBlendMode, THREE.NormalAnimationBlendMode]);
  });
  it('does not let additive scale tracks multiply actor dimensions', () => {
    const f = fixture(), layer = new THREE.AnimationClip('animation/anims/world/gesture_idle_ak47', 1,
      [new THREE.VectorKeyframeTrack('spine_2.scale', [0, 1], [1, 1, 1, 1, 1, 1])], THREE.AdditiveAnimationBlendMode);
    f.animator.addGestureClips([layer]);
    for (let n = 0; n < 10; n++) f.animator.update(actor(), .1);
    expect(f.spine.scale.toArray()).toEqual([1, 1, 1]); f.animator.dispose();
  });
  it('carries a posed weapon with procedural wrist aim without cumulative drift', () => {
    const f = fixture(); f.animator.dispose();
    const hand = new THREE.Bone(), pivot = new THREE.Bone(); hand.name = 'hand_R'; pivot.name = 'wpnPivot';
    hand.position.set(0, .1, .1); f.spine.add(hand); f.model.add(pivot);
    const idle = new THREE.AnimationClip('animation/anims/world/idle_rifle', 0, [
      new THREE.QuaternionKeyframeTrack('spine_2.quaternion', [0], [0, 0, 0, 1]),
      new THREE.VectorKeyframeTrack('wpnPivot.position', [0], [0, 1.4, .1]),
      new THREE.QuaternionKeyframeTrack('wpnPivot.quaternion', [0], [0, 0, 0, 1]),
    ]);
    const animator = new DuelAnimator(f.model, [idle], 0, 'ak47'), a = actor();
    animator.update(a, 0); const relative = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(pivot.matrixWorld);
    a.pitch = .8;
    for (let n = 0; n < 100; n++) animator.update(a, 1 / 60);
    const aimed = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(pivot.matrixWorld);
    expect(Math.max(...relative.elements.map((value, index) => Math.abs(value - aimed.elements[index])))).toBeLessThan(1e-6);
    a.pitch = 0; animator.update(a, 0);
    expect(pivot.position.distanceTo(new THREE.Vector3(0, 1.4, .1))).toBeLessThan(1e-6); animator.dispose();
  });
  it('captures the current posed skeleton and solves prop contacts only when opted in', () => {
    const f = fixture(), a = actor(); f.animator.update(a, 0);
    const before = f.head.getWorldPosition(new THREE.Vector3()).y;
    a.alive = false; f.animator.setDeathWorld({floor: 0, boxes: []}); f.animator.update(a, 0);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(before);
    for (let n = 0; n < 180; n++) f.animator.update(a, 1 / 60);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThanOrEqual(.12 - 1e-5);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(before); f.animator.dispose();
  });
  it('ignores late gesture loads and actions after disposal', () => {
    const f = fixture(); f.animator.dispose(); f.animator.dispose();
    f.animator.addGestureClips([new THREE.AnimationClip('animation/anims/world/presentation/gesture_draw_ak47', 1, [])]);
    expect(f.animator.playAction('ak47', 'reload')).toBe(false);
    f.animator.update(actor(), 1);
    expect(f.hip.position.y).toBe(1);
  });
});
