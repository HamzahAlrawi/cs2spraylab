import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {prefireAuthoringMaps, sha256File} from './prefire-map-adapters.mjs';

const filter = process.argv.find(arg => arg.startsWith('--route='))?.slice(8).split(',');
const mapId = process.argv.find(arg => arg.startsWith('--map='))?.slice(6) ?? 'de_dust2';
const qualityOutput = process.argv.find(arg => arg.startsWith('--quality-output='))?.slice(17);
if (process.argv.includes('--save') && (filter || process.argv.includes('--diagnostic'))) throw new Error('Only a complete strict audit can publish pools');
if (qualityOutput && (filter || process.argv.includes('--diagnostic') || process.argv.includes('--save')))
  throw new Error('Quality reports require a full strict audit of the already published pools, separate from --save.');

// Generate selection pools offline; never run native placement searches in the render loop.
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const adapter = await prefireAuthoringMaps.load(mapId, vite);
  const {prefireCandidates} = await vite.ssrLoadModule('/src/range/prefire/occupancy.ts');
  collision = adapter.collision;
  const {routes: prefireApproachRoutes, proposedPools: proposedPrefirePools, manifest, unit} = adapter;
  const placePrefireTarget = (_collision, point, crouched) => adapter.place(point, crouched);
  const {prefireSpawnEyes, prefireUpperBodySamples, prefireBodyExposed, nativeSightBlocked, walkPrefireAuditPath, auditPrefireMotorPath} =
    adapter.audit;
  if (filter?.some(id => !prefireApproachRoutes.some(route => route.id === id))) throw new Error('Unknown route filter');
  const routes = {}, validated = new Map();
  for (const route of prefireApproachRoutes.filter(route => !filter || filter.includes(route.id))) {
    // Certificate publication rechecks the shipped pool, not discarded source
    // proposals. Discovery/--save still audits every proposed candidate.
    const published=adapter.catalog.routes.find(candidate=>candidate.id===route.id);
    const candidates = qualityOutput ? prefireCandidates(published) : proposedPrefirePools[route.id];
    const spawn = placePrefireTarget(collision, route.spawn);
    auditPrefireMotorPath(collision, [route.spawn, ...route.path]);
    const margin = 64;
    const signature = JSON.stringify([route.spawn, route.path, margin, candidates.map(angle => angle.id)]);
    const cached = validated.get(signature);
    if (cached) {
      for (const angle of route.angles) if (!cached.includes(angle.id)) throw new Error(`Canonical ${route.id}/${angle.name} was not validated`);
      routes[route.id] = cached;
      console.log(JSON.stringify({route: route.id, accepted: cached.length, reusedGeometryCheck: true}));
      continue;
    }
    const eyes = [...prefireSpawnEyes(spawn), ...[-margin, 0, margin].flatMap(x => [-margin, 0, margin].flatMap(z =>
      [46, 52, 58, 64].map(height => ({x: spawn.x + x * unit, y: spawn.y + height * unit, z: spawn.z + z * unit}))))];
    const walks = [false, true].map(stance => walkPrefireAuditPath(collision, [route.spawn, ...route.path], stance));
    const accepted = [], rejected = [];
    for (const angle of candidates) {
      let feet;
      try {feet = placePrefireTarget(collision, angle.position, angle.crouched);}
      catch (error) {
        rejected.push({id: angle.id, reason: `invalid exact source placement: ${error.message}`});
        if (route.angles.some(original => original.id === angle.id)) throw error;
        continue;
      }
      const bodies = [prefireUpperBodySamples(feet), prefireUpperBodySamples(feet, true)];
      let reason;
      if (prefireBodyExposed(collision, eyes, bodies)) reason = 'exposed at spawn / cover margin';
      for (const [stance, walked] of walks.entries()) {
        if (reason) break;
        let distance = 0, hittable = false;
        const head = {...feet, y: feet.y + (angle.crouched ? 46 : 64) * unit};
        for (const [index, point] of walked.entries()) {
          if (index) distance += Math.hypot(point.x - walked[index - 1].x, point.z - walked[index - 1].z) / unit;
          if (distance <= 32 && prefireBodyExposed(collision, [46, 64].map(height => ({...point, y: point.y + height * unit})), bodies)) {
            reason = 'exposed before first 32 units'; break;
          }
          const eye = {...point, y: point.y + (stance ? 46 : 64) * unit};
          if (!nativeSightBlocked(collision, eye, head)) hittable = true;
          if (!hittable && Math.abs(point.y - feet.y) < 54 * unit && Math.hypot(point.x - feet.x, point.z - feet.z) < 40 * unit) {
            reason = 'holder blocks path before a hittable head'; break;
          }
        }
        if (!hittable && !reason && !stance) reason = 'head not hittable on standing supported path';
      }
      if (reason) {
        rejected.push({id: angle.id, reason});
        if (!process.argv.includes('--diagnostic') && route.angles.some(original => original.id === angle.id)) throw new Error(`Canonical ${route.id}/${angle.name}: ${reason}`);
      } else accepted.push(angle.id);
    }
    routes[route.id] = accepted;
    validated.set(signature, accepted);
    console.log(JSON.stringify({route: route.id, accepted: accepted.length, rejected}));
  }
  if (qualityOutput) {
    const {prefireRouteQualityKey, PREFIRE_MAP_GATES} = await vite.ssrLoadModule('/src/range/prefire/map-quality.ts');
    for (const route of adapter.catalog.routes) if (prefireCandidates(route).some(angle => !routes[route.id]?.includes(angle.id)))
      throw new Error(`Published pool failed native revalidation: ${route.id}`);
    const dependencySha256 = Object.fromEntries(adapter.dependencyFiles.map(file => [
      `${adapter.dependencyRoot}${file}`, sha256File(`${adapter.dependencyRoot}${file}`)]));
    for (const file of ['tools/build-prefire-pools.mjs', 'tools/prefire-map-adapters.mjs', ...adapter.qualityDependencyFiles ?? []]) dependencySha256[file] = sha256File(file);
    const routeKeys = Object.fromEntries(adapter.catalog.routes.map(route => [route.id, prefireRouteQualityKey(route)]));
    const nativeChecks = PREFIRE_MAP_GATES.filter(gate => !['materials', 'evidence'].includes(gate)).flatMap(gate =>
      (gate === 'geometry' ? [undefined] : adapter.catalog.routes.map(route => route.id)).map(routeId => ({gate, routeId,
        status: 'passed', cases: routeId ? routes[routeId].length : manifest.groups.length,
        note: 'Strict checksum, exact placement, both-stance covered entry/walk, full-speed motor and standing shot/visibility audit.'})));
    const nativeOutput = `${qualityOutput}.native.json`;
    fs.mkdirSync(path.dirname(qualityOutput), {recursive: true});
    fs.writeFileSync(nativeOutput, JSON.stringify({schemaVersion: 1, build: adapter.build, routeKeys, dependencySha256, checks: nativeChecks}, null, 2) + '\n');
    const nativeSha = sha256File(nativeOutput);
    const checks = [...nativeChecks.map(check => ({...check, reportSha256: nativeSha})),
      {gate: 'materials', ...adapter.materialQuality},
      {gate: 'evidence', status: adapter.catalog.encounters ? 'missing' : 'authored-only', cases: 0,
        note: adapter.catalog.encounters ? 'Run the separate contextual evidence/provenance/heldout validator.' : 'Authored coverage and broad regional density only; no contextual corpus certified.'}];
    fs.writeFileSync(qualityOutput, JSON.stringify({schemaVersion: 1, build: adapter.build, routeKeys, checks}, null, 2) + '\n');
    fs.writeFileSync(`${qualityOutput}.artifacts.json`, JSON.stringify({[nativeSha]: path.basename(nativeOutput),
      ...(adapter.materialQuality.reportSha256 ? {[adapter.materialQuality.reportSha256]: path.relative(path.dirname(qualityOutput), adapter.materialReportPath)} : {})}, null, 2) + '\n');
    console.log(JSON.stringify({qualityOutput, materialGate: adapter.materialQuality.status, evidenceGate: checks.at(-1).status}));
  }
  if (!filter && process.argv.includes('--save')) fs.writeFileSync(adapter.poolOutputPath, JSON.stringify({
    schemaVersion: 1, collisionSha256: manifest.collisionSha256, build: manifest.build,
    dependencySha256: Object.fromEntries(adapter.dependencyFiles.map(file => [file, sha256File(`${adapter.dependencyRoot}${file}`)])),
    approaches: Object.fromEntries(prefireApproachRoutes.map(route => [route.id, {spawn: route.spawn, path: route.path}])),
    gates: {coverMarginUnits: 64, protectedInitialWalkUnits: 32, bothWalkingStances: true, fullSpeedMotor: true, maximumActive: 5},
    validation: 'Exact source XY/stance; dense standing/crouched cover; 64u margin; 32u initial walk; both-stance native supported path; full-speed motor; standing head LOS before close contact.', routes,
  }, null, 2) + '\n');
} finally {collision?.dispose(); await vite.close();}
