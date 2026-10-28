import * as THREE from 'three';
import type {LocomotionPose} from './locomotion-transition';

type Leg = {upper: THREE.Object3D; lower: THREE.Object3D; ankle: THREE.Object3D; toe: THREE.Object3D;
  probes: {mesh: THREE.SkinnedMesh; indices: readonly number[]}[]};
type Rotation = {bone: THREE.Object3D; quaternion: THREE.Quaternion};

/** Short, bounded support correction. Never translates bones or the actor root. */
export class LocomotionFootContact {
  private readonly legs: Leg[] = [];
  private saved: Rotation[] = [];
  private point = new THREE.Vector3();
  private hip = new THREE.Vector3();
  private knee = new THREE.Vector3();
  private ankle = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private parent = new THREE.Quaternion();
  private delta = new THREE.Quaternion();
  private rotation = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly model: THREE.Object3D,
    probeIndices?: (mesh: THREE.SkinnedMesh, related: readonly boolean[]) => readonly number[]) {
    for (const side of ['L', 'R']) {
      const upper = model.getObjectByName(`leg_upper_${side}`), lower = model.getObjectByName(`leg_lower_${side}`);
      const ankle = model.getObjectByName(`ankle_${side}`), toe = model.getObjectByName(`ball_${side}`);
      if (!upper || !lower || !ankle || !toe) continue;
      const leg: Leg = {upper, lower, ankle, toe, probes: []};
      model.traverse(mesh => {
        if (!(mesh instanceof THREE.SkinnedMesh)) return;
        const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
        if (!joints || !weights) return;
        const related = mesh.skeleton.bones.map(b => [upper, lower, ankle, toe].includes(b));
        if (probeIndices) {
          const indices=probeIndices(mesh,related);
          if(indices.length)leg.probes.push({mesh,indices});
          return;
        }
        const indices: number[] = [];
        for (let i = 0; i < joints.count; i++) {
          let influence = 0;
          for (let part = 0; part < 4; part++) if (related[joints.getComponent(i, part)]) influence += weights.getComponent(i, part);
          // Include partially weighted boot/leg vertices, not just toe-dominated ones.
          if (influence > .001) indices.push(i);
        }
        if (indices.length) leg.probes.push({mesh, indices});
      });
      this.legs.push(leg);
    }
  }
  get ready() {return this.legs.length === 2;}

  restore() {
    for (const {bone, quaternion} of this.saved) bone.quaternion.copy(quaternion);
    if (this.saved.length) this.model.updateWorldMatrix(true, true);
    this.saved = [];
  }

  /** Called while sampling the historical native base pose in the current root. */
  capture(reference: LocomotionPose, current: LocomotionPose) {
    this.model.updateWorldMatrix(true, true);
    return this.legs.map(leg => {
      const target = leg.toe.getWorldPosition(new THREE.Vector3());
      const lowest = this.soleHeight(leg);
      if (Number.isFinite(lowest)) target.y += Math.max(0, current.feet + .001 - lowest);
      return target.sub(this.point.set(current.x, current.feet, current.z))
        .applyAxisAngle(this.up, reference.bodyYaw - current.bodyYaw)
        .add(this.point.set(reference.x, reference.feet, reference.z));
    });
  }

  apply(targets: THREE.Vector3[], weight: number, floor: number) {
    if (!this.ready || weight <= 0 || targets.length !== 2) return false;
    this.model.updateWorldMatrix(true, true);
    const saved = this.legs.flatMap(leg => [leg.upper, leg.lower, leg.ankle, leg.toe])
      .map(bone => ({bone, quaternion: bone.quaternion.clone()}));
    const rollback = () => {for (const value of saved) value.bone.quaternion.copy(value.quaternion); this.model.updateWorldMatrix(true, true);};
    const baseline = this.legs.map(leg => this.soleHeight(leg));
    for (let index = 0; index < this.legs.length; index++) {
      const leg = this.legs[index], toe = leg.toe.getWorldPosition(new THREE.Vector3());
      const goal = leg.ankle.getWorldPosition(new THREE.Vector3()).addScaledVector(this.point.subVectors(targets[index], toe), weight);
      if (goal.distanceTo(leg.ankle.getWorldPosition(this.point)) > .14) {rollback(); return false;}
      if (!this.solve(leg, goal)) {rollback(); return false;}
      const lowest = this.soleHeight(leg);
      // Validate every affected skinned vertex. Unreachable/unsafe correction is
      // discarded as a whole, including a previously solved other leg.
      if (Number.isFinite(lowest) && lowest < Math.min(-.004 + floor, baseline[index] - .0005)) {rollback(); return false;}
    }
    this.saved = saved;
    return true;
  }

  private soleHeight(leg: Leg) {
    let lowest = Infinity;
    for (const {mesh, indices} of leg.probes) {
      mesh.skeleton.update();
      for (const index of indices) {
        mesh.getVertexPosition(index, this.point).applyMatrix4(mesh.matrixWorld);
        lowest = Math.min(lowest, this.point.y);
      }
    }
    return lowest;
  }

  private solve(leg: Leg, goal: THREE.Vector3) {
    const {upper, lower, ankle} = leg;
    upper.getWorldPosition(this.hip); lower.getWorldPosition(this.knee); ankle.getWorldPosition(this.ankle);
    ankle.getWorldQuaternion(this.rotation);
    const a = this.hip.distanceTo(this.knee), b = this.knee.distanceTo(this.ankle);
    this.direction.subVectors(goal, this.hip);
    const distance = this.direction.length();
    if (a < .001 || b < .001 || distance > a + b - .00001 || distance < Math.abs(a - b) + .001) return false;
    this.direction.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    this.pole.subVectors(this.knee, this.hip).addScaledVector(this.direction, -this.pole.dot(this.direction));
    if (this.pole.lengthSq() < 1e-8) return false;
    this.desired.copy(this.hip).addScaledVector(this.direction, along)
      .addScaledVector(this.pole.normalize(), Math.sqrt(Math.max(0, a * a - along * along)));
    this.rotate(upper, this.from.subVectors(this.knee, this.hip), this.to.subVectors(this.desired, this.hip));
    lower.getWorldPosition(this.knee); ankle.getWorldPosition(this.ankle);
    this.rotate(lower, this.from.subVectors(this.ankle, this.knee), this.to.subVectors(goal, this.knee));
    ankle.parent!.getWorldQuaternion(this.parent);
    ankle.quaternion.copy(this.parent.invert()).multiply(this.rotation); ankle.updateWorldMatrix(false, true);
    return ankle.getWorldPosition(this.point).distanceTo(goal) < .001;
  }
  private rotate(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    this.delta.setFromUnitVectors(from.normalize(), to.normalize());
    bone.parent!.getWorldQuaternion(this.parent);
    this.delta.premultiply(this.parent.clone().invert()).multiply(this.parent);
    bone.quaternion.premultiply(this.delta); bone.updateWorldMatrix(false, true);
  }
}
