import {describe, expect, it} from 'vitest';
import {duelArena, canFitInArena} from './geometry';
import {clearSegment, routeTo} from './navigation';
import {UNIT} from '../actor-physics';

describe('seeded modular cover', () => {
  it('produces varied, nonintersecting cover with connected spawns and reachable pockets', () => {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const arena = duelArena(seed);
      layouts.add(JSON.stringify(arena.solids));
      expect(duelArena(seed)).toEqual(arena);
      const north = {x: 0, y: 1.6256, z: -8}, south = {...north, z: 8};
      expect(canFitInArena(north, 0, 72 * UNIT, arena)).toBe(true);
      expect(canFitInArena(south, 0, 72 * UNIT, arena)).toBe(true);
      expect(routeTo(north, south, arena).length).toBeGreaterThan(0);
      for (const lane of arena.lanes!) {
        expect(clearSegment(lane.anchor, lane.edge, arena)).toBe(true);
        expect(clearSegment(lane.anchor, lane.retreat, arena)).toBe(true);
        expect(routeTo(north, lane.anchor, arena).length).toBeGreaterThan(0);
        expect(routeTo(south, lane.anchor, arena).length).toBeGreaterThan(0);
      }
      for (let a = 0; a < arena.solids.length; a++) for (let b = a + 1; b < arena.solids.length; b++) {
        const x = arena.solids[a], y = arena.solids[b];
        const overlap = Math.abs(x.center.x - y.center.x) < (x.size.x + y.size.x) / 2 &&
          Math.abs(x.center.z - y.center.z) < (x.size.z + y.size.z) / 2;
        expect(overlap, `intersecting props at seed ${seed}`).toBe(false);
      }
    }
    expect(layouts.size).toBeGreaterThan(90);
  });

  it('can route away from a wall after collision enters the navigation safety margin', () => {
    const arena = duelArena(4), wall = arena.solids[0];
    const start = {x: 0, y: 1.6, z: -wall.size.z / 2 - 16 * UNIT - .00001};
    expect(routeTo(start, {x: 0, y: 1.6, z: -8}, arena).length).toBeGreaterThan(0);
    expect(clearSegment(start, {...start, z: 8}, arena)).toBe(false);
  });

  it.each([1.25, 1.5])('expands the arena to %s without enlarging actors or cover and preserves reachable lanes', scale => {
    for (let seed = 0; seed < 25; seed++) {
      const base = duelArena(seed), arena = duelArena(seed, scale);
      expect(arena.maxX - arena.minX).toBeCloseTo(24 * scale);
      expect(arena.maxZ - arena.minZ).toBeCloseTo(32 * scale);
      expect(arena.solids.map(s => s.size)).toEqual(base.solids.map(s => s.size));
      const north = {x: 0, y: 1.6256, z: -8 * scale}, south = {...north, z: 8 * scale};
      expect(canFitInArena(north, 0, 72 * UNIT, arena)).toBe(true);
      expect(canFitInArena(south, 0, 72 * UNIT, arena)).toBe(true);
      expect(routeTo(north, south, arena).length).toBeGreaterThan(0);
      for (const lane of arena.lanes!) {
        expect(clearSegment(lane.anchor, lane.edge, arena)).toBe(true);
        expect(routeTo(south, lane.anchor, arena).length).toBeGreaterThan(0);
      }
    }
  });
});
