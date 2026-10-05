import {describe, expect, it, vi} from 'vitest';
import {duelArena, canFitInArena} from './geometry';
import {clearSegment, routeTo} from './navigation';
import {UNIT} from '../actor-physics';
import {observeBot} from './perception';
import {DuelSimulation} from './simulation';
import {arenaDesigns, seedForDesign, solidsOverlap} from './arena-layout';
import {coveredSpawns} from './spawns';
import {sanitizeDuelConfig} from './config';
import {arenaPOIs, environmentPOIs, footprintsOverlap, poiThemes} from './arena-pois';
import * as navigation from './navigation';
import * as rng from './rng';

describe('seeded modular cover', () => {
  it.each(arenaDesigns)('%s preserves its identity, five covered spawns, and new seeds every round', design => {
    const layouts = new Set<string>();
    for (let round = 0; round < 30; round++) {
      const seed = seedForDesign(1000 + round, design), arena = duelArena(seed);
      expect(arena.design).toBe(design);
      layouts.add(JSON.stringify(arena.solids));
      const spawns = coveredSpawns(arena, seed, 5);
      if (!spawns) throw new Error(`No covered spawns for ${design}, seed ${seed}`);
      expect(spawns.bots).toHaveLength(5);
      expect(canFitInArena(spawns.player, 0, 72 * UNIT, arena)).toBe(true);
      for (const bot of spawns.bots) expect(canFitInArena(bot, 0, 72 * UNIT, arena)).toBe(true);
    }
    expect(layouts.size).toBeGreaterThan(26);
    expect(sanitizeDuelConfig({mapDesign: design}).mapDesign).toBe(design);
  });
  it('defaults unknown designs to randomized layouts without changing a seed', () => {
    expect(sanitizeDuelConfig({mapDesign: 'forged'}).mapDesign).toBe('random');
    expect(seedForDesign(123, 'random')).toBe(123);
  });
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
        const overlap = solidsOverlap(x, y);
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

  it.each([.65, .7, .75, .85, 1, 1.25, 1.5])('validates hundreds of seeded authored maps at scale %s with full-size hulls', scale => {
    const seen = new Set<string>(), layouts = new Set<string>();
    for (let seed = 0; seed < 240; seed++) {
      const arena = duelArena(seed, scale);
      expect(arena.seed).toBe(seed);
      expect(duelArena(seed, scale)).toEqual(arena);
      expect(arena.maxX - arena.minX).toBeCloseTo(24 * scale);
      expect(arena.maxZ - arena.minZ).toBeCloseTo(32 * scale);
      expect(arena.pois).toHaveLength(scale < 1 ? 4 : 6);
      expect(arena.solids.length).toBeLessThanOrEqual(40);
      expect(arena.pois!.filter(p => environmentPOIs.some(template => template.id === p.templateId))).toHaveLength(2);
      expect(new Set(arena.solids.map(s => s.id)).size).toBe(arena.solids.length);
      layouts.add(JSON.stringify(arena.solids));
      const north = {x: 0, y: 64 * UNIT, z: -8 * scale}, south = {...north, z: 8 * scale};
      for (const p of [north, south]) expect(canFitInArena(p, 0, 72 * UNIT, arena)).toBe(true);
      const verifyRoute = (from: typeof north, to: typeof north) => {
        const route = routeTo(from, to, arena);
        expect(route.length, `seed ${seed} scale ${scale}: ${JSON.stringify(to)}`).toBeGreaterThan(0);
        let previous = from;
        for (const next of route) {
          expect(clearSegment(previous, next, arena)).toBe(true);
          expect(canFitInArena(next, 0, 72 * UNIT, arena)).toBe(true);
          previous = next;
        }
      };
      verifyRoute(north, south);
      for (const role of ['entry', 'flank', 'camp']) for (const side of [-1, 1])
        expect(arena.lanes!.some(l => l.role === role && l.side === side), `${role}, side ${side}`).toBe(true);
      for (const lane of arena.lanes!) {
        expect(clearSegment(lane.anchor, lane.edge, arena)).toBe(true);
        expect(clearSegment(lane.anchor, lane.retreat, arena)).toBe(true);
        verifyRoute(north, lane.anchor); verifyRoute(south, lane.anchor);
        for (const p of [lane.anchor, lane.edge, lane.retreat]) {
          expect(canFitInArena(p, 0, 72 * UNIT, arena)).toBe(true);
          // At least 1.2m-wide local clearance, including at compact scale.
          for (const solid of arena.solids) expect(
            Math.abs(p.x - solid.center.x) >= solid.size.x / 2 + .6 - 1e-8 ||
            Math.abs(p.z - solid.center.z) >= solid.size.z / 2 + .6 - 1e-8,
            `seed=${seed}, scale=${scale}, lane=${lane.role}, p=${JSON.stringify(p)}, solid=${JSON.stringify(solid)}`).toBe(true);
        }
      }
      for (const [index, poi] of arena.pois!.entries()) {
        seen.add(poi.templateId);
        const template = [...arenaPOIs, ...environmentPOIs].find(t => t.id === poi.templateId)!;
        expect(poi.theme).toBe(arena.poiTheme);
        expect(poi.reservation.minX).toBeGreaterThanOrEqual(arena.minX + .6 - 1e-8);
        expect(poi.reservation.maxX).toBeLessThanOrEqual(arena.maxX - .6 + 1e-8);
        expect(poi.reservation.minZ).toBeGreaterThanOrEqual(arena.minZ + .6 - 1e-8);
        expect(poi.reservation.maxZ).toBeLessThanOrEqual(arena.maxZ - .6 + 1e-8);
        expect(poi.solidIndices.map(i => arena.solids[i].size)).toEqual(template.parts.map(s => s.size));
        for (const other of arena.pois!.slice(index + 1)) expect(footprintsOverlap(poi.reservation, other.reservation)).toBe(false);
        const paired = arena.pois!.find(other => other.id !== poi.id && other.templateId === poi.templateId)!;
        expect(paired.center.x).toBe(poi.center.x); expect(paired.center.z).toBe(-poi.center.z);
      }
      for (const [index, a] of arena.solids.entries()) for (const b of arena.solids.slice(index + 1))
        expect(solidsOverlap(a, b)).toBe(false);
      const spawns = coveredSpawns(arena, seed, 5);
      expect(spawns, `covered spawns seed ${seed}, scale ${scale}`).toBeDefined();
      expect(spawns!.bots).toHaveLength(5);
      for (const [index, bot] of spawns!.bots.entries()) {
        expect(canFitInArena(bot, 0, 72 * UNIT, arena)).toBe(true);
        verifyRoute(bot, spawns!.player);
        for (const other of spawns!.bots.slice(index + 1))
          expect(Math.hypot(bot.x - other.x, bot.z - other.z)).toBeGreaterThan(32 * UNIT);
      }
    }
    expect(layouts.size).toBe(240);
    const expected = [...arenaPOIs.filter(p => scale >= 1 || p.spawnCover), ...environmentPOIs];
    expect(expected.filter(p => !seen.has(p.id)).map(p => p.id), 'Unplaced eligible templates').toEqual([]);
  }, 30000);

  it.each(poiThemes)('supports an optional %s POI theme without changing design or seed', theme => {
    const arena = duelArena(37, .65, theme);
    expect(arena.design).toBe(arenaDesigns[1]); expect(arena.seed).toBe(37);
    expect(arena.poiTheme).toBe(theme);
    expect(arena.pois!.every(p => p.theme === theme)).toBe(true);
  });

  it.each(poiThemes)('has a validated deterministic %s fallback after all randomized candidates fail', theme => {
    const originalRoute = navigation.routeTo;
    const campId = arenaPOIs.find(p => p.theme === theme && p.spawnCover)!.id;
    const constant = () => .99;
    vi.spyOn(rng, 'randomStream').mockImplementation(() => constant);
    const route = vi.spyOn(navigation, 'routeTo').mockImplementation((a, b, arena) =>
      arena.pois?.[0]?.templateId === campId ? originalRoute(a, b, arena) : []);
    try {
      for (const scale of [.65, .7, .75, .85, 1, 1.25, 1.5]) {
        const arena = duelArena(987654321, scale, theme);
        expect(arena.seed).toBe(987654321); expect(arena.poiTheme).toBe(theme);
        expect(arena.pois![0].templateId).toBe(campId);
        expect(arena.pois).toHaveLength(scale < 1 ? 4 : 6);
        expect(duelArena(987654321, scale, theme)).toEqual(arena);
        expect(coveredSpawns(arena, 123, 5)).toBeDefined();
      }
      expect(route).toHaveBeenCalled();
    } finally {vi.restoreAllMocks();}
  });

  it.each([.65, .7, .75, .85, 1, 1.25, 1.5])('starts five hidden bots and routes each spawn to both-side angles at scale %s', scale => {
    for (let seed = 0; seed < 30; seed++) {
      const arena = duelArena(seed, scale);
      const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 5, arenaScale: scale}), seed, arena);
      const [player, ...bots] = sim.snapshot();
      expect(bots).toHaveLength(5);
      expect(player.position).toEqual(coveredSpawns(arena, seed, 5)!.player);
      for (const bot of bots) {
        expect(observeBot(0, player, [bot], arena).visible).toBeNull();
        expect(observeBot(0, bot, [player], arena).visible).toBeNull();
        for (const lane of arena.lanes!) {
          const route = routeTo(bot.position, lane.anchor, arena);
          expect(route.length, `seed ${seed}: ${lane.role}, side ${lane.side}`).toBeGreaterThan(0);
          let previous = bot.position;
          for (const next of route) {expect(clearSegment(previous, next, arena)).toBe(true); previous = next;}
        }
      }
    }
  }, 30000);
});
