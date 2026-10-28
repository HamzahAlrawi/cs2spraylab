import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {angleSummary, coveredAngleRetry} from './angle-practice';
import {angleIdentity} from './occupancy';
import type {NativeMapCollision} from './native-collision';
import type {PrefireAngleReview} from './coaching';
import type {PrefireRoute} from './schema';
import {PrefireSession} from './session';
import {sanitizePrefireConfig} from './config';
import {defaults} from '../config';
import {sourcePoint} from './routes';
import {loadAngleDiagnoses, loadPrefireHistory} from './training-log';

const route: PrefireRoute = {id: 'test', name: 'Test entry', spawn: [0, 0, 0], look: [400, 0, 0], path: [[160, 0, 0]],
  angles: [{id: 'corner', name: 'Corner', position: [400, 0, 0]}]};
const collision = (blocked: boolean | 'cover' = 'cover') => ({fits: () => true,
  sweep: (_from: unknown, to: unknown) => ({position: to, fraction: 1, startSolid: false}),
  vertical: (_p: unknown, _from: number, to: number) => ({feet: Math.max(0, to), grounded: to <= 0, ceiling: false}),
  ray: (from: {x: number}) => blocked === true || blocked === 'cover' && from.x < 2
    ? {distance: .5, normal: {x: 1, y: 0, z: 0}, surfaceId: 0} : undefined}) as unknown as NativeMapCollision;
const review: PrefireAngleReview = {id: 1, name: 'Corner', cleared: false, shots: 1, openingStopped: false, readyAim: null,
  entry: true, openingHit: false, openingHead: false, threats: 1, contactToHitMs: null, message: 'Moving', tip: 'Brake'};
afterEach(() => vi.unstubAllGlobals());
describe('safe per-angle practice', () => {
  it('keeps unavailable angle measurements unknown', () => {
    expect(angleSummary(review).metrics.find(row => row.label === 'Prepared aim')?.score).toBeNull();
    expect(angleSummary({...review, openingStopped: null, entry: null, openingHit: null}).score).toBeNull();
  });
  it('only creates a one-angle entry with covered support and a traversed approach', () => {
    const retry = coveredAngleRetry(collision(), route, 'corner')!;
    expect(retry).toBeDefined(); expect(retry.angles).toEqual(route.angles);
    expect(sourcePoint(retry.spawn).x).toBeLessThan(2);
    expect(retry.path.length).toBeGreaterThan(0);
    expect(coveredAngleRetry(collision(false), route, 'corner')).toBeUndefined();
    expect(coveredAngleRetry(collision(true), route, 'corner')).toBeUndefined();
    expect(coveredAngleRetry(collision(), route, 'unknown')).toBeUndefined();
    const unsupported = collision(); unsupported.fits = () => false;
    expect(coveredAngleRetry(unsupported, route, 'corner')).toBeUndefined();
  });
  it('persists stable angle diagnoses once, never route records or route advancement for retries', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value)});
    const session = new PrefireSession({scene: new THREE.Group(), collision: collision(), settle: sourcePoint, dispose() {}},
      sanitizePrefireConfig({routeId: 'test', routeGuide: false, population: 'all'}, ['test']),
      {id: 'test-map', name: 'Test', revision: '1', routes: [route, {...route, id: 'next'}], sources: []});
    expect(session.startAngleRetry(angleIdentity(route.angles[0]))).toBe(true);
    const sim = session.create(defaults, 4);
    vi.spyOn(sim.coach, 'review').mockReturnValue({...sim.coach.review(), angles: [review]});
    sim.phase = 'result'; sim.outcome = 'won';
    session.report(sim); session.report(sim);
    expect(loadPrefireHistory()).toHaveLength(0);
    expect(loadAngleDiagnoses()).toHaveLength(1);
    expect(loadAngleDiagnoses()[0]).toMatchObject({angleId: 'corner', scope: 'angle', routeId: 'test'});
    session.beforeRestart('won', true); expect(session.routeIndex).toBe(0);
    session.endAngleRetry();
    const normal = session.create(defaults, 5); normal.phase = 'result'; normal.outcome = 'won';
    session.report(normal); expect(loadPrefireHistory()).toHaveLength(1);
    session.beforeRestart('won', true); expect(session.routeIndex).toBe(1);
  });
});
