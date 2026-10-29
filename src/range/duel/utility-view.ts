import * as THREE from 'three';
import {syncAnimationActions} from '../animation-actions';
import {prepareNativeViewAssembly} from '../native-view-actions';
import type {UtilityKind} from './utility-loadout';
import {utilityNativeTiming, utilityThrowAction, type UtilityViewAction} from './utility-presentation';
import {NATIVE_GRENADE_INPUT} from './grenade-native-input';
export type {UtilityViewAction} from './utility-presentation';
// Native release delay, independent of the authored sound/animation completion.
export const UTILITY_THROW_PRESENTATION_DELAY = NATIVE_GRENADE_INPUT.releaseDelay;

// Fresh 2000938 viewmodel_grenade variations: Underhand entry is <= 0.33,
// Overhand is its inverse; both ClipNodes have speed multiplier 1.0.
export const grenadeViewThrowAction = utilityThrowAction;

export type UtilityPresentation = Readonly<{kind: UtilityKind; selectedAt: number; readyAt: number;
  primedAt?: number; strength?: number; releaseAt?: number; throwStartedAt?: number; drawPlaybackRate?: number}>;

/** Native arm + secondary weapon tracks. This class never launches a projectile. */
export class UtilityView {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<UtilityViewAction, THREE.AnimationAction>();
  private readonly active = new Set<THREE.AnimationAction>();
  private readonly weaponMeshes: THREE.Object3D[] = [];
  private inspectAt?: number;
  private thrown?: {at: number; strength: number; startedAt: number};
  private kind: UtilityKind;
  private previousAction: UtilityViewAction = 'idle';
  private previousTime = 0;
  private transitionAt = -Infinity;
  private readonly weights = new Map<UtilityViewAction, number>();
  activeAction: UtilityViewAction = 'idle';
  constructor(readonly scene: THREE.Group, clips: THREE.AnimationClip[], kind: UtilityKind = 'he') {
    this.kind = kind;
    prepareNativeViewAssembly(scene); scene.rotation.y = Math.PI;
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      action.enabled = false; action.paused = true;
      this.actions.set(clip.name as UtilityViewAction, action);
    }
    scene.traverse(object => {
      // Multi-material GLTF meshes load as a Group with Mesh children; the native
      // assembly metadata belongs to that group rather than each material primitive.
      if (typeof object.userData.native_view_weapon === 'string') this.weaponMeshes.push(object);
    });
    this.sample('idle', 0);
  }
  duration(name: UtilityViewAction) {
    const exported = this.actions.get(name)?.getClip().duration ?? 0;
    if (!this.actions.has(name) || (name !== 'throw-low' && name !== 'throw-high')) return exported;
    // GLTF optimization can omit a constant tail. Retain native elapsed seconds,
    // holding the final exported pose, never stretching motion to fit the clock.
    return Math.max(exported, utilityNativeTiming(this.kind, name === 'throw-low' ? 0 : 1).throwDuration);
  }
  inspect(time: number) {if (!this.actions.has('inspect')) return false; this.inspectAt = time; return true;}
  throw(time: number, strength = 1, startedAt = time - UTILITY_THROW_PRESENTATION_DELAY) {
    this.inspectAt = undefined; this.thrown = {at: time, strength, startedAt};
  }
  cancel() {this.inspectAt = undefined; this.thrown = undefined; this.transitionAt = -Infinity;
    for (const mesh of this.weaponMeshes) mesh.visible = true;}
  get followingThrough() {return !!this.thrown;}
  update(state: UtilityPresentation | undefined, time: number): boolean {
    if (!Number.isFinite(time)) return false;
    if (state) this.kind = state.kind;
    if (state) this.thrown = undefined;
    if (this.thrown) {
      const age = Math.max(0, time - this.thrown.startedAt), name = grenadeViewThrowAction(this.thrown.strength);
      // The kernel has already released the grenade. Keep only the arm follow-through,
      // never a second grenade stuck to the palm while its projectile is in flight.
      for (const mesh of this.weaponMeshes) mesh.visible = false;
      this.sample(name, age);
      if (age >= this.duration(name)) {this.cancel(); return false;}
      return true;
    }
    for (const mesh of this.weaponMeshes) mesh.visible = true;
    if (!state) return false;
    const nativeTiming = utilityNativeTiming(this.kind);
    const drawRate = Number.isFinite(state.drawPlaybackRate) && state.drawPlaybackRate! > 0 ? state.drawPlaybackRate! : 1;
    const drawComplete = nativeTiming.drawCompleteAt === undefined ? this.duration('draw') :
      nativeTiming.drawCompleteAt / nativeTiming.draw * this.duration('draw');
    const drawEndAt = state.selectedAt + drawComplete / drawRate;
    if (state.primedAt !== undefined && time >= state.primedAt) {
      this.inspectAt = undefined;
      const age = Math.max(0, time - state.primedAt);
      const strength = state.strength ?? 1;
      const timing = utilityNativeTiming(state.kind, strength);
      const readyStart = Math.max(0, this.duration('pullpin') - (timing.pullpin - (timing.pinReadyAt ?? timing.pullpin)));
      const throwAt = state.throwStartedAt ?? (state.releaseAt === undefined ? undefined : state.releaseAt - UTILITY_THROW_PRESENTATION_DELAY);
      if (throwAt !== undefined && time >= throwAt) {
        this.sample(grenadeViewThrowAction(strength), Math.max(0, time - throwAt));
      } else if (age < readyStart) this.sample('pullpin', age);
      else {
        // The native graph samples these as poses even when the resource has a duration.
        // Blend all strengths continuously, then cross from the final pin pose over ReadyToThrow.
        const s = THREE.MathUtils.clamp(strength, 0, 1), low = s < .5;
        const blend = timing.readyBlend > 0 ? THREE.MathUtils.clamp((age - readyStart) / timing.readyBlend, 0, 1) : 1;
        this.weights.clear(); this.weights.set('pullpin', 1 - blend);
        this.weights.set(low ? 'hold-low' : 'hold-mid', (low ? 1 - s * 2 : 2 - s * 2) * blend);
        this.weights.set(low ? 'hold-mid' : 'hold-high', (low ? s * 2 : s * 2 - 1) * blend);
        this.activeAction = strength < .25 ? 'hold-low' : strength < .75 ? 'hold-mid' : 'hold-high';
        this.apply(this.weights, 'pullpin', Math.min(age, this.duration('pullpin')));
      }
    } else if (this.inspectAt !== undefined && time - this.inspectAt < this.duration('inspect')) {
      this.sample('inspect', Math.max(0, time - this.inspectAt));
    } else if (time < drawEndAt) {
      this.sample('draw', Math.max(0, time - state.selectedAt) * drawRate);
    } else {
      const idleTime = this.duration('idle') > 0 ? Math.max(0, time - state.selectedAt) % this.duration('idle') : 0;
      if (this.activeAction !== 'idle') {
        this.previousAction = this.activeAction;
        this.transitionAt = this.activeAction === 'draw' ? drawEndAt :
          this.activeAction === 'inspect' && this.inspectAt !== undefined ? this.inspectAt + this.duration('inspect') : time;
      }
      const blend = THREE.MathUtils.clamp((time - this.transitionAt) / .2, 0, 1);
      this.weights.clear(); this.weights.set(this.previousAction, 1 - blend); this.weights.set('idle', blend);
      this.activeAction = 'idle'; this.apply(this.weights, this.previousAction,
        this.previousAction === 'draw' ? Math.max(0, time - state.selectedAt) * drawRate : this.previousTime, 'idle', idleTime);
      this.inspectAt = undefined;
    }
    return true;
  }
  private sample(name: UtilityViewAction, time: number) {
    this.activeAction = name; this.previousTime = time; this.transitionAt = -Infinity;
    this.weights.clear(); this.weights.set(name, 1); this.apply(this.weights, name, time);
  }
  private apply(weights: ReadonlyMap<UtilityViewAction, number>, timed: UtilityViewAction, time: number,
    other?: UtilityViewAction, otherTime = 0) {
    for (const [key, action] of this.actions) {
      const weight = weights.get(key) ?? 0;
      action.enabled = weight > 0; action.setEffectiveWeight(weight);
      action.time = THREE.MathUtils.clamp(key === other ? otherTime : key === timed ? time : 0, 0, action.getClip().duration);
    }
    syncAnimationActions(this.actions.values(), this.active); this.mixer.update(0);
  }
  dispose() {this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.scene); this.actions.clear(); this.active.clear();}
}
