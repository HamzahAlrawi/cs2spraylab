import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {GRAVITY, type Vec} from '../actor-physics';
import {rapierReady} from '../rapier-runtime';
import native from './native-ragdoll.json';
import type {DeathContact, DeathWorld} from './death-physics';

const STEP = 1 / 120, dynamicGroup = 0x00018000, staticGroup = 0x80007fff;
const vector = (values: number[]) => new THREE.Vector3(...values.map(v => v * native.source.unit) as [number, number, number]);
const rotation = (frame: number[]) => new THREE.Quaternion(...frame.slice(4) as [number, number, number, number]).normalize();
type Binding = {bone: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion; body: RAPIER.RigidBody};
type LocalPose = {bone: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion};

/** Cosmetic fixed-step articulated bodies, independent of live combat.
 * Shape/mass/limit data is native; Rapier's solver is not Source 2's Rubikon. */
export class RigidDeath {
  private world!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private bindings: Binding[] = [];
  private readonly locals: LocalPose[] = [];
  private readonly culling: {mesh: THREE.SkinnedMesh; enabled: boolean}[] = [];
  private readonly initial: {bone: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion}[];
  private readonly geometry?: ReturnType<NonNullable<DeathWorld['corpseGeometry']>>;
  private colliderNames = new Map<number, string>();
  private age = 0;
  private quiet = 0;
  private disposed = false;
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly inverse = new THREE.Quaternion();
  sleeping = false;

  static supported(model: THREE.Object3D) {
    return rapierReady() && native.bodies.every(body => model.getObjectByName(body.name));
  }

  constructor(private readonly model: THREE.Object3D, private readonly environment: DeathWorld,
    private readonly velocity: Vec, private readonly impact: {direction: Vec; headshot: boolean}) {
    if (!RigidDeath.supported(model)) throw new Error('Native death rig or physics runtime unavailable');
    model.updateWorldMatrix(true, true);
    model.traverse(bone => {if (bone instanceof THREE.Bone) this.locals.push({bone, position: bone.position.clone(), rotation: bone.quaternion.clone()});});
    model.traverse(node => {if (node instanceof THREE.SkinnedMesh) {
      this.culling.push({mesh: node, enabled: node.frustumCulled}); node.frustumCulled = false;
    }});
    this.initial = native.bodies.map(spec => {
      const bone = model.getObjectByName(spec.name)!;
      return {bone, position: bone.getWorldPosition(new THREE.Vector3()), rotation: bone.getWorldQuaternion(new THREE.Quaternion())};
    });
    this.geometry = environment.corpseGeometry?.(this.initial.find(b => b.bone.name === 'pelvis')!.position, 8);
    this.reset();
  }

