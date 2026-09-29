import {clamp} from './actor-physics';
import type {Equipment} from './equipment';
import data from './tagging-data.json';

export type TaggingState = {flinchStack: number; velocityModifier: number};

export function recoverTagging(state: TaggingState, dt: number, grounded: boolean) {
  // Separate native state: repeat-hit buildup recovers even in air; movement does not.
  state.flinchStack = clamp(state.flinchStack + .35 * dt, .1, 1);
  if (grounded) state.velocityModifier = clamp(state.velocityModifier + .4 * dt, 0, 1);
}

export function applyTagging(state: TaggingState, attackingWeapon: Equipment, heldWeapon: Equipment) {
  const {large, small} = data.weapons[attackingWeapon];
  const speed = data.weapons[heldWeapon].speed;
  state.flinchStack = Math.min(state.flinchStack, large, large - (1 - state.flinchStack) * small);
  // Build 2000919, mp_tagging_scale=1. These are NOT per-hitgroup multipliers.
  const mobility = .08 + .8 * Math.max(.15, (speed - 120) / 130);
  const floor = Math.max(.2, (1.2 * Math.min(1, (speed - 80) / 170) - .08) * .25);
  const modifier = clamp(state.flinchStack * mobility, floor, Math.max(large, .65));
  state.velocityModifier = Math.min(state.velocityModifier, modifier);
}
