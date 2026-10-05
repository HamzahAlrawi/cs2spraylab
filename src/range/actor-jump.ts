import {TERRAIN_RULES} from './terrain';

export type JumpRules = {bhopWindow?: number; spamTime?: number; autoBhop?: boolean; enableBunnyhopping?: boolean};
export const DEFAULT_JUMP_RULES: Readonly<Required<JumpRules>> = Object.freeze({
  bhopWindow: TERRAIN_RULES.bhopWindow, spamTime: TERRAIN_RULES.jumpSpamTime,
  autoBhop: false, enableBunnyhopping: false,
});
// Inspected offline in build 2000924: server RVAs ab21a0/adbbd0.
// These are landing-state factors, NOT the removed legacy stamina accumulator.
export function landingBase(impactVelocity: number, unit = TERRAIN_RULES.unit) {
  return Math.max(.2, Math.min(1, 1 + Math.min(0, impactVelocity) / unit * .0005000000237487257));
}
export function jumpLandingFactor(impactVelocity: number, secondsSinceLanding: number) {
  return Math.min(1, landingBase(impactVelocity) + Math.max(0, Math.min(1, secondsSinceLanding)) * .6000000238418579);
}
export function groundLandingFactor(impactVelocity: number, secondsSinceLanding: number) {
  return Math.min(1, landingBase(impactVelocity) ** 2 + Math.max(0, secondsSinceLanding) * 1.111189365386963);
}
export function acceptedJumpPress(time: number, previous: number | undefined, rules: JumpRules = {}) {
  return previous === undefined || time - previous > (rules.spamTime ?? TERRAIN_RULES.jumpSpamTime) + 1e-12;
}
export function isBhopPress(press: number | undefined, landing: number | undefined, rules: JumpRules = {}) {
  return press !== undefined && landing !== undefined &&
    Math.abs(press - landing) <= (rules.bhopWindow ?? TERRAIN_RULES.bhopWindow) / 2 + 1e-12;
}

export function ballisticContactTime(from: number, height: number, velocity: number, gravity: number, dt: number) {
  if (gravity <= 0) return velocity ? Math.max(0, Math.min(dt, (height - from) / velocity)) : dt;
  const root = (velocity + Math.sqrt(Math.max(0, velocity * velocity + 2 * gravity * (from - height)))) / gravity;
  return Math.max(0, Math.min(dt, root));
}
