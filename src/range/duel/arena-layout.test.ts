import {describe, expect, it, vi} from 'vitest';
import {duelArena, canFitInArena, traceSolid} from './geometry';
import {clearSegment, routeTo} from './navigation';
import {UNIT} from '../actor-physics';
import {observeBot} from './perception';
import {DuelSimulation} from './simulation';
import {ARENA_ATTEMPTS, ARENA_SOLID_BUDGET, arenaDesigns, createArena, seedForDesign, solidsOverlap} from './arena-layout';
import {coveredSpawns} from './spawns';
import {sanitizeDuelConfig} from './config';
import {arenaPOIs, environmentPOIs, footprintOf, footprintsOverlap, poiThemes} from './arena-pois';
import * as navigation from './navigation';
import * as rng from './rng';

describe('seeded modular cover', () => {
  it.each([.65, 1, 1.5])('preserves two independent midfield routes and real covered entry angles at scale %s', scale => {
    for (let seed = 0; seed < 30; seed++) {
      const arena = createArena(seed, {scale}), f = footprintOf(arena.solids.filter(s => !s.poiId));
      const point = (x: number, z: number) => ({x, y: 0, z});
      const routes = ([-1, 1] as const).map(side => {
        const x = side < 0 ? f.minX - .8 : f.maxX + .8;
        return [point(0, -8 * scale), point(0, f.minZ - .95), point(x, f.minZ - .95),
          point(x, f.maxZ + .95), point(0, f.maxZ + .95), point(0, 8 * scale)];
      });
      const dryArena = {...arena, solids: [...arena.solids, ...arena.traversalVolumes!.filter(v => v.kind === 'water').map(v => ({
        center: {...v.center, y: 1}, size: {...v.size, y: 2}, kind: 'concrete' as const}))]};
      for (const [index, route] of routes.entries()) {
        for (const [n, p] of route.slice(1).entries()) expect(clearSegment(route[n], p, dryArena), `seed ${seed}, route ${index}`).toBe(true);
        const closed = {...arena, solids: [...arena.solids, {center: point(route[2].x, (f.minZ + f.maxZ) / 2), size: {x: 1.2, y: 3, z: .6}}]};
        expect(clearSegment(route[2], route[3], closed)).toBe(false);
        const alternative = routes[1 - index];
        expect(alternative.slice(1).every((p, n) => clearSegment(alternative[n], p, closed))).toBe(true);
      }
      for (const lane of arena.lanes!.filter(l => l.role === 'entry')) {
        const height = 64 * UNIT, distance = f.maxZ - lane.anchor.z + .95;
        expect(traceSolid({...lane.anchor, y: height}, {x: 0, y: 0, z: 1}, arena, distance).distance).toBeLessThan(distance);
        expect(traceSolid({...lane.edge, y: height}, {x: 0, y: 0, z: 1}, arena, distance).distance).toBe(Infinity);
      }
    }
  });

  it.each([.65, .99, 1, 1.5])('ties every POI to a usable approach, inward traversal, or protected compound at scale %s', scale => {
    for (let seed = 0; seed < 36; seed++) {
      const arena = createArena(seed, {scale});
      for (const hemisphere of [-1, 1]) {
        const compound = arena.pois!.find(p => p.placement?.role === 'spawn-compound' && p.placement.hemisphere === hemisphere)!;
        const traversal = arena.pois!.find(p => p.placement?.role === 'lane-traversal' && p.placement.hemisphere === hemisphere)!;
        expect(compound).toBeDefined(); expect(traversal).toBeDefined();
        expect(traversal.placement!.side).toBe(-compound.placement!.side);
        const wall = arena.solids[compound.solidIndices[0]];
        for (const x of [-.85, 0, .85]) for (const back of [1, 2]) {
          const spawn = {x: wall.center.x + x, y: 64 * UNIT, z: wall.center.z + hemisphere * (wall.size.z / 2 + back)};
          expect(canFitInArena(spawn, 0, 72 * UNIT, arena), `blocked compound spawn seed ${seed}`).toBe(true);
          expect(routeTo(spawn, compound.placement!.approach, arena).length).toBeGreaterThan(0);
        }
      }
      for (const poi of arena.pois!) {
        const placement = poi.placement!;
        expect(placement).toBeDefined();
        expect(arena.solids.some(s => s.id === placement.landmarkId && !s.poiId)).toBe(true);
        expect(poi.mirrorZ).toBe(placement.hemisphere);
        expect(placement.side * poi.center.x).toBeGreaterThan(0);
        expect(placement.approach.x).toBeCloseTo(placement.side < 0 ? poi.footprint.maxX + .75 : poi.footprint.minX - .75);
        for (const z of [-8 * scale, 8 * scale]) expect(routeTo({x: 0, y: 0, z}, placement.approach, arena).length).toBeGreaterThan(0);
        if (placement.role === 'compound-support') {
          const parent = arena.pois!.find(p => p.id === placement.parentId)!;
          expect(parent.placement!.role).toBe('spawn-compound');
          expect(poi.footprint.maxZ).toBeLessThan(parent.center.z - 3);
          const lane = arena.lanes!.find(l => l.role === 'offAngle' && l.anchor === placement.approach)!;
          expect(lane).toBeDefined();
          const cover = poi.solidIndices.map(i => arena.solids[i]).reduce((best, s) => s.size.y > best.size.y ? s : best);
          const height = Math.min(64 * UNIT, cover.size.y - .1);
          const distance = poi.footprint.maxX - poi.footprint.minX + 1.5;
          expect(traceSolid({...lane.anchor, y: height}, {x: placement.side, y: 0, z: 0}, arena, distance).distance).toBeLessThan(distance);
          expect(traceSolid({...lane.edge, y: height}, {x: placement.side, y: 0, z: 0}, arena, distance).distance).toBe(Infinity);
        } else expect(placement.parentId).toBeUndefined();
        if (placement.role === 'lane-traversal') for (const link of arena.traversalLinks!.filter(l => l.poiId === poi.id)) {
          if (link.kind === 'stairs' || link.kind === 'ramp' || link.kind === 'ladder')
            expect(placement.hemisphere * (link.to.z - link.from.z)).toBeGreaterThan(0);
        }
      }
    }
  });

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
    },30000);

  it('can route away from a wall after collision enters the navigation safety margin', () => {
    const arena = duelArena(4), wall = arena.solids[0];
    const start = {x: wall.center.x, y: 1.6, z: wall.center.z - wall.size.z / 2 - 16 * UNIT - .00001};
    expect(routeTo(start, {x: 0, y: 1.6, z: -8}, arena).length).toBeGreaterThan(0);
    expect(clearSegment(start, {...start, z: 8}, arena)).toBe(false);
  });

  it.each([1.25, 1.5])('expands the arena to %s without enlarging actors or cover and preserves reachable lanes', scale => {
    for (let seed = 0; seed < 25; seed++) {
      const arena = duelArena(seed, scale);
      expect(arena.maxX - arena.minX).toBeCloseTo(24 * scale);
      expect(arena.maxZ - arena.minZ).toBeCloseTo(32 * scale);
      for (const poi of arena.pois!) {
        const template = [...arenaPOIs, ...environmentPOIs].find(t => t.id === poi.templateId)!;
        expect(poi.solidIndices.map(index => arena.solids[index].size)).toEqual(template.parts.map(s => s.size));
      }
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
    const seen = new Set<string>(), layouts = new Set<string>(), topologies = new Set<string>(), counts = new Set<number>();
    const screens = new Set<string>(), environmentCounts = new Set<number>();
    let asymmetric = 0, independentEnvironments = 0;
    for (let seed = 0; seed < 240; seed++) {
      const arena = duelArena(seed, scale);
      expect(arena.seed).toBe(seed);
      expect(duelArena(seed, scale)).toEqual(arena);
      expect(arena.maxX - arena.minX).toBeCloseTo(24 * scale);
      expect(arena.maxZ - arena.minZ).toBeCloseTo(32 * scale);
      expect(arena.pois!.length).toBeGreaterThanOrEqual(scale < 1 ? 4 : 6);
      expect(arena.pois!.length).toBeLessThanOrEqual(10);
      expect(arena.solids.length).toBeLessThanOrEqual(ARENA_SOLID_BUDGET);
      const environment = arena.pois!.filter(p => environmentPOIs.some(template => template.id === p.templateId));
      expect(environment.length).toBeGreaterThanOrEqual(2);
      environmentCounts.add(environment.length); counts.add(arena.pois!.length);
      if (environment.some(p => p.center.z < 0 && !environment.some(other => other.center.z > 0 && other.templateId === p.templateId))) independentEnvironments++;
      if (arena.pois!.some(p => !arena.pois!.some(other => other !== p && other.templateId === p.templateId &&
        Math.abs(other.center.x - p.center.x) < .1 && Math.abs(other.center.z + p.center.z) < .1))) asymmetric++;
      screens.add(arena.solids.filter(s => !s.poiId).map(s => s.id).join(','));
      topologies.add(JSON.stringify(arena.pois!.map(p => [p.templateId, Math.round(p.center.x / 2), Math.round(p.center.z / 2), p.mirrorX])));
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
      }
      for (const link of arena.traversalLinks!) for (const approach of [link.from, link.to, ...(link.boost ? [link.boost.dismount] : [])]) {
        if (approach.y !== 0) continue;
        expect(canFitInArena(approach, 0, 72 * UNIT, arena)).toBe(true);
        verifyRoute(north, approach); verifyRoute(south, approach);
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
    expect(topologies.size).toBeGreaterThan(200);
    expect(asymmetric).toBeGreaterThan(220);
    expect(independentEnvironments).toBeGreaterThan(100);
    expect(screens.size).toBeGreaterThanOrEqual(4);
    expect(counts.size).toBeGreaterThanOrEqual(2);
    if (scale >= 1) expect(environmentCounts.size).toBeGreaterThanOrEqual(2);
    for (const theme of poiThemes) {
      // Compact compounds favor fitting purposeful support sockets over catalog coverage.
      expect(arenaPOIs.filter(p => p.theme === theme && seen.has(p.id)).length).toBeGreaterThanOrEqual(scale < 1 ? 4 : 5);
      expect(environmentPOIs.filter(p => p.theme === theme && seen.has(p.id)).length).toBeGreaterThanOrEqual(3);
    }
  }, 60000);

  it.each(poiThemes)('supports an optional %s POI theme without changing design or seed', theme => {
    for (const scale of [.65, .73, .99, 1, 1.01, 1.37, 1.5]) for (let sample = 0; sample < 12; sample++) {
      const seed = 37 + sample * 6000000, arena = duelArena(seed, scale, theme);
      expect(arena.design).toBe(arenaDesigns[1]); expect(arena.seed).toBe(seed);
      expect(arena.poiTheme).toBe(theme);
      expect(arena.pois!.every(p => p.theme === theme)).toBe(true);
      expect(duelArena(seed, scale, theme)).toEqual(arena);
      expect(coveredSpawns(arena, seed, 5)).toBeDefined();
      for (const role of ['entry', 'flank', 'camp']) for (const side of [-1, 1])
        expect(arena.lanes!.some(l => l.role === role && l.side === side)).toBe(true);
    }
  },30000);

  it.each(poiThemes)('has a validated deterministic %s fallback after all randomized candidates fail', theme => {
    const originalRoute = navigation.routeTo;
    const campId = arenaPOIs.find(p => p.theme === theme && p.spawnCover)!.id;
    const constant = () => .99;
    vi.spyOn(rng, 'randomStream').mockImplementation(() => constant);
    const route = vi.spyOn(navigation, 'routeTo').mockImplementation((a, b, arena) =>
      arena.pois?.[0]?.templateId === campId ? originalRoute(a, b, arena) : []);
    try {
      for (const scale of [.65, .7, .75, .85, .99, 1, 1.01, 1.25, 1.5]) {
        const arena = duelArena(987654321, scale, theme);
        expect(arena.seed).toBe(987654321); expect(arena.poiTheme).toBe(theme);
        expect(arena.pois![0].templateId).toBe(campId);
        expect(arena.pois!.length).toBeGreaterThanOrEqual(scale < 1 ? 4 : 6);
        expect(duelArena(987654321, scale, theme)).toEqual(arena);
        expect(coveredSpawns(arena, 123, 5)).toBeDefined();
      }
      expect(route).toHaveBeenCalled();
    } finally {vi.restoreAllMocks();}
  });

  it('caps randomized generation and uses the safe plan when every candidate is rejected', () => {
    const originalRoute = navigation.routeTo, stream = vi.spyOn(rng, 'randomStream');
    vi.spyOn(navigation, 'routeTo').mockImplementation((a, b, arena) =>
      arena.pois?.[0]?.id === 'poi-0--1' ? originalRoute(a, b, arena) : []);
    try {
      const arena = createArena(2718);
      expect(stream.mock.calls.filter(([, label]) => label.startsWith('diverse-pois-'))).toHaveLength(ARENA_ATTEMPTS);
      expect(coveredSpawns(arena, 2718, 5)).toBeDefined();
    } finally {vi.restoreAllMocks();}
  });

  it('keeps negative seeds deterministic and clamps options without resizing authored cover', () => {
    for (const seed of [-1, -987654321, 2147483647]) {
      expect(createArena(seed)).toEqual(createArena(seed));
      expect(createArena(seed, {scale: .1})).toEqual(createArena(seed, {scale: .65}));
      expect(createArena(seed, {scale: 9})).toEqual(createArena(seed, {scale: 1.5}));
    }
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
