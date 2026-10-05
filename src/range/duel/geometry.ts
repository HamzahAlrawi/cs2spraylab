import {UNIT, type Vec} from '../actor-physics';
import type {Hitgroup} from './types';
import {createArena} from './arena-layout';
import type {PlacedPOI, POITheme} from './arena-pois';
import {blocksMovement, blocksShots, environmentPieceId, resolveEnvironmentSolid, surfaceMaterial,
  type EnvironmentMetadata, type EnvironmentState, type SurfaceMaterial, type TraversalLink, type TraversalVolume} from './environment';

export type PropStyle = 'plain' | 'generator' | 'pallets' | 'vent' | 'cabinet' | 'concrete-stack' | 'roadblock' | 'kiosk' | 'rack' | 'planter' | 'dock' | 'pump' | 'bench' | 'stairs' | 'ramp' | 'door' | 'glass' | 'vent-panel' | 'movable';
export type Solid = {center: Vec; size: Vec; kind?: 'concrete' | 'cargo' | 'crate' | 'barrier'; style?: PropStyle; poiId?: string} & EnvironmentMetadata;
export type CoverLane = {side: -1 | 1; anchor: Vec; edge: Vec; retreat: Vec;
  axis?: {x: number; z: number}; role?: 'entry' | 'flank' | 'camp' | 'offAngle'};
export type Arena = {minX: number; maxX: number; minZ: number; maxZ: number; solids: Solid[]; lanes?: CoverLane[]; design?: string; seed?: number; pois?: PlacedPOI[]; poiTheme?: POITheme;
  traversalVolumes?: TraversalVolume[]; traversalLinks?: TraversalLink[]};
export const testArena = (): Arena => ({minX: -12, maxX: 12, minZ: -20, maxZ: 12, solids: []});

export function duelArena(seed: number, scale = 1, theme?: POITheme): Arena {
  // Repack full-size cover instead of scaling gaps below the native actor hull.
  return createArena(seed, {scale, theme});
}

export function solidTopAt(solid: Solid, x: number, z: number, radius = 0): number | undefined {
  if (Math.abs(x - solid.center.x) > solid.size.x / 2 + radius || Math.abs(z - solid.center.z) > solid.size.z / 2 + radius) return undefined;
  if (!solid.shape) return solid.center.y + solid.size.y / 2;
  const {axis, highSide} = solid.shape, at = (axis === 'x' ? x : z) + highSide * radius;
  const fraction = Math.max(0, Math.min(1, .5 + highSide * (at - solid.center[axis]) / solid.size[axis]));
  return solid.center.y - solid.size.y / 2 + fraction * solid.size.y;
}
const intersects = (x: number, z: number, feet: number, height: number, solid: Solid) => {
  if (!blocksMovement(solid)) return false;
  if (Math.abs(x - solid.center.x) >= solid.size.x / 2 + 16 * UNIT - 1e-8 ||
    Math.abs(z - solid.center.z) >= solid.size.z / 2 + 16 * UNIT - 1e-8) return false;
  const top = solidTopAt(solid, x, z, 16 * UNIT);
  return top !== undefined && feet < top - 1e-8 && feet + height > solid.center.y - solid.size.y / 2 + 1e-8;
};

export function canFitInArena(position: Vec, feet: number, height: number, arena: Arena, state?: EnvironmentState) {
  return position.x >= arena.minX + 16 * UNIT && position.x <= arena.maxX - 16 * UNIT &&
    position.z >= arena.minZ + 16 * UNIT && position.z <= arena.maxZ - 16 * UNIT &&
    !arena.solids.some((solid, index) => intersects(position.x, position.z, feet, height, resolveEnvironmentSolid(solid, index, state)));
}

