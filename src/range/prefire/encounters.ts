import {angleIdentity, prefireAnglesIncompatible, prefireCandidates, PREFIRE_ACTOR_BUDGET} from './occupancy';
import {ENCOUNTER_CONTEXT_FIELDS, validateEncounterEvidence, validateHeldoutEncounters} from './encounter-evidence';
import type {EncounterContext, EncounterContextField, EncounterProvenance, PrefireAngle, PrefireBuildIdentity, PrefireCatalog, PrefireRoute} from './schema';

// Acceptance thresholds are an explicit conservative training policy, not measured accuracy.
export const PREFIRE_ENCOUNTER_POLICY = Object.freeze({
  id: 'contextual-joint-match-balanced-v1', minTrainMatches: 3, minTrainObservations: 12,
  minHeldoutMatches: 2, minHeldoutObservations: 4, maxTotalVariation: .5, maxUnseenSetupShare: .5,
});
export type EncounterFallbackReason = 'no-evidence' | 'invalid-evidence' | 'rights-not-approved' | 'unsupported-context' |
  'context-conflict' | 'low-support' | 'heldout-failed';
export type EncounterSelection = {
  angles: PrefireAngle[];
  mode: 'contextual-evidence' | 'authored-coverage';
  label: string; policy: string; context: EncounterContext;
  build: PrefireBuildIdentity;
  conditionedOn: EncounterContextField[];
  unavailableFields: EncounterContextField[];
  fallbackReason?: EncounterFallbackReason;
  authoredLineupId?: string;
  evidence: {
    revision?: string;
    trainObservations: number; trainMatches: number; heldoutObservations: number; heldoutMatches: number;
    selectedSetupObservations: number; selectedSetupMatches: number;
    totalVariation: number | null; unseenSetupShare: number | null;
    confidence: 'unknown' | 'insufficient-support' | 'heldout-supported';
    confidenceMeaning: 'Support/heldout gate only; not a calibrated probability or CS2 population claim.';
    provenance: readonly EncounterProvenance[]; errors: readonly string[];
  };
};

const draw = (random: () => number) => {
  const value = random();
  if (!Number.isFinite(value)) throw new Error('Encounter RNG must return a finite value.');
  return Math.max(0, Math.min(1 - Number.EPSILON, value));
};
const rosterIsCompatible = (angles: readonly PrefireAngle[]) => angles.length > 0 && angles.length <= PREFIRE_ACTOR_BUDGET &&
  angles.every((angle, index) => angles.slice(0, index).every(other => !prefireAnglesIncompatible(angle, other)));

/** Whole authored lineups only: no independent rolls to manufacture a fallback team. */
export function authoredEncounterCoverage(route: PrefireRoute, random: () => number) {
  const admitted = new Map(prefireCandidates(route).map(angle => [angleIdentity(angle), angle]));
  const seen = new Set<string>();
  const lineups = [{id: route.id, angles: route.angles}, ...route.lineups ?? []].filter(lineup => {
    const key = JSON.stringify(lineup.angles.map(angleIdentity).sort());
    if (seen.has(key) || !rosterIsCompatible(lineup.angles) || lineup.angles.some(angle => {
      const candidate = admitted.get(angleIdentity(angle));
      return !candidate || JSON.stringify([candidate.position, candidate.rotation, !!candidate.crouched, candidate.exclusionGroup]) !==
        JSON.stringify([angle.position, angle.rotation, !!angle.crouched, angle.exclusionGroup]);
    })) return false;
    seen.add(key); return true;
  });
  if (!lineups.length) throw new Error(`No compatible authored encounter lineup for ${route.id}.`);
  const lineup = lineups[Math.floor(draw(random) * lineups.length)];
  return {angles: [...lineup.angles], authoredLineupId: lineup.id};
}

