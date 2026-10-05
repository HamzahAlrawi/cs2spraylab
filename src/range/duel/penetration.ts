import {UNIT, type Vec} from '../actor-physics';
import {equipmentStats, type Equipment} from '../equipment';
import {pointOnRay, traceActor} from './geometry';
import type {Hitgroup} from './types';
import nativeSurfaces from './native-surface-fixture.json';

export type PenetrationMaterial = 'concrete' | 'metal' | 'wood' | 'plastic' | 'glass' | 'grate' | 'water' | 'flesh';
export type PenetrationSolid = {
  center: Vec; size: Vec; id?: string; kind?: string; material?: string;
  active?: boolean; health?: number; shotBlocking?: boolean; penetrable?: boolean;
  penetrationModifier?: number; damageLoss?: number; maxPenetrationThickness?: number;
  shape?: {kind: 'ramp'; axis: 'x' | 'z'; highSide: -1 | 1};
};
export type PenetrationActor = {
  id: number; side: string; position: Vec; feet: number; alive: boolean;
  duckAmount?: number; crouched?: boolean; armor?: number; helmet?: boolean;
};
export type PenetrationStats = {
  damage: number; penetration?: number; rangeModifier: number;
  armorRatio: number; headshotMultiplier: number; range?: number;
};
export type BulletRayRequest = {
  origin: Vec; direction: Vec; range: number; equipment?: Equipment; stats?: PenetrationStats;
  arena: {solids: readonly PenetrationSolid[]}; actors: readonly PenetrationActor[];
  shooterId?: number; shooterSide?: string; maxPenetrations?: number;
  // Trainer policy: never damage teammates. Zero makes friendly flesh opaque.
  friendlyFleshPenetration?: number;
  // Range scoring supplies actual mesh entry/exit distances instead of the
  // Duel's analytic hit zones. An empty array intentionally means no hits.
  physicalActorIntervals?: readonly {actorId: number; entry: number; exit: number; group: Hitgroup}[];
};
export type SurfaceContact = {
  kind: 'surface'; phase: 'entry' | 'exit'; surfaceId: number; environmentId?: string;
  material: PenetrationMaterial; point: Vec; distance: number; normal: Vec;
  thickness: number; residualDamage: number; penetrations: number;
};
export type PenetratingActorHit = {
  kind: 'actor'; actorId: number; group: Hitgroup; point: Vec; distance: number;
  exitPoint: Vec; exitDistance: number; thickness: number; friendly: boolean;
  residualDamage: number; healthDamage: number; armorDamage: number; penetrations: number;
};
export type FleshExit = {kind: 'flesh-exit'; actorId: number; point: Vec; distance: number; residualDamage: number; penetrations: number};
export type BulletRayResult = {
  contacts: (SurfaceContact | PenetratingActorHit | FleshExit)[];
  surfaces: SurfaceContact[]; hits: PenetratingActorHit[];
  direction: Vec; endPoint: Vec; distance: number; residualDamage: number; penetrations: number;
  stopped: 'range' | 'surface' | 'flesh' | 'damage' | 'penetration-limit';
};

// Base modifiers extracted from installed scripts/surfaceproperties_game.txt.
// Same-material and thin-glass branches below were inspected in client 2000924.
export const penetrationMaterials: Readonly<Record<PenetrationMaterial, {modifier: number; damageLoss: number}>> = {
  concrete: {modifier: nativeSurfaces.materials.concrete.distanceModifier, damageLoss: .16},
  metal: {modifier: nativeSurfaces.materials.metal.distanceModifier, damageLoss: .16},
  wood: {modifier: nativeSurfaces.materials.wood.distanceModifier, damageLoss: .16},
  plastic: {modifier: nativeSurfaces.materials.plastic.distanceModifier, damageLoss: .16},
  glass: {modifier: nativeSurfaces.materials.glass.distanceModifier, damageLoss: .16},
  grate: {modifier: nativeSurfaces.materials.grate.distanceModifier, damageLoss: .16},
  water: {modifier: nativeSurfaces.materials.water.distanceModifier, damageLoss: .16},
  flesh: {modifier: nativeSurfaces.materials.flesh.distanceModifier, damageLoss: .16},
};
const f = Math.fround;
function effectiveMaterial(material: PenetrationMaterial, thickness: number) {
  if ((material === 'glass' || material === 'grate') && f(thickness / UNIT) < 6) return {modifier: 3, damageLoss: .05};
  if (material === 'wood') return {modifier: 3, damageLoss: .16};
  if (material === 'plastic') return {modifier: 2, damageLoss: .16};
  return penetrationMaterials[material];
}
const EPS = 1e-9;
const axes = ['x', 'y', 'z'] as const;
const zero = (): Vec => ({x: 0, y: 0, z: 0});
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const finiteVec = (v: Vec) => axes.every(axis => Number.isFinite(v[axis]));
const materialOf = (s: PenetrationSolid): PenetrationMaterial =>
  s.material && Object.prototype.hasOwnProperty.call(penetrationMaterials, s.material)
    ? s.material as PenetrationMaterial : s.kind === 'crate' ? 'wood' : s.kind === 'cargo' ? 'metal' : 'concrete';

