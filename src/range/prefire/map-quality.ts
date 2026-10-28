import {angleIdentity, prefireCandidates} from './occupancy';
import {isSha256, samePrefireBuild, validateEncounterEvidence} from './encounter-evidence';
import {choosePrefireEncounter} from './encounters';
import type {PrefireBuildIdentity, PrefireCatalog, PrefireRoute} from './schema';

export const PREFIRE_MAP_GATES = ['geometry', 'materials', 'routes', 'entry-starts', 'cover', 'visibility', 'traversal', 'shots', 'evidence'] as const;
export type PrefireMapGate = typeof PREFIRE_MAP_GATES[number];
export type PrefireMapQuality = {
  schemaVersion: 1; build: PrefireBuildIdentity;
  routeKeys: Readonly<Record<string, string>>;
  checks: readonly {gate: PrefireMapGate; routeId?: string; status: 'passed' | 'failed' | 'missing' | 'authored-only';
    cases: number; reportSha256?: string; note: string}[];
};

/** Serialized geometry inputs, not a security hash; tools pin report bytes separately. */
export const prefireRouteQualityKey = (route: PrefireRoute) => JSON.stringify({
  id: route.id, side: route.enemySide, phase: route.phase, spawn: route.spawn, look: route.look, path: route.path,
  angles: prefireCandidates(route).map(angle => ({id: angleIdentity(angle), position: angle.position, rotation: angle.rotation,
    crouched: !!angle.crouched, moving: !!angle.moving, peek: angle.peek, exclusionGroup: angle.exclusionGroup})),
  lineups: route.lineups?.map(lineup => ({id: lineup.id, angles: lineup.angles.map(angleIdentity)})),
});

/** Required map-admission gates. Missing is never silently interpreted as passed. */
export function validatePrefireMapQuality(catalog: PrefireCatalog, build: PrefireBuildIdentity,
  report?: PrefireMapQuality, mode: 'coverage' | 'contextual-evidence' = 'coverage'): string[] {
  const errors: string[] = [];
  if (!report || report.schemaVersion !== 1 || !samePrefireBuild(report.build, build) ||
    build.mapId !== catalog.id || build.catalogRevision !== catalog.revision || !build.gameBuild.trim() || !isSha256(build.geometrySha256))
    return ['Missing, invalid or stale map quality report/build identity.'];
  if (!catalog.routes.length || new Set(catalog.routes.map(route => route.id)).size !== catalog.routes.length) errors.push('Missing/duplicate routes.');
  for (const route of catalog.routes) {
    const points = [route.spawn, route.look, ...route.path, ...prefireCandidates(route).map(angle => angle.position)];
    if (!route.path.length || !route.angles.length || points.some(point => point.length !== 3 || !point.every(Number.isFinite)))
      errors.push(`Invalid route coordinates: ${route.id}.`);
    if (report.routeKeys[route.id] !== prefireRouteQualityKey(route)) errors.push(`Stale route/entry/pocket inputs: ${route.id}.`);
  }
  for (const check of report.checks) if (!PREFIRE_MAP_GATES.includes(check.gate) ||
    check.routeId !== undefined && !catalog.routes.some(route => route.id === check.routeId)) errors.push('Unknown quality gate/route.');
  for (const gate of PREFIRE_MAP_GATES) {
    const routeIds = ['geometry', 'materials', 'evidence'].includes(gate) ? [undefined] : catalog.routes.map(route => route.id);
    for (const routeId of routeIds) {
      const checks = report.checks.filter(check => check.gate === gate && check.routeId === routeId);
      const check = checks[0];
      if (checks.length !== 1 || !check || !check.note.trim()) {errors.push(`Missing/duplicate ${gate} gate${routeId ? `: ${routeId}` : ''}.`); continue;}
      if (gate === 'evidence' && mode === 'coverage' && check.status === 'authored-only' && !catalog.encounters) continue;
      if (check.status !== 'passed' || !Number.isSafeInteger(check.cases) || check.cases < 1 || !isSha256(check.reportSha256))
        errors.push(`Unproven ${gate} gate${routeId ? `: ${routeId}` : ''}.`);
    }
  }
  if (catalog.encounters) errors.push(...validateEncounterEvidence(catalog.encounters, catalog, build));
  if (mode === 'contextual-evidence' && !catalog.encounters) errors.push('No contextual encounter evidence.');
  if (mode === 'contextual-evidence' && catalog.encounters && !errors.length) for (const route of catalog.routes) {
    const selection = choosePrefireEncounter(catalog, route, () => 0, {build});
    if (selection.mode !== 'contextual-evidence') errors.push(`Encounter heldout/support gate failed: ${route.id} (${selection.fallbackReason}).`);
  }
  return errors;
}
