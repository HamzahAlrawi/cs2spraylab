import {DEG, UNIT, type Vec} from '../actor-physics';
import {moveOnTerrain} from '../actor-collision';
import type {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import {sourcePoint} from './route-helpers';
import type {PrefireAngle, SourcePoint} from './schema';
import {actorHeadPoint, traceActor} from '../duel/geometry';

export type PrefireBotBehavior = 'hold' | 'crouch-hide' | 'periodic-peek' | 'move-out';
export type PrefirePeekStyle = 'quick' | 'wide' | 'crouch';
type BehaviorSpec = {kind: PrefireBotBehavior; side?: 1 | -1; style?: PrefirePeekStyle};

// Local training variations, keyed to the pinned source sample, not population order.
export const prefireBotCatalog: Readonly<Record<string, BehaviorSpec>> = {
  'a_long/2': {kind: 'move-out', side: 1},
  'a_long/9': {kind: 'periodic-peek', side: -1},
  'a_long/11': {kind: 'hold'},
  'a_long/4': {kind: 'move-out', side: 1, style: 'wide'},
  'a_long/10': {kind: 'hold'},
  'a_long/19': {kind: 'periodic-peek', side: -1},
  'a_long/20': {kind: 'crouch-hide'},
  'a_long/23': {kind: 'crouch-hide'},
  'a_long/34': {kind: 'hold'},
  'a_long/35': {kind: 'hold'},
  'a_short/9': {kind: 'move-out', side: 1},
  'a_short/10': {kind: 'periodic-peek', side: -1},
  'a_short/11': {kind: 'hold'},
  'a_short/13': {kind: 'periodic-peek', side: 1, style: 'crouch'},
  'a_short/18': {kind: 'hold'},
  'b_tunnel/11': {kind: 'move-out', side: -1},
  'b_tunnel/9': {kind: 'periodic-peek', side: 1},
  'b_tunnel/13': {kind: 'crouch-hide'},
  'b_tunnel/10': {kind: 'crouch-hide'},
  'b_tunnel/16': {kind: 'periodic-peek', side: -1},
  'mid_to_b/30': {kind: 'move-out', side: 1},
  'mid_to_b/37': {kind: 'hold'},
  'mid_to_b/46': {kind: 'hold'},
  'mid_to_b/39': {kind: 'crouch-hide'},
  'mid_to_b/36': {kind: 'periodic-peek', side: -1, style: 'crouch'},
  'mid_to_b/27': {kind: 'move-out', side: 1},
  'a_long/33': {kind: 'periodic-peek', side: -1},
  'a_long/31': {kind: 'hold'},
  'a_long/30': {kind: 'hold'},
  'mid_to_b/19': {kind: 'periodic-peek', side: 1},
  'ct_push_lower/7': {kind: 'move-out', side: -1},
  'ct_push_lower/8': {kind: 'periodic-peek', side: 1},
  'ct_push_lower/14': {kind: 'hold'},
  'ct_push_lower/16': {kind: 'periodic-peek', side: -1},
  'ct_push_lower/17': {kind: 'hold'},
  'a_short/19': {kind: 'move-out', side: -1},
  'a_short/21': {kind: 'periodic-peek', side: 1},
  'a_short/23': {kind: 'periodic-peek', side: -1},
  'a_short/15': {kind: 'hold'},
};

export type BotCollision = Pick<NativeMapCollision, 'vertical' | 'fits' | 'sweep' | 'ray'>;
export const PREFIRE_ENDPOINT_RADIUS = 2 * UNIT;
export const PREFIRE_MIN_PEEK_LATERALNESS = .7;
// Coarse planner views keep excursion searches bounded. Reuse the supported
// 8u walk only when those views miss a narrow native sightline.
const supportedRouteViews = new WeakMap<readonly Vec[], readonly Vec[]>();
export function densePrefireRouteViews(views:readonly Vec[]):readonly Vec[] {
  return supportedRouteViews.get(views) ?? views;
}

export function prefirePeekLateralness(home: Vec, attack: Vec, view: Vec): number {
  const dx = attack.x - home.x, dz = attack.z - home.z;
  const vx = view.x - home.x, vz = view.z - home.z;
  const length = Math.hypot(dx, dz) * Math.hypot(vx, vz);
  return length > .01 ? Math.abs(dx * vz - dz * vx) / length : 0;
}
export type PrefireBotPlan = {
  key: string;
  kind: PrefireBotBehavior;
  anchor: Vec;
  exposure?: Vec;
  sourceCrouched: boolean;
  // Standing travel is allowed only after validating that hull and spawn cover.
  travelCrouched?: boolean;
  peekStyle?: PrefirePeekStyle;
  intent?: 'check-recover' | 'take-angle';
  // Offline route sightline for pre-aim, never a live/hidden player position.
  watchPoint?: Vec;
  // Static, validated course views for area pre-aim after losing a contact.
  approachViews?: readonly Vec[];
  // Optional bounded continuation from the fighting endpoint, never a route to
  // the live player. Only recent recognized evidence can authorize using it.
  pressure?: {endpoint: Vec; travelCrouched: boolean};
  // Some source samples are the exposed fighting point. Start there unchanged,
  // then physically retreat to the validated endpoint before repeating the peek.
  attackFromAnchor?: boolean;
};

export function prefireBotKey(angle: PrefireAngle): string {
  const source = angle.source as (NonNullable<PrefireAngle['source']> & {datasetId?: string; dataset?: string}) | undefined;
  const dataset = source?.datasetId ?? source?.dataset;
  if (angle.id && dataset && dataset !== 'openprefire') return angle.id;
  if (!source) return `local:${angle.position.join(',')}`;
  const prefix = dataset && dataset !== 'openprefire' ? `${dataset}:` : '';
  return `${prefix}${source.profile}/${source.index}`;
}

export function hasPrefireSight(collision: Pick<BotCollision, 'ray'>, from: Vec, to: Vec): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, distance = Math.hypot(dx, dy, dz);
  return distance > .01 && !collision.ray(from, {x: dx / distance, y: dy / distance, z: dz / distance}, distance - .01);
}

