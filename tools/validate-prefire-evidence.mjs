import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {prefireAuthoringMaps, sha256File} from './prefire-map-adapters.mjs';

/** Freeze before model inspection. All rounds of one canonical match stay together. */
export function splitEncounterMatches(observations, seed, heldoutFraction = .25) {
  if (typeof seed !== 'string' || !seed.trim() || !Number.isFinite(heldoutFraction) || heldoutFraction <= 0 || heldoutFraction >= 1)
    throw new Error('A nonempty split seed and heldout fraction strictly between zero and one are required.');
  const ids = [...new Set(observations.map(row => row.matchId))];
  if (!ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) throw new Error('No valid canonical match IDs.');
  const hash = id => createHash('sha256').update(JSON.stringify([seed, id])).digest('hex');
  ids.sort((a, b) => hash(a).localeCompare(hash(b)) || a.localeCompare(b));
  const count = Math.max(1, Math.min(ids.length - 1, Math.round(ids.length * heldoutFraction)));
  return {method: 'match-disjoint-v1', trainMatches: ids.slice(count).sort(), heldoutMatches: ids.slice(0, count).sort()};
}

/** Every source/extractor/pocket report is resolved by content hash, never a mutable URL. */
export function verifyEncounterArtifacts(evidence, artifacts, root = '.') {
  const errors = [], reports = new Map();
  const required = new Set([...evidence.sources.flatMap(source => [source.sha256, source.extractor.sha256]),
    ...evidence.pockets.map(pocket => pocket.reportSha256),
    ...evidence.observations.map(row => row.snapshotProof?.reportSha256),
    ...evidence.observations.flatMap(row => row.members.map(member => member.pocketProof.reportSha256))]);
  for (const sha of required) {
    try {
      const file = artifacts[sha];
      if (typeof file !== 'string' || !file.trim()) throw new Error('missing artifact path');
      const resolved = path.resolve(root, file);
      if (sha256File(resolved) !== sha) throw new Error('checksum mismatch');
      reports.set(sha, resolved);
    } catch (error) {errors.push(`${sha}: ${error.message}`);}
  }
  const proofFiles = new Set(evidence.observations.flatMap(row => row.members.map(member => member.pocketProof.reportSha256)));
  const proofs = new Map();
  for (const sha of proofFiles) {
    try {
      const report = JSON.parse(fs.readFileSync(reports.get(sha), 'utf8'));
      if (report.schemaVersion !== 1 || report.geometrySha256 !== evidence.build.geometrySha256 || !Array.isArray(report.records)) throw new Error('invalid raw-foot report');
      proofs.set(sha, report.records);
    } catch (error) {errors.push(`${sha}: ${error.message}`);}
  }
  for (const row of evidence.observations) for (const member of row.members) {
    const source = evidence.sources.find(source => source.id === row.sourceId);
    const records = proofs.get(member.pocketProof.reportSha256) ?? [];
    const matches = records.filter(record => record.sourceId === row.sourceId && record.matchId === row.matchId &&
      record.roundId === row.roundId && record.tick === row.tick && record.actorId === member.actorId &&
      record.angleId === member.angleId && record.pocketId === member.pocketId && record.crouched === member.crouched &&
      JSON.stringify(record.observedFeet) === JSON.stringify(member.observedFeet) && record.status === 'accepted-local' &&
      record.sourceSha256 === source?.sha256 && record.extractorSha256 === source?.extractor.sha256);
    if (matches.length !== 1) errors.push(`Missing/duplicate pinned raw-foot proof: ${row.id}/${member.actorId}`);
  }
  errors.push(...verifyEncounterSnapshots(evidence, reports));
  return errors;
}

