import { describe, expect, it } from 'vitest';
import { getBulletCursor, interpolatePatternAt, interpolateSamples, movingAverage, pathLength, sampleUserAtBullets, scaledPattern, scoreFromError } from './path';
import { RecoilPoint } from '../types';

describe('path utilities', () => {
  it('interpolates pointer samples by timestamp', () => {
    const sample = interpolateSamples([
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 20, y: 40 }
    ], 50);

    expect(sample).toEqual({ t: 50, x: 10, y: 20 });
  });

  it('samples user path at bullet timings', () => {
    const ideal: RecoilPoint[] = [
      { bullet: 1, x: 0, y: 0, timeMs: 0 },
      { bullet: 2, x: 10, y: 10, timeMs: 50 },
      { bullet: 3, x: 20, y: 20, timeMs: 100 }
    ];

    const samples = sampleUserAtBullets([
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 20, y: 40 }
    ], ideal);

    expect(samples.map((point) => Math.round(point.y))).toEqual([0, 20, 40]);
  });

  it('scales patterns by target distance', () => {
    const base: RecoilPoint[] = [{ bullet: 1, x: 10, y: 20, timeMs: 0 }];
    expect(scaledPattern(base, 'long')[0]).toMatchObject({ x: 12, y: 24 });
    expect(scaledPattern(base, 'close')[0]).toMatchObject({ x: 8.5, y: 17 });
  });



  it('finds the current and next bullet for timed spray highlighting', () => {
    const ideal: RecoilPoint[] = [
      { bullet: 1, x: 0, y: 0, timeMs: 0 },
      { bullet: 2, x: 0, y: 10, timeMs: 100 },
      { bullet: 3, x: 10, y: 20, timeMs: 200 }
    ];

    expect(getBulletCursor(ideal, 0)).toMatchObject({ firedIndex: 0, nextIndex: 1 });
    expect(getBulletCursor(ideal, 145)).toMatchObject({ firedIndex: 1, nextIndex: 2 });
    expect(getBulletCursor(ideal, 300)).toMatchObject({ firedIndex: 2, nextIndex: 2 });
    expect(interpolatePatternAt(ideal, 150)).toMatchObject({ x: 5, y: 15 });
  });

  it('computes path length and smooth moving averages', () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }])).toBe(10);
    expect(movingAverage([10, 20, 30], 2)).toEqual([10, 15, 25]);
  });

  it('turns small errors into high scores and large errors into low scores', () => {
    expect(scoreFromError(0, 24)).toBe(100);
    expect(scoreFromError(80, 24)).toBeLessThan(10);
  });
});