export function revealsPrefireStart(collision: BotCollision, feet: Vec, crouched: boolean, spawnEye: Vec, yaw?: number) {
  // Plan-time extrema only. The dense shoulder/crown grid is an offline audit,
  // not hundreds of rays on every simulation tick.
  const duck = crouched ? 18 : 0;
  for (const height of [46, 64]) {
    const eye = {...spawnEye, y: spawnEye.y + (height - 64) * UNIT};
    for (const [radius, y] of [[20, 40], [20, 56], [14, 64], [14, 72]]) {
      for (const [x, z] of [[0, 0], [-radius, -radius], [-radius, radius], [radius, -radius], [radius, radius]]) {
        if (hasPrefireSight(collision, eye, {x: feet.x + x * UNIT, y: feet.y + (y - duck) * UNIT, z: feet.z + z * UNIT})) return true;
      }
    }
    const head = actorHeadPoint(feet, crouched ? 1 : 0, yaw);
    for (const x of [-.135, 0, .135]) for (const z of [-.135, 0, .135]) {
      if (hasPrefireSight(collision, eye, {...head, x: head.x + x, y: head.y + .135, z: head.z + z})) return true;
    }
  }
  return false;
}

function visibleUpperBody(collision: BotCollision, feet: Vec, crouched: boolean, eye: Vec, yaw?: number) {
  // Plan-time hit-zone probes prevent an occluded eye from being mistaken for
  // a fully hidden crown/shoulder. No silhouette scan runs in command().
  const head = actorHeadPoint(feet, crouched ? 1 : 0, yaw);
  if (hasPrefireSight(collision, eye, head)) return true;
  for (const height of [32, 40, 48, 56, 64, 68, 72]) for (const x of [-.4, -.31, -.22, -.135, 0, .135, .22, .31, .4]) {
    for (const z of [-.17, 0, .17]) {
      const target = {x: feet.x + x, y: feet.y + (height - (crouched ? 18 : 0)) * UNIT, z: feet.z + z};
      const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
      if (d < .01) continue;
      const direction = {x: (target.x - eye.x) / d, y: (target.y - eye.y) / d, z: (target.z - eye.z) / d};
      const hit = traceActor(eye, direction, feet, crouched, d + .5, yaw);
      if (hit.group && hit.group !== 'leg' && Number.isFinite(hit.distance) &&
        !collision.ray(eye, direction, Math.max(0, hit.distance - .0001))) return true;
    }
  }
  return false;
}

