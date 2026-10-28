import {clamp, type Vec} from '../actor-physics';
import {analyticActorBodyZones, type ActorHitPose} from './actor-hitboxes';
import {actorHeadPoint, traceSolid, type Arena} from './geometry';
import {pointInView, validSensorView, type SensorView, type VisibilityFilter} from './shadows';
import type {DuelActorSnapshot, Hitgroup} from './types';
import {fullyOccluded} from './visibility';

// Structural input also accepts Prefire actors. No animation or shot state is mutated.
export type VisibilityActor = Pick<DuelActorSnapshot, 'position' | 'feet' | 'duckAmount' | 'yaw'>;
export type SensorPoseProvider = (actor: DuelActorSnapshot) => ActorHitPose | undefined;
export type VisibilitySample = {point: Vec; group: Hitgroup; radius?: number; interiorMargin?: number; primary?: boolean};
export type VisibleHitgroupCandidate = {point: Vec; group: Hitgroup;
  /** Confirmed visible probes / all possible group probes: a lower bound, not full-body exposure. */
  exposure: number; exposureMargin: number;
  /** Checked probes / all possible group probes; the remainder is unknown. */
  sampleCoverage?: number};
export const MAX_VISIBILITY_SAMPLES = 64;
export const MAX_VISIBILITY_RAYS = 24;
export const MAX_VISIBLE_CANDIDATES = 10;
const MAX_CAPSULES = 19;
// Contains the same feet+1 / radius-2.5 query sphere used by shot broadphase.
const SENSOR_ENVELOPE = {radius: 2.5, low: -1.5, high: 3.5};
const finite = (v: Vec) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
function silhouetteAxes(eye: Vec, point: Vec) {
  const dx = eye.x - point.x, dy = eye.y - point.y, dz = eye.z - point.z;
  const length = Math.hypot(dx, dy, dz) || 1, horizontal = Math.hypot(dx, dz);
  const right = horizontal > 1e-6 ? {x: dz / horizontal, y: 0, z: -dx / horizontal} : {x: 1, y: 0, z: 0};
  const up = {x: dy / length * right.z, y: (dz * right.x - dx * right.z) / length, z: -dy / length * right.x};
  return {toward: {x: dx / length, y: dy / length, z: dz / length}, right, up};
}

// Conservative root-sphere broadphase, before asking for an animated sensor pose.
export function actorInSensorView(self: DuelActorSnapshot, actor: VisibilityActor, view?: SensorView) {
  const dx = actor.position.x - self.position.x, dy = actor.feet + 1 - self.position.y;
  const dz = actor.position.z - self.position.z, radius = 2.5;
  if (![dx, dy, dz, self.yaw, self.pitch].every(Number.isFinite)) return false;
  if (view && !validSensorView(view)) return false;
  if (Math.hypot(dx, dy, dz) <= radius) return true;
  if (!view) {
    const yaw = Math.atan2(-dx, -dz), margin = Math.asin(Math.min(1, radius / Math.hypot(dx, dz)));
    return Math.abs(Math.atan2(Math.sin(yaw - self.yaw), Math.cos(yaw - self.yaw))) <= Math.PI / 3 + margin;
  }
  const sy = Math.sin(self.yaw), cy = Math.cos(self.yaw), sp = Math.sin(self.pitch), cp = Math.cos(self.pitch);
  const forward = -dx * sy * cp + dy * sp - dz * cy * cp;
  const right = dx * cy - dz * sy, up = dx * sy * sp + dy * cp + dz * cy * sp;
  const tangent = Math.tan(view.verticalFov / 2), horizontal = tangent * view.aspect;
  return forward + radius > 0 && Math.abs(right) <= forward * horizontal + radius * Math.hypot(1, horizontal) &&
    Math.abs(up) <= forward * tangent + radius * Math.hypot(1, tangent);
}

export function actorFullyOccluded(self: DuelActorSnapshot, actor: DuelActorSnapshot, arena: Arena) {
  return fullyOccluded(self.position, actor, arena, SENSOR_ENVELOPE);
}

