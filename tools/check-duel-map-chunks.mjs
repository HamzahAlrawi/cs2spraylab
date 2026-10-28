// Independent native-kernel equivalence checks at route/spawn/hold positions.
// Usage: node tools/check-duel-map-chunks.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {sha256} from './build-duel-map-chunks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/range/duel/real-map-catalog.json')));
const vite = await createServer({root, server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
const toArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const near = (a, b, context, tolerance = 2e-4) => assert.ok(Math.abs(a - b) < tolerance, `${context}: ${a} != ${b}`);
const inside = (p, bounds, margin = 0) => ['x', 'y', 'z'].every((axis, i) => p[axis] >= bounds.min[i] + margin && p[axis] <= bounds.max[i] - margin);
function exactPrimitiveAudit(sourceDirectory, subsetDirectory) {
  const decode = directory => {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'collision.json'))), bytes = fs.readFileSync(path.join(directory, 'collision.bin'));
    return {manifest, groups: manifest.groups.map(group => ({...group,
      positions: new Float32Array(bytes.buffer, bytes.byteOffset + group.offset, group.vertexCount * 3),
      indices: new Uint32Array(bytes.buffer, bytes.byteOffset + group.offset + group.vertexCount * 12, group.indexCount)}))};
  };
  const full = decode(sourceDirectory), subset = decode(subsetDirectory); let auditedTriangles = 0, completeHulls = 0;
  assert.deepEqual(subset.manifest.surfaces, full.manifest.surfaces);
  for (const group of subset.groups) {
    const original = full.groups.find(candidate => candidate.id === group.id); assert.ok(original);
    for (const flag of ['movement', 'shots', 'tags', 'excludes']) assert.deepEqual(group[flag], original[flag]);
    const primitives = new Map(original.primitives.map(primitive => [primitive.id, primitive]));
    for (const primitive of group.primitives) {
      const source = primitives.get(primitive.id); assert.ok(source); assert.equal(primitive.kind, source.kind); assert.equal(primitive.surfaceId, source.surfaceId);
      if (primitive.kind === 'convex-hull') {assert.equal(primitive.triangleCount, source.triangleCount); completeHulls++;}
      let cursor = source.firstTriangle;
      for (let offset = 0; offset < primitive.triangleCount; offset++) {
        const outputTriangle = primitive.firstTriangle + offset;
        const matches = candidate => {
          for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 3; axis++) {
            if (!Object.is(group.positions[group.indices[outputTriangle * 3 + corner] * 3 + axis], original.positions[original.indices[candidate * 3 + corner] * 3 + axis])) return false;
          }
          return true;
        };
        while (cursor < source.firstTriangle + source.triangleCount && !matches(cursor)) cursor++;
        assert.ok(cursor < source.firstTriangle + source.triangleCount, 'Generated triangle must match exact source floats and winding');
        assert.equal(primitive.triangleSurfaces?.[offset] ?? primitive.surfaceId, source.triangleSurfaces?.[cursor - source.firstTriangle] ?? source.surfaceId);
        cursor++; auditedTriangles++;
      }
    }
  }
  return {auditedTriangles, completeHulls};
}
let full, subset;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {prefireRoutes, sourcePoint} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const load = async directory => {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'collision.json'))), bytes = fs.readFileSync(path.join(directory, 'collision.bin'));
    assert.equal(sha256(bytes), manifest.collisionSha256);
    const preparedPath=path.join(directory,'query-cache.json');
    const prepared=fs.existsSync(preparedPath)?{metadata:JSON.parse(fs.readFileSync(preparedPath))}:undefined;
    const snapshots=process.argv.includes('--snapshots');
    const original=await NativeMapCollision.create(manifest,toArrayBuffer(bytes),snapshots?undefined:prepared);
    if(!process.argv.includes('--snapshots')||!prepared)return original;
    try {
      // The browser worker generates this same snapshot from checked source
      // floats. Compare the owning-thread restore, not only rebuilt indexes.
      const exported=original.exportPrepared();
      return await NativeMapCollision.create(manifest,toArrayBuffer(bytes),{metadata:{...prepared.metadata,
        ids:exported.metadata.ids,open:exported.metadata.open},
        snapshot:exported.snapshot.slice().buffer});
    }finally{original.dispose();}
  };
  full = await load(path.join(root, 'public/revamp/maps/dust2'));
  const reports = [];
  for (const chunk of catalog.chunks) {
    const directory = path.join(root, 'public/revamp/maps/dust2/duel', chunk.id), metadata = JSON.parse(fs.readFileSync(path.join(directory, 'chunk.json')));
    const exact = exactPrimitiveAudit(path.join(root, 'public/revamp/maps/dust2'), directory);
    assert.equal(metadata.collisionManifestSha256, sha256(fs.readFileSync(path.join(directory, 'collision.json'))));
    assert.equal(metadata.visualManifestSha256, sha256(fs.readFileSync(path.join(directory, 'visual.json'))));
    subset = await load(directory);
    const route = prefireRoutes.find(route => route.id === chunk.routeId); assert.ok(route, 'Missing chunk route');
    const holds = [...route.angles, ...(route.alternatives ?? []), ...(route.lineups ?? []).flatMap(lineup => lineup.angles)];
    const points = [...new Map([route.spawn, ...route.path, ...holds.map(angle => angle.position)]
      .map(p => sourcePoint(p)).filter(p => inside(p, metadata.bounds, .01)).map(p => [JSON.stringify(p), p])).values()];
    assert.ok(points.length >= 10, `${chunk.id} has too few native route/hold fixtures`);
    let checks = 0, rays = 0, sweeps = 0, maxSweepDeltaMetres = 0;
    for (const p of points) {
      for (const height of [54 * .0254, 72 * .0254]) {
        const expected = full.vertical(p, p.y + .2, p.y - .2, height), actual = subset.vertical(p, p.y + .2, p.y - .2, height);
        assert.equal(actual.grounded, expected.grounded, `${chunk.id}: support ${JSON.stringify(p)}`);
        near(actual.feet, expected.feet, `${chunk.id}: floor`);
        assert.equal(subset.fits(p, expected.feet, height), full.fits(p, expected.feet, height), `${chunk.id}: actor hull`);
        for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
          const to = {...p, y: expected.feet, [axis]: p[axis] + sign * .25}, from = {...p, y: expected.feet};
          const sourceSweep = full.sweep(from, to, height), chunkSweep = subset.sweep(from, to, height);
          assert.equal(chunkSweep.startSolid, sourceSweep.startSolid, `${chunk.id}: sweep start-solid`);
          const delta = Math.hypot(chunkSweep.position.x - sourceSweep.position.x, chunkSweep.position.y - sourceSweep.position.y, chunkSweep.position.z - sourceSweep.position.z);
          maxSweepDeltaMetres = Math.max(maxSweepDeltaMetres, delta);
          // Rapier rebuilds a different BVH for the subset; contacts at the
          // existing skin can differ sub-millimetres despite identical faces.
          assert.ok(delta < .002, `${chunk.id}: movement sweep at ${JSON.stringify(from)} differs by ${delta}m`); sweeps++;
        }
        checks += 3;
      }
    }
    const eyes = points.map(p => ({...p, y: p.y + 64 * .0254}));
    for (let i = 0; i < eyes.length; i++) for (let j = i + 1; j < eyes.length; j++) {
      const a = eyes[i], b = eyes[j], length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); if (length < .01) continue;
      const direction = {x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length};
      const expected = full.ray(a, direction, length), actual = subset.ray(a, direction, length);
      assert.equal(!!actual, !!expected, `${chunk.id}: bounded sight/shot ray`);
      if (expected) near(actual.distance, expected.distance, `${chunk.id}: shot distance`);
      rays++;
    }
    subset.dispose(); subset = undefined;
    reports.push({id: chunk.id, points: points.length, supportAndHullChecks: checks, movementSweeps: sweeps, shotRays: rays,
      ...exact, maxSweepDeltaMetres: +maxSweepDeltaMetres.toFixed(7),
      outputMB: +(metadata.outputBytes / 1e6).toFixed(2), renderTriangleFraction: +(metadata.visual.triangles / metadata.visual.sourceTriangles).toFixed(3)});
  }
  console.log(JSON.stringify({passed: true, build: full.build, sourceCollisionSha256: full.collisionSha256, chunks: reports}, null, 2));
} finally {subset?.dispose(); full?.dispose(); await vite.close();}
