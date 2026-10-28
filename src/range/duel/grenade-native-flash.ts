const f = Math.fround;

export const NATIVE_GRENADE_FLASH = Object.freeze({
  strength: 3,
  radiusUnits: 3000,
  fadeDivisor: f(1.4),
  maxAlpha: 255,
  updateBump: f(0.01),
  facingDots: Object.freeze([f(0.6), f(0.3), f(-0.2)]),
  holdMultipliers: Object.freeze([1.25, f(0.8), 0.5, 0.25]),
  fadeMultipliers: Object.freeze([2.5, 1.75, 1, 0.5]),
});

export const NATIVE_GRENADE_FLASH_SOURCE = Object.freeze({
  build: 2000935,
  module: 'server.dll',
  sha256: '2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c',
  rvas: Object.freeze({
    detonate: '0x3aaeb0', radial: '0x3ad840', visibility: '0x3ad2d0',
    radius: '0x1dae828', distance: '0x3adab0', facing: '0x3adc22',
    playerWrapper: '0x1faf60', apply: '0x1fafd0', durationDivide: '0x1fb094',
  }),
});

export interface NativeBlindState {
  blindUntil: number;
  blindStart: number;
  duration: number;
  alpha: number;
}

export interface NativeFlashArguments {
  hold: number;
  fade: number;
  duration: number;
}

function finiteFloat(value: number): number {
  const result = f(value);
  if (!Number.isFinite(result)) throw new RangeError('Native flash inputs must be finite float32 values');
  return result;
}

/** Distance is from eye to the already Z+1-unit adjusted detonation point.
 * Dot includes pitch; visibility comes from the caller's scene queries. */
export function nativeFlashArguments(distanceUnits: number, dot: number, visibility: number): NativeFlashArguments {
  const distance = finiteFloat(distanceUnits), facing = finiteFloat(dot), visible = finiteFloat(visibility);
  if (distance < 0 || visible < 0 || visible > 1) throw new RangeError('Invalid flash distance or visibility');
  const c = NATIVE_GRENADE_FLASH;
  const q = f(c.strength - f(distance * f(c.strength / c.radiusUnits)));
  if (q <= 0 || visible === 0) return {hold: 0, fade: 0, duration: 0};
  const band = facing >= c.facingDots[0] ? 0 : facing >= c.facingDots[1] ? 1 : facing >= c.facingDots[2] ? 2 : 3;
  const hold = f(f(q * c.holdMultipliers[band]) * visible);
  const fade = f(f(q * c.fadeMultipliers[band]) * visible);
  return {hold, fade, duration: f(fade / c.fadeDivisor)};
}

/** Replays Blind state arithmetic, not client opacity or bot decision timing.
 * Caller skips application entirely when no flash reaches the target. */
export function applyNativeFlash(prior: NativeBlindState | undefined, hold: number, fade: number, time: number): NativeBlindState {
  const now = finiteFloat(time), h = finiteFloat(hold), tail = finiteFloat(fade);
  if (h < 0 || tail < 0) throw new RangeError('Flash hold and fade must be nonnegative');
  const oldUntil = finiteFloat(prior?.blindUntil ?? 0);
  const oldStart = finiteFloat(prior?.blindStart ?? 0);
  const oldDuration = finiteFloat(prior?.duration ?? 0);
  const oldAlpha = finiteFloat(prior?.alpha ?? 0);
  const c = NATIVE_GRENADE_FLASH;
  const blindUntil = Math.max(oldUntil, f(f(now + h) + f(tail * 0.5)));
  let duration = f(tail / c.fadeDivisor);
  let alpha: number = c.maxAlpha;
  // Native tests the previous blind-until deadline, including equality.
  if (now <= oldUntil) {
    duration = Math.max(duration, f(f(oldStart + oldDuration) - now));
    if (duration === oldDuration) duration = f(duration + c.updateBump);
    alpha = Math.max(oldAlpha, alpha);
  }
  return {blindUntil, blindStart: now, duration, alpha};
}
