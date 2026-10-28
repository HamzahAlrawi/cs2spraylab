import {angleIdentity, prefireAnglesIncompatible, prefireCandidates, PREFIRE_ACTOR_BUDGET} from './occupancy';
import type {EncounterContext, EncounterContextField, EncounterEvidence, EncounterMember, EncounterObservation,
  PrefireBuildIdentity, PrefireCatalog, PrefireCoverPocket, PrefireRoute} from './schema';

export const ENCOUNTER_CONTEXT_FIELDS = ['side', 'phase', 'equipment', 'arrival'] as const;
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const unique = (values: readonly string[]) => values.length === new Set(values).size;
export const samePrefireBuild = (a: PrefireBuildIdentity, b: PrefireBuildIdentity) =>
  a.mapId === b.mapId && a.gameBuild === b.gameBuild && a.geometrySha256 === b.geometrySha256 && a.catalogRevision === b.catalogRevision;

export type PocketVerifier = (member: EncounterMember, pocket: PrefireCoverPocket,
  route: PrefireRoute, observation: EncounterObservation) => boolean;

/** Fail closed; never salvage a partial team or infer missing fields from nearby holds. */
export function validateEncounterEvidence(evidence: EncounterEvidence, catalog: PrefireCatalog,
  build: PrefireBuildIdentity, verifyPocket?: PocketVerifier): string[] {
  const errors: string[] = [];
  try {
    if (evidence.schemaVersion !== 1 || !text(evidence.revision) || !samePrefireBuild(evidence.build, build) ||
      build.mapId !== catalog.id || build.catalogRevision !== catalog.revision || !text(build.gameBuild) || !isSha256(build.geometrySha256))
      errors.push('Evidence map/build/catalog identity is stale or invalid.');
    const {trainMatches, heldoutMatches} = evidence.split;
    const train = new Set(trainMatches), heldout = new Set(heldoutMatches);
    if (evidence.split.method !== 'match-disjoint-v1' || !unique(trainMatches) || !unique(heldoutMatches) ||
      [...train, ...heldout].some(id => !text(id)) || [...train].some(id => heldout.has(id))) errors.push('Invalid or leaking match split.');
    if (!evidence.sources.length || !unique(evidence.sources.map(source => source.id))) errors.push('Missing or duplicate evidence sources.');
    const sources = new Map(evidence.sources.map(source => [source.id, source]));
    for (const source of evidence.sources) {
      if (![source.id, source.url, source.revision, source.license, source.rights.reference, source.extractor.revision].every(text) ||
        !isSha256(source.sha256) || !isSha256(source.extractor.sha256) || source.positionKind !== 'raw-feet' ||
        !['demo', 'tick-data'].includes(source.kind) || !['approved', 'restricted', 'unknown'].includes(source.rights.status) ||
        Object.entries(source.fields).some(([field, definition]) => !ENCOUNTER_CONTEXT_FIELDS.includes(field as EncounterContextField) || !text(definition)))
        errors.push(`Invalid provenance: ${source.id}.`);
    }
    if (!unique(evidence.pockets.map(pocket => pocket.id))) errors.push('Duplicate cover pocket IDs.');
    if (!unique(evidence.pockets.flatMap(pocket => [...pocket.angleIds]))) errors.push('An authored hold belongs to multiple physical pockets.');
    const pockets = new Map(evidence.pockets.map(pocket => [pocket.id, pocket]));
    const allAngles = new Set(catalog.routes.flatMap(route => prefireCandidates(route).map(angleIdentity)));
    for (const pocket of evidence.pockets) if (!text(pocket.id) || !pocket.angleIds.length || !unique(pocket.angleIds) ||
      pocket.angleIds.some(id => !allAngles.has(id)) || pocket.geometrySha256 !== build.geometrySha256 || !isSha256(pocket.reportSha256))
      errors.push(`Invalid cover pocket: ${pocket.id}.`);
    const ids = new Set<string>(), rounds = new Set<string>();
    for (const observation of evidence.observations) {
      const key = JSON.stringify([observation.matchId, observation.roundId, observation.routeId]);
      const source = sources.get(observation.sourceId), route = catalog.routes.find(route => route.id === observation.routeId);
      if (![observation.id, observation.matchId, observation.roundId].every(text) || ids.has(observation.id) || rounds.has(key) ||
        !Number.isInteger(observation.tick) || observation.tick < 0 || observation.complete !== true ||
        !route || !source || !train.has(observation.matchId) && !heldout.has(observation.matchId)) {
        errors.push(`Invalid/duplicate/incomplete observation: ${observation.id}.`); continue;
      }
      ids.add(observation.id); rounds.add(key);
      if (observation.snapshotProof?.method !== 'complete-defender-snapshot-v1' || !isSha256(observation.snapshotProof.reportSha256))
        errors.push(`Missing complete snapshot/arrival proof: ${observation.id}.`);
      const context = observation.context;
      if (Object.entries(context).some(([field, value]) => !source.fields[field as EncounterContextField] || !text(value)) ||
        context.side !== undefined && !['ct', 't'].includes(context.side) ||
        context.phase !== undefined && !['preplant', 'postplant'].includes(context.phase) ||
        route.enemySide !== undefined && context.side !== route.enemySide || route.phase !== undefined && context.phase !== route.phase)
        errors.push(`Unrecorded or conflicting context: ${observation.id}.`);
      const candidates = new Map(prefireCandidates(route).map(angle => [angleIdentity(angle), angle]));
      const members = observation.members;
      if (members.length > PREFIRE_ACTOR_BUDGET || !unique(members.map(member => member.actorId)) ||
        !unique(members.map(member => member.angleId)) || !unique(members.map(member => member.pocketId))) errors.push(`Invalid joint roster: ${observation.id}.`);
      for (const [index, member] of members.entries()) {
        const pocket = pockets.get(member.pocketId), angle = candidates.get(member.angleId);
        if (!text(member.actorId) || !angle || !pocket?.angleIds.includes(member.angleId) ||
          member.observedFeet.length !== 3 || !member.observedFeet.every(Number.isFinite) || typeof member.crouched !== 'boolean' ||
          member.crouched !== !!angle.crouched || member.pocketProof.method !== 'raw-feet-local-pocket-v1' ||
          member.pocketProof.geometrySha256 !== build.geometrySha256 || !isSha256(member.pocketProof.reportSha256) ||
          members.slice(0, index).some(other => {
            const prior = candidates.get(other.angleId);
            return prior && angle && prefireAnglesIncompatible(angle, prior) || prefireAnglesIncompatible(
              {id: member.actorId, name: member.actorId, position: member.observedFeet},
              {id: other.actorId, name: other.actorId, position: other.observedFeet});
          }) ||
          verifyPocket && pocket && !verifyPocket(member, pocket, route, observation))
          errors.push(`Unverified/incompatible raw-foot pocket: ${observation.id}/${member.actorId}.`);
      }
    }
    const observedMatches = new Set(evidence.observations.map(row => row.matchId));
    if ([...train, ...heldout].some(match => !observedMatches.has(match))) errors.push('Split contains matches with no retained observations.');
  } catch {
    errors.push('Malformed encounter evidence structure.');
  }
  return errors;
}

