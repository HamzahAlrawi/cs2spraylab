import * as THREE from 'three';
import {clamp, UNIT} from '../actor-physics';
import type {DuelActorSnapshot} from './types';

export function locomotionWeights(actor: DuelActorSnapshot) {
  const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  const x = actor.velocity.x * Math.cos(actor.yaw) - actor.velocity.z * Math.sin(actor.yaw);
  const z = -actor.velocity.x * Math.sin(actor.yaw) - actor.velocity.z * Math.cos(actor.yaw);
  const compass = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const sector = ((Math.atan2(x, z) / (Math.PI / 4)) + 8) % 8;
  const low = Math.floor(sector), blend = sector - low;
  const directions = speed > .001 ? {[compass[low]]: 1 - blend, [compass[(low + 1) % 8]]: blend} : {n: 1};
  const duck = actor.duckAmount * actor.duckAmount * (3 - 2 * actor.duckAmount);
  const moving = clamp(speed / (32 * UNIT), 0, 1);
  const running = clamp((speed / UNIT - 136) / (225 - 136), 0, 1);
  const weights = new Map<string, number>();
  weights.set('idle_rifle', (1 - moving) * (1 - duck));
  weights.set('idle_crouch_rifle', (1 - moving) * duck);
  for (const [direction, amount] of Object.entries(directions)) {
    weights.set(`walk_${direction}_rifle`, amount * moving * (1 - duck) * (1 - running));
    weights.set(`run_${direction}_rifle`, amount * moving * (1 - duck) * running);
    weights.set(`crouch_${direction}_rifle`, amount * moving * duck);
  }
  return {weights, speed, authoredSpeed: ((136 + (225 - 136) * running) * (1 - duck) + 76.5 * duck) * UNIT};
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
  private deathPose: {bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion}[] = [];
  private readonly bodyContacts: {bone: THREE.Object3D; radius: number}[] = [];

  constructor(private readonly model: THREE.Object3D, clips: THREE.AnimationClip[], phase = 0) {
    this.gaitPhase = phase;
    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, radius] of [['head_0', .12], ['pelvis', .11], ['spine_2', .12],
      ['ankle_L', .055], ['ankle_R', .055], ['hand_L', .035], ['hand_R', .035]] as const) {
      const bone = model.getObjectByName(name);
      if (bone) this.bodyContacts.push({bone, radius});
    }
    for (const clip of clips) {
      if (!clip.name.includes('/world/')) continue;
      const key = clip.name.split('/').pop()!.replace(/\.\d+$/, '');
      const action = this.mixer.clipAction(clip);
      action.play(); action.paused = true; action.enabled = false;
      this.actions.set(key, action);
    }
  }

  update(actor: DuelActorSnapshot, dt: number, deathAge?: number) {
    if (!actor.alive) {this.updateDeath(actor, dt, deathAge); return;}
    const {weights, speed, authoredSpeed} = locomotionWeights(actor);
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
        : forward > 0 ? 'n' : 's'}_rifle` : 'jump_stand_rifle';
    }
    this.airTime += airborne ? dt : 0;
    this.wasAirborne = airborne;
    if (airborne && this.actions.has(this.jumpClip)) {
      weights.clear();
      const takeoff = this.actions.get(this.jumpClip)!.getClip().duration;
      const blend = this.actions.has('inair_stand_rifle') ? clamp((this.airTime - takeoff * .6) / .12, 0, 1) : 0;
      const duck = this.actions.has('inair_crouch_stand_rifle') && this.actions.has('jump_crouch_stand_rifle')
        ? actor.duckAmount * actor.duckAmount * (3 - 2 * actor.duckAmount) : 0;
      weights.set(this.jumpClip, (1 - blend) * (1 - duck)); weights.set('inair_stand_rifle', blend * (1 - duck));
      weights.set('jump_crouch_stand_rifle', (1 - blend) * duck); weights.set('inair_crouch_stand_rifle', blend * duck);
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
      action.time = name.startsWith('jump') ? Math.min(this.airTime, length - .0001)
        : name.startsWith('idle') || name.startsWith('inair') ? this.idleTime % length : this.gaitPhase * length;
    }
    this.mixer.update(0);
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
      this.model.traverse(bone => {
        if (bone instanceof THREE.Bone) this.deathPose.push({bone, position: bone.position.clone(), quaternion: bone.quaternion.clone()});
      });
    }
    this.deathTime = age ?? this.deathTime + dt;
    // Chest A straightens the knees during its blend and lifts crouched actors.
    // The other native collapses have compatible low-stance transitions.
    const names = actor.duckAmount > .2 ? ['death_chest_b', 'death_gut_a'] : ['death_chest_a', 'death_chest_b', 'death_gut_a'];
    const action = this.actions.get(names[actor.id % names.length]);
    if (!action) {
      // The small baseline asset can finish loading before the full motion set.
      const t = clamp(this.deathTime / .65, 0, 1);
      this.model.rotation.x = -1.45 * t * t * (3 - 2 * t);
      return;
    }
    for (const candidate of this.actions.values()) candidate.enabled = candidate === action;
    action.setEffectiveWeight(1);
    // Standing death clips must not lift a crouched victim back to standing.
    // Enter at compatible hip and head heights, blending from the hit pose.
    // Leave some headroom for the curved joint-rotation blend; matching only
    // the endpoints can briefly straighten the upper body between them.
    if (first && actor.duckAmount > .2 && pelvis) {
      for (this.deathStart = 0; this.deathStart < Math.min(1.2, action.getClip().duration - 1 / 30); this.deathStart += 1 / 30) {
        action.time = this.deathStart; this.mixer.update(0); this.model.updateWorldMatrix(true, true);
        const lowest = Math.min(...this.bodyContacts.map(({bone, radius}) => bone.matrixWorld.elements[13] - radius));
        const lift = Math.max(0, this.model.matrixWorld.elements[13] - lowest);
        if (pelvis.matrixWorld.elements[13] + lift <= initialHip + .03 &&
          (!head || head.matrixWorld.elements[13] + lift <= initialHead - actor.duckAmount * 6 * UNIT)) break;
      }
    }
    action.time = Math.min(this.deathTime + this.deathStart, action.getClip().duration - .0001);
    this.mixer.update(0);
    const blend = clamp(this.deathTime / .16, 0, 1);
    for (const {bone, position, quaternion} of this.deathPose) {
      bone.position.lerp(position, 1 - blend);
      bone.quaternion.slerp(quaternion, 1 - blend);
    }
    // CS2 hands these poses to its physics system. A small contact correction
    // keeps this lightweight, non-ragdoll presentation out of the floor.
    this.model.updateWorldMatrix(true, true);
    const floor = this.model.matrixWorld.elements[13];
    const lowest = Math.min(...this.bodyContacts.map(({bone, radius}) => bone.matrixWorld.elements[13] - radius));
    this.model.position.y = Math.max(0, floor - lowest);
  }

  dispose() {this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);}
}