export function moveInArena(from: Vec, desired: Vec, feet: number, height: number, arena: Arena, state?: EnvironmentState): Vec {
  const x = Math.max(arena.minX + 16 * UNIT, Math.min(arena.maxX - 16 * UNIT, desired.x));
  const z = Math.max(arena.minZ + 16 * UNIT, Math.min(arena.maxZ - 16 * UNIT, desired.z));
  let nextX = from.x, nextZ = from.z;
  let blockedX = false, blockedZ = false;
  const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / .2));
  for (let step = 1; step <= steps; step++) {
    const candidateX = from.x + (x - from.x) * step / steps;
    const candidateZ = from.z + (z - from.z) * step / steps;
    if (!blockedX) {
      blockedX = arena.solids.some((solid, index) => intersects(candidateX, nextZ, feet, height, resolveEnvironmentSolid(solid, index, state)));
      if (!blockedX) nextX = candidateX;
    }
    if (!blockedZ) {
      blockedZ = arena.solids.some((solid, index) => intersects(nextX, candidateZ, feet, height, resolveEnvironmentSolid(solid, index, state)));
      if (!blockedZ) nextZ = candidateZ;
    }
  }
  return {x: nextX, y: desired.y, z: nextZ};
}

export type RayInterval = {entryDistance: number; exitDistance: number; entryNormal: Vec; exitNormal: Vec};
const validRay = (origin: Vec, direction: Vec, maxDistance: number) =>
  Number.isFinite(origin.x) && Number.isFinite(origin.y) && Number.isFinite(origin.z) &&
  Number.isFinite(direction.x) && Number.isFinite(direction.y) && Number.isFinite(direction.z) &&
  Math.hypot(direction.x, direction.y, direction.z) >= 1e-12 && maxDistance >= 0;

// Distance-only queries dominate sight/cover tests. Use the same slabs without
// allocating normals/intervals for every miss; full contacts remain unchanged.
function boundsDistance(origin: Vec, direction: Vec, minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number, maxDistance: number) {
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(minZ) ||
    !Number.isFinite(maxX) || !Number.isFinite(maxY) || !Number.isFinite(maxZ) ||
    minX > maxX || minY > maxY || minZ > maxZ) return Infinity;
  let near = 0, far = Infinity;
  if (Math.abs(direction.x) < 1e-12) {
    if (origin.x < minX || origin.x > maxX) return Infinity;
  } else {
    const a = (minX - origin.x) / direction.x, b = (maxX - origin.x) / direction.x;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (far < near) return Infinity;
  }
  if (Math.abs(direction.y) < 1e-12) {
    if (origin.y < minY || origin.y > maxY) return Infinity;
  } else {
    const a = (minY - origin.y) / direction.y, b = (maxY - origin.y) / direction.y;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (far < near) return Infinity;
  }
  if (Math.abs(direction.z) < 1e-12) {
    if (origin.z < minZ || origin.z > maxZ) return Infinity;
  } else {
    const a = (minZ - origin.z) / direction.z, b = (maxZ - origin.z) / direction.z;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (far < near) return Infinity;
  }
  return near <= maxDistance ? near : Infinity;
}
export function rayBoxInterval(origin: Vec, direction: Vec, min: Vec, max: Vec, maxDistance = Infinity): RayInterval | undefined {
  if ([origin, direction, min, max].some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) ||
    Math.hypot(direction.x, direction.y, direction.z) < 1e-12 || maxDistance < 0 || Number.isNaN(maxDistance) ||
    (['x', 'y', 'z'] as const).some(axis => min[axis] > max[axis])) return undefined;
  let near = 0, far = Infinity, entryNormal: Vec = {x: 0, y: 0, z: 0}, exitNormal: Vec = {x: 0, y: 0, z: 0};
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = direction[axis];
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return undefined;
      continue;
    }
    let enter = (min[axis] - origin[axis]) / delta;
    let exit = (max[axis] - origin[axis]) / delta;
    if (enter > exit) [enter, exit] = [exit, enter];
    if (enter > near) {near = enter; entryNormal = {x: 0, y: 0, z: 0}; entryNormal[axis] = delta > 0 ? -1 : 1;}
    if (exit < far) {far = exit; exitNormal = {x: 0, y: 0, z: 0}; exitNormal[axis] = delta > 0 ? 1 : -1;}
    if (far < near) return undefined;
  }
  return near <= maxDistance ? {entryDistance: near, exitDistance: far, entryNormal, exitNormal} : undefined;
}
export function rayBox(origin: Vec, direction: Vec, min: Vec, max: Vec, maxDistance = Infinity) {
  return validRay(origin, direction, maxDistance)
    ? boundsDistance(origin, direction, min.x, min.y, min.z, max.x, max.y, max.z, maxDistance) : Infinity;
}

