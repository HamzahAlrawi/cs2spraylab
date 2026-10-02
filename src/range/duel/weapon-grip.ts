import * as THREE from 'three';
import mounts from '../weapon-mounts.json';

/** Lightweight two-bone IK for the second native Dual Berettas hand anchor. */
export class DualPistolGrip {
  private readonly upper;
  private readonly lower;
  private readonly hand;
  private readonly right;
  private readonly mount;
  private readonly offset = new THREE.Vector3().fromArray(mounts.mounts.elite.leftGripOffset);
  private readonly start = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly desiredElbow = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly delta = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly inverseParentRotation = new THREE.Quaternion();
  private readonly handRotation = new THREE.Quaternion();

  constructor(private readonly model: THREE.Object3D) {
    this.upper = model.getObjectByName('arm_upper_L'); this.lower = model.getObjectByName('arm_lower_L');
    this.hand = model.getObjectByName('hand_L'); this.right = model.getObjectByName('hand_R');
    this.mount = model.getObjectByName('wpn');
  }

  update() {
    const {upper, lower, hand, right, mount} = this;
    if (!upper || !lower || !hand || !right || !mount) return;
    this.model.updateWorldMatrix(true, true);
    upper.getWorldPosition(this.start); lower.getWorldPosition(this.elbow); hand.getWorldPosition(this.wrist);
    hand.getWorldQuaternion(this.handRotation);
    // Native left/right weapon anchors give the separation. Preserve the
    // already-aligned right wrist's grip offset, rather than guessing a handle.
    this.goal.copy(this.offset).transformDirection(mount.matrixWorld).multiplyScalar(this.offset.length());
    this.goal.add(right.getWorldPosition(this.to));
    const a = this.start.distanceTo(this.elbow), b = this.elbow.distanceTo(this.wrist);
    this.direction.subVectors(this.goal, this.start);
    const d = Math.min(a + b - .002, Math.max(Math.abs(a - b) + .002, this.direction.length()));
    if (a < .001 || b < .001 || d < .001) return;
    this.direction.normalize(); this.goal.copy(this.start).addScaledVector(this.direction, d);
    const along = (a * a - b * b + d * d) / (2 * d);
    this.pole.subVectors(this.elbow, this.start).addScaledVector(this.direction, -this.pole.dot(this.direction));
    if (this.pole.lengthSq() < 1e-6) {
      this.pole.set(0, -1, 0).addScaledVector(this.direction, this.direction.y);
      if (this.pole.lengthSq() < 1e-6) this.pole.set(1, 0, 0);
    }
    this.pole.normalize();
    this.desiredElbow.copy(this.start).addScaledVector(this.direction, along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, a * a - along * along)));
    this.rotate(upper, this.from.subVectors(this.elbow, this.start), this.to.subVectors(this.desiredElbow, this.start));
    lower.getWorldPosition(this.elbow); hand.getWorldPosition(this.wrist);
    this.rotate(lower, this.from.subVectors(this.wrist, this.elbow), this.to.subVectors(this.goal, this.elbow));
    hand.parent!.getWorldQuaternion(this.parentRotation);
    hand.quaternion.copy(this.parentRotation.invert()).multiply(this.handRotation);
    hand.updateWorldMatrix(false, true);
  }

  private rotate(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    this.delta.setFromUnitVectors(from.normalize(), to.normalize());
    bone.parent!.getWorldQuaternion(this.parentRotation);
    this.delta.premultiply(this.inverseParentRotation.copy(this.parentRotation).invert()).multiply(this.parentRotation);
    bone.quaternion.premultiply(this.delta);
    bone.updateWorldMatrix(false, true);
  }
}
