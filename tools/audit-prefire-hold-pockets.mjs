import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {prefireRoutes, dust2Catalog} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {prefireCandidates, holdingEvidence, selectionWeights, PREFIRE_WEIGHT_POLICY, HOLD_RADIUS_UNITS, HOLD_HEIGHT_UNITS} = await vite.ssrLoadModule('/src/range/prefire/occupancy.ts');
  const {auditHoldPocket} = await vite.ssrLoadModule('/src/range/prefire/hold-pocket-audit.ts');
  const manifest = JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.collisionSha256) throw new Error('Collision checksum mismatch');
  collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const density = dust2Catalog.density, cache = new Map(), results = [];
  for (const route of prefireRoutes) {
    const entries = prefireCandidates(route).map(angle => ({angle, evidence: holdingEvidence(angle, route, density)}));
    const weighted = selectionWeights(entries);
    const legacyGroups = new Map();
    for (const {angle, evidence} of entries) if (angle.exclusionGroup) {
      const group = legacyGroups.get(angle.exclusionGroup) ?? {rounds: new Set(), total: 0};
      for (const key of evidence.roundKeys) group.rounds.add(key);
      group.total += evidence.weight; legacyGroups.set(angle.exclusionGroup, group);
    }
    const legacy = entries.map(({angle, evidence}) => {
      const group = legacyGroups.get(angle.exclusionGroup);
      return group ? evidence.weight / group.total * (1 + group.rounds.size) : evidence.weight;
    });
    const legacyTotal = legacy.reduce((sum, weight) => sum + weight, 0);
    for (const [index, {angle, evidence: broad, weight}] of weighted.entries()) {
      const accepted = new Set(), blocked = new Set(), ambiguous = new Set();
      const cells = [];
      const eligible = new Set(density.layers.find(layer => layer.side === route.enemySide && layer.context === route.phase).roundKeys);
      for (const cell of density.cells) {
        if (cell.side !== route.enemySide || cell.context !== route.phase ||
          Math.hypot(cell.position[0] - angle.position[0], cell.position[1] - angle.position[1]) > HOLD_RADIUS_UNITS ||
          Math.abs(cell.position[2] - angle.position[2]) > HOLD_HEIGHT_UNITS) continue;
        const key = JSON.stringify([angle.position, cell.position]);
        if (!cache.has(key)) cache.set(key, auditHoldPocket(collision, angle.position, cell.position));
        const status = cache.get(key), rounds = cell.roundKeys.filter(key => eligible.has(key));
        const set = status === 'accepted-local' ? accepted : status === 'blocked-corridor' ? blocked : ambiguous;
        for (const key of rounds) set.add(key);
        cells.push({bin: cell.bin, status, roundKeys: rounds});
      }
      results.push({route: route.id, angle: angle.id, name: angle.name, broadRounds: broad.rounds, sampleRounds: broad.sampleRounds,
        matches: broad.matches, sampleMatches: broad.sampleMatches, family: angle.exclusionGroup ?? angle.id,
        legacyTicketShare: legacy[index] / legacyTotal, coveragePolicyShare: weight,
        acceptedRounds: accepted.size, blockedRounds: blocked.size, ambiguousRounds: ambiguous.size, cells});
    }
  }
  const report = {schemaVersion: 1, mapId: dust2Catalog.id, catalogRevision: dust2Catalog.revision,
    build: manifest.build, collisionSha256: manifest.collisionSha256,
    densitySha256: hash('src/range/prefire/data/dust2-hold-density.json'),
    coordinatesSha256: hash('src/range/prefire/routes.ts'), auditSha256: hash('src/range/prefire/hold-pocket-audit.ts'),
    dependencySha256: Object.fromEntries(['spawn-audit.ts', 'placement.ts', 'native-collision.ts', 'occupancy.ts',
      'data/openprefire-dust2.json', 'data/retakes-dust2.json', 'data/dust2-weighted-pools.json',
      '../actor-collision.ts', '../actor-physics.ts'].map(file => [file, hash(`src/range/prefire/${file}`)])),
    samplingPolicy: {...PREFIRE_WEIGHT_POLICY,
      comparison: 'First-draw normalized policy shares on the current pool/families, before compatibility constraints; not inclusion or encounter probabilities.'},
    method: {radiusUnits: HOLD_RADIUS_UNITS, heightUnits: HOLD_HEIGHT_UNITS, bothStances: true, maximumSideDeviationUnits: 4,
      maximumExtraPathUnits: 8, centroidFilteringChangesRuntimeWeights: false,
      interpretation: 'Diagnostic centroid-matched local corridor support, not population probability or a certified lower bound on original observations.'},
    results};
  fs.mkdirSync('research/dust2', {recursive: true});
  fs.writeFileSync('research/dust2/hold-pocket-audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({uniqueGeometryPairs: cache.size, holds: results.length,
    reducedSupport: results.filter(result => result.acceptedRounds < result.broadRounds).length,
    results: results.filter(result => result.broadRounds >= 10).map(({cells, ...result}) => result)}, null, 2));
} finally {collision?.dispose(); await vite.close();}
