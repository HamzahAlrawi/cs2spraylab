import * as THREE from 'three';
import {clamp, stanceCurve, UNIT, type Vec} from '../actor-physics';
import type {DuelActorSnapshot} from './types';
import {pistolIds} from '../config';
import type {Equipment} from '../equipment';
import {DualPistolGrip} from './weapon-grip';
import {BOT_COLLAPSE_SECONDS, DEATH_POSE_BLEND_SECONDS, deathVariant} from './round-flow';
import {DeathPhysics, skeletalDeathLinks, type DeathWorld, type DeathContact} from './death-physics';
import {nativeReloadWindow} from '../native-view-actions';
import type {ReloadPhase} from '../weapon-actions';
import {syncAnimationActions} from '../animation-actions';

export type DuelPresentationFrame = {reloadRemaining?: number; reloadDuration?: number; deathWorld?: DeathWorld;
  reloadPhase?: ReloadPhase; reloadProgress?: number; deathVelocity?: Vec};
export type WeaponGestureOptions = {duration?: number; crouched?: boolean; side?: 'left' | 'right'; lastShot?: boolean};
const upperBone = (name: string) => /^(?:(?:spine_|neck_|head_|clavicle_|arm_|hand_|finger_|thumb_)|wpn(?:Pivot)?$)/.test(name);
export function nativeGestureClips(asset: {animations: THREE.AnimationClip[]; parser: {json: {animations?: {extras?: {additive?: boolean; additive_composed?: boolean}}[]}}}) {
  asset.animations.forEach((clip, index) => {
    const extras = asset.parser.json.animations?.[index]?.extras;
    if (extras?.additive && !extras.additive_composed) clip.blendMode = THREE.AdditiveAnimationBlendMode;
  });
  return asset.animations;
}
export function nativeGestureName(equipment: string, action: string, options: WeaponGestureOptions = {}) {
  if (!['draw', 'reload', 'reload-empty', 'fire', 'fire-alt'].includes(action)) return null;
  const side = equipment === 'elite' && action === 'fire' && options.side ? `-${options.side}${options.lastShot ? '-last' : ''}` : '';
  return `gesture_${action}${side}${options.crouched && action !== 'fire' ? '_crouch' : ''}_${equipment}`;
}

