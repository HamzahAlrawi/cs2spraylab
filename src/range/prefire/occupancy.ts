import type {HoldingDensity, PrefireAngle, PrefireRoute} from './schema';

export const PREFIRE_ACTOR_BUDGET = 5;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export const angleIdentity = (angle: PrefireAngle) => angle.id ?? `${angle.source?.dataset ?? 'openprefire'}:${
  angle.source?.profile ?? 'local'}/${angle.source?.index ?? angle.position.join(',')}`;
export const prefireCandidates = (route: PrefireRoute) => [...route.angles, ...route.alternatives ?? []]
  .filter((angle, index, all) => all.findIndex(other => angleIdentity(angle) === angleIdentity(other)) === index);

export const HOLD_RADIUS_UNITS = 96;
export const HOLD_HEIGHT_UNITS = 24;
export const PREFIRE_WEIGHT_POLICY = Object.freeze({
  id: 'match-balanced-regional-coverage-v1', coverageShare: .5,
  label: '50% family coverage / 50% match-balanced nearby hold support',
  interpretation: 'Training selection policy; centroid proximity is unverified regional evidence, not pocket or encounter probability.',
});

/** Count a sampled round once, regardless of repeat pauses or neighboring cells. */
export function holdingEvidence(angle: PrefireAngle, route: PrefireRoute, density?: HoldingDensity) {
  let episodes = 0, seconds = 0, matchedCells = 0;
  const side = route.enemySide ?? 'ct', context = route.phase ?? 'preplant';
  const layer = density?.schemaVersion === 1 ? density.layers?.find(layer => layer.side === side && layer.context === context) : undefined;
  const eligible = new Set(layer?.roundKeys?.filter(key => typeof key === 'string' && key.length) ?? []);
  const observed = new Set<string>();
  if (density?.schemaVersion === 1) for (const cell of density.cells) {
    if (cell.side !== side || cell.context !== context ||
      cell.position.length !== 3 || !cell.position.every(Number.isFinite)) continue;
    const xy = Math.hypot(cell.position[0] - angle.position[0], cell.position[1] - angle.position[1]);
    const z = Math.abs(cell.position[2] - angle.position[2]);
    if (xy > HOLD_RADIUS_UNITS || z > HOLD_HEIGHT_UNITS || !Number.isFinite(cell.episodeAnchors) || cell.episodeAnchors < 0 || !Number.isFinite(cell.seconds) || cell.seconds <= 0) continue;
    episodes += cell.episodeAnchors;
    seconds += Math.max(0, cell.seconds);
    for (const key of cell.roundKeys ?? []) if (eligible.has(key)) observed.add(key);
    matchedCells++;
  }
  const rounds = observed.size, sampleRounds = eligible.size;
  const matchCount = (keys: Iterable<string>) => new Set([...keys].filter(key => key.includes('/')).map(key => key.split('/')[0])).size;
  // Keep broad support and the old ticket diagnostic stable for existing callers.
  // Actual sampling uses selectionWeights, not this legacy 1+n value.
  return {episodes, seconds, matchedCells, rounds, sampleRounds, matches: matchCount(observed), sampleMatches: matchCount(eligible),
    roundKeys: [...observed], sampleRoundKeys: [...eligible], weight: 1 + rounds,
    trainingSupport: matchBalancedSupport(observed, eligible), weightPolicy: PREFIRE_WEIGHT_POLICY.id};
}

/** Each sampled match contributes equally, even when phase coverage differs. */
export function matchBalancedSupport(roundKeys: Iterable<string>, sampledKeys: Iterable<string>): number {
  const denominators = new Map<string, number>(), numerators = new Map<string, number>();
  const eligible = new Set(sampledKeys);
  for (const key of eligible) {
    const match = key.split('/')[0];
    denominators.set(match, (denominators.get(match) ?? 0) + 1);
  }
  for (const key of new Set(roundKeys)) if (eligible.has(key)) {
    const match = key.split('/')[0];
    numerators.set(match, (numerators.get(match) ?? 0) + 1);
  }
  return denominators.size ? [...denominators].reduce((sum, [match, count]) =>
    sum + (numerators.get(match) ?? 0) / count, 0) / denominators.size : 0;
}