  private reset() {
    this.world?.free(); this.events?.free(); this.colliderNames.clear();
    this.world = new RAPIER.World({x: 0, y: -(this.environment.gravity ?? GRAVITY), z: 0});
    this.world.timestep = STEP;
    this.world.integrationParameters.numSolverIterations = 8;
    this.world.integrationParameters.numInternalPgsIterations = 2;
    this.events = new RAPIER.EventQueue(true);
    this.age = 0; this.quiet = 0; this.sleeping = false;
    const collider = (desc: RAPIER.ColliderDesc) => this.world.createCollider(desc.setCollisionGroups(staticGroup).setFriction(.65).setRestitution(0));
    if (this.geometry?.indices.length) collider(RAPIER.ColliderDesc.trimesh(this.geometry.vertices, this.geometry.indices));
    if (!this.geometry && (this.environment.floor ?? 0) > -100)
      collider(RAPIER.ColliderDesc.cuboid(200, .1, 200).setTranslation(0, (this.environment.floor ?? 0) - .1, 0));
    for (const box of this.environment.boxes ?? []) collider(RAPIER.ColliderDesc.cuboid(box.size.x / 2, box.size.y / 2, box.size.z / 2)
      .setTranslation(box.center.x, box.center.y, box.center.z));

    this.bindings = this.initial.map((initial, i) => {
      const spec = native.bodies[i];
      // World-aligned body frames let generic joints share an exact rest frame.
      // Shape offsets carry the captured bone orientation instead.
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...initial.position.toArray())
        .setLinvel(this.velocity.x, this.velocity.y, this.velocity.z).setLinearDamping(.12)
        .setAngularDamping(spec.angularDamping).setCcdEnabled(true));
      for (const shape of spec.shapes) {
        const a = vector(shape.a).applyQuaternion(initial.rotation), b = vector(shape.b).applyQuaternion(initial.rotation);
        const axis = b.clone().sub(a), half = axis.length() / 2;
        const desc = half > 1e-5 ? RAPIER.ColliderDesc.capsule(half, shape.radius * native.source.unit)
          .setRotation(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()))
          : RAPIER.ColliderDesc.ball(shape.radius * native.source.unit);
        const center = a.add(b).multiplyScalar(.5);
        const c = this.world.createCollider(desc.setTranslation(...center.toArray()).setMass(spec.mass / spec.shapes.length)
          .setCollisionGroups(dynamicGroup).setFriction(.65).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
        this.colliderNames.set(c.handle, spec.name);
      }
      body.recomputeMassPropertiesFromColliders();
      const inertia = new THREE.Vector3().copy(body.principalInertia()).multiplyScalar(spec.inertiaScale - 1);
      body.setAdditionalMassProperties(0, body.localCom(), inertia, body.principalInertiaLocalFrame(), true);
      return {...initial, body};
    });
    const filters = this.bindings.map((_, i) => 0xffff ^ (1 << i));
    for (let i = 0; i < this.bindings.length; i++) for (let j = i + 1; j < this.bindings.length; j++) {
      const connected = native.joints.some(joint => joint.a === i && joint.b === j || joint.a === j && joint.b === i);
      // Native weapon-holding poses legitimately overlap some coarse capsules.
      // Exclude those initial pairs, not all self-contact for the entire corpse.
      const overlap = this.bindings[i].body.collider(0).contactCollider(this.bindings[j].body.collider(0), .015);
      if (connected || overlap) {filters[i] &= ~(1 << j); filters[j] &= ~(1 << i);}
    }
    this.bindings.forEach((binding, i) => {
      for (let c = 0; c < binding.body.numColliders(); c++) binding.body.collider(c).setCollisionGroups((((1 << i) << 16) | filters[i]) >>> 0);
    });
    for (const spec of native.joints) {
      const a = this.bindings[spec.a], b = this.bindings[spec.b];
      const qa = a.rotation.clone().multiply(rotation(spec.frameA)), qb = b.rotation.clone().multiply(rotation(spec.frameB));
      const anchor = vector(spec.frameA.slice(0, 3)).applyQuaternion(a.rotation).add(a.position)
        .add(vector(spec.frameB.slice(0, 3)).applyQuaternion(b.rotation).add(b.position)).multiplyScalar(.5);
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(qa);
      const descriptor = RAPIER.JointData.generic(anchor.clone().sub(a.position), anchor.clone().sub(b.position), axis,
        RAPIER.JointAxesMask.LinX | RAPIER.JointAxesMask.LinY | RAPIER.JointAxesMask.LinZ);
      const joint = this.world.createImpulseJoint(descriptor, a.body, b.body, true);
      joint.setContactsEnabled(false);
      const flex = THREE.MathUtils.clamp(new THREE.Euler().setFromQuaternion(qa.clone().invert().multiply(qb), 'XYZ').z, ...spec.twist as [number, number]);
      // Rapier 0.19's public raw set exposes multi-axis limits. Native flex Z
      // maps to generic X; the swing cone is approximated by two bounded axes.
      this.world.impulseJoints.raw.jointSetLimits(joint.handle, 3, spec.twist[0] - flex, spec.twist[1] - flex);
      this.world.impulseJoints.raw.jointSetLimits(joint.handle, 4, -spec.swing, spec.swing);
      this.world.impulseJoints.raw.jointSetLimits(joint.handle, 5, -spec.swing, spec.swing);
    }
    const direction = new THREE.Vector3().copy(this.impact.direction);
    if (![direction.x, direction.y, direction.z].every(Number.isFinite) || direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
    direction.normalize();
    const hit = this.bindings.find(binding => binding.bone.name === (this.impact.headshot ? 'head_0' : 'spine_2'))!;
    // Local hit impulse, not a whole-body launch. Gravity and retained running/
    // jumping velocity do most of the collapse; no baked positional motors.
    hit.body.applyImpulse(direction.clone().multiplyScalar(hit.body.mass() * (this.impact.headshot ? 1.8 : 1.2)), true);
    // Coherent angular momentum must include the limbs and their linear arc.
    // Rotating only the chest lets the other bodies cancel the hit through the
    // joint solver, leaving a balanced corpse standing for almost a second.
    const spin = this.impact.headshot ? 3.4 : 2.8;
    const tumble = new THREE.Vector3(direction.z * spin, 0, -direction.x * spin);
    const pivot = this.bindings.find(binding => binding.bone.name === 'pelvis')!.position;
    for (const binding of this.bindings) {
      const arc = tumble.clone().cross(binding.position.clone().sub(pivot));
      binding.body.setAngvel(tumble, true);
      binding.body.setLinvel(arc.add(binding.body.linvel()), true);
    }
  }

  update(target: number, onContact?: (contact: DeathContact) => void) {
    if (this.disposed) return;
    const time = Math.max(0, Math.min(8, Number.isFinite(target) ? target : this.age));
    const rewind = time < this.age - 1e-9;
    if (rewind) this.reset();
    while (this.age + STEP <= time + 1e-9 && !this.sleeping) {
      const speeds = this.bindings.map(b => new THREE.Vector3().copy(b.body.linvel()).length());
      this.world.step(this.events); this.age += STEP;
      this.events.drainCollisionEvents((first, second, started) => {
        if (!started || rewind || !onContact) return;
        if (this.colliderNames.has(first) && this.colliderNames.has(second)) return;
        const name = this.colliderNames.get(first) ?? this.colliderNames.get(second);
        const index = this.bindings.findIndex(b => b.bone.name === name);
        if (index < 0 || speeds[index] < .8) return;
        onContact({body: name!, point: {...this.bindings[index].body.translation()}, normal: {x: 0, y: 1, z: 0}, speed: speeds[index], solid: -1});
      });
      const quiet = this.bindings.every(b => {
        const v = b.body.linvel(), w = b.body.angvel();
        return Math.hypot(v.x, v.y, v.z) < .055 && Math.hypot(w.x, w.y, w.z) < .14;
      });
      this.quiet = quiet ? this.quiet + STEP : 0;
      if (this.quiet > .4 || this.age >= 8 - STEP) {
        this.sleeping = true; for (const b of this.bindings) b.body.sleep();
      }
    }
    this.apply();
  }

  private apply() {
    this.model.updateWorldMatrix(true, true);
    for (const local of this.locals) {local.bone.position.copy(local.position); local.bone.quaternion.copy(local.rotation);}
    this.model.updateWorldMatrix(true, true);
    const byName = new Map(this.bindings.map(binding => [binding.bone.name, binding]));
    // Native anchors are offset from bone origins (notably knees and neck).
    // Transfer complete body transforms, not rotations alone, or the rendered
    // skin drifts away from its collision shapes. Joint frames bound articulation.
    this.model.traverse(bone => {
      const binding = byName.get(bone.name); if (!binding) return;
      this.v.copy(binding.body.translation()); bone.parent?.worldToLocal(this.v); bone.position.copy(this.v);
      this.q.copy(binding.body.rotation()).multiply(binding.rotation);
      if (bone.parent) {bone.parent.getWorldQuaternion(this.inverse).invert(); this.q.premultiply(this.inverse);}
      bone.quaternion.copy(this.q); bone.updateWorldMatrix(false, true);
    });
  }

  center(target: THREE.Vector3) {
    return target.copy(this.bindings.find(b => b.bone.name === 'pelvis')!.body.translation());
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.world.free(); this.events.free();
    for (const value of this.culling) value.mesh.frustumCulled = value.enabled;
  }
}