type Interval = {entry: number; exit: number; entryNormal: Vec; exitNormal: Vec};

// Clip against convex half-spaces, retaining physical exits even beyond range.
export function raySolidInterval(origin: Vec, direction: Vec, solid: PenetrationSolid): Interval | undefined {
  if (!finiteVec(solid.center) || !finiteVec(solid.size) || axes.some(a => solid.size[a] <= 0)) return;
  let entry = 0, exit = Infinity, entryNormal = zero(), exitNormal = zero();
  const clip = (normal: Vec, bound: number) => {
    const slope = dot(normal, direction), offset = bound - dot(normal, origin);
    if (Math.abs(slope) < EPS) return offset >= -EPS;
    const distance = offset / slope;
    if (slope < 0 && distance > entry) {entry = distance; entryNormal = normal;}
    if (slope > 0 && distance < exit) {exit = distance; exitNormal = normal;}
    return exit > entry + EPS;
  };
  for (const axis of axes) {
    if (!clip({...zero(), [axis]: 1}, solid.center[axis] + solid.size[axis] / 2) ||
      !clip({...zero(), [axis]: -1}, -solid.center[axis] + solid.size[axis] / 2)) return;
  }
  if (solid.shape?.kind === 'ramp') {
    const {axis, highSide} = solid.shape, slope = highSide * solid.size.y / solid.size[axis];
    const normal = {...zero(), y: 1, [axis]: -slope};
    if (!clip(normal, solid.center.y - slope * solid.center[axis])) return;
    const length = Math.hypot(entryNormal.x, entryNormal.y, entryNormal.z);
    if (length) entryNormal = {x: entryNormal.x / length, y: entryNormal.y / length, z: entryNormal.z / length};
    const exitLength = Math.hypot(exitNormal.x, exitNormal.y, exitNormal.z);
    if (exitLength) exitNormal = {x: exitNormal.x / exitLength, y: exitNormal.y / exitLength, z: exitNormal.z / exitLength};
  }
  return exit > entry + EPS ? {entry, exit, entryNormal, exitNormal} : undefined;
}

function actorInterval(origin: Vec, direction: Vec, actor: PenetrationActor, range: number) {
  const feet = {...actor.position, y: actor.feet}, duck = actor.duckAmount ?? Number(actor.crouched ?? false);
  const hit = traceActor(origin, direction, feet, duck, range);
  if (!hit.group || !Number.isFinite(hit.distance)) return;
  // Existing analytic hit zones, not render bones. Reverse from beyond all zones
  // to obtain the flesh chord; gaps between zones belong to the same actor.
  const end = Math.max(hit.distance + 3, dot({x: feet.x - origin.x, y: feet.y + 1 - origin.y, z: feet.z - origin.z}, direction) + 3);
  const reverse = {x: -direction.x, y: -direction.y, z: -direction.z};
  const back = traceActor(pointOnRay(origin, direction, end), reverse, feet, duck, end - hit.distance + EPS);
  if (!Number.isFinite(back.distance)) return;
  return {entry: hit.distance, exit: Math.max(hit.distance, end - back.distance), group: hit.group};
}

function actorDamage(raw: number, stats: PenetrationStats, group: Hitgroup, actor: PenetrationActor) {
  const multiplier = group === 'head' ? stats.headshotMultiplier : group === 'stomach' ? 1.25 : group === 'leg' ? .75 : 1;
  const damage = raw * multiplier, armor = Math.max(0, actor.armor ?? 0);
  if (!armor || group === 'leg' || (group === 'head' && !actor.helmet)) return {healthDamage: damage, armorDamage: 0};
  const health = damage * Math.max(0, Math.min(1, stats.armorRatio / 2)), cost = (damage - health) / 2;
  return cost <= armor ? {healthDamage: health, armorDamage: cost} : {healthDamage: damage - armor * 2, armorDamage: armor};
}

