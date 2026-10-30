import {UNIT, type Vec} from '../actor-physics';
import type {PrefireCatalog, PrefireRoute} from '../prefire/schema';
import {angleIdentity, prefireCandidates} from '../prefire/occupancy';
import {placePrefireTarget} from '../prefire/placement';
import {createPrefireBotPlan, densePrefireRouteViews, prefireRouteViews, revealsPrefireStart,
  validPrefireExcursion} from '../prefire/bot-behavior';
import type {PrefireMap} from '../prefire/map';
import type {PrefireAngle} from '../prefire/schema';
import type {CoverLane} from './geometry';
import {nativeClearSegment} from './native-navigation';
import {nativeLaneRole} from './tactical-geometry';
import {randomStream} from './rng';

type Chunk = {id: string; routeId: string; sourceMin: readonly number[]; sourceMax: readonly number[]};
export type RoundHold = {angle: PrefireAngle; source: Vec; sheltered: Vec; lane: CoverLane};
export type RoundStart = {feet: Vec; viewIndex: number; holds: string[]};
export type RoundCourse = {id: string; name: string; views: Vec[]; walk: Vec[]; holds: RoundHold[]; starts: RoundStart[]};
export type RoundCatalog = {version: number; chunks: Record<string, {collisionSha256: string; courses: RoundCourse[]}>};
export function chooseRealMapCourse(courses: readonly RoundCourse[], standard: string, choice: string, seed: number): RoundCourse {
  if (!courses.length) throw new Error('No authored courses available for this chunk.');
  if (choice === 'shuffle') return courses[Math.floor(randomStream(seed, 'duel-approach')() * courses.length)];
  const course = courses.find(course => course.id === (choice === 'standard' ? standard : choice));
  if (course) return course;
  if (choice === 'standard') return courses[0];
  throw new Error('The selected course is not available in this chunk.');
}
export function chooseRealMapStart(course: RoundCourse, choice: string, seed: number): RoundStart {
  if (!course.starts.length) throw new Error('No supported covered entry for this course.');
  if (choice === 'shuffle') return course.starts[Math.floor(randomStream(seed, 'duel-covered-start')() * course.starts.length)];
  // Standard practice begins at the course's first validated covered entry,
  // rather than jumping into a random middle segment of the clear every round.
  return course.starts.reduce((first, entry) => entry.viewIndex < first.viewIndex ? entry : first);
}
const inside = (chunk: Chunk, point: readonly number[]) => point[0] > chunk.sourceMin[0] + 17 &&
  point[0] < chunk.sourceMax[0] - 17 && point[1] > chunk.sourceMin[1] + 17 &&
  point[1] < chunk.sourceMax[1] - 17 && point[2] >= chunk.sourceMin[2] && point[2] <= chunk.sourceMax[2];

export function realMapApproaches(chunk: Chunk, catalog: PrefireCatalog): readonly PrefireRoute[] {
  return catalog.routes.filter(route => [route.spawn, ...route.path].every(point => inside(chunk, point)));
}

// Shared sourced/native-validated positions, not guessed encounter probabilities.
export function realMapHoldPool(chunk: Chunk, catalog: PrefireCatalog): PrefireAngle[] {
  return catalog.routes.flatMap(prefireCandidates).filter((angle, index, all) => inside(chunk, angle.position) &&
    all.findIndex(other => angleIdentity(other) === angleIdentity(angle)) === index);
}

// Offline authoring only. The browser consumes the pinned result and does no
// excursion search, roster LOS scan or navigation bake when starting a round.
export function buildRealMapCourses(map: PrefireMap, chunk: Chunk, catalog: PrefireCatalog): RoundCourse[] {
  const arena={minX:chunk.sourceMin[0]*UNIT,maxX:chunk.sourceMax[0]*UNIT,
    minZ:-chunk.sourceMax[1]*UNIT,maxZ:-chunk.sourceMin[1]*UNIT,solids:[],native:map.collision};
  const candidates = realMapHoldPool(chunk,catalog);
  const courses: RoundCourse[] = [];
  for (const route of realMapApproaches(chunk,catalog)) {
    const views = prefireRouteViews([route.spawn, ...route.path], map.collision);
    const holds: RoundHold[] = [];
    for (const angle of candidates) {
      const source = placePrefireTarget(map.collision, angle.position, angle.crouched);
      // Duel can transition into standing movement; don't borrow a crouch-only
      // Prefire pocket and then command its actor to stand inside native cover.
      if (!map.collision.fits(source, source.y, 72 * UNIT)) continue;
      if (!nativeClearSegment(source,source,arena)) continue;
      const plan = createPrefireBotPlan(map.collision, {...angle, source: undefined, moving: true}, true, views);
      if (!plan.watchPoint) continue;
      let sheltered = plan.attackFromAnchor && plan.exposure ? plan.exposure : source;
      let edge = plan.attackFromAnchor ? source : plan.exposure ?? source;
      if (!validPrefireExcursion(map.collision, sheltered, edge, false, []) ||
        !nativeClearSegment(sheltered,edge,arena) || !nativeClearSegment(edge,sheltered,arena)) sheltered = edge = source;
      const dx = edge.x - sheltered.x, dz = edge.z - sheltered.z, length = Math.hypot(dx, dz);
      const vx = plan.watchPoint.x - source.x, vz = plan.watchPoint.z - source.z, range = Math.hypot(vx, vz) || 1;
      // Peek handedness relative to the watch, never a world-X hemisphere.
      const lane: CoverLane = {side: vx * dz - vz * dx >= 0 ? 1 : -1,
        anchor: sheltered, edge, retreat: sheltered, watch: plan.watchPoint,
        axis: length > .01 ? {x: dx / length, z: dz / length} : {x: -vz / range, z: vx / range}};
      lane.role = nativeLaneRole(lane, views);
      holds.push({angle, source, sheltered, lane});
    }
    if (holds.length < 5) continue;
    const starts: RoundStart[] = [];
    // Keep starts in the opening half of the approach. Later starts shorten a
    // rep, but never spawn beyond the fighting area or openly facing a defender.
    const indices = [0, 1, 2, 3, 4, 6, 8].filter(i => i < Math.min(views.length - 1, Math.ceil(views.length * .5)));
    for (const viewIndex of indices) {
      const view = views[viewIndex], feet = {...view, y: view.y - 64 * UNIT};
      if (!map.collision.fits(feet, feet.y, 72 * UNIT)) continue;
      const available = holds.filter(hold => Math.hypot(hold.source.x - feet.x, hold.source.z - feet.z) >= 5 &&
        !revealsPrefireStart(map.collision, hold.source, !!hold.angle.crouched, view) &&
        !revealsPrefireStart(map.collision, hold.sheltered, false, view)).map(hold => angleIdentity(hold.angle));
      if (available.length >= 5) starts.push({feet, viewIndex, holds: available});
    }
    if (starts.length) courses.push({id: route.id, name: route.name, views,
      walk: densePrefireRouteViews(views).map(view => ({...view, y: view.y - 64 * UNIT})), holds, starts});
  }
  if (!courses.length) throw new Error(`No covered Duel approaches in ${chunk.id}`);
  return courses;
}