/** Bounded interior/silhouette probes of world-space capsules; an empty pose is authoritative. */
export function actorVisibilitySamples(actor: VisibilityActor, eye: Vec, pose?: ActorHitPose): VisibilitySample[] {
  const samples: VisibilitySample[] = [];
  const add = (point: Vec, group: Hitgroup, radius: number, interiorMargin = radius, primary = true) => {
    if (samples.length < MAX_VISIBILITY_SAMPLES && finite(point)) samples.push({point, group, radius, interiorMargin, primary});
  };
  if (pose) {
    // Keep head/torso preference independent of the provider's capsule ordering.
    const capsules = pose.capsules.slice(0, MAX_CAPSULES).filter(c => finite(c.point0) && finite(c.point1) &&
      Number.isFinite(c.radius) && c.radius > 0);
    for (const group of ['head', 'chest', 'stomach', 'arm', 'leg'] as const) for (const c of capsules) {
      if (c.group !== group) continue;
      const middle = {x: (c.point0.x + c.point1.x) / 2, y: (c.point0.y + c.point1.y) / 2,
        z: (c.point0.z + c.point1.z) / 2};
      const {toward, right, up} = silhouetteAxes(eye, middle);
      if (group === 'arm' || group === 'leg') {
        // Long limbs need two axial samples, including posed hands/ankles.
        for (const t of [.15, .85]) add({x: c.point0.x + (c.point1.x - c.point0.x) * t + toward.x * c.radius * .9,
          y: c.point0.y + (c.point1.y - c.point0.y) * t + toward.y * c.radius * .9,
          z: c.point0.z + (c.point1.z - c.point0.z) * t + toward.z * c.radius * .9}, group, c.radius, c.radius * .1, t === .15);
      } else {
        add(middle, group, c.radius);
        for (const axis of [right, up]) for (const sign of [-1, 1]) add({
          x: middle.x + sign * axis.x * c.radius * .98, y: middle.y + sign * axis.y * c.radius * .98,
          z: middle.z + sign * axis.z * c.radius * .98}, group, c.radius, c.radius * .02, false);
      }
    }
    return samples;
  }
  const duck = clamp(actor.duckAmount, 0, 1), cy = Math.cos(actor.yaw), sy = Math.sin(actor.yaw);
  const local = (x: number, y: number, z = 0): Vec => ({x: actor.position.x + x * cy + z * sy,
    y: actor.feet + y, z: actor.position.z - x * sy + z * cy});
  const head = actorHeadPoint({...actor.position, y: actor.feet}, duck, actor.yaw);
  add(head, 'head', .135);
  const {right, up} = silhouetteAxes(eye, head);
  for (const axis of [right, up]) for (const sign of [-1, 1])
    add({x: head.x + axis.x * sign * .135 * .98, y: head.y + axis.y * sign * .135 * .98,
      z: head.z + axis.z * sign * .135 * .98}, 'head', .135, .135 * .02, false);
  // Analytic fallback follows local body axes and the existing stance dimensions.
  for (const zone of analyticActorBodyZones(duck)) {
    const x = zone.centerX, y = (zone.low + zone.high) / 2;
    const radius = Math.min(zone.halfWidth, zone.halfDepth, (zone.high - zone.low) / 2);
    add(local(x, y), zone.group, radius);
    for (const sign of [-1, 1]) {
      add(local(x + sign * zone.halfWidth * .98, y), zone.group, radius, Math.min(radius, zone.halfWidth * .02), false);
      add(local(x, y + sign * (zone.high - zone.low) * .49), zone.group, radius, Math.min(radius, (zone.high - zone.low) * .01), false);
      add(local(x, y, sign * zone.halfDepth * .98), zone.group, radius, Math.min(radius, zone.halfDepth * .02), false);
    }
  }
  return samples;
}

// Usable by either mode with its own pose cadence/cache. Returns visible samples only.
export function visibleActorPoints(self: DuelActorSnapshot, actor: VisibilityActor, arena: Arena,
  view?: SensorView, pose?: ActorHitPose, visibilityFilter?: VisibilityFilter) {
  const samples = actorVisibilitySamples(actor, self.position, pose);
  // Unknown is not blocked: unvisited samples cannot shrink a visible margin.
  const state = new Int8Array(samples.length);
  const groups = (['head', 'chest', 'stomach', 'arm', 'leg'] as const).map(group => {
    const indices: number[] = [], primary: number[] = [], edges: number[] = [];
    for (let i = 0; i < samples.length; i++) if (samples[i].group === group) {
      indices.push(i); (samples[i].primary ? primary : edges).push(i);
    }
    // Start with the deepest/largest center, before capsule-order-dependent necks/hands.
    primary.sort((a, b) => (samples[b].interiorMargin ?? 0) - (samples[a].interiorMargin ?? 0));
    return {group, indices, queue: [...primary, ...edges], next: 0, checked: 0, visible: -1};
  });
  const probe = (i: number) => {
    const {point} = samples[i];
    if (!pointInView(self, point, view) || visibilityFilter && !visibilityFilter(self.position, point)) return -1;
    const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
    const length = Math.hypot(dx, dy, dz);
    return length >= 1e-6 && !Number.isFinite(traceSolid(self.position,
      {x: dx / length, y: dy / length, z: dz / length}, arena, length - 1e-4).distance) ? 1 : -1;
  };
  // One representative per group in open sight (normally five rays). Missing
  // groups receive round-robin capsule/edge retries; neither rays nor utility
  // predicates can exceed this budget, even when every probe is obscured.
  let checked = 0, work = true;
  while (checked < MAX_VISIBILITY_RAYS && work) {
    work = false;
    for (const group of groups) {
      if (checked >= MAX_VISIBILITY_RAYS) break;
      if (group.visible >= 0 || group.next >= group.queue.length) continue;
      work = true;
      const i = group.queue[group.next++];
      state[i] = probe(i); group.checked++; checked++;
      if (state[i] === 1) group.visible = i;
    }
  }
  const candidates: VisibleHitgroupCandidate[] = [];
  for (const {group, indices, visible: i, checked: groupChecked} of groups) {
    if (i >= 0) {
      const sample = samples[i];
      // A probe-based clearance estimate, not a promise that the entire area is
      // clear. Never average points across cover or synthesize an unseen center.
      let margin = sample.interiorMargin ?? 0;
      for (const j of indices) if (state[j] === -1) margin = Math.min(margin,
        Math.hypot(sample.point.x - samples[j].point.x, sample.point.y - samples[j].point.y,
          sample.point.z - samples[j].point.z) / 2);
      candidates.push({point: {...sample.point}, group, exposure: 1 / indices.length,
        sampleCoverage: groupChecked / indices.length, exposureMargin: margin});
    }
  }
  const headPoint = candidates.find(c => c.group === 'head')?.point;
  const bodyPoint = candidates.find(c => c.group !== 'head')?.point;
  const aimPoint = headPoint ?? bodyPoint;
  return aimPoint ? {aimPoint, headPoint, bodyPoint, candidates} : null;
}
