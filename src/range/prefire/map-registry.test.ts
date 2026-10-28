import {describe, expect, it} from 'vitest';
import {encounterFixture} from './encounter-test-data';
import {createPrefireMapRegistry} from './map-registry';
import {PREFIRE_MAP_GATES, prefireRouteQualityKey, validatePrefireMapQuality, type PrefireMapQuality} from './map-quality';

function fixture() {
  const {catalog: original, route, build} = encounterFixture(), catalog = {...original, encounters: undefined};
  const quality: PrefireMapQuality = {schemaVersion: 1, build, routeKeys: {[route.id]: prefireRouteQualityKey(route)},
    checks: PREFIRE_MAP_GATES.map(gate => ({gate, routeId: ['geometry', 'materials', 'evidence'].includes(gate) ? undefined : route.id,
      status: gate === 'evidence' ? 'authored-only' : 'passed', cases: gate === 'evidence' ? 0 : 1,
      reportSha256: gate === 'evidence' ? undefined : 'b'.repeat(64), note: 'Synthetic gate fixture; not native verification.'}))};
  return {catalog, build, quality, route};
}

describe('generic map admission and lazy adapter registry', () => {
  it('enumerates and loads independent next-map adapters without eager runtime imports', async () => {
    const pack = fixture(); let loads = 0, runtimeLoads = 0;
    const registry = createPrefireMapRegistry([{id: pack.catalog.id, name: pack.catalog.name,
      load: async () => {loads++; return {...pack, loadRuntime: async () => {runtimeLoads++; return 'geometry';}};}}]);
    expect(registry.list()).toEqual([{id: 'synthetic', name: 'Synthetic'}]); expect(loads).toBe(0);
    expect((await registry.activate('synthetic')).catalog).toBe(pack.catalog);
    expect(await registry.load('synthetic')).toBe(await registry.load('synthetic')); expect(loads).toBe(1); expect(runtimeLoads).toBe(0);
    expect(() => registry.register({id: 'synthetic', name: 'duplicate', load: async () => pack})).toThrow('Duplicate');
    await expect(registry.load('unknown')).rejects.toThrow('Unknown');
  });
  it('retries failed loads and rejects mismatched map/catalog/build identity', async () => {
    const pack = fixture(); let loads = 0;
    const registry = createPrefireMapRegistry([{id: 'synthetic', name: 'Synthetic', load: async () => {
      if (!loads++) throw new Error('unavailable'); return pack;
    }}]);
    await expect(registry.load('synthetic')).rejects.toThrow('unavailable');
    expect((await registry.load('synthetic')).build).toEqual(pack.build);
    const wrong = createPrefireMapRegistry([{id: 'other-map', name: 'Other', load: async () => pack}]);
    await expect(wrong.load('other-map')).rejects.toThrow('mismatch');
  });
  it('requires explicit pinned geometry, materials, routes, starts, cover, visibility, traversal and shot gates', () => {
    const {catalog, build, quality} = fixture();
    expect(validatePrefireMapQuality(catalog, build, quality)).toEqual([]);
    for (const gate of PREFIRE_MAP_GATES) {
      expect(validatePrefireMapQuality(catalog, build, {...quality, checks: quality.checks.filter(check => check.gate !== gate)}).join(' ')).toContain(gate);
      if (gate !== 'evidence') expect(validatePrefireMapQuality(catalog, build, {...quality,
        checks: quality.checks.map(check => check.gate === gate ? {...check, status: 'failed'} : check)}).join(' ')).toContain(gate);
    }
    expect(validatePrefireMapQuality(catalog, build, quality, 'contextual-evidence').join(' ')).toContain('No contextual');
    expect(validatePrefireMapQuality(catalog, {...build, gameBuild: 'new'}, quality).join(' ')).toContain('stale');
    expect(validatePrefireMapQuality(catalog, build, {...quality, checks: quality.checks.map(check => ({...check, reportSha256: undefined}))}).length).toBeGreaterThan(0);
  });
  it('invalidates starts, changed cover/stance, paths and lineups even at the same catalog revision', async () => {
    const {catalog, build, quality, route} = fixture();
    for (const changed of [{...route, spawn: [5, 0, 0] as const}, {...route, path: [[99, 0, 0] as const]},
      {...route, angles: route.angles.map(angle => ({...angle, crouched: true}))},
      {...route, lineups: [{id: 'new', name: 'New', angles: route.angles.slice(0, 2)}]}])
      expect(validatePrefireMapQuality({...catalog, routes: [changed]}, build, quality).join(' ')).toContain('Stale route');
    const registry = createPrefireMapRegistry([{id: catalog.id, name: catalog.name, load: async () => ({catalog, build})}]);
    await expect(registry.activate(catalog.id)).rejects.toThrow('quality gates');
  });
});