export function encounterSignature(observation: EncounterObservation): string {
  return JSON.stringify(observation.members.map(member => [member.pocketId, member.angleId]).sort((a, b) =>
    a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])));
}

export function matchesEncounterContext(observation: EncounterObservation, context: EncounterContext): boolean {
  return ENCOUNTER_CONTEXT_FIELDS.every(field => context[field] === undefined || observation.context[field] === context[field]);
}

/** Every sampled match contributes equal mass; rounds within it share that mass. */
export function jointSetupDistribution(observations: readonly EncounterObservation[]) {
  const matches = new Map<string, number>();
  for (const row of observations) matches.set(row.matchId, (matches.get(row.matchId) ?? 0) + 1);
  const setups = new Map<string, {weight: number; observations: EncounterObservation[]}>();
  for (const row of observations) {
    const signature = encounterSignature(row), setup = setups.get(signature) ?? {weight: 0, observations: []};
    setup.weight += 1 / matches.size / matches.get(row.matchId)!;
    setup.observations.push(row); setups.set(signature, setup);
  }
  return setups;
}

export function validateHeldoutEncounters(evidence: EncounterEvidence, routeId: string, context: EncounterContext = {}) {
  const trainIds = new Set(evidence.split.trainMatches), heldoutIds = new Set(evidence.split.heldoutMatches);
  const rows = evidence.observations.filter(row => row.routeId === routeId && matchesEncounterContext(row, context));
  const train = rows.filter(row => trainIds.has(row.matchId)), heldout = rows.filter(row => heldoutIds.has(row.matchId));
  const fitted = jointSetupDistribution(train), test = jointSetupDistribution(heldout);
  const keys = new Set([...fitted.keys(), ...test.keys()]);
  const comparable = !!train.length && !!heldout.length;
  return {train, heldout, distribution: fitted,
    trainMatches: new Set(train.map(row => row.matchId)).size, heldoutMatches: new Set(heldout.map(row => row.matchId)).size,
    // Null is unknown, not perfect agreement. Heldout rows never enter fitted weights.
    totalVariation: comparable ? [...keys].reduce((sum, key) => sum + Math.abs((fitted.get(key)?.weight ?? 0) - (test.get(key)?.weight ?? 0)), 0) / 2 : null,
    unseenSetupShare: comparable ? [...test].reduce((sum, [key, setup]) => sum + (fitted.has(key) ? 0 : setup.weight), 0) : null};
}
