import type {EncounterEvidence, EncounterObservation, PrefireBuildIdentity, PrefireCatalog, PrefireRoute} from './schema';

// Synthetic fixtures only. Never attach these to a shipping catalog.
export function encounterFixture() {
  const sha = 'a'.repeat(64), proof = 'b'.repeat(64);
  const route: PrefireRoute = {id: 'entry', name: 'Synthetic entry', enemySide: 'ct', phase: 'preplant',
    spawn: [0, -200, 0], look: [0, 0, 0], path: [[0, 0, 0]],
    angles: Array.from({length: 4}, (_, index) => ({id: `a${index}`, name: `Hold ${index}`, position: [index * 200 + 32, 0, 0] as const}))};
  const build: PrefireBuildIdentity = {mapId: 'synthetic', catalogRevision: 'fixture-v1', gameBuild: 'fixture-only', geometrySha256: sha};
  const observations: EncounterObservation[] = Array.from({length: 5}, (_, match) => Array.from({length: 4}, (_, round) => ({
    id: `row-${match}-${round}`, sourceId: 'synthetic', matchId: `match-${match}`, roundId: `${round}`, routeId: route.id,
    tick: 100, complete: true as const, context: {side: 'ct' as const, phase: 'preplant' as const, equipment: 'rifles', arrival: 'opening'},
    snapshotProof: {method: 'complete-defender-snapshot-v1' as const, reportSha256: proof},
    members: [round % 2 ? 2 : 0, round % 2 ? 3 : 1].map(index => ({actorId: `player-${index}`, angleId: `a${index}`,
      pocketId: `p${index}`, observedFeet: route.angles[index].position, crouched: false,
      pocketProof: {method: 'raw-feet-local-pocket-v1' as const, geometrySha256: sha, reportSha256: proof}})),
  }))).flat();
  const evidence: EncounterEvidence = {schemaVersion: 1, revision: 'synthetic-test-v1', build, sources: [{id: 'synthetic', url: 'https://example.test/fixture', revision: 'fixture',
    sha256: sha, license: 'synthetic-test-only', kind: 'tick-data', rights: {status: 'approved', reference: 'synthetic fixture only'},
    extractor: {revision: 'fixture', sha256: sha}, positionKind: 'raw-feet',
    fields: {side: 'Observed defender side', phase: 'Observed round phase', equipment: 'Synthetic team class', arrival: 'Synthetic arrival window'}}],
    pockets: route.angles.map((angle, index) => ({id: `p${index}`, angleIds: [angle.id!], geometrySha256: sha, reportSha256: proof})),
    split: {method: 'match-disjoint-v1', trainMatches: ['match-0', 'match-1', 'match-2'], heldoutMatches: ['match-3', 'match-4']}, observations};
  const catalog: PrefireCatalog = {id: build.mapId, name: 'Synthetic', revision: build.catalogRevision, routes: [route], sources: [], encounters: evidence};
  return {route, build, evidence, catalog};
}