export function penetrationLoss(damage: number, thickness: number, power: number, modifier: number, damageLoss: number) {
  if (![damage, thickness, power, modifier, damageLoss].every(Number.isFinite) || thickness < 0 || power <= 0 || modifier <= 0) return Infinity;
  const inverse = f(1 / f(modifier)), units = f(thickness / UNIT);
  const powerTerm = f(f(3 / f(power)) * f(1.25));
  const base = f(f(powerTerm * f(inverse * 3)) + f(f(damageLoss) * f(damage)));
  const loss = f(f(f(f(units * units) * inverse) / 24) + base);
  return Number.isNaN(loss) ? Infinity : Math.max(0, loss);
}

export type SurfaceDamageOptions = {penetrable?: boolean; penetrationModifier?: number; damageLoss?: number; maxPenetrationThickness?: number};
export function damageThroughSurface(remainingDamage: number, weapon: Equipment | PenetrationStats,
  entryExit: {entry: Vec; exit: Vec}, material: PenetrationMaterial, options: SurfaceDamageOptions = {}) {
  const stats: PenetrationStats = typeof weapon === 'string' ? equipmentStats(weapon) : weapon;
  const thickness = Math.hypot(entryExit.exit.x - entryExit.entry.x, entryExit.exit.y - entryExit.entry.y, entryExit.exit.z - entryExit.entry.z);
  const properties = effectiveMaterial(material, thickness);
  const loss = options.penetrable === false || thickness > (options.maxPenetrationThickness ?? Infinity) ? Infinity :
    penetrationLoss(remainingDamage, thickness, stats.penetration ?? 0,
      options.penetrationModifier ?? properties.modifier, options.damageLoss ?? properties.damageLoss);
  const penetrated = Number.isFinite(remainingDamage) && remainingDamage - loss >= 1;
  return {thickness, penetrated, residualDamage: penetrated ? remainingDamage - loss : 0,
    lostDamage: penetrated ? loss : Math.max(0, remainingDamage)};
}

