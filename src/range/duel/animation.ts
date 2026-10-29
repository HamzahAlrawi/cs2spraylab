import * as THREE from 'three';
import {clamp, stanceCurve, UNIT, type Vec} from '../actor-physics';
import type {DuelActorSnapshot} from './types';
import {pistolIds} from '../config';
import type {Equipment} from '../equipment';
import {DualPistolGrip} from './weapon-grip';
import {DEATH_POSE_BLEND_SECONDS, deathVariant} from './round-flow';
import {DeathPhysics, skeletalDeathLinks, type DeathWorld, type DeathContact, type DeathBody, type DeathPoseDrive} from './death-physics';
import {nativeReloadWindow} from '../native-view-actions';
import type {ReloadPhase} from '../weapon-actions';
import {syncAnimationActions} from '../animation-actions';
import {bodyYawDelta} from './body-turn';
import {ActorPoseClock, type PoseClockInput} from './pose-clock';
import {sampleHitReaction} from './hit-reaction';
import {nativeFlinchSample} from './native-flinch';
import {LocomotionTransitions, type LocomotionInput} from './locomotion-transition';
import {LocomotionFootContact} from './locomotion-foot-contact';
import {RigidDeath} from './rigid-death';

type SkinAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type LegProbeMetadata = {joints: SkinAttribute; weights: SkinAttribute; jointVersion: number; weightVersion: number;
  masks: Map<string, readonly number[]>};
const legProbeMetadata = new WeakMap<THREE.BufferGeometry, LegProbeMetadata>();
const attributeVersion = (attribute: SkinAttribute) => attribute instanceof THREE.InterleavedBufferAttribute
  ? attribute.data.version : attribute.version;

/** Immutable geometry metadata only. Actor meshes, bones, poses and contact
 * targets are never cached. The related mask is in this mesh's skeleton order.
 * LocomotionFootContact may use this as its optional probe-index provider.
 */
export function cachedLegProbeIndices(mesh: THREE.SkinnedMesh, related: readonly boolean[]): readonly number[] {
  const geometry = mesh.geometry, joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  if (!joints || !weights) return [];
  const jointVersion = attributeVersion(joints), weightVersion = attributeVersion(weights);
  let metadata = legProbeMetadata.get(geometry);
  if (!metadata || metadata.joints !== joints || metadata.weights !== weights ||
    metadata.jointVersion !== jointVersion || metadata.weightVersion !== weightVersion) {
    metadata = {joints, weights, jointVersion, weightVersion, masks: new Map()}; legProbeMetadata.set(geometry, metadata);
  }
  const key = related.map(value => value ? '1' : '0').join('');
  const cached = metadata.masks.get(key); if (cached) return cached;
  const indices: number[] = [];
  for (let i = 0; i < Math.min(joints.count, weights.count); i++) {
    let influence = 0;
    for (let part = 0; part < 4; part++) if (related[joints.getComponent(i, part)]) influence += weights.getComponent(i, part);
    if (influence > .001) indices.push(i);
  }
  // Different skin palettes may share a geometry; keep that exceptional case bounded.
  if (metadata.masks.size >= 8) metadata.masks.delete(metadata.masks.keys().next().value!);
  const result = Object.freeze(indices); metadata.masks.set(key, result); return result;
}

export type DuelPresentationFrame = {reloadRemaining?: number; reloadDuration?: number; deathWorld?: DeathWorld;
  reloadPhase?: ReloadPhase; reloadProgress?: number; deathVelocity?: Vec;
  /** Parent must apply bodyYaw - PI to root and reuse this value for shot poses. */
  bodyYaw?: number; poseTime?: number};
export type WeaponGestureOptions = {duration?: number; crouched?: boolean; side?: 'left' | 'right'; lastShot?: boolean; startedAt?: number};
const upperBone = (name: string) => /^(?:(?:spine_|neck_|head_|clavicle_|arm_|hand_|finger_|thumb_)|wpn(?:Pivot)?$)/.test(name);
const processedAnimationClips = new WeakMap<THREE.AnimationClip,
  Map<string, WeakMap<THREE.AnimationClip, THREE.AnimationClip | null>>>();
const animationBindingKey = (modelName: string, nodes: Set<string>) => JSON.stringify([modelName, [...nodes].sort()]);

/** Only detached clip data is shared. Mixers, actions, interpolants and poses
 * remain actor-local. Source clips (including their typed arrays) are never edited.
 */
function cachedAnimationClip(source: THREE.AnimationClip, bindings: string, conversion: 'world' | 'gesture',
  prepare: () => THREE.AnimationClip | null, base = source): THREE.AnimationClip | null {
  let variants = processedAnimationClips.get(source);
  if (!variants) {variants = new Map(); processedAnimationClips.set(source, variants);}
  // nativeGestureClips may set blendMode when an asset's metadata arrives.
  const key = JSON.stringify([bindings, conversion, source.blendMode]);
  let bases = variants.get(key);
  if (!bases) {bases = new WeakMap(); variants.set(key, bases);}
  const cached = bases.get(base); if (cached !== undefined) return cached;
  const clip = prepare();
  if (clip) {
    // Typed-array contents stay read-only by ownership; Three.js samples them
    // through per-action interpolants. Freeze the structural data after conversion.
    for (const track of clip.tracks) Object.freeze(track);
    Object.freeze(clip.tracks); Object.freeze(clip);
  }
  bases.set(base, clip); return clip;
}

export function nativeGestureClips(asset: {animations: THREE.AnimationClip[]; parser: {json: {animations?: {extras?: {additive?: boolean; additive_composed?: boolean}}[]}}}) {
  asset.animations.forEach((clip, index) => {
    const extras = asset.parser.json.animations?.[index]?.extras;
    if (extras?.additive && !extras.additive_composed) clip.blendMode = THREE.AdditiveAnimationBlendMode;
  });
  return asset.animations;
}
export function nativeGestureName(equipment: string, action: string, options: WeaponGestureOptions = {}) {
  if (!['draw', 'reload', 'reload-empty', 'fire', 'fire-alt', ...(equipment.startsWith('utility') ? ['pullpin', 'throw-high', 'throw-low'] : [])].includes(action)) return null;
  const side = equipment === 'elite' && action === 'fire' && options.side ? `-${options.side}${options.lastShot ? '-last' : ''}` : '';
  return `gesture_${action}${side}${options.crouched && action !== 'fire' ? '_crouch' : ''}_${equipment}`;
}

export function locomotionWeights(actor: DuelActorSnapshot, family = 'rifle', bodyYaw = actor.yaw) {
  const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  const x = actor.velocity.x * Math.cos(bodyYaw) - actor.velocity.z * Math.sin(bodyYaw);
  const z = -actor.velocity.x * Math.sin(bodyYaw) - actor.velocity.z * Math.cos(bodyYaw);
  const compass = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const sector = ((Math.atan2(x, z) / (Math.PI / 4)) + 8) % 8;
  const low = Math.floor(sector), blend = sector - low;
  const directions = speed > .001 ? {[compass[low]]: 1 - blend, [compass[(low + 1) % 8]]: blend} : {n: 1};
  const duck = stanceCurve(actor.duckAmount);
  const moving = clamp(speed / (32 * UNIT), 0, 1);
  const running = clamp((speed / UNIT - 136) / (225 - 136), 0, 1);
  const weights = new Map<string, number>();
  weights.set(`idle_${family}`, (1 - moving) * (1 - duck));
  weights.set(`idle_crouch_${family}`, (1 - moving) * duck);
  for (const [direction, amount] of Object.entries(directions)) {
    weights.set(`walk_${direction}_${family}`, amount * moving * (1 - duck) * (1 - running));
    weights.set(`run_${direction}_${family}`, amount * moving * (1 - duck) * running);
    weights.set(`crouch_${direction}_${family}`, amount * moving * duck);
  }
  // Native locomotion graph's crouch blend-space anchor is 96 u/s, not the
  // weapon's crouched speed cap. Using the cap made the feet cycle too quickly.
  return {weights, speed, authoredSpeed: ((136 + (225 - 136) * running) * (1 - duck) + 96 * duck) * UNIT};
}

