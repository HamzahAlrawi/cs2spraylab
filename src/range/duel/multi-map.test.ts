import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Group} from 'three';
import {beforeAll, afterEach, describe, expect, it, vi} from 'vitest';
import {createNativeMapRegistry, nativeChunkKey, type NativeMapDefinition} from '../prefire/native-map-schema';
import {defaultNativeMapId, nativeMaps} from '../prefire/maps';
import type {PrefireCatalog} from '../prefire/schema';
import {loadNativeMap, type PrefireMap} from '../prefire/map';
import {fetchDeliveredAsset, type DeliveredAsset} from '../prefire/asset-delivery';
import {defaults} from '../config';
import {chunkContains, createRealMapArena, chooseRealMapChunk, loadRealMapChunk, RealMapSession} from './real-map';
import {localChunkManifest} from './map-manifests';
import {loadMapContext} from './map-context';
import {loadNativeRadar} from './native-radar-cache';
import {sanitizeDuelConfig} from './config';
import {exportManualLineups, importManualLineups, mergeManualLineups, validateManualLineup, type ManualLineup} from './manual-spawns';
import type {RoundCourse} from './real-map-rounds';

vi.mock('../prefire/map', () => ({loadNativeMap: vi.fn()}));
vi.mock('./map-context', () => ({loadMapContext: vi.fn()}));
vi.mock('./native-radar-cache', () => ({loadNativeRadar: vi.fn()}));
vi.mock('../prefire/asset-delivery', async original => ({...await original<typeof import('../prefire/asset-delivery')>(), fetchDeliveredAsset: vi.fn()}));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bodies = new Map<string, ArrayBuffer>();
function asset(assetId: string, value: unknown): DeliveredAsset {
  const bytes = new TextEncoder().encode(JSON.stringify(value)), sha256 = hash(new TextDecoder().decode(bytes));
  const url = `/maps/${assetId}/duel/objects/${sha256}.bin`;
  bodies.set(url, bytes.buffer);
  return {url, bytes: bytes.byteLength, sha256, decodedBytes: bytes.byteLength, decodedSha256: sha256, encoding: 'identity'};
}
function fixture(assetId: string) {
  const id = `de_${assetId.replace(/-/g, '_')}`, name = assetId.toUpperCase(), revision = 'fixture-v1';
  const chunk = {mapId: id, id: 'shared-chunk', name: `${name} chunk`, routeId: 'shared-route',
    sourceMin: [-1000, -1000, -100], sourceMax: [1000, 1000, 500], contextPaddingUnits: 100};
  const route = {id: 'shared-route', name: `${name} approach`, spawn: [0, 0, 0] as const,
    look: [0, 100, 64] as const, path: [[0, 100, 0] as const], angles: []};
  const catalog: PrefireCatalog = {id, name, revision, routes: [route], sources: []};
  const collisionSha256 = hash(id), watch = {x: 0, y: 1.6256, z: 0};
  const course: RoundCourse = {id: route.id, name: route.name, views: [watch, {...watch, z: -5}],
    walk: [{x: 0, y: 0, z: 0}, {x: 0, y: 0, z: -5}],
    holds: [0, 1, 2].map(index => {
      const p = {x: 2 + index * 2, y: 0, z: -8};
      return {source: p, sheltered: {...p}, angle: {id: `hold-${index}`, name: `${name} hold`, position: [p.x / .0254, -p.z / .0254, 0]},
        lane: {anchor: p, edge: {...p, x: p.x + .5}, retreat: p, watch, side: 1, axis: {x: 1, z: 0}, role: 'camp'}};
    }), starts: [{feet: {x: 0, y: 0, z: 0}, viewIndex: 0, holds: ['hold-0', 'hold-1', 'hold-2']}]};
  const navigation = asset(assetId, {version: 1, nodes: [{point: {x: 0, y: 0, z: 0}, links: []}]}),
    rounds = asset(assetId, {collisionSha256, courses: [course]});
  const delivery = asset(assetId, {version: 1, files: {'navigation.json': navigation, 'round-data.json': rounds}});
  const map: NativeMapDefinition = {id, name, assetId, revision, base: `/maps/${assetId}/`, chunks: [chunk],
    index: {id, revision, routes: [{id: route.id, name: route.name}], aliases: {}, approaches: {[chunk.id]: [{id: route.id, name: route.name}]}},
    release: {version: 1, map: assetId, chunks: {[chunk.id]: {version: 1, id: chunk.id, map: assetId, routeId: route.id,
      sourceMin: chunk.sourceMin, sourceMax: chunk.sourceMax, contextPaddingUnits: chunk.contextPaddingUnits,
      sourceCollisionSha256: hash('native-source-' + id), collisionManifestSha256: hash('manifest-' + id),
      visualManifestSha256: hash('visual-' + id), navigationSha256: navigation.sha256, delivery}}},
    loadCatalog: vi.fn(async () => catalog)};
  return {map, catalog, chunk, course, collisionSha256};
}
const a = fixture('fixture-a'), b = fixture('fixture-b');
beforeAll(() => {nativeMaps.register(a.map); nativeMaps.register(b.map);});
afterEach(() => {vi.unstubAllGlobals(); vi.clearAllMocks();});