export function raySolidInterval(origin: Vec, direction: Vec, solid: Solid, maxDistance = Infinity): RayInterval | undefined {
  const {center: c, size: s} = solid;
  const interval = rayBoxInterval(origin, direction, {x: c.x - s.x / 2, y: c.y - s.y / 2, z: c.z - s.z / 2},
    {x: c.x + s.x / 2, y: c.y + s.y / 2, z: c.z + s.z / 2}, maxDistance);
  if (!interval || !solid.shape) return interval;
  const {axis, highSide} = solid.shape, slope = highSide * s.y / s[axis];
  // Clip the bounding box by the actual wedge top, never trace its empty half.
  const value = origin.y - c.y - slope * (origin[axis] - c[axis]);
  const delta = direction.y - slope * direction[axis];
  if (Math.abs(delta) < 1e-12) return value <= 1e-10 ? interval : undefined;
  const crossing = -value / delta, length = Math.hypot(slope, 1), normal: Vec = {x: 0, y: 1 / length, z: 0};
  normal[axis] = -slope / length;
  if (delta < 0 && crossing > interval.entryDistance) {interval.entryDistance = crossing; interval.entryNormal = normal;}
  if (delta > 0 && crossing < interval.exitDistance) {interval.exitDistance = crossing; interval.exitNormal = normal;}
  return interval.exitDistance >= interval.entryDistance && interval.entryDistance <= maxDistance ? interval : undefined;
}

function raySphere(origin: Vec, direction: Vec, center: Vec, radius: number, maxDistance: number) {
  const x = origin.x - center.x, y = origin.y - center.y, z = origin.z - center.z;
  const halfB = x * direction.x + y * direction.y + z * direction.z;
  const c = x * x + y * y + z * z - radius * radius;
  const discriminant = halfB * halfB - c;
  if (discriminant < 0) return Infinity;
  const root = Math.sqrt(discriminant);
  const entry = -halfB - root, exit = -halfB + root;
  const distance = entry >= 0 ? entry : exit >= 0 ? exit : Infinity;
  return distance <= maxDistance ? distance : Infinity;
}

export function traceActor(origin: Vec, direction: Vec, feet: Vec, crouch: boolean | number, maxDistance = Infinity) {
  // Analytic hit zones share the movement stance fraction; visual animation is separate.
  const base = feet.y;
  const fraction = typeof crouch === 'boolean' ? Number(crouch) : Math.max(0, Math.min(1, crouch));
  const lerp = (stand: number, duck: number) => stand + (duck - stand) * fraction;
  let closest = {distance: Infinity, group: undefined as Hitgroup | undefined};
  const head = raySphere(origin, direction, {x: feet.x, y: base + lerp(1.62, 1.17), z: feet.z}, .135, maxDistance);
  if (head < closest.distance) closest = {distance: head, group: 'head'};
  const zones: {group: Hitgroup; centerX: number; low: number; high: number; halfWidth: number; halfDepth: number}[] = [
    {group: 'chest', centerX: 0, low: lerp(1.08, .76), high: lerp(1.47, 1.07), halfWidth: lerp(.25, .24), halfDepth: .17},
    {group: 'stomach', centerX: 0, low: lerp(.76, .42), high: lerp(1.08, .76), halfWidth: .22, halfDepth: .17},
    {group: 'arm', centerX: -.31, low: lerp(.79, .55), high: lerp(1.4, 1.02), halfWidth: .09, halfDepth: .15},
    {group: 'arm', centerX: .31, low: lerp(.79, .55), high: lerp(1.4, 1.02), halfWidth: .09, halfDepth: .15},
    {group: 'leg', centerX: 0, low: .02, high: lerp(.76, .42), halfWidth: .22, halfDepth: .15},
  ];
  for (const zone of zones) {
    const x = feet.x + zone.centerX;
    const distance = rayBox(origin, direction,
      {x: x - zone.halfWidth, y: base + zone.low, z: feet.z - zone.halfDepth},
      {x: x + zone.halfWidth, y: base + zone.high, z: feet.z + zone.halfDepth}, maxDistance);
    if (distance < closest.distance) closest = {distance, group: zone.group};
  }
  return closest;
}