export function resolveBulletRay(request: BulletRayRequest): BulletRayResult {
  const {origin, arena, actors} = request;
  const length = Math.hypot(request.direction.x, request.direction.y, request.direction.z);
  if (!finiteVec(origin) || !finiteVec(request.direction) || !Number.isFinite(length) || length < EPS || !Number.isFinite(request.range) || request.range < 0) {
    throw new RangeError('Bullet ray requires finite origin/direction and non-negative metre range');
  }
  const direction = {x: request.direction.x / length, y: request.direction.y / length, z: request.direction.z / length};
  const stats = request.stats ?? (request.equipment ? equipmentStats(request.equipment) : undefined);
  if (!stats || !Number.isFinite(stats.damage) || stats.damage < 0 ||
    !Number.isFinite(stats.rangeModifier) || stats.rangeModifier <= 0 || stats.rangeModifier > 1 ||
    !Number.isFinite(stats.armorRatio) || !Number.isFinite(stats.headshotMultiplier)) {
    throw new RangeError('Bullet ray requires valid native damage stats or equipment');
  }
  const range = Math.min(request.range, stats.range === undefined ? Infinity : stats.range * UNIT);
  if (!Number.isFinite(range) || range < 0 || !Number.isFinite(request.maxPenetrations ?? 4)) throw new RangeError('Invalid bullet range or penetration budget');
  const maxPenetrations = Math.max(0, Math.floor(request.maxPenetrations ?? 4));
  const power = Math.max(0, (stats as PenetrationStats).penetration ?? 0);
  type SolidCrossing = Interval & {kind: 'surface'; solid: PenetrationSolid; surfaceId: number};
  type ActorCrossing = {kind: 'actor'; actor: PenetrationActor; entry: number; exit: number; group: Hitgroup};
  type Crossing = SolidCrossing | ActorCrossing;
  const crossings: Crossing[] = [];
  arena.solids.forEach((solid, surfaceId) => {
    if (solid.active === false || solid.health === 0 || solid.shotBlocking === false) return;
    const interval = raySolidInterval(origin, direction, solid);
    if (interval && interval.entry <= range) crossings.push({...interval, kind: 'surface', solid, surfaceId});
  });
  for (const actor of actors) {
    if (!actor.alive || actor.id === request.shooterId) continue;
    const interval = request.physicalActorIntervals === undefined ? actorInterval(origin, direction, actor, range)
      : request.physicalActorIntervals.find(interval=>interval.actorId===actor.id);
    if (interval) {
      if(!Number.isFinite(interval.entry)||!Number.isFinite(interval.exit)||interval.entry<0||interval.exit<interval.entry)
        throw new RangeError('Physical actor intervals require ordered finite metre distances');
      if(interval.entry<=range)crossings.push({...interval, kind: 'actor', actor});
    }
  }
  const boundaries = crossings.flatMap(crossing => ([{crossing, exit: false, distance: crossing.entry},
    {crossing, exit: true, distance: crossing.exit}])).filter(b => b.distance <= range)
    .sort((a, b) => a.distance - b.distance || Number(b.exit) - Number(a.exit) ||
      (a.crossing.kind === 'surface' ? -1 : 1) - (b.crossing.kind === 'surface' ? -1 : 1));
  const contacts: BulletRayResult['contacts'] = [], surfaces: SurfaceContact[] = [], hits: PenetratingActorHit[] = [];
  let damage = stats.damage, distance = 0, penetrations = 0, stopped: BulletRayResult['stopped'] = 'range';
  const travel = (to: number) => {
    damage *= Math.pow(stats.rangeModifier, Math.max(0, to - distance) / (500 * UNIT));
    distance = to;
  };
  for (const boundary of boundaries) {
    travel(boundary.distance);
    if (damage < 1) {stopped = 'damage'; break;}
    const crossing = boundary.crossing, thickness = crossing.exit - crossing.entry;
    if (crossing.kind === 'surface') {
      const material = materialOf(crossing.solid);
      const contact: SurfaceContact = {kind: 'surface', phase: boundary.exit ? 'exit' : 'entry',
        surfaceId: crossing.surfaceId, environmentId: crossing.solid.id, material,
        point: pointOnRay(origin, direction, distance), distance,
        normal: {...(boundary.exit ? crossing.exitNormal : crossing.entryNormal)}, thickness, residualDamage: damage, penetrations};
      surfaces.push(contact); contacts.push(contact);
      if (boundary.exit) continue;
      if (penetrations >= maxPenetrations) {stopped = 'penetration-limit'; break;}
      const properties = effectiveMaterial(material, thickness);
      if (distance > 3000 * UNIT || crossing.solid.penetrable === false ||
        thickness > (crossing.solid.maxPenetrationThickness ?? Infinity)) {stopped = 'surface'; break;}
      const loss = penetrationLoss(damage, thickness, power, crossing.solid.penetrationModifier ?? properties.modifier,
        crossing.solid.damageLoss ?? properties.damageLoss);
      if (loss >= damage) {stopped = 'surface'; break;}
      damage -= loss;
      if (damage < 1) {stopped = 'damage'; break;}
      penetrations++;
    } else {
      if (boundary.exit) {
        contacts.push({kind: 'flesh-exit', actorId: crossing.actor.id,
          point: pointOnRay(origin, direction, distance), distance, residualDamage: damage, penetrations});
        continue;
      }
      const side = request.shooterSide ?? actors.find(a => a.id === request.shooterId)?.side;
      const friendly = side !== undefined && crossing.actor.side === side;
      const hit: PenetratingActorHit = {kind: 'actor', actorId: crossing.actor.id, group: crossing.group,
        point: pointOnRay(origin, direction, distance), distance, exitDistance: crossing.exit,
        exitPoint: pointOnRay(origin, direction, crossing.exit), thickness, friendly, residualDamage: damage, penetrations,
        ...(friendly ? {healthDamage: 0, armorDamage: 0} : actorDamage(damage, stats, crossing.group, crossing.actor))};
      hits.push(hit); contacts.push(hit);
      if (penetrations >= maxPenetrations) {stopped = 'penetration-limit'; break;}
      const modifier = friendly ? request.friendlyFleshPenetration ?? penetrationMaterials.flesh.modifier : penetrationMaterials.flesh.modifier;
      const loss = penetrationLoss(damage, thickness, power, modifier, penetrationMaterials.flesh.damageLoss);
      if (distance > 3000 * UNIT || loss >= damage) {stopped = 'flesh'; break;}
      damage -= loss;
      if (damage < 1) {stopped = 'damage'; break;}
      penetrations++;
    }
  }
  if (stopped === 'range') travel(range);
  return {contacts, surfaces, hits, direction, endPoint: pointOnRay(origin, direction, distance),
    distance, residualDamage: damage, penetrations, stopped};
}

export const resolvePenetratingRay = resolveBulletRay;
