import React from 'react';
import {createRoot} from 'react-dom/client';
import {Group} from 'three';
import PrefirePractice from '../src/range/prefire/PrefirePractice';
import {nativeMaps} from '../src/range/prefire/maps';
import {prefireMaps} from '../src/range/prefire/map-adapters';
import {PREFIRE_MAP_GATES, prefireRouteQualityKey} from '../src/range/prefire/map-quality';
import {defaults} from '../src/range/config';
import type {PrefireCatalog} from '../src/range/prefire/schema';
import type {PrefireMap} from '../src/range/prefire/map';
import {fixture} from './prefire-map-switch-state';

for (const [suffix, name, hash] of [['alpha', 'Alpha Range', 'a'], ['beta', 'Beta Range', 'b']]) {
  const id = `fixture_${suffix}`, revision = `${suffix}-revision`;
  const angles = [{id: 'shared-angle', name: 'Fixture hold', position: [0, 200, 0] as const}];
  const catalog: PrefireCatalog = {id, name, revision, sources: [], routes: [{id: 'shared-entry', name: 'Shared entry',
    spawn: [0, 0, 0], look: [0, 100, 0], path: [[0, 100, 0]], angles,
    lineups: [{id: 'shared-lineup', name: 'Shared lineup', angles}]}]};
  const summary = {id: 'shared-entry', name: 'Shared entry', lineups: [{id: 'shared-lineup', name: 'Shared lineup'}]};
  nativeMaps.register({id, name, revision, assetId: id, base: `/maps/${id}/`,
    chunks: [{id: 'shared-chunk', name: 'Fixture chunk', routeId: summary.id, mapId: id,
      sourceMin: [0, 0, 0], sourceMax: [100, 200, 100], contextPaddingUnits: 0}],
    index: {id, revision, routes: [summary], aliases: {}, approaches: {'shared-chunk': [summary]}},
    release: {version: 1, map: id, chunks: {}}, loadCatalog: async () => catalog,
  });
  const build = {mapId: id, catalogRevision: revision, gameBuild: `${suffix}-build`, geometrySha256: hash.repeat(64)};
  prefireMaps.register({id, name, load: async () => ({catalog: await nativeMaps.loadCatalog(id), build,
    // Test-only admission reports describe synthetic fixtures, never actual map fidelity.
    quality: {schemaVersion: 1, build, routeKeys: {[summary.id]: prefireRouteQualityKey(catalog.routes[0])},
      checks: PREFIRE_MAP_GATES.map(gate => ({gate, status: 'passed', cases: 1, reportSha256: hash.repeat(64),
        note: 'Synthetic browser fixture only', ...(!['geometry', 'materials', 'evidence'].includes(gate) ? {routeId: summary.id} : {})}))},
    loadRuntime: signal => new Promise<PrefireMap>((resolve, reject) => {
      fixture.requests.push({mapId: id, signal, resolve, reject, settled: false});
    }),
  })});
}

const control = {
  snapshot: () => ({requests: fixture.requests.map(({mapId, signal, settled}) => ({mapId, aborted: signal?.aborted, settled})),
    disposals: [...fixture.disposals], mounts: [...fixture.mounts]}),
  resolve(id: string) {
    const request = fixture.requests.find(row => row.mapId === id && !row.settled);
    if (!request) throw new Error(`No pending runtime for ${id}`);
    request.settled = true;
    const scene = new Group(); scene.userData.mapId = id;
    const suffix = id.slice('fixture_'.length);
    request.resolve({scene, collision: {bounds: {minX: -68, maxX: 55, minZ: -95, maxZ: 36},
      build: `${suffix}-build`, collisionSha256: (suffix === 'alpha' ? 'a' : 'b').repeat(64)},
      dispose() {fixture.disposals.push(id);}, settle() {return {x: 0, y: 0, z: 0};}} as PrefireMap);
  },
  reject(id: string, asError = false) {
    const request = fixture.requests.find(row => row.mapId === id && !row.settled);
    if (!request) throw new Error(`No pending runtime for ${id}`);
    request.settled = true; request.reject(asError ? new Error(`${id} fixture failure`) : 'fixture failure');
  },
};
declare global {interface Window {prefireMapSwitch: typeof control}}
window.prefireMapSwitch = control;
localStorage.setItem('spraylab.prefire.v1', JSON.stringify({mapId: 'fixture_alpha', routeId: 'shared-entry', lineupId: 'shared-lineup'}));
createRoot(document.getElementById('root')!).render(<PrefirePractice settings={defaults} openSettings={() => {}} onEnter={() => {}} suspended={false}/>);
