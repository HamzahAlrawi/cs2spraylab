import { PointerSample, RecoilPoint, TargetDistance } from '../types';

export const distanceTolerances: Record<TargetDistance, number> = {
  // CS2 spraying has natural bullet spread and browser pointer sampling is not raw-input perfect,
  // so these are deliberately forgiving. The analyzer still shows exact per-bullet error.
  close: 54,
  mid: 40,
  long: 29
};

export const distanceScale: Record<TargetDistance, number> = {
  close: 0.85,
  mid: 1,
  long: 1.2
};

export function scaledPattern(pattern: RecoilPoint[], distance: TargetDistance): RecoilPoint[] {
  const scale = distanceScale[distance];
  return pattern.map((p) => ({ ...p, x: p.x * scale, y: p.y * scale }));
}

export function interpolateSamples(samples: PointerSample[], t: number): PointerSample {
  if (samples.length === 0) return { t, x: 0, y: 0 };
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];

  let hi = samples.findIndex((sample) => sample.t >= t);
  if (hi <= 0) hi = 1;
  const lo = hi - 1;
  const a = samples[lo];
  const b = samples[hi];
  const span = Math.max(1, b.t - a.t);
  const ratio = (t - a.t) / span;

  const result: PointerSample = {
    t,
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio
  };
  const state = ratio < 0.5 ? a : b;
  if (state.moving !== undefined) result.moving = state.moving;
  if (state.crouching !== undefined) result.crouching = state.crouching;
  if (a.speed !== undefined || b.speed !== undefined) result.speed = (a.speed ?? 0) + ((b.speed ?? 0) - (a.speed ?? 0)) * ratio;
  if (a.inaccuracyPx !== undefined || b.inaccuracyPx !== undefined) result.inaccuracyPx = (a.inaccuracyPx ?? 0) + ((b.inaccuracyPx ?? 0) - (a.inaccuracyPx ?? 0)) * ratio;
  if (a.startAimOffsetX !== undefined || b.startAimOffsetX !== undefined) result.startAimOffsetX = a.startAimOffsetX ?? b.startAimOffsetX;
  if (a.startAimOffsetY !== undefined || b.startAimOffsetY !== undefined) result.startAimOffsetY = a.startAimOffsetY ?? b.startAimOffsetY;
  return result;
}

export function sampleUserAtBullets(samples: PointerSample[], ideal: RecoilPoint[]): PointerSample[] {
  return ideal.map((point) => interpolateSamples(samples, point.timeMs));
}

export function nearestSampleTiming(samples: PointerSample[], target: { x: number; y: number }, idealTimeMs: number): number {
  if (samples.length === 0) return 0;
  let best = samples[0];
  let bestCost = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    const spatial = Math.hypot(sample.x - target.x, sample.y - target.y);
    // Spatial closeness matters most, but add a tiny time prior so a wildly different timestamp must
    // be much closer spatially before it becomes the estimated crossing time.
    const timePrior = Math.abs(sample.t - idealTimeMs) * 0.012;
    const cost = spatial + timePrior;
    if (cost < bestCost) {
      bestCost = cost;
      best = sample;
    }
  }

  return best.t - idealTimeMs;
}

export function pathLength(points: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreFromError(error: number, tolerance: number): number {
  const deadzonePx = Math.max(6, tolerance * 0.22);
  const effectiveError = Math.max(0, error - deadzonePx);
  return clampScore(100 * Math.exp(-effectiveError / Math.max(1, tolerance * 1.12)));
}

export function scoreFromTimingError(timingMs: number, refireMs: number): number {
  // Timing matters, but a human-visible browser trainer should not nuke the score for a few ms.
  const deadzoneMs = Math.max(10, refireMs * 0.16);
  const effective = Math.max(0, Math.abs(timingMs) - deadzoneMs);
  return clampScore(100 * Math.exp(-effective / Math.max(1, refireMs * 0.55)));
}

export function movingAverage(values: number[], windowSize: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export type BulletCursor = {
  firedIndex: number;
  nextIndex: number;
  currentBullet?: RecoilPoint;
  nextBullet?: RecoilPoint;
  progressToNext: number;
};

export function getBulletCursor(pattern: RecoilPoint[], elapsedMs: number): BulletCursor {
  if (pattern.length === 0) return { firedIndex: -1, nextIndex: -1, progressToNext: 0 };
  let firedIndex = -1;
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i].timeMs <= elapsedMs) firedIndex = i;
    else break;
  }
  const nextIndex = Math.min(pattern.length - 1, Math.max(0, firedIndex + 1));
  const previous = pattern[Math.max(0, firedIndex)];
  const next = pattern[nextIndex];
  const span = Math.max(1, next.timeMs - previous.timeMs);
  const progressToNext = nextIndex === firedIndex ? 1 : Math.max(0, Math.min(1, (elapsedMs - previous.timeMs) / span));
  return {
    firedIndex,
    nextIndex,
    currentBullet: firedIndex >= 0 ? pattern[firedIndex] : undefined,
    nextBullet: next,
    progressToNext
  };
}

export function interpolatePatternAt(pattern: RecoilPoint[], elapsedMs: number): RecoilPoint | undefined {
  if (pattern.length === 0) return undefined;
  if (elapsedMs <= pattern[0].timeMs) return pattern[0];
  if (elapsedMs >= pattern[pattern.length - 1].timeMs) return pattern[pattern.length - 1];

  let hi = pattern.findIndex((point) => point.timeMs >= elapsedMs);
  if (hi <= 0) hi = 1;
  const lo = hi - 1;
  const a = pattern[lo];
  const b = pattern[hi];
  const span = Math.max(1, b.timeMs - a.timeMs);
  const ratio = (elapsedMs - a.timeMs) / span;
  return {
    bullet: b.bullet,
    timeMs: elapsedMs,
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio
  };
}