export function validPrefireExcursion(collision: BotCollision, anchor: Vec, target: Vec, crouched: boolean,
  reserved: readonly Vec[] = []): boolean {
  const height = (crouched ? 54 : 72) * UNIT, length = Math.hypot(target.x - anchor.x, target.z - anchor.z);
  if (length < 16 * UNIT || length > 128 * UNIT || Math.abs(target.y - anchor.y) > 3 * UNIT) return false;
  for (const [from, to] of [[anchor, target], [target, anchor]]) {
    const sweep = collision.sweep(from, to, height);
    if (sweep.startSolid || sweep.fraction < .999) return false;
  }
  const steps = Math.ceil(length / (8 * UNIT));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = {x: anchor.x + (target.x - anchor.x) * t, y: anchor.y + (target.y - anchor.y) * t,
      z: anchor.z + (target.z - anchor.z) * t};
    const support = collision.vertical(p, p.y + 3 * UNIT, p.y - 3 * UNIT, height);
    if (!support.grounded || Math.abs(support.feet - p.y) > 3 * UNIT || !collision.fits(p, support.feet, height)) return false;
    if (reserved.some(other => Math.hypot(other.x - anchor.x, other.z - anchor.z) > .01 &&
      Math.abs(other.y - p.y) < 72 * UNIT && Math.hypot(other.x - p.x, other.z - p.z) < 34 * UNIT)) return false;
  }
  return true;
}

