import fs from 'node:fs';
import {createHash} from 'node:crypto';

export const sha256File = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Extend with another map-owned loader; the shared authoring commands have no map paths. */
export function createPrefireAuthoringRegistry(adapters = []) {
  const entries = new Map();
  function register(adapter) {
    if (!adapter.id?.trim() || typeof adapter.load !== 'function' || entries.has(adapter.id)) throw new Error(`Invalid/duplicate authoring adapter: ${adapter.id}`);
    entries.set(adapter.id, adapter);
  }
  for (const adapter of adapters) register(adapter);
  return {register, ids: () => [...entries.keys()], async load(id, vite) {
    const adapter = entries.get(id);
    if (!adapter) throw new Error(`Unknown authoring map ${id}; registered: ${[...entries.keys()].join(', ')}`);
    const map = await adapter.load(vite);
    if (map.catalog.id !== id || map.build.mapId !== id || map.build.catalogRevision !== map.catalog.revision) {
      map.collision?.dispose(); throw new Error(`Authoring map identity mismatch: ${id}`);
    }
    return map;
  }};
}

export const prefireAuthoringMaps = createPrefireAuthoringRegistry([{id: 'de_dust2', async load(vite) {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {dust2Catalog, prefireApproachRoutes, proposedPrefirePools} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {placePrefireTarget} = await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const audit = await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const {settleNativePosition} = await vite.ssrLoadModule('/src/range/prefire/map.ts');
  const {moveOnTerrain} = await vite.ssrLoadModule('/src/range/actor-collision.ts');
  const {auditHoldPocket} = await vite.ssrLoadModule('/src/range/prefire/hold-pocket-audit.ts');
  const manifest = JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.collisionSha256) throw new Error('Collision checksum mismatch');
  const collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const build = {mapId: dust2Catalog.id, catalogRevision: dust2Catalog.revision, gameBuild: manifest.build, geometrySha256: manifest.collisionSha256};
  const materialReportPath = 'research/dust2/material-quality.json';
  let materialQuality = {status: 'missing', cases: 0, note: 'Run tools/audit-native-materials.mjs to validate the current native material inputs.'};
  if (fs.existsSync(materialReportPath)) {
    const report = JSON.parse(fs.readFileSync(materialReportPath, 'utf8'));
    const check = report.checks?.find(check => check.gate === 'materials' && check.status === 'passed' && check.cases > 0);
    if (check && JSON.stringify(report.build) === JSON.stringify(build) && Object.keys(report.dependencySha256 ?? {}).length &&
      Object.entries(report.dependencySha256).every(([file, sha]) => fs.existsSync(file) && sha256File(file) === sha))
      materialQuality = {...check, reportSha256: sha256File(materialReportPath)};
  }
  return {catalog: dust2Catalog, routes: prefireApproachRoutes, proposedPools: proposedPrefirePools, collision, manifest,
    build,
    poolOutputPath: 'src/range/prefire/data/dust2-weighted-pools.json',
    dependencyFiles: ['routes.ts', 'route-helpers.ts', 'spawn-audit.ts', 'placement.ts', 'native-collision.ts',
      'data/openprefire-dust2.json', 'data/retakes-dust2.json', 'data/authored-dust2.json', 'data/combat-dust2-leads.json', '../actor-collision.ts', '../actor-physics.ts'],
    dependencyRoot: 'src/range/prefire/', unit: manifest.unit,
    qualityDependencyFiles: ['public/revamp/maps/dust2/collision.json', 'src/range/prefire/data/dust2-weighted-pools.json'],
    place: (point, crouched) => placePrefireTarget(collision, point, crouched),
    settle: point => settleNativePosition(collision, point),
    move: (from, to, height) => moveOnTerrain(from, to, height, {floor: null, solids: [], native: collision}, true),
    verifyPocket: (member, _pocket, route) => {
      const angle = [...route.angles, ...route.alternatives ?? []].find(angle => angle.id === member.angleId);
      return !!angle && auditHoldPocket(collision, member.observedFeet, angle.position) === 'accepted-local';
    },
    audit,
    // Native semantics may exist; map admission still needs their pinned fixture report.
    materialQuality, materialReportPath,
  };
}}]);
