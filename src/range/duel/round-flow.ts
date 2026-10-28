import {clamp, GRAVITY, UNIT,type Vec} from '../actor-physics';
import {verticalContact} from '../actor-collision';
import type {Solid} from './geometry';
import type {DuelActorSnapshot} from './types';
import type {TerrainQueries} from '../terrain';

export const BOT_COLLAPSE_SECONDS = 1.2;
export const DEATH_POSE_BLEND_SECONDS = .08;
export const PLAYER_COLLAPSE_SECONDS = .5;

export function deathVariant(actor: Pick<DuelActorSnapshot, 'id' | 'yaw' | 'deathDirection'>): 'a' | 'b' | 'c' {
  if (!actor.deathDirection) return (['a', 'b', 'c'] as const)[actor.id % 3];
  // The native rig faces +Z before the actor group's yaw-minus-PI rotation.
  const {x, z} = actor.deathDirection, yaw = actor.yaw - Math.PI;
  const localX = x * Math.cos(yaw) - z * Math.sin(yaw), localZ = x * Math.sin(yaw) + z * Math.cos(yaw);
  return Math.abs(localX) > Math.abs(localZ) * 1.1 ? 'b' : localZ < 0 ? 'a' : 'c';
}

export class RoundFlow {
  elapsed = 0;
  ending = false;
  finish() {this.ending = true; this.elapsed = 0;}
  reset() {this.ending = false; this.elapsed = 0;}
  remaining(delay: number) {return this.ending ? Math.max(0, delay - this.elapsed) : 0;}
  advance(dt: number, paused: boolean, delay: number) {
    if (!this.ending || paused) return false;
    this.elapsed += clamp(dt, 0, .25);
    return this.elapsed >= delay;
  }
}

export function deathView(seconds: number, eyeHeight: number,impact?:{direction:Vec;yaw:number;headshot?:boolean}) {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const eye = Number.isFinite(eyeHeight) ? Math.max(.28, eyeHeight) : 1.6256;
  const valid = impact && [impact.yaw,impact.direction.x,impact.direction.y,impact.direction.z].every(Number.isFinite);
  const length = valid ? Math.hypot(impact.direction.x,impact.direction.z) : 0;
  const side = valid && length > 1e-8 ? (impact.direction.x*Math.cos(impact.yaw)-impact.direction.z*Math.sin(impact.yaw))/length : 0;
  const back = valid && length > 1e-8 ? (impact.direction.x*Math.sin(impact.yaw)+impact.direction.z*Math.cos(impact.yaw))/length : 0;
  const head = valid && impact.headshot;
  // Native 800 u/s^2 gravity suggests ~.36 s for a standing eye to lose 1.35 m.
  // A short hit lead-in, ballistic descent and impact-angle settle replace the
  // old .7 s smooth lowering. Camera offsets/timings are authored estimates,
  // not extracted Source 2 camera/ragdoll playback. deathFeet owns world support.
  const lead = head ? .015 : .035, travel = eye - .28;
  const duration = Math.min(.41, Math.sqrt(2 * travel / GRAVITY)) * (head ? .94 : 1);
  const fallTime = Math.max(0, time - lead);
  const phase = duration > 0 ? clamp(fallTime / duration, 0, 1) : 1;
  const drop = phase * phase;
  const settle = clamp((time - lead - duration) / .055, 0, 1);
  const hit = Math.min(1,time/.018) * Math.exp(-Math.max(0,time-.018)/.065) *
    clamp((PLAYER_COLLAPSE_SECONDS-time)/.1,0,1);
  const tilt = Math.min(1,drop*1.2);
  const kick = head ? .075 : .028;
  return {height: eye - travel * drop,
    pitch: (.14 + back*.10)*tilt + back*kick*hit - .018*Math.sin(settle*Math.PI),
    roll: side*.25*tilt + side*kick*.8*hit,
    weaponDrop: clamp(time / (head ? .075 : .10), 0, 1)};
}

export function deathFeet(actor: Pick<DuelActorSnapshot, 'position' | 'feet'>, seconds: number, solids: readonly Solid[], verticalVelocity = 0, native?: TerrainQueries) {
  // Dead actors no longer advance their movement state, but their presentation
  // still needs a support surface when settling from a jump or on top of cover.
  const time = Math.max(0, seconds), to = actor.feet + verticalVelocity * time - .5 * 800 * UNIT * time ** 2;
  return verticalContact(actor.position, actor.feet, to, native ? .01 : 0, solids, native ? null : 0, native).feet;
}
