import * as THREE from 'three';
import {nativeFireAction, nativeReloadWindow, type NativeFireOptions, type NativeViewAction} from './native-view-actions';
import type {ReloadPhase} from './weapon-actions';
import {syncAnimationActions} from './animation-actions';

export type ViewAction = 'idle' | 'reload' | 'reload-empty' | 'draw' | 'pickup' | 'inspect' | NativeViewAction;
export interface ViewAnimationOptions {reloadEmpty?: boolean; ammo?: number; charging?: boolean; chargeDuration?: number;
  equipment?: string; reloadPhase?: ReloadPhase; reloadProgress?: number}

/** Presentation only: gameplay still owns ammo, deploy delays, and firing permissions. */
export class ViewAnimation {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<ViewAction, THREE.AnimationAction>();
  private activeActions = new Set<THREE.AnimationAction>();
  private transient?: {name: ViewAction; elapsed: number; duration: number};
  private idleTime = 0;
  private reloading = false;
  private disposed = false;
  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    const names: ViewAction[] = ['idle', 'reload', 'reload-empty', 'draw', 'pickup', 'inspect', 'fire', 'fire-last', 'fire-alt', 'fire-scoped', 'fire-left', 'fire-right', 'fire-left-last', 'fire-right-last', 'idle-empty', 'idle-left-empty', 'charge', 'dryfire', 'draw-alt'];
    for (const clip of clips) {
      if (!names.includes(clip.name as ViewAction)) continue;
      if (!Number.isFinite(clip.duration) || clip.duration < 0) continue;
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      action.paused = true; action.enabled = false;
      this.actions.set(clip.name as ViewAction, action);
    }
    this.update(0, 1);
  }
  has(action: ViewAction) {return this.actions.has(action);}
  duration(action: ViewAction) {return this.actions.get(action)?.getClip().duration ?? 0;}
  get activeAction(): ViewAction {return this.reloading ? 'reload' : this.transient?.name ?? 'idle';}

  playInspect() {return this.play('inspect');}
  playFire(id: string, options: NativeFireOptions & {duration?: number} = {}) {
    const name = nativeFireAction(id, options);
    // Replace the presentation in one evaluation, including repeated high-RPM shots.
    this.transient = undefined; this.reloading = false;
    const played = name ? this.play(this.has(name) ? name : 'fire', options.duration) : false;
    if (!played && !this.disposed) this.update(0, 1);
    return played;
  }
  playDraw(duration?: number) {this.cancel(); return this.play('draw', duration);}
  // CS2's audited viewmodel set has no distinct pickup action; draw is explicit reuse.
  playPickup(duration?: number) {this.cancel(); return this.play(this.has('pickup') ? 'pickup' : 'draw', duration);}

  private play(name: ViewAction, duration?: number) {
    if (this.disposed || this.reloading || !this.has(name)) return false;
    const seconds = duration ?? this.duration(name);
    if (!Number.isFinite(seconds) || seconds <= 0 || this.duration(name) <= 0) return false;
    this.transient = {name, elapsed: 0, duration: seconds};
    this.update(0, 1);
    return true;
  }

  /** Call on firing, unequip, round reset, or loss of the active viewmodel. */
  cancel() {
    this.transient = undefined; this.reloading = false;
    if (!this.disposed) this.update(0, 1);
  }

  /** Existing two-argument reload callers remain valid; pass frame dt to advance actions. */
  update(remaining: number, duration: number, dt = 0, options: ViewAnimationOptions = {}) {
    if (this.disposed) return;
    const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const idleDuration = this.duration('idle');
    this.idleTime = idleDuration > 0 ? (this.idleTime + delta) % idleDuration : 0;
    this.reloading = Number.isFinite(duration) && duration > 0 &&
      (Number.isFinite(remaining) && remaining > 0 || !!options.reloadPhase && options.reloadPhase !== 'idle' && Number.isFinite(options.reloadProgress));
    if (options.charging && this.has('charge') && !this.reloading && this.transient?.name !== 'charge') {
      this.transient = {name:'charge', elapsed:0, duration:options.chargeDuration ?? this.duration('charge')};
    } else if (!options.charging && this.transient?.name === 'charge') this.transient = undefined;
    let base: ViewAction = 'idle';
    if (options.ammo === 0 && this.has('idle-empty')) base = 'idle-empty';
    else if (options.ammo === 1 && this.has('idle-left-empty')) base = 'idle-left-empty';
    let name: ViewAction = base, time = base === 'idle' ? this.idleTime : 0, weight = 0;
    if (this.reloading) {
      this.transient = undefined;
      name = options.reloadEmpty && this.has('reload-empty') ? 'reload-empty' : 'reload';
      const progress = THREE.MathUtils.clamp(Number.isFinite(options.reloadProgress) ? options.reloadProgress! : 1 - remaining / duration, 0, 1);
      const window = nativeReloadWindow(options.equipment, options.reloadPhase);
      time = window ? Math.min(this.duration(name), window.start + progress * window.duration) : progress * this.duration(name);
      weight = Math.max(0, Math.min(1, progress * duration / .06, remaining / .08));
      // Native shell phases join each other directly, never fade back to loaded idle between inserts.
      if (window) weight = options.reloadPhase === 'start' ? Math.min(1, progress * duration / .06)
        : options.reloadPhase === 'finish' ? Math.min(1, remaining / .08) : 1;
    } else if (this.transient) {
      const action = this.transient;
      action.elapsed += delta;
      if (action.elapsed >= action.duration && action.name !== 'charge') this.transient = undefined;
      else {
        name = action.name;
        time = Math.min(1, action.elapsed / action.duration) * this.duration(name);
        const fade = Math.min(.08, action.duration / 4);
        weight = action.name === 'charge' ? 1 : Math.max(0,Math.min(1, (action.duration - action.elapsed) / fade));
        if (name === 'inspect') weight = Math.min(weight, action.elapsed / .06);
      }
    }
    if (!this.has(name) || name === base) weight = 0;
    for (const [key, action] of this.actions) {
      const value = key === base ? 1 - weight : key === name ? weight : 0;
      action.enabled = value > 0;
      action.setEffectiveWeight(value);
      action.time = key === base ? (base === 'idle' ? this.idleTime : 0) : key === name ? time : 0;
    }
    syncAnimationActions(this.actions.values(), this.activeActions);
    this.mixer.update(0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.transient = undefined; this.reloading = false;
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); this.actions.clear(); this.activeActions.clear();
  }
}