type EvidenceEntry = {angle: PrefireAngle; evidence: ReturnType<typeof holdingEvidence>};
/** Recomputed only at roster selection, never during simulation frames. */
export function selectionWeights(entries: readonly EvidenceEntry[]) {
  const groups = new Map<string, {entries: EvidenceEntry[]; rounds: Set<string>; score: number}>();
  for (const entry of entries) {
    const key = entry.angle.exclusionGroup ? `family:${entry.angle.exclusionGroup}` : `angle:${angleIdentity(entry.angle)}`;
    const group = groups.get(key) ?? {entries: [], rounds: new Set<string>(), score: 0};
    group.entries.push(entry);
    for (const round of entry.evidence.roundKeys) group.rounds.add(round);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.score = group.entries.length === 1 ? group.entries[0].evidence.trainingSupport
    : matchBalancedSupport(group.rounds, group.entries[0].evidence.sampleRoundKeys);
  const total = [...groups.values()].reduce((sum, group) => sum + group.score, 0);
  const weights = new Map<PrefireAngle, number>(), coverage = PREFIRE_WEIGHT_POLICY.coverageShare;
  for (const group of groups.values()) {
    const familyWeight = total ? coverage / groups.size + (1 - coverage) * group.score / total : 1 / groups.size;
    const scores = group.entries.map(entry => entry.evidence.trainingSupport);
    const variantTotal = scores.reduce((sum, score) => sum + score, 0);
    for (const [index, entry] of group.entries.entries()) weights.set(entry.angle, familyWeight * (variantTotal
      ? coverage / scores.length + (1 - coverage) * scores[index] / variantTotal : 1 / scores.length));
  }
  return entries.map(entry => ({...entry, weight: weights.get(entry.angle)!}));
}

export function prefireAnglesIncompatible(a: PrefireAngle, b: PrefireAngle) {
  return angleIdentity(a) === angleIdentity(b) || !!a.exclusionGroup && a.exclusionGroup === b.exclusionGroup ||
    Math.abs(a.position[2] - b.position[2]) < 72 && Math.abs(a.position[0] - b.position[0]) < 32 && Math.abs(a.position[1] - b.position[1]) < 32;
}
const incompatible = prefireAnglesIncompatible;

function canFill(angles: readonly PrefireAngle[], count: number): boolean {
  if (count <= 0) return true;
  if (angles.length < count) return false;
  if (count === 1) return true;
  for (let index = 0; index <= angles.length - count; index++) {
    if (canFill(angles.slice(index + 1).filter(other => !incompatible(angles[index], other)), count - 1)) return true;
  }
  return false;
}

export function choosePrefireAngles(route: PrefireRoute, population: 'all' | 'random', random: () => number,
  density?: HoldingDensity, botsPerRun = 4): PrefireAngle[] {
  const cap = PREFIRE_ACTOR_BUDGET;
  const candidates = population === 'all' ? prefireCandidates({...route, alternatives: []}) : prefireCandidates(route);
  if (!candidates.length) throw new Error('Prefire course has no validated angles.');
  if (population === 'all') {
    if (candidates.length > cap) throw new Error('Split exhaustive Prefire courses to preserve the actor budget.');
    const selected: PrefireAngle[] = [];
    for (const angle of candidates) {
      if (selected.some(other => incompatible(angle, other))) throw new Error('Exhaustive course contains incompatible holds.');
      selected.push(angle);
    }
    return selected;
  }
  // Training density is an explicit setting, not an invented match statistic.
  const draw = () => clamp(random(), 0, 1 - Number.EPSILON);
  let targetCount = Math.min(candidates.length, clamp(Math.round(Number.isFinite(botsPerRun) ? botsPerRun : 4), 1, cap));
  while (!canFill(candidates, targetCount)) targetCount--;
  const pool = candidates.map(angle => ({angle, evidence: holdingEvidence(angle, route, density)}));
  const selected: PrefireAngle[] = [];
  while (pool.length && selected.length < targetCount) {
    // Do not let an overlapping alternative silently reduce the requested density.
    const available = pool.filter(entry => canFill(pool.filter(other => !incompatible(entry.angle, other.angle))
      .map(other => other.angle), targetCount - selected.length - 1));
    // Coverage is allocated per physical family, not per authored source record.
    const viable = selectionWeights(available);
    let value = draw() * viable.reduce((sum, entry) => sum + entry.weight, 0), picked = viable[viable.length - 1];
    for (const entry of viable) {value -= entry.weight; if (value < 0) {picked = entry; break;}}
    selected.push(picked.angle);
    for (let index = pool.length - 1; index >= 0; index--) if (incompatible(picked.angle, pool[index].angle)) pool.splice(index, 1);
  }
  // Preserve authored clearing order; randomization changes occupancy, not the
  // scorecard's angle sequence, source stance, or collision placement.
  return candidates.filter(angle => selected.includes(angle));
}