export function createPrefireBotPlan(collision: BotCollision, angle: PrefireAngle, enabled: boolean,
  views: readonly Vec[] = [], reserved: readonly Vec[] = [], forTrade = false): PrefireBotPlan {
  const anchor = placePrefireTarget(collision, angle.position, angle.crouched), key = prefireBotKey(angle);
  const spec: BehaviorSpec = forTrade ? {kind: 'move-out'} :
    prefireBotCatalog[key] ?? {kind: angle.moving ? 'move-out' : angle.peek ? 'periodic-peek' : 'hold'};
  const plan: PrefireBotPlan = {key, anchor, kind: enabled ? spec.kind : 'hold', sourceCrouched: !!angle.crouched,
    ...(views.length ? {approachViews: views} : {})};
  const facing = angle.rotation ? (angle.rotation[1] - 90) * DEG : undefined;
  // A source facing belongs to its original full course. Shorter approaches
  // need their own first reachable threat angle, including stationary holders.
  const eye = {...anchor, y: anchor.y + (angle.crouched ? 46 : 64) * UNIT};
  let watch = views.find(view => hasPrefireSight(collision, eye, view) ||
    visibleUpperBody(collision, anchor, !!angle.crouched, view, facing));
  const supported = supportedRouteViews.get(views);
  if (!watch && supported) {
    watch = supported.find(view => {
      const yaw = Math.atan2(-(view.x - anchor.x), -(view.z - anchor.z));
      return hasPrefireSight(collision, eye, view) ||
        hasPrefireSight(collision, view, actorHeadPoint(anchor, !!angle.crouched, yaw));
    });
    if (watch) {
      const selected = new Set([...views, watch]);
      views = supported.filter(view => selected.has(view));
      plan.approachViews = views;
    }
  }
  if (watch) plan.watchPoint = {...watch};
  if (plan.kind === 'hold') return plan;
  const coveredStart = !!views[0] && !revealsPrefireStart(collision, anchor, !!angle.crouched, views[0], facing);
  if (plan.kind === 'crouch-hide') {
    const stands = collision.fits(anchor, anchor.y, 72 * UNIT);
    const lowCover = views.some(view => hasPrefireSight(collision, {...anchor, y: anchor.y + 64 * UNIT}, view) &&
      !hasPrefireSight(collision, {...anchor, y: anchor.y + 46 * UNIT}, view) &&
      visibleUpperBody(collision, anchor, false, view, facing) && !visibleUpperBody(collision, anchor, true, view, facing));
    if (!stands || !lowCover || coveredStart && revealsPrefireStart(collision, anchor, false, views[0], facing)) plan.kind = 'hold';
    return plan;
  }
  if (!views.length) {plan.kind = 'hold'; return plan;}
  const style = spec.style ?? (plan.kind === 'move-out' ? 'wide' : 'quick');
  const fightingCrouched = !!angle.crouched || style === 'crouch';
  const candidates: SourcePoint[] = angle.peek ? [angle.peek] : [];
  const axes: number[] = [];
  const addAxis = (yaw: number) => {
    if (!axes.some(axis => Math.abs(Math.atan2(Math.sin(yaw - axis), Math.cos(yaw - axis))) < .25)) axes.push(yaw);
  };
  if (watch) addAxis(Math.atan2(-(watch.z - anchor.z), watch.x - anchor.x));
  if (angle.rotation) addAxis(angle.rotation[1] * DEG);
  // A shortened course can approach an anchor from a different side than the
  // original sample. Derive a bounded extra axis from its nearest route view.
  const nearest = views.reduce<Vec | undefined>((best, view) => !best ||
    Math.hypot(view.x - anchor.x, view.z - anchor.z) < Math.hypot(best.x - anchor.x, best.z - anchor.z) ? view : best, undefined);
  if (nearest) addAxis(Math.atan2(-(nearest.z - anchor.z), nearest.x - anchor.x));
  const preferred = spec.side ?? 1;
  for (const yaw of axes) {
    const offsets = [90 * preferred, -90 * preferred, 60 * preferred, -60 * preferred, 120 * preferred, -120 * preferred,
      ...(forTrade ? [0, 180] : [])];
    for (const distance of [112, 80, 56, 32]) for (const offset of offsets) {
      const direction = yaw + offset * DEG;
      candidates.push([angle.position[0] + Math.cos(direction) * distance,
        angle.position[1] + Math.sin(direction) * distance, angle.position[2]]);
    }
  }
  const fightingEye = (p: Vec) => ({...p, y: p.y + (fightingCrouched ? 46 : 64) * UNIT});
  const anchorVisible = views.map(view => hasPrefireSight(collision, fightingEye(anchor), view));
  const anchorBodyVisible = views.map(view => visibleUpperBody(collision, anchor, !!angle.crouched, view, facing));
  let best = -Infinity;
  for (const point of candidates) {
    let candidate: Vec;
    try {candidate = placePrefireTarget(collision, point, angle.crouched);} catch {continue;}
    if (!validPrefireExcursion(collision, anchor, candidate, !!angle.crouched, reserved)) continue;
    const travelCrouched = !!angle.crouched && !validPrefireExcursion(collision, anchor, candidate, false, reserved);
    let standingTravel = !travelCrouched;
    if (coveredStart) {
      const steps = Math.ceil(Math.hypot(candidate.x - anchor.x, candidate.z - anchor.z) / (8 * UNIT));
      let revealsStart = false;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, p = {x: anchor.x + (candidate.x - anchor.x) * t,
          y: anchor.y + (candidate.y - anchor.y) * t, z: anchor.z + (candidate.z - anchor.z) * t};
        if (revealsPrefireStart(collision, p, !!angle.crouched, views[0], facing)) {revealsStart = true; break;}
        if (angle.crouched && standingTravel && revealsPrefireStart(collision, p, false, views[0], facing)) standingTravel = false;
      }
      if (revealsStart) continue;
    }
    const candidateVisible = views.map(view => hasPrefireSight(collision, fightingEye(candidate), view));
    const bodyCache: (boolean | undefined)[] = [];
    const candidateBodyVisible = (index: number) => bodyCache[index] ??=
      visibleUpperBody(collision, candidate, !!angle.crouched, views[index], facing);
    // A real check has one hidden endpoint and a usable firing sightline at the
    // other, for the SAME route view. A blocked eye alone is not concealment.
    const gains = views.some((_, i) => !anchorBodyVisible[i] && candidateVisible[i] && candidateBodyVisible(i));
    const losses = !gains && views.some((_, i) => anchorVisible[i] && anchorBodyVisible[i] && !candidateBodyVisible(i));
    if (!gains && !losses) continue;
    const reverse = !gains && losses;
    const home = reverse ? candidate : anchor, attack = reverse ? anchor : candidate;
    const viewIndex = views.findIndex((view, i) => {
      if (!(reverse ? anchorVisible[i] && !candidateBodyVisible(i) : candidateVisible[i] && !anchorBodyVisible[i])) return false;
      // A trader may push forward toward fresh evidence. Ordinary angle checks
      // must remain lateral; neither case may bypass native cover/support.
      if (!forTrade && prefirePeekLateralness(home, attack, view) < PREFIRE_MIN_PEEK_LATERALNESS) return false;
      const yaw = Math.atan2(-(view.x - home.x), -(view.z - home.z));
      // The controller settles near an endpoint, not exactly on it. Certify the
      // approach-side margin at its actual pre-aim facing as well as its center.
      const length = Math.hypot(attack.x - home.x, attack.z - home.z);
      const nearHome = {x: home.x + (attack.x - home.x) / length * PREFIRE_ENDPOINT_RADIUS,
        y: home.y, z: home.z + (attack.z - home.z) / length * PREFIRE_ENDPOINT_RADIUS};
      const nearAttack = {x: attack.x + (home.x - attack.x) / length * PREFIRE_ENDPOINT_RADIUS,
        y: attack.y, z: attack.z + (home.z - attack.z) / length * PREFIRE_ENDPOINT_RADIUS};
      return !visibleUpperBody(collision, home, !!angle.crouched, view, yaw) &&
        !visibleUpperBody(collision, nearHome, !!angle.crouched, view, yaw) &&
        hasPrefireSight(collision, fightingEye(attack), view) && hasPrefireSight(collision, fightingEye(nearAttack), view);
    });
    if (viewIndex < 0) continue;
    const watchYaw = Math.atan2(-(views[viewIndex].x - attack.x), -(views[viewIndex].z - attack.z));
    // A valid firing view farther along the route is not useful if the swing
    // first presents its back to an earlier, already-hittable approach.
    // A death trade has a newly reported threat and overrides route pre-aim;
    // an earlier course entrance must not veto that evidence-led attempt.
    if (!forTrade && views.slice(0, viewIndex).some((view, i) => (reverse ? anchorBodyVisible[i] : candidateBodyVisible(i)) &&
      Math.abs(Math.atan2(Math.sin(Math.atan2(-(view.x - attack.x), -(view.z - attack.z)) - watchYaw),
        Math.cos(Math.atan2(-(view.x - attack.x), -(view.z - attack.z)) - watchYaw))) > 75 * DEG)) continue;
    const length = Math.hypot(candidate.x - anchor.x, candidate.z - anchor.z) / UNIT;
    // Prefer a coherent early approach and a lateral exit, not the number of
    // unrelated route points exposed by an otherwise awkward forward stroll.
    const score = -viewIndex * 2 + prefirePeekLateralness(home, attack, views[viewIndex]) +
      (style === 'quick' ? -length / 128 : length / 128);
    if (score > best) {
      best = score; plan.exposure = candidate;
      plan.peekStyle = style;
      plan.travelCrouched = !!angle.crouched && !standingTravel;
      plan.attackFromAnchor = reverse;
      plan.watchPoint = {...views[viewIndex]};
    }
  }
  if (!plan.exposure) plan.kind = 'hold';
  else {
    plan.intent = 'check-recover';
    if (plan.kind === 'move-out' && !forTrade) plan.pressure = pressureContinuation(collision, plan, views, reserved, coveredStart);
  }
  return plan;
}