/** Opt-in API. Existing choosePrefireAngles/weighted learning semantics are unchanged. */
export function choosePrefireEncounter(catalog: PrefireCatalog, route: PrefireRoute, random: () => number,
  options: {build: PrefireBuildIdentity; context?: EncounterContext}): EncounterSelection {
  if (!catalog.routes.includes(route)) throw new Error('Encounter route must belong to the supplied catalog.');
  const context: EncounterContext = {side: route.enemySide, phase: route.phase, ...options.context};
  const fields = ENCOUNTER_CONTEXT_FIELDS.filter(field => context[field] !== undefined);
  const result: EncounterSelection = {angles: [], mode: 'authored-coverage', label: 'Authored lineup coverage; not measured encounter likelihood',
    policy: PREFIRE_ENCOUNTER_POLICY.id, context, build: options.build, conditionedOn: [], unavailableFields: [],
    evidence: {trainObservations: 0, trainMatches: 0, heldoutObservations: 0, heldoutMatches: 0,
      selectedSetupObservations: 0, selectedSetupMatches: 0, totalVariation: null, unseenSetupShare: null,
      confidence: 'unknown', confidenceMeaning: 'Support/heldout gate only; not a calibrated probability or CS2 population claim.',
      provenance: [], errors: []}};
  const fallback = (reason: EncounterFallbackReason): EncounterSelection => ({...result, ...authoredEncounterCoverage(route, random),
    conditionedOn: [], fallbackReason: reason});
  if (options.context?.side !== undefined && route.enemySide !== undefined && options.context.side !== route.enemySide ||
    options.context?.phase !== undefined && route.phase !== undefined && options.context.phase !== route.phase) return fallback('context-conflict');
  const evidence = catalog.encounters;
  if (!evidence) {result.unavailableFields = [...fields]; return fallback('no-evidence');}
  result.evidence.errors = validateEncounterEvidence(evidence, catalog, options.build);
  if (result.evidence.errors.length) return fallback('invalid-evidence');
  result.evidence.revision = evidence.revision;
  const relevantSources = evidence.sources.filter(source => evidence.observations.some(row => row.routeId === route.id && row.sourceId === source.id));
  result.evidence.provenance = relevantSources;
  result.unavailableFields = fields.filter(field => !relevantSources.some(source => source.fields[field]));
  if (result.unavailableFields.length) return fallback('unsupported-context');
  // A source with unknown/restricted rights cannot be silently published via sampling.
  if (relevantSources.some(source => source.rights.status !== 'approved')) return fallback('rights-not-approved');
  const validation = validateHeldoutEncounters(evidence, route.id, context);
  result.conditionedOn = [...fields];
  Object.assign(result.evidence, {trainObservations: validation.train.length, trainMatches: validation.trainMatches,
    heldoutObservations: validation.heldout.length, heldoutMatches: validation.heldoutMatches,
    totalVariation: validation.totalVariation, unseenSetupShare: validation.unseenSetupShare, confidence: 'insufficient-support'});
  const policy = PREFIRE_ENCOUNTER_POLICY;
  if (validation.trainMatches < policy.minTrainMatches || validation.train.length < policy.minTrainObservations ||
    validation.heldoutMatches < policy.minHeldoutMatches || validation.heldout.length < policy.minHeldoutObservations) return fallback('low-support');
  if (validation.totalVariation === null || validation.totalVariation > policy.maxTotalVariation ||
    validation.unseenSetupShare === null || validation.unseenSetupShare > policy.maxUnseenSetupShare) return fallback('heldout-failed');
  const setups = [...validation.distribution.values()];
  let value = draw(random) * setups.reduce((sum, setup) => sum + setup.weight, 0), selected = setups[setups.length - 1];
  for (const setup of setups) {value -= setup.weight; if (value < 0) {selected = setup; break;}}
  const ids = new Set(selected.observations[0].members.map(member => member.angleId));
  result.angles = prefireCandidates(route).filter(angle => ids.has(angleIdentity(angle)));
  result.mode = 'contextual-evidence';
  result.label = 'Observed joint setups; match-balanced, context-filtered training sample';
  result.evidence.confidence = 'heldout-supported';
  result.evidence.selectedSetupObservations = selected.observations.length;
  result.evidence.selectedSetupMatches = new Set(selected.observations.map(row => row.matchId)).size;
  const selectedSources = new Set(selected.observations.map(row => row.sourceId));
  result.evidence.provenance = evidence.sources.filter(source => selectedSources.has(source.id));
  return result;
}
