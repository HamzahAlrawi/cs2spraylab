import {clamp, UNIT} from '../actor-physics';
import {verticalContact} from '../actor-collision';
import type {Solid} from './geometry';
import type {DuelActorSnapshot} from './types';

export const BOT_COLLAPSE_SECONDS = 1.2;
export const DEATH_POSE_BLEND_SECONDS = .08;
export const PLAYER_COLLAPSE_SECONDS = .7;

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

export function deathView(seconds: number, eyeHeight: number) {
  const t = clamp(seconds / PLAYER_COLLAPSE_SECONDS, 0, 1), drop = t * t * (3 - 2 * t);
  return {height: eyeHeight + (.28 - eyeHeight) * drop,
    pitch: .16 * drop, roll: .18 * drop, weaponDrop: clamp(seconds / .12, 0, 1)};
}

export function deathFeet(actor: Pick<DuelActorSnapshot, 'position' | 'feet'>, seconds: number, solids: readonly Solid[], verticalVelocity = 0) {
  // Dead actors no longer advance their movement state, but their presentation
  // still needs a support surface when settling from a jump or on top of cover.
  const time = Math.max(0, seconds), to = actor.feet + verticalVelocity * time - .5 * 800 * UNIT * time ** 2;
  return verticalContact(actor.position, actor.feet, to, 0, solids).feet;
}
