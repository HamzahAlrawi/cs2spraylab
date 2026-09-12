import { describe, expect, it } from 'vitest';
import { getPatternForLength, getWeapon } from '../data/weapons';
import { PointerSample } from '../types';
import { scoreAttempt, findWeakSegmentForWeapon } from './scoring';
import { scaledPattern } from './path';

function samplesFromPattern(pattern: Array<{ timeMs: number; x: number; y: number }>, offset = { x: 0, y: 0 }): PointerSample[] {
  return pattern.map((point) => ({
    t: point.timeMs,
    x: point.x + offset.x,
    y: point.y + offset.y
  }));
}

function samplesTooEarly(pattern: Array<{ timeMs: number; x: number; y: number }>, shiftMs = 260): PointerSample[] {
  return pattern.map((point) => ({
    t: Math.max(0, point.timeMs - shiftMs),
    x: point.x,
    y: point.y
  }));
}

describe('spray scoring', () => {
  it('scores a path that follows the ideal pattern very highly', () => {
    const weapon = getWeapon('ak47');
    const ideal = scaledPattern(getPatternForLength(weapon, 10), 'mid');
    const attempt = scoreAttempt({
      weapon,
      mode: 'trace',
      sprayLength: 10,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesFromPattern(ideal),
      previousAttempts: []
    });

    expect(attempt.scores.overall).toBeGreaterThanOrEqual(95);
    expect(attempt.scores.pathAccuracy).toBe(100);
    expect(attempt.scores.temporalAccuracy).toBe(100);
    expect(attempt.bulletErrors.every((error) => error.distance < 0.001)).toBe(true);
    expect(attempt.feedback.some((line) => line.toLowerCase().includes('strong spray'))).toBe(true);
  });

  it('penalizes moving through the spray too early even when the shape is eventually correct', () => {
    const weapon = getWeapon('ak47');
    const ideal = scaledPattern(getPatternForLength(weapon, 10), 'mid');
    const attempt = scoreAttempt({
      weapon,
      mode: 'trace',
      sprayLength: 10,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesTooEarly(ideal),
      previousAttempts: []
    });

    expect(attempt.scores.temporalAccuracy).toBeLessThan(75);
    expect(attempt.feedback.join(' ')).toMatch(/too fast|rhythm/i);
  });

  it('diagnoses not pulling down enough', () => {
    const weapon = getWeapon('ak47');
    const ideal = scaledPattern(getPatternForLength(weapon, 10), 'mid');
    const attempt = scoreAttempt({
      weapon,
      mode: 'no-guide',
      sprayLength: 10,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesFromPattern(ideal, { x: 0, y: -38 }),
      previousAttempts: []
    });

    expect(attempt.scores.verticalControl).toBeLessThan(45);
    expect(attempt.feedback.join(' ')).toMatch(/not pulling down enough/i);
    expect(attempt.bulletErrors.some((error) => error.comment.includes('did not pull down enough'))).toBe(true);
  });

  it('diagnoses over-pulling down', () => {
    const weapon = getWeapon('m4a4');
    const ideal = scaledPattern(getPatternForLength(weapon, 10), 'mid');
    const attempt = scoreAttempt({
      weapon,
      mode: 'trace',
      sprayLength: 10,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesFromPattern(ideal, { x: 0, y: 42 }),
      previousAttempts: []
    });

    expect(attempt.scores.verticalControl).toBeLessThan(45);
    expect(attempt.feedback.join(' ')).toMatch(/too aggressively/i);
  });



  it('greatly penalizes spraying while moving and rewards crouch as the lower-spread stance', () => {
    const weapon = getWeapon('ak47');
    const ideal = scaledPattern(getPatternForLength(weapon, 10), 'mid');
    const standingStill = scoreAttempt({
      weapon,
      mode: 'trace',
      sprayLength: 10,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesFromPattern(ideal).map((sample) => ({ ...sample, moving: false, crouching: false, inaccuracyPx: weapon.inaccuracy.standPx })),
      previousAttempts: []
    });
    const moving = scoreAttempt({
      weapon,
      mode: 'trace',
      sprayLength: 10,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesFromPattern(ideal).map((sample) => ({ ...sample, moving: true, crouching: false, speed: 6, inaccuracyPx: weapon.inaccuracy.movePx })),
      previousAttempts: []
    });
    const crouched = scoreAttempt({
      weapon,
      mode: 'trace',
      sprayLength: 10,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesFromPattern(ideal).map((sample) => ({ ...sample, moving: false, crouching: true, inaccuracyPx: weapon.inaccuracy.standPx * weapon.inaccuracy.crouchMultiplier })),
      previousAttempts: []
    });

    expect(moving.scores.overall).toBeLessThan(standingStill.scores.overall - 25);
    expect(crouched.scores.overall).toBeGreaterThan(moving.scores.overall);
    expect(moving.feedback.join(' ')).toMatch(/moving|counter-strafe/i);
  });

  it('finds the repeated weakest segment for a weapon', () => {
    const weapon = getWeapon('m4a1s');
    const ideal = scaledPattern(getPatternForLength(weapon, 15), 'mid');
    const attemptA = scoreAttempt({
      weapon,
      mode: 'trace',
      sprayLength: 15,
      distance: 'mid',
      idealPattern: ideal,
      samples: samplesFromPattern(ideal).map((sample, index) => index >= 7 && index <= 11 ? { ...sample, x: sample.x + 50 } : sample),
      previousAttempts: []
    });
    const attemptB = { ...attemptA, id: 'second-attempt' };

    const weak = findWeakSegmentForWeapon([attemptA, attemptB], 'm4a1s');
    expect(weak).toBeDefined();
    expect(weak?.from).toBeLessThanOrEqual(8);
    expect(weak?.to).toBeGreaterThanOrEqual(12);
  });
});
