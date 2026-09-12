import {
  AttemptResult,
  AttemptScores,
  BulletError,
  PointerSample,
  RecoilPoint,
  SprayLength,
  TargetDistance,
  TrainingMode,
  WeakSegment,
  WeaponPattern
} from '../types';
import { classifyHit } from './hitZones';
import {
  clampScore,
  distanceTolerances,
  nearestSampleTiming,
  pathLength,
  sampleUserAtBullets,
  scoreFromError,
  scoreFromTimingError
} from './path';
import { finiteNumber } from './numeric';

function average(values: number[]): number {
  const safeValues = values.filter(Number.isFinite);
  if (safeValues.length === 0) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function calculateSmoothness(samples: PointerSample[], ideal: RecoilPoint[], tolerance: number): number {
  if (samples.length < 4 || ideal.length < 3) return 60;
  const userBulletPath = sampleUserAtBullets(samples, ideal);
  const userLength = pathLength(userBulletPath);
  const idealLength = pathLength(ideal);
  const excessTravel = Math.max(0, userLength - idealLength);

  const angleChanges: number[] = [];
  for (let i = 2; i < userBulletPath.length; i += 1) {
    const a = userBulletPath[i - 2];
    const b = userBulletPath[i - 1];
    const c = userBulletPath[i];
    const angle1 = Math.atan2(b.y - a.y, b.x - a.x);
    const angle2 = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = Math.abs(angle2 - angle1);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    angleChanges.push(delta);
  }

  const jitterPenalty = average(angleChanges) * 18;
  return clampScore(100 - excessTravel * 0.55 - jitterPenalty - Math.max(0, tolerance - 24) * 0.2);
}

function detectWeakSegment(errors: BulletError[], windowSize = 5): WeakSegment {
  if (errors.length === 0) return { from: 1, to: 1, averageError: 0 };
  if (errors.length <= windowSize) {
    return {
      from: errors[0].bullet,
      to: errors[errors.length - 1].bullet,
      averageError: average(errors.map((e) => e.distance + Math.abs(e.timingMs) * 0.18))
    };
  }

  let bestStart = 0;
  let worstAverage = -1;
  for (let i = 0; i <= errors.length - windowSize; i += 1) {
    const window = errors.slice(i, i + windowSize);
    const avg = average(window.map((e) => e.distance + Math.abs(e.timingMs) * 0.18));
    if (avg > worstAverage) {
      worstAverage = avg;
      bestStart = i;
    }
  }
  return {
    from: errors[bestStart].bullet,
    to: errors[bestStart + windowSize - 1].bullet,
    averageError: Math.round(worstAverage * 10) / 10
  };
}

function deterministicSpread(bullet: number, weaponName: string, penaltyPx: number) {
  if (penaltyPx <= 0) return { x: 0, y: 0 };
  let hash = bullet * 2166136261;
  for (const char of weaponName) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const a = ((hash >>> 0) % 10_000) / 10_000 * Math.PI * 2;
  const b = (((hash * 1103515245 + 12345) >>> 0) % 10_000) / 10_000;
  const radius = penaltyPx * (0.55 + b * 0.45);
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}

function describeBulletError(
  point: RecoilPoint,
  dx: number,
  dy: number,
  previousDx: number,
  timingMs: number,
  refireMs: number,
  moving: boolean,
  crouching: boolean,
  movementPenalty: number
): string {
  const parts: string[] = [];
  if (dy > 14) parts.push('over-pulled down');
  if (dy < -14) parts.push('did not pull down enough');
  if (dx > 13) parts.push('too far right');
  if (dx < -13) parts.push('too far left');

  if (timingMs < -refireMs * 0.38) parts.push('reached this point too early');
  if (timingMs > refireMs * 0.38) parts.push('reached this point too late');

  const horizontalReversal = Math.sign(point.x) !== 0 && Math.sign(point.x) !== Math.sign(previousDx);
  if (horizontalReversal && Math.abs(dx) > 10) parts.push('late horizontal transition');
  if (moving && movementPenalty > 18) parts.push('movement inaccuracy');
  if (crouching && movementPenalty < 8) parts.push('stable crouched shot');

  return parts.length ? parts.join(', ') : 'good timed control';
}

function buildFeedback(errors: BulletError[], scores: AttemptScores, weakSegment: WeakSegment, weapon: WeaponPattern): string[] {
  const feedback: string[] = [];
  const over = average(errors.map((e) => Math.max(0, e.dy)));
  const under = average(errors.map((e) => Math.max(0, -e.dy)));
  const horizontal = average(errors.map((e) => Math.abs(e.dx)));
  const early = errors.filter((e) => e.timingMs < -weapon.refireMs * 0.38).length;
  const late = errors.filter((e) => e.timingMs > weapon.refireMs * 0.38).length;
  const movingShots = errors.filter((e) => e.moving && e.movementPenalty > 18).length;
  const crouchedShots = errors.filter((e) => e.crouching).length;

  if (movingShots > 0) {
    feedback.push(`You fired ${movingShots} bullet${movingShots === 1 ? '' : 's'} while moving. In this trainer, moving shots get a large spread penalty; counter-strafe before spraying.`);
  }
  if (crouchedShots > 0 && movingShots === 0) {
    feedback.push('Crouching stabilized the burst, but do not use it as a substitute for learning the standing pattern timing.');
  }
  if (scores.first5 >= 75 && scores.first10 < 60) {
    feedback.push('Your first 5 bullets are controlled, but the spray breaks down before bullet 10. Focus on the first timed horizontal transition.');
  }
  if (scores.temporalAccuracy < 55) {
    feedback.push(
      early > late
        ? `You are moving through the pattern too fast. Hold the rhythm: ${weapon.name} fires every ${Math.round(weapon.refireMs)}ms.`
        : `You are reaching key bullets too late. Try to arrive at bullets ${weakSegment.from}-${weakSegment.to} on the shot beat, not after it.`
    );
  }
  if (over > under + 5) {
    feedback.push(`You are pulling down too aggressively, especially around bullets ${weakSegment.from}-${weakSegment.to}.`);
  } else if (under > over + 5) {
    feedback.push(`You are not pulling down enough around bullets ${weakSegment.from}-${weakSegment.to}; increase the downward compensation gradually.`);
  }
  if (horizontal > 16) {
    feedback.push(`Your left/right timing is the main issue. Practice the ${weapon.name} transition near bullets ${weakSegment.from}-${weakSegment.to}.`);
  }
  if (scores.smoothness < 55) {
    feedback.push('Your movement is shaky. Slow the trace down and make one smooth pull instead of small corrections.');
  }
  if (scores.overall >= 82 && movingShots === 0) {
    feedback.push('Strong spray. Move to a longer spray length or long-distance target to make the drill harder.');
  }
  if (feedback.length === 0) {
    feedback.push(`Keep repeating ${weapon.name} bullets ${weakSegment.from}-${weakSegment.to}; that is your current weakest segment.`);
  }
  return feedback;
}

export function scoreAttempt(params: {
  weapon: WeaponPattern;
  mode: TrainingMode;
  sprayLength: SprayLength;
  distance: TargetDistance;
  samples: PointerSample[];
  idealPattern: RecoilPoint[];
  previousAttempts: AttemptResult[];
}): AttemptResult {
  const { weapon, mode, sprayLength, previousAttempts } = params;
  const distance = params.distance;
  const samples = params.samples
    .filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.x) && Number.isFinite(sample.y))
    .map((sample) => ({
      ...sample,
      t: finiteNumber(sample.t),
      x: finiteNumber(sample.x),
      y: finiteNumber(sample.y),
      speed: sample.speed === undefined ? undefined : finiteNumber(sample.speed),
      inaccuracyPx: sample.inaccuracyPx === undefined ? undefined : Math.max(0, finiteNumber(sample.inaccuracyPx)),
      startAimOffsetX: sample.startAimOffsetX === undefined ? undefined : finiteNumber(sample.startAimOffsetX),
      startAimOffsetY: sample.startAimOffsetY === undefined ? undefined : finiteNumber(sample.startAimOffsetY)
    }));
  const idealPattern = params.idealPattern
    .filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ ...point, x: finiteNumber(point.x), y: finiteNumber(point.y), timeMs: finiteNumber(point.timeMs) }));
  const tolerance = distanceTolerances[distance];
  const userAtBullets = sampleUserAtBullets(samples, idealPattern);

  const errors: BulletError[] = idealPattern.map((ideal, index) => {
    const user = userAtBullets[index] ?? { t: ideal.timeMs, x: 0, y: 0 };
    const aimOffsetX = user.startAimOffsetX ?? samples[0]?.startAimOffsetX ?? 0;
    const aimOffsetY = user.startAimOffsetY ?? samples[0]?.startAimOffsetY ?? 0;
    const dx = finiteNumber(user.x - ideal.x + aimOffsetX);
    const dy = finiteNumber(user.y - ideal.y + aimOffsetY);
    const previousDx = index > 0 ? finiteNumber(userAtBullets[index - 1].x - idealPattern[index - 1].x) : 0;
    const timingMs = finiteNumber(nearestSampleTiming(samples, ideal, ideal.timeMs));
    const timingScore = scoreFromTimingError(timingMs, weapon.refireMs);
    const movementPenalty = Math.max(0, finiteNumber(user.inaccuracyPx));
    const spread = deterministicSpread(ideal.bullet, weapon.id, movementPenalty);
    const impact = { x: finiteNumber(dx + spread.x), y: finiteNumber(dy + spread.y) };
    const pathDistance = finiteNumber(Math.hypot(dx, dy), 9999);
    const effectiveDistance = finiteNumber(pathDistance + movementPenalty, 9999);
    return {
      bullet: ideal.bullet,
      ideal,
      user,
      dx,
      dy,
      distance: effectiveDistance,
      timingMs,
      timingScore,
      movementPenalty,
      moving: Boolean(user.moving),
      crouching: Boolean(user.crouching),
      impact,
      hitZone: classifyHit(impact.x, impact.y),
      comment: describeBulletError(ideal, dx, dy, previousDx, timingMs, weapon.refireMs, Boolean(user.moving), Boolean(user.crouching), movementPenalty)
    };
  });

  const distances = errors.map((e) => e.distance);
  const avgError = average(distances);
  const verticalError = average(errors.map((e) => Math.abs(e.dy) + e.movementPenalty * 0.45));
  const horizontalError = average(errors.map((e) => Math.abs(e.dx) + e.movementPenalty * 0.45));
  const timingScore = average(errors.map((e) => e.timingScore));
  const transitionErrors = errors.map((e, index) => {
    const previous = index > 0 ? idealPattern[index - 1] : idealPattern[index];
    const horizontalDelta = Math.abs(idealPattern[index].x - previous.x);
    const transitionWeight = 1 + Math.min(2.5, horizontalDelta / 8);
    return Math.abs(e.dx) * transitionWeight + Math.abs(e.timingMs) * 0.08 + e.movementPenalty * 0.65;
  });
  const horizontalTimingError = average(transitionErrors);
  const overcorrectionPx = average(errors.map((e) => Math.max(0, e.dy)));
  const undercorrectionPx = average(errors.map((e) => Math.max(0, -e.dy)));
  const first5Error = average(errors.slice(0, 5).map((e) => e.distance + Math.abs(e.timingMs) * 0.1));
  const first10Error = average(errors.slice(0, 10).map((e) => e.distance + Math.abs(e.timingMs) * 0.1));

  const recentSameWeapon = previousAttempts.filter((attempt) => attempt.weaponId === weapon.id).slice(0, 8);
  const recentScores = recentSameWeapon.map((attempt) => attempt.scores.overall);
  const currentPathScore = scoreFromError(avgError, tolerance);
  const currentVariance = Math.abs(average(recentScores) - currentPathScore);
  const consistency = recentScores.length < 2 ? 50 : clampScore(100 - currentVariance * 1.5);

  const scores: AttemptScores = {
    pathAccuracy: currentPathScore,
    temporalAccuracy: clampScore(timingScore),
    verticalControl: scoreFromError(verticalError, tolerance * 0.75),
    horizontalTiming: scoreFromError(horizontalTimingError, tolerance * 0.7),
    smoothness: calculateSmoothness(samples, idealPattern, tolerance),
    overcorrection: clampScore(100 - overcorrectionPx * 3.3),
    undercorrection: clampScore(100 - undercorrectionPx * 3.3),
    first5: scoreFromError(first5Error, tolerance),
    first10: scoreFromError(first10Error, tolerance),
    consistency,
    overall: 0
  };

  scores.overall = clampScore(
    scores.pathAccuracy * 0.28 +
      scores.temporalAccuracy * 0.22 +
      scores.verticalControl * 0.14 +
      scores.horizontalTiming * 0.16 +
      scores.smoothness * 0.08 +
      scores.first10 * 0.08 +
      scores.consistency * 0.04
  );

  const weakSegment = detectWeakSegment(errors);

  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    weaponId: weapon.id,
    weaponName: weapon.name,
    mode,
    sprayLength,
    distance,
    scores,
    weakSegment,
    bulletErrors: errors,
    userSamples: samples,
    idealPattern,
    feedback: buildFeedback(errors, scores, weakSegment, weapon)
  };
}

export function findWeakSegmentForWeapon(attempts: AttemptResult[], weaponId: string): WeakSegment | undefined {
  const recent = attempts.filter((attempt) => attempt.weaponId === weaponId).slice(0, 8);
  if (recent.length === 0) return undefined;
  const segmentMap = new Map<string, { segment: WeakSegment; count: number; error: number }>();
  for (const attempt of recent) {
    const key = `${attempt.weakSegment.from}-${attempt.weakSegment.to}`;
    const existing = segmentMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.error += attempt.weakSegment.averageError;
    } else {
      segmentMap.set(key, { segment: attempt.weakSegment, count: 1, error: attempt.weakSegment.averageError });
    }
  }
  return Array.from(segmentMap.values()).sort((a, b) => b.error / b.count - a.error / a.count)[0]?.segment;
}