function pressureContinuation(collision: BotCollision, plan: PrefireBotPlan, views: readonly Vec[],
  reserved: readonly Vec[], coveredStart: boolean): PrefireBotPlan['pressure'] {
  const attack = plan.attackFromAnchor ? plan.anchor : plan.exposure!, watch = plan.watchPoint!;
  const dx = watch.x - attack.x, dz = watch.z - attack.z, range = Math.hypot(dx, dz);
  // No stairs, jumps, blind corner chasing, or new pathfinding. A pressure lane
  // must be reversible and keep the same known opening in view throughout.
  if (range < 128 * UNIT) return;
  const others = reserved.filter(p => Math.hypot(p.x - plan.anchor.x, p.z - plan.anchor.z) > .01);
  const crouched = plan.travelCrouched ?? plan.sourceCrouched;
  const yaw = Math.atan2(-dx, -dz), fightingCrouched = plan.sourceCrouched || plan.peekStyle === 'crouch';
  const earlierViews = views.slice(0, views.findIndex(view => view.x === watch.x && view.y === watch.y && view.z === watch.z) + 1);
  const forward = Math.atan2(dz, dx);
  for (const units of [80, 56, 32]) for (const offset of [0, 30, -30, 45, -45]) {
    if (range - units * UNIT < 64 * UNIT) continue;
    const direction = forward + offset * DEG;
    const endpoint = {x: attack.x + Math.cos(direction) * units * UNIT, y: attack.y, z: attack.z + Math.sin(direction) * units * UNIT};
    if (!validPrefireExcursion(collision, attack, endpoint, crouched, others)) continue;
    const steps = Math.ceil(units / 8);
    let valid = true;
    for (let step = 0; step <= steps; step++) {
      const p = {x: attack.x + (endpoint.x - attack.x) * step / steps, y: attack.y,
        z: attack.z + (endpoint.z - attack.z) * step / steps};
      if (!hasPrefireSight(collision, {...p, y: p.y + (fightingCrouched ? 46 : 64) * UNIT}, watch) ||
        coveredStart && revealsPrefireStart(collision, p, crouched, views[0], yaw) ||
        earlierViews.some(view => Math.abs(Math.atan2(Math.sin(Math.atan2(-(view.x - p.x), -(view.z - p.z)) - yaw),
          Math.cos(Math.atan2(-(view.x - p.x), -(view.z - p.z)) - yaw))) > 75 * DEG &&
          visibleUpperBody(collision, p, crouched, view, yaw))) {valid = false; break;}
    }
    if (valid) return {endpoint, travelCrouched: crouched};
  }
}