export type SolidTrace = {distance: number; exitDistance: number; surfaceId: number; pieceId?: string; material?: SurfaceMaterial;
  entry?: Vec; exit?: Vec; normal?: Vec; exitNormal?: Vec; thickness: number};
export function traceSolid(origin: Vec, direction: Vec, arena: Arena, maxDistance = Infinity, state?: EnvironmentState): SolidTrace {
  let closest: SolidTrace = {distance: Infinity, exitDistance: Infinity, surfaceId: -1, thickness: 0};
  if (!validRay(origin, direction, maxDistance)) return closest;
  for (let index = 0; index < arena.solids.length; index++) {
    const solid = resolveEnvironmentSolid(arena.solids[index], index, state);
    if (!blocksShots(solid)) continue;
    const {center: c, size: s} = solid;
    const limit = Math.min(maxDistance, closest.distance);
    const entry = boundsDistance(origin, direction, c.x - s.x / 2, c.y - s.y / 2, c.z - s.z / 2,
      c.x + s.x / 2, c.y + s.y / 2, c.z + s.z / 2, limit);
    if (!Number.isFinite(entry) || entry >= closest.distance) continue;
    const interval = raySolidInterval(origin, direction, solid, limit);
    if (interval && interval.entryDistance < closest.distance) closest = traceFromInterval(origin, direction, solid, index, interval);
  }
  return closest;
}

function traceFromInterval(origin: Vec, direction: Vec, solid: Solid, index: number, interval: RayInterval): SolidTrace {
  return {distance: interval.entryDistance, exitDistance: interval.exitDistance, surfaceId: index, pieceId: environmentPieceId(solid, index),
    material: surfaceMaterial(solid), entry: pointOnRay(origin, direction, interval.entryDistance), exit: pointOnRay(origin, direction, interval.exitDistance),
    normal: interval.entryNormal, exitNormal: interval.exitNormal,
    thickness: (interval.exitDistance - interval.entryDistance) * Math.hypot(direction.x, direction.y, direction.z)};
}

export function traceSolidEntries(origin: Vec, direction: Vec, arena: Arena, maxDistance = Infinity, state?: EnvironmentState): SolidTrace[] {
  return arena.solids.flatMap((authored, index) => {
    const solid = resolveEnvironmentSolid(authored, index, state);
    const interval = blocksShots(solid) ? raySolidInterval(origin, direction, solid, maxDistance) : undefined;
    return interval ? [traceFromInterval(origin, direction, solid, index, interval)] : [];
  }).sort((a, b) => a.distance - b.distance || a.surfaceId - b.surfaceId);
}

export function materialForSurface(arena: Arena, surfaceId: number): SurfaceMaterial | undefined {
  const solid = arena.solids[surfaceId];
  return solid ? surfaceMaterial(solid) : undefined;
}

// Use targets remain in the closed doorway footprint, so an open door can close.
// Call useEnvironmentPiece afterwards for reach, occlusion and occupant checks.
export function traceEnvironmentUse(origin: Vec, direction: Vec, arena: Arena, state?: EnvironmentState, maxDistance = 1.8): SolidTrace {
  let closest: SolidTrace = {distance: Infinity, exitDistance: Infinity, surfaceId: -1, thickness: 0};
  arena.solids.forEach((authored, index) => {
    if (authored.interaction?.kind !== 'door' || resolveEnvironmentSolid(authored, index, state).active === false) return;
    const interval = raySolidInterval(origin, direction, authored, Math.min(maxDistance, authored.interaction.useRadius));
    if (interval && interval.entryDistance < closest.distance) closest = traceFromInterval(origin, direction, authored, index, interval);
  });
  return closest;
}

export const pointOnRay = (origin: Vec, direction: Vec, distance: number): Vec => ({
  x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance,
});
