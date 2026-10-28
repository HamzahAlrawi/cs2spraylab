import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {prefireAuthoringMaps, sha256File} from './prefire-map-adapters.mjs';

const mapId = process.argv.find(a => a.startsWith('--map='))?.slice(6) ?? 'de_dust2';
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? 'research/dust2/material-quality.json';
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let adapter;
try {
  adapter = await prefireAuthoringMaps.load(mapId, vite);
  const {prefireRouteQualityKey} = await vite.ssrLoadModule('/src/range/prefire/map-quality.ts');
  const {convexRayInterval} = await vite.ssrLoadModule('/src/range/prefire/native-solids.ts');
  const {resolveBulletRay} = await vite.ssrLoadModule('/src/range/duel/penetration.ts');
  const {equipmentStats} = await vite.ssrLoadModule('/src/range/equipment.ts');
  const axes = ['x', 'y', 'z'], solids = [], cases = [];
  const visit = node => {if (!node) return; if (node.items) solids.push(...node.items); else {visit(node.left); visit(node.right);}};
  // Offline structural audit only. This is the same immutable BVH queried by runtime bullets.
  visit(adapter.collision.solidTree);
  for (const family of ['wood', 'metal', 'concrete']) {
    const candidates = solids.filter(solid => adapter.collision.materialForSurface(solid.primitive.surfaceId)?.material === family).slice(0, 8);
    if (!candidates.length) throw new Error(`No validated ${family} source solids`);
    for (const solid of candidates) {
      const center = Object.fromEntries(axes.map(axis => [axis, (solid.min[axis] + solid.max[axis]) / 2]));
      for (let pass = 0; pass < 256; pass++) {
        let adjusted = false;
        for (const plane of solid.planes) {
          const violation = axes.reduce((n, axis) => n + plane.normal[axis] * center[axis], 0) - plane.bound + 1e-5;
          if (violation > 0) {for (const axis of axes) center[axis] -= plane.normal[axis] * violation; adjusted = true;}
        }
        if (!adjusted) break;
      }
      for (const axis of axes) {
        const length = solid.max[axis] - solid.min[axis] + 1;
        const origin = {...center, [axis]: center[axis] - length}, direction = {x: 0, y: 0, z: 0, [axis]: 1};
        const interval = convexRayInterval(solid, origin, direction);
        if (!interval || interval.entry <= 0) continue;
        const source = adapter.collision.traceSolid(origin, direction, length * 2).find(hit => hit.primitiveId === solid.primitive.id);
        if (!source?.validated || !source.surface || Math.abs(source.entry - interval.entry) > 1e-7 || Math.abs(source.exit - interval.exit) > 1e-7)
          throw new Error(`Runtime/source chord mismatch ${solid.primitive.id}/${axis}`);
        const end = {...center, [axis]: center[axis] + length}, reverse = {...direction, [axis]: -1};
        const back = adapter.collision.traceSolid(end, reverse, length * 2).find(hit => hit.primitiveId === solid.primitive.id);
        if (!back || Math.abs((back.exit - back.entry) - (source.exit - source.entry)) > 1e-6)
          throw new Error(`Reverse chord mismatch ${solid.primitive.id}/${axis}`);
        const ray = resolveBulletRay({origin, direction, range: length * 2, stats: equipmentStats('ak47'), actors: [],
          arena: {solids: [], native: {ray: () => undefined, traceSolid: () => [source]}}});
        if (!ray.surfaces.length || ray.surfaces[0].nativeSurface.hash !== source.surface.hash ||
          !Number.isFinite(ray.residualDamage) || ray.residualDamage < 0) throw new Error('Invalid material traversal');
        cases.push({primitiveId: solid.primitive.id, sourceSurface: source.surface.name, family, axis,
          thicknessUnits: (source.exit - source.entry) / .0254, stopped: ray.stopped,
          residualDamage: ray.residualDamage, contacts: ray.surfaces.map(contact => contact.phase)});
      }
    }
  }
  const dependencies = ['tools/audit-native-materials.mjs', 'tools/prefire-map-adapters.mjs',
    'src/range/prefire/native-collision.ts', 'src/range/prefire/native-solids.ts', 'src/range/prefire/native-surfaces.ts',
    'src/range/duel/penetration.ts', 'src/range/duel/native-surface-fixture.json',
    'public/revamp/maps/dust2/collision.json', 'public/revamp/maps/dust2/collision.bin'];
  const report = {schemaVersion: 1, build: adapter.build,
    routeKeys: Object.fromEntries(adapter.catalog.routes.map(route => [route.id, prefireRouteQualityKey(route)])),
    dependencySha256: Object.fromEntries(dependencies.map(file => [file, sha256File(file)])),
    checks: [{gate: 'materials', status: 'passed', cases: cases.length,
      note: 'Extracted source material identity and validated native convex chords, including reverse rays and finite shared penetration results. Open/unverified meshes remain opaque. Not a live-engine damage measurement.'}],
    surfaceDiagnostics: adapter.collision.surfaceDiagnostics, cases};
  fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, cases: cases.length, surfaceDiagnostics: report.surfaceDiagnostics}));
} finally {adapter?.collision.dispose(); await vite.close();}