// The masked native plant prototype fails mesh-floor validation during fades.
// Keep it inactive until its contact blend is verified; pitch aim is independent.
const nativePlantVerified = false;

// Native reversal deltas need contact correction, just as the source graph has
// foot IK. This rotates existing leg joints only; the actor/root never moves.
class PlantedFoot {
  readonly upper?: THREE.Object3D;
  readonly lower?: THREE.Object3D;
  readonly ankle?: THREE.Object3D;
  readonly toe?: THREE.Object3D;
  readonly target = new THREE.Vector3();
  private hip = new THREE.Vector3();
  private knee = new THREE.Vector3();
  private foot = new THREE.Vector3();
  private point = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private delta = new THREE.Quaternion();
  private parent = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private rotation = new THREE.Quaternion();
  private plantedRotation = new THREE.Quaternion();
  private toeRotation = new THREE.Quaternion();
  private plantedToeRotation = new THREE.Quaternion();
  private floor = 0;
  private readonly sole: {mesh: THREE.SkinnedMesh; index: number}[] = [];
  constructor(model: THREE.Object3D, side: 'L' | 'R') {
    this.upper = model.getObjectByName(`leg_upper_${side}`); this.lower = model.getObjectByName(`leg_lower_${side}`);
    this.ankle = model.getObjectByName(`ankle_${side}`); this.toe = model.getObjectByName(`ball_${side}`);
    if (!this.ready) return;
    model.updateWorldMatrix(true, true);
    model.traverse(mesh => {
      if (!(mesh instanceof THREE.SkinnedMesh)) return;
      const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
      if (!joints || !weights) return;
      mesh.skeleton.update();
      const related = mesh.skeleton.bones.map(bone => bone.name === `ankle_${side}` || bone.name === `ball_${side}`);
      for (let index = 0; index < joints.count; index++) {
        let influence = 0;
        for (let part = 0; part < 4; part++) if (related[joints.getComponent(index, part)])
          influence += weights.getComponent(index, part);
        if (influence < .75) continue;
        this.sole.push({mesh, index});
      }
    });
  }
  get ready() {return !!(this.upper && this.lower && this.ankle && this.toe);}
  capture(floor: number) {
    this.floor = floor;
    this.toe!.getWorldPosition(this.target); this.ankle!.getWorldQuaternion(this.plantedRotation);
    this.toe!.getWorldQuaternion(this.plantedToeRotation);
    const lowest = this.soleHeight();
    if (Number.isFinite(lowest)) this.target.y += floor + .003 - lowest;
  }
  private soleHeight() {
    let lowest = Infinity;
    let previous: THREE.SkinnedMesh | undefined;
    for (const {mesh, index} of this.sole) {
      if (mesh !== previous) {mesh.skeleton.update(); previous = mesh;}
      mesh.getVertexPosition(index, this.point).applyMatrix4(mesh.matrixWorld); lowest = Math.min(lowest, this.point.y);
    }
    return lowest;
  }
  solve(weight: number) {
    const {upper, lower, ankle, toe} = this;
    if (!upper || !lower || !ankle || !toe || weight <= 0) return true;
    upper.getWorldPosition(this.hip); lower.getWorldPosition(this.knee); ankle.getWorldPosition(this.foot);
    toe.getWorldQuaternion(this.toeRotation); this.toeRotation.slerp(this.plantedToeRotation, weight);
    ankle.getWorldQuaternion(this.rotation); this.rotation.slerp(this.plantedRotation, weight);
    ankle.parent!.getWorldQuaternion(this.parent);
    ankle.quaternion.copy(this.parent.invert()).multiply(this.rotation); ankle.updateWorldMatrix(false, true);
    toe.getWorldPosition(this.point);
    this.goal.copy(this.point).lerp(this.target, weight).sub(this.point).add(this.foot);
    if (!this.reach()) return false;
    // The animated fade can rotate a heel beneath an otherwise valid contact.
    // Correct only its vertical support, never the captured horizontal anchor.
    let rise = 0;
    for (let pass = 0; pass < 2; pass++) {
      const lowest = this.soleHeight();
      if (lowest >= this.floor + .0005) break;
      const correction = this.floor + .001 - lowest; rise += correction;
      if (rise > .03) return false;
      this.goal.y += correction;
      if (!this.reach()) return false;
    }
    const contact = toe.getWorldPosition(this.point).distanceTo(this.target) < .002 || weight < .999;
    return contact && this.soleHeight() > this.floor - .004;
  }
  private reach() {
    const {upper, lower, ankle, toe} = this;
    if (!upper || !lower || !ankle || !toe) return false;
    upper.getWorldPosition(this.hip); lower.getWorldPosition(this.knee); ankle.getWorldPosition(this.foot);
    const a = this.hip.distanceTo(this.knee), b = this.knee.distanceTo(this.foot);
    this.direction.subVectors(this.goal, this.hip);
    const distance = this.direction.length();
    if (a < .001 || b < .001 || distance < .001 || distance > a + b + .002 || distance < Math.abs(a - b) + .001) return false;
    const d = Math.min(a + b - .00001, distance);
    this.direction.normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    this.pole.subVectors(this.knee, this.hip);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction));
    if (this.pole.lengthSq() < 1e-8) return false;
    this.pole.normalize();
    this.desired.copy(this.hip).addScaledVector(this.direction, along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, a * a - along * along)));
    this.rotate(upper, this.from.subVectors(this.knee, this.hip), this.to.subVectors(this.desired, this.hip));
    lower.getWorldPosition(this.knee); ankle.getWorldPosition(this.foot);
    this.rotate(lower, this.from.subVectors(this.foot, this.knee), this.to.subVectors(this.goal, this.knee));
    ankle.parent!.getWorldQuaternion(this.parent);
    ankle.quaternion.copy(this.parent.invert()).multiply(this.rotation); ankle.updateWorldMatrix(false, true);
    toe.parent!.getWorldQuaternion(this.parent);
    toe.quaternion.copy(this.parent.invert()).multiply(this.toeRotation); toe.updateWorldMatrix(false, true);
    return true;
  }
  private rotate(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    this.delta.setFromUnitVectors(from.normalize(), to.normalize());
    bone.parent!.getWorldQuaternion(this.parent);
    this.delta.premultiply(this.inverse.copy(this.parent).invert()).multiply(this.parent);
    bone.quaternion.premultiply(this.delta); bone.updateWorldMatrix(false, true);
  }
}

