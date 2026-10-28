import {UNIT} from '../actor-physics';
import type {CoachingSummary} from '../coaching-types';
import type {PrefireAngleReview} from './coaching';
import type {NativeMapCollision} from './native-collision';
import {angleIdentity, prefireCandidates} from './occupancy';
import {placePrefireTarget} from './placement';
import type {PrefireAngle, PrefireRoute, SourcePoint} from './schema';
import {prefireBodyExposed, prefireSpawnEyes, prefireUpperBodyExtrema, prefireUpperBodySamples, walkPrefireAuditPath} from './spawn-audit';

export function angleSummary(angle: PrefireAngleReview): CoachingSummary {
  const metric = (label: string, value: boolean | null) => ({label, value: value === null ? '--' : value ? 'Yes' : 'No', score: value === null ? null : value ? 100 : 0, detail: 'Measured on the opening of this angle.'});
  const metrics = [metric('Settled openings', angle.openingStopped), metric('Prepared aim', angle.readyAim),
    metric('Clean entries', angle.entry === null || angle.openingStopped === null ? null : angle.entry && angle.openingStopped && angle.readyAim !== false && angle.threats <= 1),
    metric('Opening hit', angle.openingHit)];
  const scores = metrics.flatMap(row => row.score === null ? [] : [row.score]);
  return {score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, focus: angle.name,
    evidence: angle.message, action: angle.tip, goal: 'Repeat a settled, prepared entry.', metrics,
    confidence: 'One angle opening. Unobserved skills remain unknown.'};
}

// Retry starts come only from the already-authored route, never arbitrary nearby coordinates.
// Validate the walk once, then retain the last fully covered sample before first exposure.
export function coveredAngleRetry(collision: NativeMapCollision, route: PrefireRoute, identity: string): PrefireRoute | undefined {
  const angle = prefireCandidates(route).find(row => angleIdentity(row) === identity);
  if (!angle) return;
  try {
    const bodies = [angle.position, ...(angle.peek ? [angle.peek] : [])].flatMap(point => {
      const feet = placePrefireTarget(collision, point, angle.crouched);
      return [prefireUpperBodySamples(feet), prefireUpperBodySamples(feet, true)];
    });
    const extrema = [angle.position, ...(angle.peek ? [angle.peek] : [])].flatMap(point => {
      const feet = placePrefireTarget(collision, point, angle.crouched);
      return [prefireUpperBodyExtrema(feet), prefireUpperBodyExtrema(feet, true)];
    });
    const walked = walkPrefireAuditPath(collision, [route.spawn, ...route.path]);
    let start: SourcePoint | undefined, startIndex = 0, exposedIndex = 0;
    const coveredCandidates: number[] = [];
    let exposed = false;
    for (let i = 0; i < walked.length; i += 4) {
      const feet = walked[i], eyes = prefireSpawnEyes(feet);
      if (prefireBodyExposed(collision, eyes, extrema)) {exposed = true; exposedIndex = i; break;}
      if (i % 16 === 0) coveredCandidates.push(i);
    }
    // Only densely test the nearest covered candidate, backing up if a narrow sliver is exposed.
    for (const index of coveredCandidates.reverse()) {
      const feet = walked[index];
      if (!prefireBodyExposed(collision, prefireSpawnEyes(feet), bodies)) {start = [feet.x / UNIT, -feet.z / UNIT, feet.y / UNIT]; startIndex = index; break;}
    }
    if (!start || !exposed) return;
    const path: SourcePoint[] = walked.slice(startIndex + 1, exposedIndex + 1).filter((_, index) => index % 4 === 0)
      .map(feet => [feet.x / UNIT, -feet.z / UNIT, feet.y / UNIT]);
    const end = walked[exposedIndex]; path.push([end.x / UNIT, -end.z / UNIT, end.y / UNIT]);
    return {...route, spawn: start, path, look: angle.position, angles: [angle], alternatives: [], lineups: undefined,
      startLabel: 'Validated covered entry retry'};
  } catch {return;}
}

export function selectedAngleIdentity(angles: readonly PrefireAngle[], id: number) {
  const angle = angles[id - 1]; return angle ? angleIdentity(angle) : undefined;
}
