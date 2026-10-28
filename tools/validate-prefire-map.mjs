import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {prefireAuthoringMaps, sha256File} from './prefire-map-adapters.mjs';

const args = process.argv.slice(2), get = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const qualityPath = get('quality'), artifactsPath = get('artifacts'), mapId = get('map') ?? 'de_dust2';
if (!qualityPath || !artifactsPath) throw new Error('Usage: node tools/validate-prefire-map.mjs --quality=quality.json --artifacts=quality.json.artifacts.json [--map=de_dust2] [--mode=coverage|contextual-evidence]');
const mode = get('mode') ?? 'coverage';
if (!['coverage', 'contextual-evidence'].includes(mode)) throw new Error('Unknown quality mode');
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let adapter;
try {
  adapter = await prefireAuthoringMaps.load(mapId, vite);
  const {validatePrefireMapQuality} = await vite.ssrLoadModule('/src/range/prefire/map-quality.ts');
  const {samePrefireBuild} = await vite.ssrLoadModule('/src/range/prefire/encounter-evidence.ts');
  const quality = JSON.parse(fs.readFileSync(qualityPath, 'utf8')), artifacts = JSON.parse(fs.readFileSync(artifactsPath, 'utf8'));
  const errors = validatePrefireMapQuality(adapter.catalog, adapter.build, quality, mode);
  const reports = new Map();
  for (const check of quality.checks.filter(check => check.status === 'passed')) {
    try {
      const file = artifacts[check.reportSha256];
      if (!file) throw new Error('missing artifact');
      const resolved = path.resolve(path.dirname(artifactsPath), file);
      if (sha256File(resolved) !== check.reportSha256) throw new Error('report checksum mismatch');
      let report = reports.get(resolved);
      if (!report) {report = JSON.parse(fs.readFileSync(resolved, 'utf8')); reports.set(resolved, report);}
      if (report.schemaVersion !== 1 || !samePrefireBuild(report.build, adapter.build) ||
        JSON.stringify(report.routeKeys) !== JSON.stringify(quality.routeKeys)) throw new Error('stale gate report inputs');
      const proofs = report.checks.filter(proof => proof.gate === check.gate && proof.routeId === check.routeId &&
        proof.status === 'passed' && proof.cases === check.cases);
      if (proofs.length !== 1) throw new Error('gate result not present in pinned report');
      if (!Object.keys(report.dependencySha256 ?? {}).length) throw new Error('missing gate dependency hashes');
      for (const [dependency, sha] of Object.entries(report.dependencySha256)) if (sha256File(dependency) !== sha) throw new Error(`stale dependency: ${dependency}`);
    } catch (error) {errors.push(`${check.gate}/${check.routeId ?? mapId}: ${error.message}`);}
  }
  console.log(JSON.stringify({mapId, mode, passed: !errors.length, errors}, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {adapter?.collision.dispose(); await vite.close();}
