import {clamp, UNIT} from '../actor-physics';
import {verticalContact} from '../actor-collision';
import type {Solid} from './geometry';
import type {DuelActorSnapshot} from './types';

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
  const t = clamp(seconds / .85, 0, 1), drop = t * t * (3 - 2 * t);
  return {height: eyeHeight + (.28 - eyeHeight) * drop,
    pitch: -.18 * drop, roll: .32 * drop, weaponDrop: Math.min(1, seconds / .25)};
}

export function deathFeet(actor: Pick<DuelActorSnapshot, 'position' | 'feet'>, seconds: number, solids: readonly Solid[]) {
  // Dead actors no longer advance their movement state, but their presentation
  // still needs a support surface when settling from a jump or on top of cover.
  const to = actor.feet - .5 * 800 * UNIT * Math.max(0, seconds) ** 2;
  return verticalContact(actor.position, actor.feet, to, 0, solids).feet;
}