/** An empty or shortened roster must not bypass source-tick completeness checks. */
export function verifyEncounterSnapshots(evidence, reports) {
  const errors = [], cache = new Map();
  const memberKey = member => JSON.stringify([member.actorId, member.angleId, member.pocketId, member.observedFeet, member.crouched]);
  const contextKey = context => JSON.stringify(Object.entries(context ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const buildKey = build => JSON.stringify([build?.mapId, build?.catalogRevision, build?.gameBuild, build?.geometrySha256]);
  for (const row of evidence.observations) {
    try {
      if (row.snapshotProof?.method !== 'complete-defender-snapshot-v1') throw new Error('missing snapshot proof');
      const sha = row.snapshotProof.reportSha256;
      if (!cache.has(sha)) cache.set(sha, JSON.parse(fs.readFileSync(reports.get(sha), 'utf8')));
      const report = cache.get(sha);
      if (report.schemaVersion !== 1 || buildKey(report.build) !== buildKey(evidence.build) || !Array.isArray(report.snapshots))
        throw new Error('invalid/stale snapshot report');
      const source = evidence.sources.find(source => source.id === row.sourceId);
      const matches = report.snapshots.filter(snapshot => snapshot.sourceId === row.sourceId && snapshot.matchId === row.matchId &&
        snapshot.roundId === row.roundId && snapshot.routeId === row.routeId && snapshot.tick === row.tick);
      if (matches.length !== 1) throw new Error('missing/duplicate same-tick snapshot');
      const snapshot = matches[0], defenders = snapshot.defenders;
      if (!source || snapshot.sourceSha256 !== source.sha256 || snapshot.extractorSha256 !== source.extractor.sha256 ||
        contextKey(snapshot.context) !== contextKey(row.context)) throw new Error('snapshot provenance/context mismatch');
      const arrival = snapshot.arrivalEvent;
      if (arrival?.tick !== row.tick || typeof arrival.definition !== 'string' || !arrival.definition.trim() ||
        typeof arrival.approachingActorId !== 'string' || !arrival.approachingActorId.trim()) throw new Error('unrecorded approach arrival');
      if (!Array.isArray(defenders) || defenders.length !== 5 || new Set(defenders.map(actor => actor.actorId)).size !== 5 ||
        defenders.some(actor => typeof actor.actorId !== 'string' || !actor.actorId.trim() || typeof actor.alive !== 'boolean' ||
          actor.actorId === arrival.approachingActorId || !actor.alive && actor.member !== undefined))
        throw new Error('partial/unknown defender team');
      const alive = defenders.filter(actor => actor.alive);
      if (alive.some(actor => actor.member?.actorId !== actor.actorId) || alive.length !== row.members.length ||
        JSON.stringify(alive.map(actor => memberKey(actor.member)).sort()) !== JSON.stringify(row.members.map(memberKey).sort()))
        throw new Error('omitted/unmapped/changed live defender');
    } catch (error) {errors.push(`Unverified complete snapshot: ${row.id}: ${error.message}`);}
  }
  return errors;
}

export async function main(args = process.argv.slice(2)) {
  const get = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const input = get('input'), artifactsPath = get('artifacts'), mapId = get('map') ?? 'de_dust2';
  if (!input || !artifactsPath) throw new Error('Usage: node tools/validate-prefire-evidence.mjs --input=normalized.json --artifacts=sha-to-file.json [--map=de_dust2] [--split-seed=frozen-seed] [--output=validated.json]');
  const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
  const seed = get('split-seed');
  if (seed && evidence.split) throw new Error('Existing heldout split is immutable; do not re-split after inspection.');
  if (!evidence.split && seed) evidence.split = splitEncounterMatches(evidence.observations, seed);
  const {createServer} = await import('vite');
  const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
  let adapter;
  try {
    adapter = await prefireAuthoringMaps.load(mapId, vite);
    const {validateEncounterEvidence, validateHeldoutEncounters} = await vite.ssrLoadModule('/src/range/prefire/encounter-evidence.ts');
    const {choosePrefireEncounter} = await vite.ssrLoadModule('/src/range/prefire/encounters.ts');
    const errors = validateEncounterEvidence(evidence, adapter.catalog, adapter.build, adapter.verifyPocket);
    if (!errors.length) errors.push(...verifyEncounterArtifacts(evidence, JSON.parse(fs.readFileSync(artifactsPath, 'utf8')), path.dirname(artifactsPath)));
    const validations = errors.length ? [] : adapter.catalog.routes.map(route => {
      const validation = validateHeldoutEncounters(evidence, route.id, {side: route.enemySide, phase: route.phase});
      const selection = choosePrefireEncounter({...adapter.catalog, encounters: evidence}, route, () => 0, {build: adapter.build});
      return {routeId: route.id, trainObservations: validation.train.length, trainMatches: validation.trainMatches,
        heldoutObservations: validation.heldout.length, heldoutMatches: validation.heldoutMatches,
        totalVariation: validation.totalVariation, unseenSetupShare: validation.unseenSetupShare,
        mode: selection.mode, fallbackReason: selection.fallbackReason};
    });
    console.log(JSON.stringify({mapId, build: adapter.build, valid: !errors.length, errors, validations}, null, 2));
    if (errors.length) throw new Error('Encounter evidence validation failed; nothing published.');
    const output = get('output');
    if (output) {fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');}
  } finally {adapter?.collision.dispose(); await vite.close();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {console.error(error.message); process.exitCode = 1;});
