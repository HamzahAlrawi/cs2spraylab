import {UNIT, type Vec} from '../actor-physics';
import type {Hitgroup} from './types';
import {createArena} from './arena-layout';
import type {PlacedPOI, POITheme} from './arena-pois';

export type PropStyle = 'plain' | 'generator' | 'pallets' | 'vent' | 'cabinet' | 'concrete-stack' | 'roadblock' | 'kiosk' | 'rack' | 'planter' | 'dock' | 'pump' | 'bench';
export type Solid = {center: Vec; size: Vec; kind?: 'concrete' | 'cargo' | 'crate' | 'barrier'; style?: PropStyle; poiId?: string};
export type CoverLane = {side: -1 | 1; anchor: Vec; edge: Vec; retreat: Vec;
  axis?: {x: number; z: number}; role?: 'entry' | 'flank' | 'camp' | 'offAngle'};
export type Arena = {minX: number; maxX: number; minZ: number; maxZ: number; solids: Solid[]; lanes?: CoverLane[]; design?: string; seed?: number; pois?: PlacedPOI[]; poiTheme?: POITheme};
export const testArena = (): Arena => ({minX: -12, maxX: 12, minZ: -20, maxZ: 12, solids: []});

export function duelArena(seed: number, scale = 1, theme?: POITheme): Arena {
  // Repack full-size cover instead of scaling gaps below the native actor hull.
  return createArena(seed, {scale, theme});
}

const intersects = (x: number, z: number, feet: number, height: number, solid: Solid) =>
  feet < solid.center.y + solid.size.y / 2 && feet + height > solid.center.y - solid.size.y / 2 &&
  Math.abs(x - solid.center.x) < solid.size.x / 2 + 16 * UNIT &&
  Math.abs(z - solid.center.z) < solid.size.z / 2 + 16 * UNIT;

export function canFitInArena(position: Vec, feet: number, height: number, arena: Arena) {
  return position.x >= arena.minX + 16 * UNIT && position.x <= arena.maxX - 16 * UNIT &&
    position.z >= arena.minZ + 16 * UNIT && position.z <= arena.maxZ - 16 * UNIT &&
    !arena.solids.some(solid => intersects(position.x, position.z, feet, height, solid));
}

export function moveInArena(from: Vec, desired: Vec, feet: number, height: number, arena: Arena): Vec {
  const x = Math.max(arena.minX + 16 * UNIT, Math.min(arena.maxX - 16 * UNIT, desired.x));
  const z = Math.max(arena.minZ + 16 * UNIT, Math.min(arena.maxZ - 16 * UNIT, desired.z));
  let nextX = from.x, nextZ = from.z;
  let blockedX = false, blockedZ = false;
  const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / .2));
  for (let step = 1; step <= steps; step++) {
    const candidateX = from.x + (x - from.x) * step / steps;
    const candidateZ = from.z + (z - from.z) * step / steps;
    if (!blockedX) {
      blockedX = arena.solids.some(solid => intersects(candidateX, nextZ, feet, height, solid));
      if (!blockedX) nextX = candidateX;
    }
    if (!blockedZ) {
      blockedZ = arena.solids.some(solid => intersects(nextX, candidateZ, feet, height, solid));
      if (!blockedZ) nextZ = candidateZ;
    }
  }
  return {x: nextX, y: desired.y, z: nextZ};
}

export function rayBox(origin: Vec, direction: Vec, min: Vec, max: Vec, maxDistance = Infinity) {
  let near = 0, far = maxDistance;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = direction[axis];
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity;
      continue;
    }
    let enter = (min[axis] - origin[axis]) / delta;
    let exit = (max[axis] - origin[axis]) / delta;
    if (enter > exit) [enter, exit] = [exit, enter];
    near = Math.max(near, enter); far = Math.min(far, exit);
    if (far < near) return Infinity;
  }
  return near;
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

export function traceSolid(origin: Vec, direction: Vec, arena: Arena, maxDistance = Infinity) {
  let closest = {distance: Infinity, surfaceId: -1};
  for (let index = 0; index < arena.solids.length; index++) {
    const {center, size} = arena.solids[index];
    const distance = rayBox(origin, direction,
      {x: center.x - size.x / 2, y: center.y - size.y / 2, z: center.z - size.z / 2},
      {x: center.x + size.x / 2, y: center.y + size.y / 2, z: center.z + size.z / 2}, maxDistance);
    if (distance < closest.distance) closest = {distance, surfaceId: index};
  }
  return closest;
}

export const pointOnRay = (origin: Vec, direction: Vec, distance: number): Vec => ({
  x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance,
});
