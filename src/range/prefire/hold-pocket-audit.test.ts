import {describe, expect, it} from 'vitest';
import {fitsHull, sweepHull, verticalContact} from '../actor-collision';
import {UNIT} from '../actor-physics';
import type {TerrainSolid} from '../terrain';
import type {NativeMapCollision} from './native-collision';
import {auditHoldPocket} from './hold-pocket-audit';

function map(solids: TerrainSolid[] = []): NativeMapCollision {
  return {fits: (p: any, feet: number, height: number) => fitsHull(p, feet, height, solids),
    sweep: (from: any, to: any, height: number) => sweepHull(from, to, height, solids),
    vertical: (p: any, from: number, to: number, height: number) => verticalContact(p, from, to, height, solids, 0),
    ray: () => undefined} as unknown as NativeMapCollision;
}

describe('offline local holding-pocket diagnostics', () => {
  it('accepts nearby supported open-ground feet in both hull heights', () => {
    expect(auditHoldPocket(map(), [-32,0,0], [32,0,0])).toBe('accepted-local');
    expect(auditHoldPocket(map(), [0,0,0], [0,0,0])).toBe('accepted-local');
  });
  it('rejects a thin movement-only wall even if shot rays are clear', () => {
    const wall = {center: {x: 0, y: 128 * UNIT, z: 0}, size: {x: 4 * UNIT, y: 256 * UNIT, z: 400 * UNIT}};
    expect(auditHoldPocket(map([wall]), [-32,0,0], [32,0,0])).toBe('blocked-corridor');
  });
  it('labels an embedded or stance-dependent centroid ambiguous, not an unused hold', () => {
    const wall = {center: {x: 0, y: 128 * UNIT, z: 0}, size: {x: 4 * UNIT, y: 256 * UNIT, z: 400 * UNIT}};
    expect(auditHoldPocket(map([wall]), [-32,0,0], [0,0,0])).toBe('ambiguous');
    const ceiling = {center: {x: 0, y: 70 * UNIT, z: 0}, size: {x: 200 * UNIT, y: 12 * UNIT, z: 200 * UNIT}};
    expect(auditHoldPocket(map([ceiling]), [-32,0,0], [32,0,0])).toBe('ambiguous');
  });
  it('does not merge floors, widen the neighborhood or accept nonfinite observations', () => {
    expect(auditHoldPocket(map(), [0,0,0], [0,0,128])).toBe('ambiguous');
    expect(auditHoldPocket(map(), [0,0,0], [97,0,0])).toBe('ambiguous');
    expect(auditHoldPocket(map(), [0,0,0], [NaN,0,0])).toBe('ambiguous');
  });
});