describe('native map package boundaries', () => {
  it('keeps the shipped lightweight index aligned with its lazy route and lineup catalog', async () => {
    const map = nativeMaps.get(defaultNativeMapId), catalog = await nativeMaps.loadCatalog(map.id);
    const summary = (route: PrefireCatalog['routes'][number]) => ({id: route.id, name: route.name,
      ...(route.lineups ? {lineups: route.lineups.map(({id, name}) => ({id, name}))} : {})});
    expect(map.index.routes).toEqual(catalog.routes.map(summary));
    for (const chunk of map.chunks) expect(map.index.approaches[chunk.id]).toEqual(catalog.routes.filter(route =>
      [route.spawn, ...route.path].every(point => chunkContains(chunk, point))).map(summary));
  });
  it('loads catalogs lazily once per map and keeps equal route/chunk IDs isolated', async () => {
    const registry = createNativeMapRegistry([a.map, b.map]);
    vi.mocked(a.map.loadCatalog).mockClear(); vi.mocked(b.map.loadCatalog).mockClear();
    expect(registry.list().map(map => map.id)).toEqual([a.map.id, b.map.id]);
    expect(a.map.loadCatalog).not.toHaveBeenCalled();
    const [first, second, joined] = await Promise.all([registry.loadCatalog(a.map.id), registry.loadCatalog(b.map.id), registry.loadCatalog(a.map.id)]);
    expect(first).toBe(a.catalog); expect(second).toBe(b.catalog); expect(joined).toBe(first);
    expect(a.map.loadCatalog).toHaveBeenCalledOnce(); expect(b.map.loadCatalog).toHaveBeenCalledOnce();
    expect(nativeChunkKey(a.map, a.chunk)).not.toBe(nativeChunkKey(b.map, b.chunk));
    expect(() => nativeChunkKey(a.map, b.chunk)).toThrow('identity');
    expect(() => registry.get('de_missing')).toThrow('Unknown native map');
  });
  it('rejects a foreign catalog/revision or density layer without falling back to the default', async () => {
    for (const catalog of [a.catalog, {...b.catalog, revision: 'stale'}, {...b.catalog, density: {mapId: a.map.id}}]) {
      const registry = createNativeMapRegistry([{...b.map, loadCatalog: async () => catalog as PrefireCatalog}]);
      await expect(registry.loadCatalog(b.map.id)).rejects.toThrow('catalog/index mismatch');
    }
    expect(() => createNativeMapRegistry([a.map, a.map])).toThrow('duplicate');
    expect(() => createNativeMapRegistry([{...b.map, chunks: [a.chunk]}])).toThrow('native map');
  });
  it('selects and validates chunks/courses/manifests using the selected map only', () => {
    const config = sanitizeDuelConfig({mapId: b.map.id, realMapChunk: b.chunk.id, realMapCourse: 'shared-route'});
    expect(config).toMatchObject({mapId: b.map.id, realMapChunk: b.chunk.id, realMapCourse: 'shared-route'});
    expect(chooseRealMapChunk('random', 8, b.chunk.id, b.map.id)).toBe(b.chunk);
    expect(localChunkManifest(b.chunk.id, b.map).map).toBe(b.map.assetId);
    expect(localChunkManifest(a.chunk.id, a.map).sourceCollisionSha256).not.toBe(localChunkManifest(b.chunk.id, b.map).sourceCollisionSha256);
    expect(() => chooseRealMapChunk('dust2-mid-ct', 8, undefined, b.map.id)).toThrow('Unknown map chunk');
    expect(() => localChunkManifest('dust2-mid-ct', b.map)).toThrow('Unsupported map chunk');
  });
  it('rejects duplicate full-catalog routes that would hide a missing indexed route', async () => {
    const summary = {id: 'second-route', name: 'Second route'};
    const map = {...b.map, index: {...b.map.index, routes: [...b.map.index.routes, summary]},
      loadCatalog: async () => ({...b.catalog, routes: [b.catalog.routes[0], b.catalog.routes[0]]})};
    await expect(createNativeMapRegistry([map]).loadCatalog(map.id)).rejects.toThrow('catalog/index mismatch');
  });
  it('keeps manual lineups with identical IDs separate and binds legacy saves to their original map', () => {
    const lineup = (input: typeof a): ManualLineup => ({mapId: input.map.id, chunkId: input.chunk.id, collisionSha256: input.collisionSha256,
      id: 'same-lineup', name: input.map.name, allowImmediateSight: false,
      entry: {id: 'entry', name: 'Entry', feet: {x: 0, y: 0, z: 0}, yaw: 0, pitch: 0},
      bots: [{id: 'bot', name: 'Bot', feet: {x: 0, y: 0, z: -5}, yaw: Math.PI, pitch: 0}]});
    const first = lineup(a), second = lineup(b), merged = mergeManualLineups([first], [second]);
    expect(importManualLineups(exportManualLineups(merged))).toEqual([first, second]);
    expect(sanitizeDuelConfig({mapId: b.map.id, realMapChunk: b.chunk.id, manualLineup: first}).manualLineup).toBeNull();
    expect(sanitizeDuelConfig({mapId: b.map.id, realMapChunk: b.chunk.id, manualLineup: second}).manualLineup).toEqual(second);
    const collision = {collisionSha256: a.collisionSha256} as Parameters<typeof validateManualLineup>[2];
    expect(validateManualLineup({...second, collisionSha256: a.collisionSha256}, first, collision).errors.join(' ')).toContain('different chunk');
    expect(sanitizeDuelConfig({realMapChunk: 'dust2-mid-ct'}).mapId).toBe(defaultNativeMapId);
  });
  it('loads and creates real-map Duel sessions for two packages without using Dust 2 catalogs or paths', async () => {
    vi.stubGlobal('navigator', {deviceMemory: 4, hardwareConcurrency: 4});
    const records = new Map<string, PrefireMap>();
    vi.mocked(fetchDeliveredAsset).mockImplementation(async descriptor => {
      const value = bodies.get(descriptor.url); if (!value) throw Error('Unexpected resource: ' + descriptor.url);
      return value.slice(0);
    });
    vi.mocked(loadNativeMap).mockImplementation(async (_signal, options) => {
      const f = options.base.startsWith(a.map.base) ? a : options.base.startsWith(b.map.base) ? b : undefined;
      if (!f) throw Error('Unexpected map base: ' + options.base);
      const collision = {collisionSha256: f.collisionSha256, fits: () => true,
        vertical: () => ({feet: 0, grounded: true}), ray: () => undefined, sweep: () => undefined};
      const map = {scene: new Group(), collision, settle: () => ({x: 0, y: 0, z: 0}), dispose: vi.fn()} as unknown as PrefireMap;
      records.set(f.map.id, map); return map;
    });
    const signal = new AbortController().signal;
    const sessions = await Promise.all([a, b].map(f => RealMapSession.load(sanitizeDuelConfig({mapId: f.map.id,
      realMapChunk: f.chunk.id, botCount: 1, utilitiesEnabled: false}), 4, signal)));
    try {
      for (const [index, f] of [a, b].entries()) {
        const session = sessions[index], sim = session.create(defaults, 4);
        expect(session.mapId).toBe(f.map.id); expect(session.spawnContext().mapId).toBe(f.map.id);
        expect(sim.config.mapId).toBe(f.map.id); expect(sim.arena.design).toBe(f.chunk.name);
        expect(sim.arena.roundSetup?.course).toBe('shared-route');
        expect(() => session.configureDuel(sanitizeDuelConfig({mapId: index ? a.map.id : b.map.id}))).toThrow('new native-map session');
        expect(await session.prepareRound(5, signal)).toBe(false);
      }
      expect(loadNativeMap).toHaveBeenCalledTimes(2);
      expect(vi.mocked(loadNativeMap).mock.calls.map(call => call[1].base)).toEqual([`${a.map.base}duel/shared-chunk/`, `${b.map.base}duel/shared-chunk/`]);
      expect(() => createRealMapArena(records.get(a.map.id)!, b.chunk, sanitizeDuelConfig({mapId: b.map.id}), 1,
        {collisionSha256: a.collisionSha256, courses: [a.course]}, a.catalog)).toThrow('do not match');
      await expect(loadRealMapChunk({...a.chunk, mapId: 'de_missing'}, signal)).rejects.toThrow('Unknown native map');
    } finally {sessions.forEach(session => session.dispose());}
    for (const map of records.values()) expect(map.dispose).toHaveBeenCalledOnce();
  });
  it('keeps generic consumers free from direct map files and eager route data', () => {
    for (const file of ['duel/config.ts', 'duel/DuelSetup.tsx', 'duel/real-map.ts', 'duel/real-map-rounds.ts',
      'duel/manual-spawns.ts', 'duel/map-manifests.ts', 'prefire/placement.ts', 'prefire/bot-behavior.ts']) {
      const source = readFileSync(`src/range/${file}`, 'utf8');
      expect(source, file).not.toMatch(/from ['"].*(?:real-map-catalog\.json|prefire\/routes|\.\/routes|map-manifests\.json)['"]/);
      expect(source, file).not.toMatch(/\/maps\/dust2\/|dust2Catalog|loadDust2/);
    }
  });
  it('releases context and radar leases when a lazy catalog fails after geometry loads', async () => {
    const f = fixture('fixture-failed-catalog');
    f.map.release.context = {version: 1, map: f.map.assetId, visualOnly: true,
      delivery: asset(f.map.assetId, {}), sha256: hash('context')};
    f.map.radar = {...nativeMaps.get(defaultNativeMapId).radar!, map: f.map.assetId};
    f.map.loadCatalog = async () => {throw new Error('Catalog unavailable');};
    nativeMaps.register(f.map);
    const context = {root: new Group(), attach: vi.fn(), dispose: vi.fn()};
    const radar = {overview: {} as Awaited<ReturnType<typeof loadNativeRadar>>['overview'], dispose: vi.fn()};
    vi.mocked(loadMapContext).mockResolvedValue(context);
    vi.mocked(loadNativeRadar).mockResolvedValue(radar);
    vi.mocked(fetchDeliveredAsset).mockImplementation(async descriptor => bodies.get(descriptor.url)!.slice(0));
    const map = {scene: new Group(), collision: {collisionSha256: f.collisionSha256}, dispose: vi.fn()} as unknown as PrefireMap;
    const dispose = map.dispose;
    vi.mocked(loadNativeMap).mockResolvedValue(map);
    await expect(loadRealMapChunk(f.chunk, new AbortController().signal)).rejects.toThrow('Catalog unavailable');
    expect(context.dispose).toHaveBeenCalledOnce();
    expect(radar.dispose).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