export function locomotionWeights(actor: DuelActorSnapshot, family = 'rifle') {
  const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  const x = actor.velocity.x * Math.cos(actor.yaw) - actor.velocity.z * Math.sin(actor.yaw);
  const z = -actor.velocity.x * Math.sin(actor.yaw) - actor.velocity.z * Math.cos(actor.yaw);
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

// Native eight-direction clips share a gait phase. Direction and stance change their
// weights, not the playback origin; stride timing follows simulated velocity.
export class DuelAnimator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private activeActions = new Set<THREE.AnimationAction>();
  private gaitPhase: number;
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
  private gesture?: {name: string; duration: number; elapsed: number};
  private absoluteGestures = new Set<string>();
  private aimBones: {bone: THREE.Object3D; quaternion: THREE.Quaternion; weight: number}[] = [];
  private aimApplied = false;
  private disposed = false;
  private deathWorld?: DeathWorld;
  private dynamicDeath?: DeathPhysics;
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
  onDeathContact?: (contact: DeathContact) => void;

  constructor(private readonly model: THREE.Object3D, clips: THREE.AnimationClip[], phase = 0, equipment?: Equipment) {
    this.gaitPhase = phase;
    this.dualGrip = new DualPistolGrip(model);
    this.mixer = new THREE.AnimationMixer(model);
    const anchor = model.getObjectByName('wpnPivot'), hand = model.getObjectByName('hand_R');
    if (anchor && hand) this.weaponAim = {bone: anchor, hand, position: anchor.position.clone(), quaternion: anchor.quaternion.clone()};
    for (const [name, weight] of [['spine_0', .2], ['spine_1', .3], ['spine_2', .35], ['head_0', .15]] as const) {
      const bone = model.getObjectByName(name);
      if (bone) this.aimBones.push({bone, quaternion: bone.quaternion.clone(), weight});
    }
    for (const [name, radius] of [['head_0', .12], ['pelvis', .11], ['spine_2', .12],
      ['ankle_L', .055], ['ankle_R', .055], ['hand_L', .035], ['hand_R', .035]] as const) {
      const bone = model.getObjectByName(name);
      if (bone) this.bodyContacts.push({bone, radius});
    }
    const nodes = new Set<string>(); model.traverse(node => nodes.add(node.name));
    const family = equipment && pistolIds.some(id => id === equipment) ? 'pistol' : 'rifle';
    const weaponIdle = equipment === 'hkp2000' ? 'hkp' : equipment;
    for (const clip of clips) {
      if (!clip.name.includes('/world/')) continue;
      const key = clip.name.split('/').pop()!.replace(/\.\d+$/, '');
      if (key.startsWith('gesture_')) continue;
      if (equipment && (key.endsWith(family === 'pistol' ? '_rifle' : '_pistol') ||
        /^idle_(?:crouch_)?(usp|glock|hkp|p250|deagle|elite|fiveseven|tec9|cz75a|revolver)$/.test(key) &&
        key !== `idle_${weaponIdle}` && key !== `idle_crouch_${weaponIdle}`)) continue;
      const bound = clip.clone();
      bound.tracks = bound.tracks.filter(track => {
        const target = track.name.slice(0, track.name.lastIndexOf('.'));
        return target === '' || nodes.has(target);
      });
      // Weapon-specific native idles are RelativeToFrame layers, not complete
      // locomotion poses. Replacing the base pose with one leaves T-pose hands.
      if (/^idle_(?:crouch_)?(usp|glock|hkp|p250|deagle|elite|fiveseven|tec9|cz75a|revolver)$/.test(key))
        THREE.AnimationUtils.makeClipAdditive(bound, 0, bound);
      const action = this.mixer.clipAction(bound);
      action.paused = true; action.enabled = false;
      this.actions.set(key, action);
    }
    this.addGestureClips(clips);
  }

  /** A separate animation-only asset may be loaded after the base actor; no mesh replacement. */
  addGestureClips(clips: THREE.AnimationClip[]) {
    if (this.disposed) return;
    for (const clip of clips) {
      const name = clip.name.split('/').pop()!;
      if (!name.startsWith('gesture_') || this.actions.has(name)) continue;
      const bound = clip.clone();
      bound.tracks = bound.tracks.filter(track => upperBone(track.name.slice(0, track.name.lastIndexOf('.')))
        && !track.name.endsWith('.scale')
        && !(track.name.endsWith('.position')&&/^(spine_|neck_|head_)/.test(track.name))
        && !!this.model.getObjectByName(track.name.slice(0, track.name.lastIndexOf('.'))));
      if (!bound.tracks.length) continue;
      if (clip.blendMode !== THREE.AdditiveAnimationBlendMode) {
        const family = name.endsWith('_elite') || /_(usp|glock|hkp2000|p250|deagle|fiveseven|tec9|cz75a|revolver)$/.test(name) ? 'pistol' : 'rifle';
        const base = this.actions.get(`idle_${name.includes('_crouch_') ? 'crouch_' : ''}${family}`)?.getClip();
        if (!base) continue;
        THREE.AnimationUtils.makeClipAdditive(bound, 0, base);
        this.absoluteGestures.add(name);
      }
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
    this.gesture = {name: name!, duration, elapsed: 0}; return true;
  }
  setDeathWorld(world?: DeathWorld) {this.deathWorld = world;}

  update(actor: DuelActorSnapshot, dt: number, deathAge?: number, frame: DuelPresentationFrame = {}) {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (frame.deathWorld) this.deathWorld = frame.deathWorld;
    if (!actor.alive && this.deathWorld) {this.updateDynamicDeath(actor, dt, frame.deathVelocity); return;}
    if (!actor.alive) {this.updateDeath(actor, dt, deathAge); return;}
    if (this.aimApplied) {
      for (const value of this.aimBones) value.bone.quaternion.copy(value.quaternion);
      if (this.weaponAim) {this.weaponAim.bone.position.copy(this.weaponAim.position); this.weaponAim.bone.quaternion.copy(this.weaponAim.quaternion);}
    }
    this.aimApplied = false;
    const family = pistolIds.some(id => id === actor.equipment) && this.actions.has('idle_pistol') ? 'pistol' : 'rifle';
    const {weights, speed, authoredSpeed} = locomotionWeights(actor, family);
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
    if (motionWeight > 0) this.gaitPhase = (this.gaitPhase + dt * speed / authoredSpeed / (duration / motionWeight)) % 1;
    this.idleTime += dt;
    const airborne = !(actor.grounded ?? actor.feet < .001);
    if (airborne && !this.wasAirborne) {
      this.airTime = 0;
      const lateral = actor.velocity.x * Math.cos(actor.yaw) - actor.velocity.z * Math.sin(actor.yaw);
      const forward = -actor.velocity.x * Math.sin(actor.yaw) - actor.velocity.z * Math.cos(actor.yaw);
      this.jumpClip = speed > .8 ? `jump_${Math.abs(lateral) > Math.abs(forward) ? lateral > 0 ? 'e' : 'w'
        : forward > 0 ? 'n' : 's'}_${family}` : `jump_stand_${family}`;
    }
    this.airTime += airborne ? dt : 0;
    this.wasAirborne = airborne;
    if (airborne && this.actions.has(this.jumpClip)) {
      weights.clear();
      const takeoff = this.actions.get(this.jumpClip)!.getClip().duration;
      const blend = this.actions.has(`inair_stand_${family}`) ? clamp((this.airTime - takeoff * .6) / .12, 0, 1) : 0;
      const duck = this.actions.has(`inair_crouch_stand_${family}`) && this.actions.has(`jump_crouch_stand_${family}`)
        ? stanceCurve(actor.duckAmount) : 0;
      weights.set(this.jumpClip, (1 - blend) * (1 - duck)); weights.set(`inair_stand_${family}`, blend * (1 - duck));
      weights.set(`jump_crouch_stand_${family}`, (1 - blend) * duck); weights.set(`inair_crouch_stand_${family}`, blend * duck);
    }
    // The baseline three-clip asset remains usable while the native library loads.
    const resolved = new Map<string, number>();
    for (const [name, weight] of weights) {
      if (weight < .001) continue;
      const fallback = name.startsWith('idle') || speed < .2 ? 'idle_rifle'
        : name.includes('_w_') ? 'run_w_rifle' : 'run_e_rifle';
      const key = this.actions.has(name) ? name : fallback;
      resolved.set(key, (resolved.get(key) ?? 0) + weight);
    }
    const weaponIdle = `gesture_idle_${actor.equipment}`;
    if (!airborne && this.actions.has(weaponIdle)) resolved.set(weaponIdle, 1);
    for (const [name, action] of this.actions) {
      const weight = resolved.get(name) ?? 0;
      action.enabled = weight > .001;
      if (!action.enabled) continue;
      action.setEffectiveWeight(weight);
      const length = action.getClip().duration;
      // Native idle clips can be a single pose at t=0, with no duration.
      action.time = length <= 0 ? 0 : name.startsWith('jump') ? Math.min(this.airTime, Math.max(0, length - .0001))
        : name.startsWith('idle') || name.startsWith('gesture_idle_') ? (this.idleTime * .167) % length
        : name.startsWith('inair') ? this.idleTime % length : this.gaitPhase * length;
    }
    if (actor.reloading && !this.gesture?.name.includes('reload')) this.playAction(actor.equipment, 'reload',
      {duration: frame.reloadDuration, crouched: actor.duckAmount > .5});
    if (!actor.reloading && this.gesture?.name.includes('reload')) this.gesture = undefined;
    if (this.gesture) {
      const gesture = this.gesture, action = this.actions.get(gesture.name)!;
      gesture.elapsed = frame.reloadRemaining !== undefined && gesture.name.includes('reload')
        ? Math.max(0, gesture.duration - frame.reloadRemaining) : gesture.elapsed + dt;
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
    this.evaluatePose();
    // Authored gesture clips are native; this small spine/head pitch distribution is estimated.
    this.model.updateWorldMatrix(true, false);
    if (this.weaponAim) {
      this.weaponAim.position.copy(this.weaponAim.bone.position); this.weaponAim.quaternion.copy(this.weaponAim.bone.quaternion);
      this.weaponAim.hand.updateWorldMatrix(true, false);
      this.handBeforeAim.copy(this.weaponAim.hand.matrixWorld).invert();
    }
    this.model.getWorldQuaternion(this.quaternion); this.axis.set(1, 0, 0).applyQuaternion(this.quaternion);
    for (const value of this.aimBones) {
      value.quaternion.copy(value.bone.quaternion);
      value.bone.getWorldQuaternion(this.quaternion);
      this.inverse.setFromAxisAngle(this.axis, clamp(actor.pitch, -1.15, 1.15) * value.weight * (actor.reloading ? .35 : 1));
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

  private updateDynamicDeath(actor: DuelActorSnapshot, dt: number, velocity?: Vec) {
    this.model.updateWorldMatrix(true, false);
    if (this.dynamicDeath?.sleeping && this.model.matrixWorld.equals(this.deathPoseRoot)) return;
    if (!this.dynamicDeath) {
      this.dying = true; this.gesture = undefined;
      const pose: {bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion}[] = [];
      this.model.traverse(bone => {if (bone instanceof THREE.Bone) pose.push({bone, position: bone.position.clone(), quaternion: bone.quaternion.clone()});});
      this.mixer.stopAllAction();
      for (const value of pose) {value.bone.position.copy(value.position); value.bone.quaternion.copy(value.quaternion);}
      this.model.updateWorldMatrix(true, true);
      const names: [string, number][] = [['pelvis', .12], ['spine_2', .14], ['head_0', .12],
        ['arm_upper_L', .07], ['arm_lower_L', .06], ['hand_L', .045], ['arm_upper_R', .07], ['arm_lower_R', .06], ['hand_R', .045],
        ['leg_lower_L', .07], ['ankle_L', .06], ['leg_lower_R', .07], ['ankle_R', .06]];
      const bodies = names.flatMap(([name, radius]) => {
        const bone = this.model.getObjectByName(name); if (!bone) return [];
        const position = bone.getWorldPosition(new THREE.Vector3()); return [{name, radius, position, mass: name === 'pelvis' ? 4 : 1}];
      });
      const links = skeletalDeathLinks.filter(link => bodies.some(b => b.name === link.a) && bodies.some(b => b.name === link.b));
      this.dynamicDeath = new DeathPhysics(bodies, links, velocity ?? {x: actor.velocity.x, y: 0, z: actor.velocity.z});
      const impulse = actor.deathDirection ?? {x: 0, y: 0, z: 1};
      this.dynamicDeath.impulse('spine_2', {x: impulse.x * 2, y: -.3, z: impulse.z * 2});
      for (const body of bodies) {
        const bone = this.model.getObjectByName(body.name)!;
        // Only direct skeletal children define orientation; renderer translations follow solved points.
        const child = bone.children.find(node => node instanceof THREE.Bone);
        const direction = child ? child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize() : new THREE.Vector3(0, 1, 0);
        this.deathBindings.push({bone, child, direction, quaternion: bone.getWorldQuaternion(new THREE.Quaternion())});
      }
    }
    for (const contact of this.dynamicDeath.step(dt, this.deathWorld)) this.onDeathContact?.(contact);
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
    this.deathPoseRoot.copy(this.model.matrixWorld);
  }

  private updateDeath(actor: DuelActorSnapshot, dt: number, age?: number) {
    const first = !this.dying;
    this.model.position.y = 0;
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
      // The small baseline asset can finish loading before the full motion set.
      const t = clamp(this.deathTime / BOT_COLLAPSE_SECONDS, 0, 1);
      this.model.rotation.x = -1.45 * t * t * (3 - 2 * t);
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
    this.model.position.y = Math.max(0, floor - lowest);
  }

  private evaluatePose() {
    syncAnimationActions(this.actions.values(), this.activeActions, this.deathBlend);
    this.mixer.update(0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.gesture = undefined;
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    this.actions.clear(); this.activeActions.clear(); this.absoluteGestures.clear(); this.deathBindings = []; this.dynamicDeath = undefined;
  }
}