export function prefireRouteViews(points: readonly SourcePoint[], collision?: BotCollision): Vec[] {
  const original = points.map(point => {
    const p = collision ? placePrefireTarget(collision, point) : sourcePoint(point);
    return {...p, y: p.y + 64 * UNIT};
  });
  if (!collision || original.length < 2) return original;
  const views: Vec[] = [], supported: Vec[] = [];
  for (let i = 0; i < original.length; i++) {
    views.push(original[i]);
    supported.push(original[i]);
    const next = original[i + 1];
    if (!next) continue;
    const length = Math.hypot(next.x - original[i].x, next.z - original[i].z);
    const segments = Math.min(16, Math.ceil(length / (128 * UNIT)));
    if (length < 8 * UNIT) continue;
    const budget = Math.ceil(length / (2 * UNIT)) + 256, interior: Vec[] = [], dense: Vec[] = [];
    let feet = {...original[i], y: original[i].y - 64 * UNIT}, valid = true, traveled = 0, nextCoarse = length / segments;
    for (let step = 1; step <= budget; step++) {
      const remaining = Math.hypot(next.x - feet.x, next.z - feet.z);
      if (remaining <= .025) break;
      const stride = Math.min(remaining, 2 * UNIT), previous = feet;
      const target = {x: feet.x + (next.x - feet.x) / remaining * stride,
        y: feet.y, z: feet.z + (next.z - feet.z) / remaining * stride};
      const moved = moveOnTerrain(feet, target, 72 * UNIT, {solids: [], floor: null, native: collision}, true);
      feet = moved.position;
      const support = collision.vertical(feet, feet.y + 6 * UNIT, feet.y - 6 * UNIT, 72 * UNIT);
      const progress = Math.hypot(feet.x - previous.x, feet.z - previous.z);
      if (!moved.grounded || progress < .0001 ||
        !support.grounded || !collision.fits(feet, support.feet, 72 * UNIT)) {valid = false; break;}
      traveled += progress;
      if (remaining > stride) {
        const view = {...feet, y: feet.y + 64 * UNIT};
        const coarse = segments >= 2 && traveled >= nextCoarse && interior.length < segments - 1;
        if (coarse || step % 4 === 0) dense.push(view);
        if (coarse) {interior.push(view); nextCoarse += length / segments;}
      }
    }
    // Retain authored waypoints, but never turn a wall-crossing chord or a
    // different floor into an invented threat/pre-aim position.
    if (valid && Math.hypot(feet.x - next.x, feet.z - next.z) <= .05 && Math.abs(feet.y + 64 * UNIT - next.y) <= 3 * UNIT) {
      views.push(...interior); supported.push(...dense);
    }
  }
  supportedRouteViews.set(views, supported);
  return views;
}
