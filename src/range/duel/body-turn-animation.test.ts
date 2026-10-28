import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {DuelAnimator, locomotionWeights} from './animation';
import type {DuelActorSnapshot} from './types';

function fixture() {
  const model = new THREE.Group(), pelvis = new THREE.Bone(); pelvis.name = 'pelvis'; model.add(pelvis);
  const bones: THREE.Bone[] = [];
  let parent = pelvis;
  for (const name of ['spine_0', 'spine_1', 'spine_2', 'head_0']) {
    const bone = new THREE.Bone(); bone.name = name; bone.position.y = .2; parent.add(bone); bones.push(bone); parent = bone;
  }
  for (const side of ['L', 'R']) {
    const shoulder = new THREE.Bone(), hand = new THREE.Bone(); shoulder.name = `clavicle_${side}`; hand.name = `hand_${side}`;
    bones[2].add(shoulder); shoulder.add(hand); hand.position.set(side === 'L' ? -.15 : .15, 0, .3); bones.push(shoulder, hand);
  }
  const pivot = new THREE.Bone(); pivot.name = 'wpnPivot'; pivot.position.set(.15, .6, .3); model.add(pivot); bones.push(pivot);
  const clip = new THREE.AnimationClip('animation/anims/world/idle_rifle', 0, bones.flatMap(b => [
    new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0], b.quaternion.toArray()),
    new THREE.VectorKeyframeTrack(`${b.name}.position`, [0], b.position.toArray()),
  ]));
  const actor: DuelActorSnapshot = {id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 1.6, z: 0}, feet: 0,
    velocity: {x: 0, z: 0}, yaw: .8, pitch: .6, duckAmount: 0, crouched: false, alive: true,
    health: 100, armor: 100, helmet: true, equipment: 'ak47', ammo: 30, reloading: false};
  return {model, bones, pivot, actor, animator: new DuelAnimator(model, [clip], 0, 'ak47')};
}
describe('independent body root with authoritative physical aim', () => {
  it.each([-.7, 0, .7])('preserves head, hands and mounted aim with yaw residual %s', residual => {
    const f = fixture(), bodyYaw = f.actor.yaw - residual;
    f.model.rotation.y = bodyYaw - Math.PI;
    const input = structuredClone(f.actor), root = f.model.quaternion.clone();
    const expected = new THREE.Vector3(-Math.sin(f.actor.yaw) * Math.cos(f.actor.pitch), Math.sin(f.actor.pitch), -Math.cos(f.actor.yaw) * Math.cos(f.actor.pitch));
    for (let n = 0; n < 80; n++) f.animator.update(f.actor, 0, undefined, {bodyYaw});
    for (const name of ['head_0', 'hand_L', 'hand_R', 'wpnPivot']) {
      const bone = f.model.getObjectByName(name)!;
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion())).angleTo(expected)).toBeLessThan(1e-6);
    }
    const visible = f.bones.map(b => b.getWorldPosition(new THREE.Vector3()));
    // Shot/visibility sampling at the same pose clock cannot advance the pose.
    f.animator.update(f.actor, 0, undefined, {bodyYaw});
    f.bones.forEach((b, i) => expect(b.getWorldPosition(new THREE.Vector3()).distanceTo(visible[i])).toBeLessThan(1e-7));
    expect(f.actor).toEqual(input); expect(f.model.quaternion.angleTo(root)).toBeLessThan(1e-7); f.animator.dispose();
  });
  it('resolves locomotion directions in the displayed body frame, not physical aim yaw', () => {
    const f = fixture(); f.actor.yaw = Math.PI / 2; f.actor.velocity = {x: 0, z: -5};
    expect(locomotionWeights(f.actor, 'rifle', 0).weights.get('run_n_rifle')).toBeGreaterThan(0);
    expect(locomotionWeights(f.actor, 'rifle').weights.get('run_e_rifle')).toBeGreaterThan(0); f.animator.dispose();
  });
});
