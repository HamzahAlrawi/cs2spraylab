import {describe, expect, it} from 'vitest';
import {Bone, Object3D, Vector3} from 'three';
import {DualPistolGrip} from './weapon-grip';

function rig() {
  const model = new Object3D();
  const upper = new Bone(); upper.name = 'arm_upper_L'; upper.position.set(.2, 1.4, 0);
  const lower = new Bone(); lower.name = 'arm_lower_L'; lower.position.set(0, -.32, 0);
  const hand = new Bone(); hand.name = 'hand_L'; hand.position.set(0, -.28, 0);
  const right = new Bone(); right.name = 'hand_R'; right.position.set(-.2, 1.2, -.3);
  const mount = new Bone(); mount.name = 'wpn';
  // Native weapon Y separates the two grips laterally in the character frame.
  mount.rotation.z = -Math.PI / 2;
  model.add(upper, right, mount); upper.add(lower); lower.add(hand);
  model.updateMatrixWorld(true);
  return {model, upper, lower, hand, right, mount};
}

describe('native dual-pistol support hand', () => {
  it('reaches the second native anchor without stretching the arm or moving the right hand', () => {
    const {model, upper, lower, hand, right} = rig();
    const before = right.getWorldPosition(new Vector3()), wristRotation = hand.getWorldQuaternion(right.quaternion.clone());
    const grip = new DualPistolGrip(model); grip.update(); model.updateMatrixWorld(true);
    expect(right.getWorldPosition(new Vector3()).distanceTo(before)).toBeLessThan(1e-9);
    expect(upper.getWorldPosition(new Vector3()).distanceTo(lower.getWorldPosition(new Vector3()))).toBeCloseTo(.32);
    expect(lower.getWorldPosition(new Vector3()).distanceTo(hand.getWorldPosition(new Vector3()))).toBeCloseTo(.28);
    expect(hand.getWorldPosition(new Vector3()).x).toBeGreaterThan(.3);
    expect(hand.getWorldQuaternion(wristRotation.clone()).angleTo(wristRotation)).toBeLessThan(1e-7);
  });
  it('tolerates missing optional rig nodes and an unreachable anchor without NaNs', () => {
    expect(() => new DualPistolGrip(new Object3D()).update()).not.toThrow();
    const {model, right, hand} = rig(); right.position.set(10, 10, 10);
    new DualPistolGrip(model).update();
    expect(hand.getWorldPosition(new Vector3()).toArray().every(Number.isFinite)).toBe(true);
  });
});
