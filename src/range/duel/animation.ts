import * as THREE from 'three';
import {clamp, stanceCurve, UNIT} from '../actor-physics';
import type {DuelActorSnapshot} from './types';
import {pistolIds} from '../config';
import type {Equipment} from '../equipment';
import {DualPistolGrip} from './weapon-grip';
import {BOT_COLLAPSE_SECONDS, DEATH_POSE_BLEND_SECONDS, deathVariant} from './round-flow';

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

  constructor(private readonly model: THREE.Object3D, clips: THREE.AnimationClip[], phase = 0, equipment?: Equipment) {
    this.gaitPhase = phase;
    this.dualGrip = new DualPistolGrip(model);
    this.mixer = new THREE.AnimationMixer(model);
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
      action.play(); action.paused = true; action.enabled = false;
      this.actions.set(key, action);
    }
  }

  update(actor: DuelActorSnapshot, dt: number, deathAge?: number) {
    if (!actor.alive) {this.updateDeath(actor, dt, deathAge); return;}
    const family = pistolIds.some(id => id === actor.equipment) && this.actions.has('idle_pistol') ? 'pistol' : 'rifle';
    const {weights, speed, authoredSpeed} = locomotionWeights(actor, family);
    const suffix = actor.equipment === 'hkp2000' ? 'hkp' : actor.equipment;
    if (family === 'pistol') for (const idle of ['idle', 'idle_crouch']) {
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
    for (const [name, action] of this.actions) {
      const weight = resolved.get(name) ?? 0;
      action.enabled = weight > .001;
      if (!action.enabled) continue;
      action.setEffectiveWeight(weight);
      const length = action.getClip().duration;
      // Native idle clips can be a single pose at t=0, with no duration.
      action.time = length <= 0 ? 0 : name.startsWith('jump') ? Math.min(this.airTime, Math.max(0, length - .0001))
        : name.startsWith('idle') ? (this.idleTime * .167) % length
        : name.startsWith('inair') ? this.idleTime % length : this.gaitPhase * length;
    }
    this.mixer.update(0);
    if (actor.equipment === 'elite') this.dualGrip.update();
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
      this.deathBlend.play(); this.deathBlend.paused = true; this.deathBlend.enabled = false;
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
        action.time = this.deathStart; this.mixer.update(0); this.model.updateWorldMatrix(true, true);
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
    this.mixer.update(0);
    // CS2 hands these poses to its physics system. A small contact correction
    // keeps this lightweight, non-ragdoll presentation out of the floor.
    this.model.updateWorldMatrix(true, true);
    const floor = this.model.matrixWorld.elements[13];
    const lowest = Math.min(...this.bodyContacts.map(({bone, radius}) => bone.matrixWorld.elements[13] - radius));
    this.model.position.y = Math.max(0, floor - lowest);
  }

  dispose() {this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);}
}