// Native eight-direction clips share a gait phase. Direction and stance change their
// weights, not the playback origin; stride timing follows simulated velocity.
export class DuelAnimator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private activeActions = new Set<THREE.AnimationAction>();
  private gaitPhase: number;
  private readonly poseClock: ActorPoseClock;
  private readonly transitions = new LocomotionTransitions();
  private readonly footContact: LocomotionFootContact;
  private idleTime = 0;
  private airTime = 0;
  private wasAirborne = false;
  private jumpClip = 'jump_stand_rifle';
  private deathTime = 0;
  private dying = false;
  private deathStart = 0;
  private deathBlend?: THREE.AnimationAction;
  private deathActions: {action: THREE.AnimationAction; weight: number}[] = [];
  private bakedDeath = false;
  private readonly bodyContacts: {bone: THREE.Object3D; radius: number}[] = [];
  private readonly dualGrip: DualPistolGrip;
  private gesture?: {name: string; duration: number; elapsed: number; startedAt?: number};
  private absoluteGestures = new Set<string>();
  private aimBones: {bone: THREE.Object3D; quaternion: THREE.Quaternion; weight: number}[] = [];
  private aimApplied = false;
  private disposed = false;
  private deathWorld?: DeathWorld;
  private dynamicDeath?: DeathPhysics;
  private rigidDeath?: RigidDeath;
  private restartDeath?: () => DeathPhysics;
  private deathWeaponOffset?: THREE.Matrix4;
  private readonly deathPoseRoot = new THREE.Matrix4();
  private deathBindings: {bone: THREE.Object3D; child?: THREE.Object3D; direction: THREE.Vector3;
    quaternion: THREE.Quaternion}[] = [];
  private vector = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private weaponAim?: {bone: THREE.Object3D; hand: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion};
  private handBeforeAim = new THREE.Matrix4();
  private weaponAimMatrix = new THREE.Matrix4();
  private readonly plantFeet: PlantedFoot[];
  private readonly plantLegs: {bone: THREE.Object3D; quaternion: THREE.Quaternion}[] = [];
  private plantApplied = false;
  private plant?: {name: string; elapsed: number; duration: number; yaw: number; feet: number; weight: number; capture: boolean};
  private strafe?: {sign: number; age: number; yaw: number};
  private previousLateral = 0;
  private actorGeneration?: number;
  private actorId?: number;
  private health?: number;
  private armor?: number;
  private reactionBase:{bone:THREE.Object3D;position:THREE.Vector3;rotation:THREE.Quaternion}[]=[];
  private reactionEuler=new THREE.Euler();
  private reactionQuaternion=new THREE.Quaternion();
  onDeathContact?: (contact: DeathContact) => void;

  constructor(private readonly model: THREE.Object3D, clips: THREE.AnimationClip[], phase = 0, equipment?: Equipment) {
    this.gaitPhase = phase;
    this.poseClock = new ActorPoseClock(phase);
    this.dualGrip = new DualPistolGrip(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.footContact = new LocomotionFootContact(model,cachedLegProbeIndices);
    const canPlant = nativePlantVerified && clips.some(clip => /\/planted_[ew]2[ew]_rifle$/.test(clip.name)) &&
      equipment !== 'knife' && equipment !== 'zeus' && !pistolIds.some(id => id === equipment);
    this.plantFeet = canPlant ? [new PlantedFoot(model, 'L'), new PlantedFoot(model, 'R')] : [];
    if (canPlant) model.traverse(bone => {if (/^(?:leg_|ankle_|ball_)/.test(bone.name)) this.plantLegs.push({bone, quaternion: bone.quaternion.clone()});});
    const anchor = model.getObjectByName('wpnPivot'), hand = model.getObjectByName('hand_R');
    if (anchor && hand) this.weaponAim = {bone: anchor, hand, position: anchor.position.clone(), quaternion: anchor.quaternion.clone()};
    // Head and arms branch after the spine's 85% contribution. Complete both
    // chains so the gun does not receive less physical pitch than the face.
    for (const [name, weight] of [['spine_0', .2], ['spine_1', .3], ['spine_2', .35],
      ['head_0', .15], ['clavicle_L', .15], ['clavicle_R', .15]] as const) {
      const bone = model.getObjectByName(name);
      if (bone) this.aimBones.push({bone, quaternion: bone.quaternion.clone(), weight});
    }
    for (const [name, radius] of [['head_0', .12], ['pelvis', .11], ['spine_2', .12],
      ['ankle_L', .055], ['ankle_R', .055], ['hand_L', .035], ['hand_R', .035]] as const) {
      const bone = model.getObjectByName(name);
      if (bone) this.bodyContacts.push({bone, radius});
    }
    const nodes = new Set<string>(); model.traverse(node => nodes.add(node.name));
    const bindings = animationBindingKey(model.name, nodes);
    const family = equipment && pistolIds.some(id => id === equipment) ? 'pistol' : 'rifle';
    const weaponIdle = equipment === 'hkp2000' ? 'hkp' : equipment;
    for (const clip of clips) {
      if (!clip.name.includes('/world/')) continue;
      const key = clip.name.split('/').pop()!.replace(/\.\d+$/, '');
      if (key.startsWith('gesture_')) continue;
      if (!nativePlantVerified && /^planted_[ew]2[ew]_rifle$/.test(key)) continue;
      if (equipment && (key.endsWith(family === 'pistol' ? '_rifle' : '_pistol') ||
        /^idle_(?:crouch_)?(usp|glock|hkp|p250|deagle|elite|fiveseven|tec9|cz75a|revolver)$/.test(key) &&
        key !== `idle_${weaponIdle}` && key !== `idle_crouch_${weaponIdle}`)) continue;
      const bound = cachedAnimationClip(clip, bindings, 'world', () => {
        const bound = clip.clone();
        bound.tracks = bound.tracks.filter(track => {
          const target = track.name.slice(0, track.name.lastIndexOf('.'));
          if (key.startsWith('death_') && (target === '' || target === model.name)) return false;
          return target === '' || nodes.has(target);
        });
        // Weapon-specific native idles are RelativeToFrame layers, not complete
        // locomotion poses. Replacing the base pose with one leaves T-pose hands.
        if (/^idle_(?:crouch_)?(usp|glock|hkp|p250|deagle|elite|fiveseven|tec9|cz75a|revolver)$/.test(key))
          THREE.AnimationUtils.makeClipAdditive(bound, 0, bound);
        return bound;
      })!;
      const action = this.mixer.clipAction(bound);
      action.paused = true; action.enabled = false;
      this.actions.set(key, action);
      if (/^planted_[ew]2[ew]_rifle$/.test(key) && clip.duration > 0 && this.plantFeet.length === 2 && this.plantFeet.every(foot => foot.ready)) {
        const recovery = bound.clone(); recovery.name = `recovery_${key}`;
        recovery.tracks = recovery.tracks.filter(track => (/^(?:leg_|ankle_|ball_)/.test(track.name) && !track.name.endsWith('.scale')) || track.name === 'pelvis.position');
        THREE.AnimationUtils.makeClipAdditive(recovery, clip.duration * 30, bound, 30);
        const pelvis = recovery.tracks.find(track => track.name === 'pelvis.position');
        if (pelvis) {
          // Preserve native compression/recovery, not its lateral root-space
          // pose offset or pelvis twist. Carry the held gun with the hands.
          const basis = bound.tracks.find(track => track.name === 'root_motion.quaternion');
          const rotation = basis ? new THREE.Quaternion().fromArray(basis.values) : new THREE.Quaternion();
          this.quaternion.identity();
          model.getObjectByName('root_motion')?.parent?.getWorldQuaternion(this.quaternion);
          rotation.premultiply(this.quaternion);
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation.invert()), point = new THREE.Vector3();
          for (let i = 0; i < pelvis.values.length; i += 3) point.fromArray(pelvis.values, i).projectOnVector(up).toArray(pelvis.values, i);
          if (anchor) {const gun = pelvis.clone(); gun.name = 'wpnPivot.position'; recovery.tracks.push(gun);}
        }
        const gesture = this.mixer.clipAction(recovery); gesture.paused = true; gesture.enabled = false;
        this.actions.set(recovery.name, gesture);
      }
    }
    this.addGestureClips(clips);
  }

  /** A separate animation-only asset may be loaded after the base actor; no mesh replacement. */
  addGestureClips(clips: THREE.AnimationClip[]) {
    if (this.disposed) return;
    const nodes = new Set<string>(); this.model.traverse(node => nodes.add(node.name));
    const bindings = animationBindingKey(this.model.name, nodes);
    for (const clip of clips) {
      const name = clip.name.split('/').pop()!;
      if (!name.startsWith('gesture_') || this.actions.has(name)) continue;
      let base: THREE.AnimationClip | undefined;
      if (clip.blendMode !== THREE.AdditiveAnimationBlendMode) {
        const family = name.endsWith('_pistol') || name.endsWith('_elite') || /_(usp|glock|hkp2000|p250|deagle|fiveseven|tec9|cz75a|revolver)$/.test(name) ? 'pistol' : 'rifle';
        base = this.actions.get(`idle_${name.includes('_crouch_') ? 'crouch_' : ''}${family}`)?.getClip();
        if (!base) continue;
      }
      const bound = cachedAnimationClip(clip, bindings, 'gesture', () => {
        const bound = clip.clone();
        bound.tracks = bound.tracks.filter(track => upperBone(track.name.slice(0, track.name.lastIndexOf('.')))
          && !track.name.endsWith('.scale')
          && !(track.name.endsWith('.position')&&/^(spine_|neck_|head_)/.test(track.name))
          && nodes.has(track.name.slice(0, track.name.lastIndexOf('.'))));
        if (!bound.tracks.length) return null;
        if (base) THREE.AnimationUtils.makeClipAdditive(bound, 0, base);
        return bound;
      }, base);
      if (!bound) continue;
      if (base) this.absoluteGestures.add(name);
      const action = this.mixer.clipAction(bound); action.paused = true; action.enabled = false;
      this.actions.set(name, action);
    }
  }
  playAction(equipment: string, action: string, options: WeaponGestureOptions = {}) {
    if (this.disposed) return false;
    if (action === 'cancel') {this.gesture = undefined; return false;}
    const requested = nativeGestureName(equipment, action, options);
    const name = requested && this.actions.has(requested) ? requested : nativeGestureName(equipment, action);
    const clip = name ? this.actions.get(name)?.getClip() : undefined;
    const duration = options.duration ?? clip?.duration ?? 0;
    if (!clip || !Number.isFinite(duration) || duration <= 0 || this.dying) return false;
    this.gesture = {name: name!, duration, elapsed: 0, startedAt: options.startedAt}; return true;
  }
  setDeathWorld(world?: DeathWorld) {this.deathWorld = world;}

  private clockInput(actor: DuelActorSnapshot, bodyYaw = actor.yaw): PoseClockInput {
    const family = pistolIds.some(id => id === actor.equipment) && this.actions.has('idle_pistol') ? 'pistol' : 'rifle';
    const {weights, speed, authoredSpeed} = locomotionWeights(actor, family, bodyYaw);
    let duration = 0, weight = 0;
    for (const [name, amount] of weights) if (!name.startsWith('idle') && amount >= .001) {
      duration += (this.actions.get(name)?.getClip().duration ?? .75) * amount; weight += amount;
    }
    const lateral = actor.velocity.x * Math.cos(actor.yaw) - actor.velocity.z * Math.sin(actor.yaw);
    const forward = -actor.velocity.x * Math.sin(actor.yaw) - actor.velocity.z * Math.cos(actor.yaw);
    return {id: actor.id, generation: actor.generation, cyclesPerSecond: weight ? speed / authoredSpeed / (duration / weight) : 0,
      airborne: !(actor.grounded ?? actor.feet < .001), jumpClip: speed > .8 ? `jump_${Math.abs(lateral) > Math.abs(forward)
        ? lateral > 0 ? 'e' : 'w' : forward > 0 ? 'n' : 's'}_${family}` : `jump_stand_${family}`};
  }
  recordPose(actor: DuelActorSnapshot, time: number, bodyYaw = actor.yaw) {
    this.poseClock.record(this.clockInput(actor, bodyYaw), time);
    const clock = this.poseClock.sample(this.clockInput(actor, bodyYaw), time);
    if (!clock) return;
    const family = pistolIds.some(id => id === actor.equipment) && this.actions.has('idle_pistol') ? 'pistol' : 'rifle';
    const {weights} = locomotionWeights(actor, family, bodyYaw);
    this.airborneWeights(weights, actor, family, clock.air, clock.jumpClip);
    this.transitions.record(this.transitionInput(actor, bodyYaw, weights, clock.gait, clock.idle), time);
  }

  private transitionInput(actor: DuelActorSnapshot, bodyYaw: number, weights: ReadonlyMap<string, number>, gait: number, idle: number): LocomotionInput {
    return {id: actor.id, generation: actor.generation, equipment: actor.equipment, weights: new Map(weights), gait, idle,
      x: actor.position.x, z: actor.position.z, feet: actor.feet, bodyYaw, vx: actor.velocity.x, vz: actor.velocity.z,
      duck: actor.duckAmount, airborne: !(actor.grounded ?? actor.feet < .001),
      supported: actor.alive && actor.supportingActor === undefined};
  }

  private airborneWeights(weights: Map<string, number>, actor: DuelActorSnapshot, family: string, air: number, jump: string) {
    if ((actor.grounded ?? actor.feet < .001) || !this.actions.has(jump)) return;
    weights.clear();
    const takeoff = this.actions.get(jump)!.getClip().duration;
    const blend = this.actions.has(`inair_stand_${family}`) ? clamp((air - takeoff * .6) / .12, 0, 1) : 0;
    const duck = this.actions.has(`inair_crouch_stand_${family}`) && this.actions.has(`jump_crouch_stand_${family}`)
      ? stanceCurve(actor.duckAmount) : 0;
    weights.set(jump, (1 - blend) * (1 - duck)); weights.set(`inair_stand_${family}`, blend * (1 - duck));
    weights.set(`jump_crouch_stand_${family}`, (1 - blend) * duck); weights.set(`inair_crouch_stand_${family}`, blend * duck);
  }

  update(actor: DuelActorSnapshot, dt: number, deathAge?: number, frame: DuelPresentationFrame = {}) {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (actor.generation !== this.actorGeneration || actor.id !== this.actorId || !actor.alive ||
      this.health !== undefined && actor.health < this.health || this.armor !== undefined && actor.armor < this.armor) {
      this.plant = undefined; this.strafe = undefined; this.previousLateral = 0;
    }
    this.actorGeneration = actor.generation; this.actorId = actor.id; this.health = actor.health; this.armor = actor.armor;
    if (frame.deathWorld) this.deathWorld = frame.deathWorld;
    if (!actor.alive && this.deathWorld) {this.updateDynamicDeath(actor, dt, frame.deathVelocity, deathAge); return;}
    if (!actor.alive) {this.updateDeath(actor, dt, deathAge); return;}
    this.footContact.restore();
    if (this.plantApplied) for (const value of this.plantLegs) value.bone.quaternion.copy(value.quaternion);
    this.plantApplied = false;
    if (this.aimApplied) {
      for (const value of this.aimBones) value.bone.quaternion.copy(value.quaternion);
      if (this.weaponAim) {this.weaponAim.bone.position.copy(this.weaponAim.position); this.weaponAim.bone.quaternion.copy(this.weaponAim.quaternion);}
    }
    this.aimApplied = false;
    for(const base of this.reactionBase){base.bone.position.copy(base.position);base.bone.quaternion.copy(base.rotation);}
    this.reactionBase=[];
    const family = pistolIds.some(id => id === actor.equipment) && this.actions.has('idle_pistol') ? 'pistol' : 'rifle';
    const bodyYaw = Number.isFinite(frame.bodyYaw) ? frame.bodyYaw! : actor.yaw;
    const {weights, speed, authoredSpeed} = locomotionWeights(actor, family, bodyYaw);
    const suffix = actor.equipment === 'hkp2000' ? 'hkp' : actor.equipment;
    if (family === 'pistol' && !this.actions.has(`gesture_idle_${actor.equipment}`)) for (const idle of ['idle', 'idle_crouch']) {
      const name = `${idle}_${suffix}`, duck = stanceCurve(actor.duckAmount);
      if (this.actions.has(name)) weights.set(name, idle === 'idle' ? 1 - duck : duck);
    }
    let duration = 0, motionWeight = 0;
    for (const [name, weight] of weights) {
      if (name.startsWith('idle') || weight < .001) continue;
      duration += (this.actions.get(name)?.getClip().duration ?? .75) * weight;
      motionWeight += weight;
    }
    const clock = frame.poseTime === undefined ? undefined : this.poseClock.sample(this.clockInput(actor, bodyYaw), frame.poseTime);
    if (clock) {this.gaitPhase = clock.gait; this.idleTime = clock.idle;}
    else {if (motionWeight > 0) this.gaitPhase = (this.gaitPhase + dt * speed / authoredSpeed / (duration / motionWeight)) % 1;
      this.idleTime += dt;}
    const airborne = !(actor.grounded ?? actor.feet < .001);
    if (airborne && !this.wasAirborne) {
      this.airTime = 0;
      const lateral = actor.velocity.x * Math.cos(actor.yaw) - actor.velocity.z * Math.sin(actor.yaw);
      const forward = -actor.velocity.x * Math.sin(actor.yaw) - actor.velocity.z * Math.cos(actor.yaw);
      this.jumpClip = speed > .8 ? `jump_${Math.abs(lateral) > Math.abs(forward) ? lateral > 0 ? 'e' : 'w'
        : forward > 0 ? 'n' : 's'}_${family}` : `jump_stand_${family}`;
    }
    this.airTime += airborne ? dt : 0;
    if (clock) {this.airTime = clock.air; this.jumpClip = clock.jumpClip;}
    this.wasAirborne = airborne;
    this.preparePlant(actor, dt, family, airborne);
    this.airborneWeights(weights, actor, family, this.airTime, this.jumpClip);
    // Additive weapon-idle layers are not normalized into the base-pose blend.
    const overlays = new Map([...weights].filter(([name]) => /^idle_(?:crouch_)?(usp|glock|hkp|p250|deagle|elite|fiveseven|tec9|cz75a|revolver)$/.test(name)));
    for (const name of overlays.keys()) weights.delete(name);
    const input = this.transitionInput(actor, bodyYaw, weights, this.gaitPhase, this.idleTime);
    const transition = frame.poseTime === undefined ? this.transitions.advance(input, dt) : this.transitions.sample(input, frame.poseTime);
    if (transition) {weights.clear(); for (const [name, amount] of transition.weights) weights.set(name, amount);}
    for (const [name, amount] of overlays) weights.set(name, amount);
    // The baseline three-clip asset remains usable while the native library loads.
    const resolved = new Map<string, number>();
    for (const [name, weight] of weights) {
      if (weight < .001) continue;
      const fallback = name.startsWith('idle') || speed < .2 ? 'idle_rifle'
        : name.includes('_w_') ? 'run_w_rifle' : 'run_e_rifle';
      const key = this.actions.has(name) ? name : fallback;
      resolved.set(key, (resolved.get(key) ?? 0) + weight);
    }
    const utilityFamily = actor.utility === 'molotov' ? 'utility-molotov' : 'utility';
    const weaponIdle = actor.utility ? `gesture_idle${actor.duckAmount > .5 ? '_crouch' : ''}_${utilityFamily}` : `gesture_idle_${actor.equipment}`;
    if (!airborne && this.actions.has(weaponIdle)) resolved.set(weaponIdle, 1);
    if (this.plant && this.plant.weight > 0) resolved.set(this.plant.name, this.plant.weight);
    let contactTargets: THREE.Vector3[] | undefined;
    if (transition?.contact && transition.contact.weight > 0 && this.footContact.ready) {
      const reference = transition.contact.pose;
      for (const [name, action] of this.actions) {
        const amount = reference.weights.get(name) ?? 0;
        action.enabled = amount > .001;
        if (!action.enabled) continue;
        action.setEffectiveWeight(amount);
        const length = action.getClip().duration;
        action.time = length <= 0 ? 0 : name.startsWith('idle') ? (reference.idle * .167) % length : reference.gait * length;
      }
      this.evaluatePose();
      contactTargets = this.footContact.capture(reference, input);
    }
    for (const [name, action] of this.actions) {
      const weight = resolved.get(name) ?? 0;
      action.enabled = weight > .001;
      if (!action.enabled) continue;
      action.setEffectiveWeight(weight);
      const length = action.getClip().duration;
      // Native idle clips can be a single pose at t=0, with no duration.
      action.time = length <= 0 ? 0 : name.startsWith('jump') ? Math.min(this.airTime, Math.max(0, length - .0001))
        : name.startsWith('recovery_') ? Math.min(this.plant?.elapsed ?? 0, length)
        : name.startsWith('idle') || name.startsWith('gesture_idle_') ? (this.idleTime * .167) % length
        : name.startsWith('inair') ? this.idleTime % length : this.gaitPhase * length;
    }
    if (actor.reloading && !this.gesture?.name.includes('reload')) this.playAction(actor.equipment, 'reload',
      {duration: frame.reloadDuration, crouched: actor.duckAmount > .5});
    if (!actor.reloading && this.gesture?.name.includes('reload')) this.gesture = undefined;
    if (frame.poseTime !== undefined && actor.action && actor.action !== 'reload' && actor.actionAt !== undefined) {
      this.playAction(actor.equipment, actor.action);
    }
    if (this.gesture) {
      const gesture = this.gesture, action = this.actions.get(gesture.name)!;
      gesture.elapsed = frame.reloadRemaining !== undefined && gesture.name.includes('reload')
        ? Math.max(0, gesture.duration - frame.reloadRemaining)
          : frame.poseTime !== undefined && (gesture.startedAt ?? actor.actionAt) !== undefined
            ? Math.max(0, frame.poseTime - (gesture.startedAt ?? actor.actionAt)!) : gesture.elapsed + dt;
      const window = gesture.name.includes('reload') ? nativeReloadWindow(actor.equipment, frame.reloadPhase) : undefined;
      const phaseProgress = Number.isFinite(frame.reloadProgress) ? clamp(frame.reloadProgress!, 0, 1) : gesture.elapsed / gesture.duration;
      if (!window && gesture.elapsed >= gesture.duration) this.gesture = undefined;
      else {
        const fade = Math.min(.08, gesture.duration / 4);
        action.enabled = true; action.time = window ? Math.min(action.getClip().duration, window.start + phaseProgress * window.duration)
          : gesture.elapsed / gesture.duration * action.getClip().duration;
        action.setEffectiveWeight(window ? frame.reloadPhase === 'shell' ? 1 : frame.reloadPhase === 'start' ? Math.min(1, phaseProgress * gesture.duration / fade)
          : Math.max(0, Math.min(1, (1 - phaseProgress) * gesture.duration / fade))
          : Math.min(1, gesture.elapsed / fade, (gesture.duration - gesture.elapsed) / fade));
        // Absolute native poses replace the weapon idle, rather than adding its
        // deltas twice; additive firing layers keep the weapon idle underneath.
        const idle = this.actions.get(weaponIdle);
        if (idle && this.absoluteGestures.has(gesture.name)) idle.setEffectiveWeight(1 - action.getEffectiveWeight());
      }
    }
    const reactionTime=frame.poseTime??this.idleTime;
    const nativeFlinch=actor.recentHits?nativeFlinchSample(actor.recentHits,reactionTime,family,name=>this.actions.get(name)?.getClip().duration):undefined;
    if(nativeFlinch) {
      const action=this.actions.get(nativeFlinch.name)!;
      action.enabled=true;action.time=nativeFlinch.elapsed;action.setEffectiveWeight(nativeFlinch.weight);
    }
    // The installed flashed clips are single native poses, not timed gestures.
    // Valve's visibility cue covers the eyes only during complete whiteout.
    if ((actor.flashAmount ?? 0) >= .999) {
      const duck = stanceCurve(actor.duckAmount);
      const standing = this.actions.get(`gesture_flashed_${family}`), crouching = this.actions.get(`gesture_flashed_crouch_${family}`);
      if (standing || crouching) {
        for (const [name, action] of this.actions) if (name.startsWith('gesture_') ||
          /^idle_(?:crouch_)?(usp|glock|hkp|p250|deagle|elite|fiveseven|tec9|cz75a|revolver)$/.test(name)) action.enabled = false;
        if (standing) {standing.enabled = true; standing.time = 0; standing.setEffectiveWeight(crouching ? 1 - duck : 1);}
        if (crouching) {crouching.enabled = true; crouching.time = 0; crouching.setEffectiveWeight(standing ? duck : 1);}
      }
    }
    this.evaluatePose();
    if (contactTargets) this.footContact.apply(contactTargets, transition!.contact!.weight, actor.feet);
    if (this.plant) {
      for (const value of this.plantLegs) value.quaternion.copy(value.bone.quaternion);
      if (this.plant.capture) {
        this.model.updateWorldMatrix(true, true);
        this.plantFeet.forEach(foot => foot.capture(actor.feet)); this.plant.capture = false;
      }
      if (this.plantFeet.every(foot => foot.solve(this.plant!.weight))) this.plantApplied = this.plant.weight > 0;
      else {
        // A ceiling/step/turn can invalidate a captured support. Fall back to
        // the normal pose now, never stretch a leg or relocate the actor.
        this.actions.get(this.plant.name)!.enabled = false; this.plant = undefined;
        for (const value of this.plantLegs) value.bone.quaternion.copy(value.quaternion);
        this.evaluatePose();
      }
    }
    // A timestamped flinch uses the same posed skeleton for rendering and shot
    // capsules. Restore the base first on every query, including replay/rewind.
    if(!nativeFlinch&&actor.recentHits?.some(hit=>reactionTime>=hit.time&&reactionTime-hit.time<.25)) {
      const reaction=sampleHitReaction(actor.recentHits,reactionTime);
      for(const [name,offset] of [['pelvis',reaction.pelvis],['spine_2',reaction.spine],['head_0',reaction.head]] as const) {
        const bone=this.model.getObjectByName(name);if(!bone)continue;
        this.reactionBase.push({bone,position:bone.position.clone(),rotation:bone.quaternion.clone()});
        bone.updateWorldMatrix(true,false);bone.getWorldQuaternion(this.quaternion);
        const yaw=new THREE.Quaternion().setFromAxisAngle(this.axis.set(0,1,0),actor.yaw);
        this.reactionQuaternion.setFromEuler(this.reactionEuler.set(offset.rotation.x,offset.rotation.y,offset.rotation.z));
        this.reactionQuaternion.premultiply(yaw).multiply(yaw.invert());
        this.quaternion.premultiply(this.reactionQuaternion);
        bone.parent?.getWorldQuaternion(this.inverse);this.inverse.invert();bone.quaternion.copy(this.inverse.multiply(this.quaternion));
        this.vector.set(offset.position.x,offset.position.y,offset.position.z).applyAxisAngle(this.axis.set(0,1,0),actor.yaw);
        bone.getWorldPosition(this.axis);this.axis.add(this.vector);bone.parent?.worldToLocal(this.axis);bone.position.copy(this.axis);
        bone.updateWorldMatrix(false,true);
      }
    }
    // Authored gesture clips are native; this small spine/head pitch distribution is estimated.
    this.model.updateWorldMatrix(true, false);
    if (this.weaponAim) {
      this.weaponAim.position.copy(this.weaponAim.bone.position); this.weaponAim.quaternion.copy(this.weaponAim.bone.quaternion);
      this.weaponAim.hand.updateWorldMatrix(true, false);
      this.handBeforeAim.copy(this.weaponAim.hand.matrixWorld).invert();
    }
    const yawAim = bodyYawDelta(actor.yaw, bodyYaw);
    this.model.getWorldQuaternion(this.quaternion); this.axis.set(1, 0, 0).applyQuaternion(this.quaternion);
    if (yawAim) this.axis.applyAxisAngle(this.vector.set(0, 1, 0), yawAim);
    for (const value of this.aimBones) value.quaternion.copy(value.bone.quaternion);
    // Complete yaw before pitch so rotations about different axes do not
    // interleave down the hierarchy and change the physical aim direction.
    if (yawAim) for (const value of this.aimBones) {
      value.bone.getWorldQuaternion(this.quaternion);
      this.quaternion.premultiply(this.inverse.setFromAxisAngle(this.vector.set(0, 1, 0), yawAim * value.weight));
      value.bone.parent?.getWorldQuaternion(this.inverse); this.inverse.invert();
      value.bone.quaternion.copy(this.inverse.multiply(this.quaternion)); value.bone.updateWorldMatrix(false, false);
    }
    for (const value of this.aimBones) {
      value.bone.getWorldQuaternion(this.quaternion);
      // Native actors face local +Z; positive X rotates that direction down.
      // Physical aim uses positive-up pitch, so its skeletal rotation is negative.
      this.inverse.setFromAxisAngle(this.axis, -clamp(actor.pitch, -1.15, 1.15) * value.weight * (actor.reloading ? .35 : 1));
      this.quaternion.premultiply(this.inverse);
      value.bone.parent?.getWorldQuaternion(this.inverse); this.inverse.invert();
      value.bone.quaternion.copy(this.inverse.multiply(this.quaternion)); value.bone.updateWorldMatrix(false, false);
    }
    // Only these two chains are needed for the grip correction. The renderer
    // updates the complete skeleton once, instead of walking it twice here.
    this.aimApplied = true;
    if (this.weaponAim) {
      const {bone, hand} = this.weaponAim;
      hand.updateWorldMatrix(true, false); bone.updateWorldMatrix(true, false);
      this.weaponAimMatrix.copy(hand.matrixWorld).multiply(this.handBeforeAim).multiply(bone.matrixWorld);
      if (bone.parent) this.weaponAimMatrix.premultiply(this.handBeforeAim.copy(bone.parent.matrixWorld).invert());
      this.weaponAimMatrix.decompose(bone.position, bone.quaternion, bone.scale); bone.updateWorldMatrix(false, false);
    }
    if (actor.equipment === 'elite' && !this.gesture) this.dualGrip.update();
  }

  private preparePlant(actor: DuelActorSnapshot, dt: number, family: string, airborne: boolean) {
    if (this.plantFeet.length !== 2) return;
    const lateral = (actor.velocity.x * Math.cos(actor.yaw) - actor.velocity.z * Math.sin(actor.yaw)) / UNIT;
    const forward = (-actor.velocity.x * Math.sin(actor.yaw) - actor.velocity.z * Math.cos(actor.yaw)) / UNIT;
    const yawGap = (yaw: number) => Math.abs(Math.atan2(Math.sin(actor.yaw - yaw), Math.cos(actor.yaw - yaw)));
    const supported = family === 'rifle' && !pistolIds.some(id => id === actor.equipment) && actor.equipment !== 'knife' && actor.equipment !== 'zeus' &&
      !airborne && actor.duckAmount < .05 && actor.supportingActor === undefined && dt < .1;
    if (!supported) {this.plant = undefined; this.strafe = undefined; this.previousLateral = lateral; return;}
    if (this.plant && (yawGap(this.plant.yaw) > .15 || Math.abs(actor.feet - this.plant.feet) > UNIT)) this.plant = undefined;
    if (dt <= 0) return;
    if (this.plant) {
      this.plant.elapsed += dt;
      const remaining = this.plant.duration - this.plant.elapsed;
      const move = clamp((80 - Math.hypot(lateral, forward)) / 64, 0, 1);
      this.plant.weight = Math.min(1, this.plant.elapsed / .04, remaining / .06, move);
      if (remaining <= 0 || move <= 0 || yawGap(this.plant.yaw) > .15 || Math.abs(actor.feet - this.plant.feet) > UNIT) this.plant = undefined;
    }
    if (this.strafe) {
      this.strafe.age += dt;
      if (this.strafe.age > .65 || yawGap(this.strafe.yaw) > .15) this.strafe = undefined;
    }
    // 170/80 are native previous-speed selector bands, not movement caps.
    if (Math.abs(lateral) >= 170 && Math.abs(forward) < 32) this.strafe = {sign: Math.sign(lateral), age: 0, yaw: actor.yaw};
    else if (!this.plant && this.strafe && Math.abs(lateral) <= 16 && Math.abs(forward) < 16 && Math.abs(this.previousLateral) > Math.abs(lateral)) {
      const name = `recovery_planted_${this.strafe.sign > 0 ? 'e2w' : 'w2e'}_rifle`, action = this.actions.get(name);
      if (action) this.plant = {name, elapsed: 0, duration: action.getClip().duration, yaw: actor.yaw, feet: actor.feet, weight: 0, capture: true};
      this.strafe = undefined;
    }
    this.previousLateral = lateral;
  }

  private updateDynamicDeath(actor: DuelActorSnapshot, dt: number, velocity?: Vec, age?: number) {
    if (this.rigidDeath || !this.dynamicDeath && RigidDeath.supported(this.model) &&
      (!this.deathWorld?.sweepSphere || this.deathWorld.corpseGeometry)) {
      this.updateRigidDeath(actor, dt, velocity, age); return;
    }
    this.model.updateWorldMatrix(true, false);
    if (this.dynamicDeath?.sleeping && this.model.matrixWorld.equals(this.deathPoseRoot) &&
      (!Number.isFinite(age) || age! >= this.deathTime)) return;
    if (!this.dynamicDeath) {
      this.dying = true; this.gesture = undefined;
      const pose: {bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion}[] = [];
      this.model.traverse(bone => {if (bone instanceof THREE.Bone) pose.push({bone, position: bone.position.clone(), quaternion: bone.quaternion.clone()});});
      this.mixer.stopAllAction(); this.activeActions.clear();
      for (const value of pose) {value.bone.position.copy(value.position); value.bone.quaternion.copy(value.quaternion);}
      this.model.updateWorldMatrix(true, true);
      const names: [string, number][] = [['pelvis', .12], ['spine_0', .06], ['spine_1', .08], ['spine_2', .14],
        ['spine_3', .1], ['neck_0', .06], ['head_0', .12],
        ['clavicle_L', .05], ['arm_upper_L', .07], ['arm_lower_L', .06], ['hand_L', .045],
        ['clavicle_R', .05], ['arm_upper_R', .07], ['arm_lower_R', .06], ['hand_R', .045],
        ['leg_upper_L', .07], ['leg_lower_L', .07], ['ankle_L', .06], ['ball_L', .04],
        ['leg_upper_R', .07], ['leg_lower_R', .07], ['ankle_R', .06], ['ball_R', .04]];
      const bodies = names.flatMap(([name, radius]) => {
        const bone = this.model.getObjectByName(name); if (!bone) return [];
        const position = bone.getWorldPosition(new THREE.Vector3()); return [{name, radius, position, mass: name === 'pelvis' ? 4 : 1}];
      });
      const links = skeletalDeathLinks.filter(link => bodies.some(b => b.name === link.a) && bodies.some(b => b.name === link.b));
      const drive = this.nativeDeathDrive(actor, bodies);
      const impulse = this.vector.copy(actor.deathDirection ?? {x: 0, y: 0, z: 1});
      if (![impulse.x, impulse.y, impulse.z].every(Number.isFinite) || impulse.lengthSq() < 1e-8) impulse.set(0, 0, 1);
      impulse.normalize();
      const headshot=actor.deathGroup==='head';
      const kick = {x: impulse.x * (headshot?2.5:2), y:headshot ? .2 : -.3, z: impulse.z * (headshot?2.5:2)};
      const support = {x: impulse.x * .7, y: -1.2, z: impulse.z * .7};
      const initialVelocity = {...velocity ?? {x: actor.velocity.x, y: 0, z: actor.velocity.z}};
      this.restartDeath = () => {
        const physics = new DeathPhysics(bodies, links, initialVelocity, drive);
        physics.impulse(headshot ? 'head_0' : 'spine_2', kick);
        if (!drive) physics.impulse('pelvis', support);
        return physics;
      };
      this.dynamicDeath = this.restartDeath(); this.deathTime = 0;
      if (this.weaponAim) {
        const {bone, hand} = this.weaponAim;
        hand.updateWorldMatrix(true, false); bone.updateWorldMatrix(true, false);
        this.deathWeaponOffset = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(bone.matrixWorld);
      }
      for (const body of bodies) {
        const bone = this.model.getObjectByName(body.name)!;
        // Follow the actual chain, not a jiggle/twist helper. Include intermediate
        // spine/hip bones so a horizontal torso does not stretch an upright spine.
        const child = body.name === 'pelvis' ? this.model.getObjectByName('spine_0') ?? this.model.getObjectByName('spine_2')
          : bone.children.find(node => node instanceof THREE.Bone && bodies.some(body => body.name === node.name));
        const direction = child ? child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize() : new THREE.Vector3(0, 1, 0);
        this.deathBindings.push({bone, child, direction, quaternion: bone.getWorldQuaternion(new THREE.Quaternion())});
      }
    }
    const target = Number.isFinite(age) ? clamp(age!, 0, 8.1) : this.deathTime + Math.min(dt, 1 / 15);
    const rewind = target < this.deathTime - 1e-8;
    if (rewind) {this.dynamicDeath = this.restartDeath!(); this.deathTime = 0;}
    while (this.deathTime < target - 1e-8 && !this.dynamicDeath.sleeping) {
      const step = Math.min(1 / 15, target - this.deathTime);
      for (const contact of this.dynamicDeath.step(step, this.deathWorld)) if (!rewind) this.onDeathContact?.(contact);
      this.deathTime += step;
    }
    this.deathTime = target;
    for (const binding of this.deathBindings) {
      const point = this.dynamicDeath.point(binding.bone.name)!;
      this.vector.set(point.x, point.y, point.z);
      binding.bone.parent?.worldToLocal(this.vector); binding.bone.position.copy(this.vector);
      const child = binding.child && this.dynamicDeath.point(binding.child.name);
      if (child) {
        this.vector.set(child.x - point.x, child.y - point.y, child.z - point.z).normalize();
        this.quaternion.setFromUnitVectors(binding.direction, this.vector).multiply(binding.quaternion);
        binding.bone.parent?.getWorldQuaternion(this.inverse); this.inverse.invert();
        binding.bone.quaternion.copy(this.inverse.multiply(this.quaternion));
      }
      binding.bone.updateWorldMatrix(false, true);
    }
    if (this.weaponAim && this.deathWeaponOffset) {
      const {bone, hand} = this.weaponAim;
      hand.updateWorldMatrix(true, false);
      this.weaponAimMatrix.copy(hand.matrixWorld).multiply(this.deathWeaponOffset);
      if (bone.parent) this.weaponAimMatrix.premultiply(this.handBeforeAim.copy(bone.parent.matrixWorld).invert());
      this.weaponAimMatrix.decompose(bone.position, bone.quaternion, bone.scale); bone.updateWorldMatrix(false, true);
    }
    this.deathPoseRoot.copy(this.model.matrixWorld);
  }

  corpseCenter(target: THREE.Vector3) {
    return this.rigidDeath?.center(target);
  }

  private updateRigidDeath(actor: DuelActorSnapshot, dt: number, velocity?: Vec, age?: number) {
    this.model.updateWorldMatrix(true, false);
    if (this.rigidDeath?.sleeping && this.model.matrixWorld.equals(this.deathPoseRoot) &&
      (!Number.isFinite(age) || age! >= this.deathTime)) return;
    if (!this.rigidDeath) {
      this.dying = true; this.gesture = undefined;
      const saved: {bone: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion}[] = [];
      this.model.traverse(bone => {if (bone instanceof THREE.Bone) saved.push({bone, position: bone.position.clone(), rotation: bone.quaternion.clone()});});
      this.mixer.stopAllAction(); this.activeActions.clear();
      for (const pose of saved) {pose.bone.position.copy(pose.position); pose.bone.quaternion.copy(pose.rotation);}
      this.model.updateWorldMatrix(true, true);
      this.rigidDeath = new RigidDeath(this.model, this.deathWorld!, velocity ?? {x: actor.velocity.x, y: actor.verticalVelocity ?? 0, z: actor.velocity.z},
        {direction: actor.deathDirection ?? {x: 0, y: 0, z: 1}, headshot: actor.deathGroup === 'head'});
      this.deathTime = 0;
      if (this.weaponAim) {
        const {bone, hand} = this.weaponAim;
        hand.updateWorldMatrix(true, false); bone.updateWorldMatrix(true, false);
        this.deathWeaponOffset = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(bone.matrixWorld);
      }
    }
    const target = Number.isFinite(age) ? clamp(age!, 0, 8.1) : this.deathTime + Math.min(dt, 1 / 15);
    this.rigidDeath.update(target, this.onDeathContact); this.deathTime = target;
    if (this.weaponAim && this.deathWeaponOffset) {
      const {bone, hand} = this.weaponAim;
      hand.updateWorldMatrix(true, false);
      this.weaponAimMatrix.copy(hand.matrixWorld).multiply(this.deathWeaponOffset);
      if (bone.parent) this.weaponAimMatrix.premultiply(this.handBeforeAim.copy(bone.parent.matrixWorld).invert());
      this.weaponAimMatrix.decompose(bone.position, bone.quaternion, bone.scale); bone.updateWorldMatrix(false, true);
    }
    this.deathPoseRoot.copy(this.model.matrixWorld);
  }

  private nativeDeathDrive(actor: DuelActorSnapshot, bodies: readonly DeathBody[]): DeathPoseDrive | undefined {
    this.model.getWorldQuaternion(this.quaternion);
    const yaw = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ').y + Math.PI;
    const variant = deathVariant({...actor, yaw});
    const standing = this.actions.get(`death_fall_${variant}`), crouched = this.actions.get(`death_crouch_fall_${variant}`);
    if (!standing || !crouched || !bodies.length) return;
    const saved: {bone: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3}[] = [];
    this.model.traverse(bone => {if (bone instanceof THREE.Bone) saved.push({bone, position: bone.position.clone(),
      rotation: bone.quaternion.clone(), scale: bone.scale.clone()});});
    const duck = stanceCurve(actor.duckAmount), frames: DeathPoseDrive['frames'][number][] = [];
    const headshot = actor.deathGroup === 'head';
    const family = pistolIds.some(id => id === actor.equipment) ? 'pistol' : 'rifle';
    try {
      // Cache only the validated, locally baked native-rig falls. The raw chest
      // clips contain discontinuities; death_poses_head is a pose bank, not motion.
      for (let frame = 0; frame <= 24; frame++) {
        const time = frame / 30;
        for (const action of this.actions.values()) action.enabled = false;
        for (const [action, weight] of [[standing, 1 - duck], [crouched, duck]] as const) {
          action.enabled = weight > 0; action.time = Math.min(time, action.getClip().duration);
          action.setEffectiveWeight(weight);
        }
        if (headshot && time < .22) {
          const flinch = nativeFlinchSample([{time: -.035, region: 'head', helmet: actor.helmet,
            actorYaw: actor.yaw, incoming: actor.deathDirection ?? {x: 0, z: 1}}], time, family,
            name => this.actions.get(name)?.getClip().duration);
          if (flinch) {
            const action = this.actions.get(flinch.name)!;
            action.enabled = true; action.time = flinch.elapsed;
            action.setEffectiveWeight(flinch.weight * (1 - time / .22));
          }
        }
        this.evaluatePose(); this.model.updateWorldMatrix(true, true);
        frames.push({time, positions: bodies.map(body => this.model.getObjectByName(body.name)!.getWorldPosition(new THREE.Vector3()))});
      }
    } finally {
      this.mixer.stopAllAction(); this.activeActions.clear();
      for (const value of saved) {
        value.bone.position.copy(value.position); value.bone.quaternion.copy(value.rotation); value.bone.scale.copy(value.scale);
      }
      this.model.updateWorldMatrix(true, true);
    }
    // Rotate displacement, not the actor or captured pose. This gives opposite
    // side hits opposite falls without turning the model root or its hitboxes.
    const center = Math.max(0, bodies.findIndex(body => body.name === 'spine_2'));
    const first = frames[0].positions, reference = frames[15].positions[center];
    const dx = reference.x - first[center].x, dz = reference.z - first[center].z;
    const incoming = actor.deathDirection;
    const angle = incoming && Number.isFinite(incoming.x) && Number.isFinite(incoming.z) &&
      Math.hypot(incoming.x, incoming.z) > 1e-6 && Math.hypot(dx, dz) > .01
      ? Math.atan2(incoming.x, incoming.z) - Math.atan2(dx, dz) : 0;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return {frames: frames.map(frame => ({time: frame.time, positions: frame.positions.map((point, i) => {
      const x = point.x - first[i].x, z = point.z - first[i].z;
      return {x: bodies[i].position.x + x * cos + z * sin,
        y: bodies[i].position.y + point.y - first[i].y, z: bodies[i].position.z - x * sin + z * cos};
    })}))};
  }

  private updateDeath(actor: DuelActorSnapshot, dt: number, age?: number) {
    const first = !this.dying;
    this.model.updateWorldMatrix(true, true);
    const pelvis = this.model.getObjectByName('pelvis');
    const head = this.model.getObjectByName('head_0');
    const initialHip = pelvis?.matrixWorld.elements[13] ?? Infinity;
    const initialHead = head?.matrixWorld.elements[13] ?? Infinity;
    if (first) {
      this.dying = true;
      const tracks: THREE.KeyframeTrack[] = [];
      this.model.traverse(bone => {
        if (!(bone instanceof THREE.Bone)) return;
        tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0], bone.position.toArray()),
          new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0], bone.quaternion.toArray()));
      });
      // Blend inside the mixer. Editing bones after sampling leaves constant
      // native tracks stale because PropertyMixer skips unchanged outputs.
      this.deathBlend = this.mixer.clipAction(new THREE.AnimationClip('death-hit-pose', 0, tracks));
      this.deathBlend.paused = true; this.deathBlend.enabled = false;
    }
    this.deathTime = age ?? this.deathTime + dt;
    if (first) {
      const variant = deathVariant(actor);
      const standing = this.actions.get(`death_fall_${variant}`), crouched = this.actions.get(`death_crouch_fall_${variant}`);
      this.bakedDeath = !!standing && !!crouched;
      if (standing && crouched) {
        const duck = stanceCurve(actor.duckAmount);
        this.deathActions = [{action: standing, weight: 1 - duck}, {action: crouched, weight: duck}].filter(value => value.weight > 0);
      } else {
        const names = actor.duckAmount > .2 ? ['death_chest_b', 'death_gut_a'] : ['death_chest_a', 'death_chest_b', 'death_gut_a'];
        const action = this.actions.get(names[actor.id % names.length]);
        if (action) this.deathActions = [{action, weight: 1}];
      }
    }
    const action = this.deathActions[0]?.action;
    if (!action) {
      // Even baseline-only rigs fall via their bones, never the actor root.
      this.updateDynamicDeath(actor, dt);
      return;
    }
    for (const candidate of this.actions.values()) candidate.enabled = this.deathActions.some(value => value.action === candidate);
    action.setEffectiveWeight(1);
    // Standing death clips must not lift a crouched victim back to standing.
    // Enter at compatible hip and head heights, blending from the hit pose.
    // Leave some headroom for the curved joint-rotation blend; matching only
    // the endpoints can briefly straighten the upper body between them.
    if (first && !this.bakedDeath && actor.duckAmount > .2 && pelvis) {
      for (this.deathStart = 0; this.deathStart < Math.min(1.2, action.getClip().duration - 1 / 30); this.deathStart += 1 / 30) {
        action.time = this.deathStart; this.evaluatePose(); this.model.updateWorldMatrix(true, true);
        const lowest = Math.min(...this.bodyContacts.map(({bone, radius}) => bone.matrixWorld.elements[13] - radius));
        const lift = Math.max(0, this.model.matrixWorld.elements[13] - lowest);
        if (pelvis.matrixWorld.elements[13] + lift <= initialHip + .03 &&
          (!head || head.matrixWorld.elements[13] + lift <= initialHead - actor.duckAmount * 6 * UNIT)) break;
      }
    }
    const blend = clamp(this.deathTime / DEATH_POSE_BLEND_SECONDS, 0, 1);
    // Physics is baked offline. Sample real seconds, never compress a whole
    // extracted clip into a fixed collapse budget or retime individual joints.
    for (const {action: fall, weight} of this.deathActions) {
      fall.time = Math.min(this.deathStart + this.deathTime, Math.max(0, fall.getClip().duration - .0001));
      fall.setEffectiveWeight(weight * blend);
    }
    if (this.deathBlend) {
      this.deathBlend.enabled = blend < 1;
      this.deathBlend.setEffectiveWeight(1 - blend);
    }
    this.evaluatePose();
    // CS2 hands these poses to its physics system. A small contact correction
    // keeps this lightweight, non-ragdoll presentation out of the floor.
    this.model.updateWorldMatrix(true, true);
    const floor = this.model.matrixWorld.elements[13];
    const lowest = Math.min(...this.bodyContacts.map(({bone, radius}) => bone.matrixWorld.elements[13] - radius));
    if (pelvis && Number.isFinite(lowest) && floor > lowest) {
      pelvis.getWorldPosition(this.vector); this.vector.y += floor - lowest;
      pelvis.parent?.worldToLocal(this.vector); pelvis.position.copy(this.vector);
    }
  }

  private evaluatePose() {
    syncAnimationActions(this.actions.values(), this.activeActions, this.deathBlend);
    this.mixer.update(0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.gesture = undefined;
    this.footContact.restore(); this.transitions.clear();
    this.plant = undefined; this.strafe = undefined;
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    this.rigidDeath?.dispose(); this.rigidDeath = undefined;
    this.actions.clear(); this.activeActions.clear(); this.absoluteGestures.clear(); this.deathBindings = []; this.dynamicDeath = undefined; this.restartDeath = undefined;
  }
}
