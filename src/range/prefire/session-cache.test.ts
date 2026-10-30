import {beforeEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {defaults} from '../config';
import {randomStream} from '../duel/rng';
import {createPrefireBotPlan} from './bot-behavior';
import {sanitizePrefireConfig} from './config';
import {choosePrefireAngles} from './occupancy';
import {PREFIRE_PLAN_CACHE_LIMIT, PrefireSimulation} from './session';
import {dust2Catalog, sourcePoint} from './routes';
import type {PrefireMap} from './map';
import type {NativeMapCollision} from './native-collision';
import type {PrefireRoute} from './schema';

vi.mock('./bot-behavior', async importOriginal => {
  const actual = await importOriginal<typeof import('./bot-behavior')>();
  return {...actual, createPrefireBotPlan: vi.fn(actual.createPrefireBotPlan)};
});

const fixture = () => {
  const angles = Array.from({length: 22}, (_, index) => ({id: `fixture/${index}`, name: `Fixture ${index}`,
    position: [index * 80, 500, 0] as const}));
  const route: PrefireRoute = {id: 'fixture', name: 'Fixture', spawn: [0, -500, 0], look: [0, -400, 0],
    path: [[0, -400, 0]], angles: angles.slice(0, 5), alternatives: angles.slice(5)};
  const map: PrefireMap = {scene: new THREE.Group(), dispose() {}, settle: sourcePoint,
    collision: {bounds: {minX: -68, maxX: 55, minZ: -95, maxZ: 36}, fits: () => true, ray: () => undefined,
      sweep: (_from: unknown, to: unknown) => ({position: to, fraction: 1, startSolid: false}),
      vertical: () => ({feet: 0, grounded: true, ceiling: false})} as unknown as NativeMapCollision};
  return {route, map};
};

beforeEach(() => vi.clearAllMocks());
describe('bounded selected-roster planning', () => {
  it('reserves only actual opponents, not all possible Weighted holds', () => {
    const {route, map} = fixture(), config = sanitizePrefireConfig({population: 'random', botsPerRun: 1, botBehavior: 'static'});
    const sim = new PrefireSimulation(map, config, route, 42, defaults, undefined, dust2Catalog);
    const planner = vi.mocked(createPrefireBotPlan);
    expect(planner).toHaveBeenCalledTimes(1);
    expect(planner.mock.calls[0][4]).toEqual([{x: sim.actors[1].position.x, y: sim.actors[1].feet, z: sim.actors[1].position.z}]);
    new PrefireSimulation(map, config, route, 42, defaults, undefined, dust2Catalog);
    expect(planner).toHaveBeenCalledTimes(1);
  });
  it('evicts old rosters instead of accumulating every random combination indefinitely', () => {
    const {route, map} = fixture(), config = sanitizePrefireConfig({population: 'random', botsPerRun: 1, botBehavior: 'static'});
    const first = choosePrefireAngles(route, 'random', randomStream(0, 'prefire-occupancy'), undefined, 1)[0].id!;
    const visited = new Set([first]);
    new PrefireSimulation(map, config, route, 0, defaults, undefined, dust2Catalog);
    let latest = 0;
    for (let seed = 1; visited.size <= PREFIRE_PLAN_CACHE_LIMIT && seed < 10000; seed++) {
      const id = choosePrefireAngles(route, 'random', randomStream(seed, 'prefire-occupancy'), undefined, 1)[0].id!;
      if (visited.has(id)) continue;
      visited.add(id); latest = seed;
      new PrefireSimulation(map, config, route, seed, defaults, undefined, dust2Catalog);
    }
    expect(visited.size).toBe(PREFIRE_PLAN_CACHE_LIMIT + 1);
    expect(createPrefireBotPlan).toHaveBeenCalledTimes(visited.size);
    new PrefireSimulation(map, config, route, latest, defaults, undefined, dust2Catalog);
    expect(createPrefireBotPlan).toHaveBeenCalledTimes(visited.size);
    new PrefireSimulation(map, config, route, 0, defaults, undefined, dust2Catalog);
    expect(createPrefireBotPlan).toHaveBeenCalledTimes(visited.size + 1);
  });
});
