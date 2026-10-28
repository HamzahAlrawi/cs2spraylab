import type {Vec, ResolveVertical} from './actor-physics';
import {CONTACT_EPSILON as EPS, TERRAIN_RULES as RULES, add, subtract, scale, dot, collidable,
  horizontalOverlap, hullPlanes, surfaceHeight, normalize, rampSurface, type TerrainSolid, type TerrainWorld, type TerrainQueries} from './terrain';

export type HullContact = {normal: Vec; solid?: TerrainSolid};
export type HullSweep = {position: Vec; fraction: number; contact?: HullContact; startSolid: boolean};
export type TerrainMove = {position: Vec; contacts: HullContact[]; grounded: boolean; ceiling: boolean; stepped: boolean;
  support?: TerrainSolid; fraction: number};

// Conservative broad phase only: a box/wedge's expanded AABB contains every
// hull plane. Keep near-boundary candidates for the existing narrow phase.
function overlapsSweptBounds(from: Vec, to: Vec, height: number, solid: TerrainSolid) {
  const {center: c, size: s} = solid, r = RULES.hullRadius;
  return Math.max(from.x, to.x) >= c.x - s.x / 2 - r - EPS &&
    Math.min(from.x, to.x) <= c.x + s.x / 2 + r + EPS &&
    Math.max(from.z, to.z) >= c.z - s.z / 2 - r - EPS &&
    Math.min(from.z, to.z) <= c.z + s.z / 2 + r + EPS &&
    Math.max(from.y, to.y) >= c.y - s.y / 2 - height - EPS &&
    Math.min(from.y, to.y) <= c.y + s.y / 2 + EPS;
}

export function fitsHull(position: Vec, feet: number, height: number, boxes: readonly TerrainSolid[], native?: TerrainQueries) {
  const p = {...position, y: feet};
  return !boxes.some(box => collidable(box) && overlapsSweptBounds(p, p, height, box) &&
    hullPlanes(box, height).every(plane => dot(p, plane.normal) < plane.distance - EPS)) && (!native || native.fits(position, feet, height));
}

// Continuous swept Minkowski hull; tangent motion is not a collision.
export function sweepHull(from: Vec, to: Vec, height: number, boxes: readonly TerrainSolid[], native?: TerrainQueries): HullSweep {
  const hit = native?.sweep(from, to, height);
  let fraction = hit?.fraction ?? 1, contact: HullContact | undefined = hit?.contact, startSolid = hit?.startSolid ?? false;
  for (const solid of boxes) {
    if (!collidable(solid) || !overlapsSweptBounds(from, to, height, solid)) continue;
    let enter = 0, exit = 1, normal: Vec | undefined, miss = false;
    let strictlyInside = true;
    for (const plane of hullPlanes(solid, height)) {
      const a = dot(from, plane.normal) - plane.distance, b = dot(to, plane.normal) - plane.distance;
      strictlyInside &&= a < -EPS;
      if (a >= -EPS && b >= -EPS) {miss = true; break;}
      if (a < -EPS && b < -EPS) continue;
      const time = a / (a - b);
      if (a > b && Math.max(0, time) >= enter) {enter = Math.max(0, time); normal = plane.normal;}
      else if (a < b) exit = Math.min(exit, time);
      if (enter > exit + EPS) {miss = true; break;}
    }
    if (miss) continue;
    if (strictlyInside) {startSolid = true; fraction = 0; contact = {normal: {x: 0, y: 0, z: 0}, solid};}
    else if (normal && enter <= fraction && enter <= exit + EPS) {fraction = Math.max(0, enter); contact = {normal, solid};}
  }
  return {position: add(from, scale(subtract(to, from), fraction)), fraction, contact, startSolid};
}

export function clipContactVelocity(velocity: Vec, normal: Vec): Vec {
  const into = dot(velocity, normal);
  return into < 0 ? subtract(velocity, scale(normal, into)) : {...velocity};
}

export function slideHull(from: Vec, to: Vec, height: number, boxes: readonly TerrainSolid[], native?: TerrainQueries) {
  let position = {...from}, remaining = subtract(to, from);
  const contacts: HullContact[] = [];
  let fraction = 1;
  for (let bump = 0; bump < 4 && Math.hypot(remaining.x, remaining.y, remaining.z) > EPS; bump++) {
    const trace = sweepHull(position, add(position, remaining), height, boxes, native);
    position = trace.position;
    if (!trace.contact) break;
    if (!contacts.length) fraction = trace.fraction;
    contacts.push(trace.contact);
    if (trace.startSolid) break;
    remaining = scale(remaining, 1 - trace.fraction);
    for (const contact of contacts) remaining = clipContactVelocity(remaining, contact.normal);
    if (contacts.some(contact => dot(remaining, contact.normal) < -EPS)) break;
  }
  return {position, contacts, fraction};
}

export function verticalContact(position: Vec, from: number, to: number, height: number,
  boxes: readonly TerrainSolid[], floor: number | null = 0, native?: TerrainQueries): ReturnType<ResolveVertical> {
  let feet = floor === null ? to : Math.max(floor, to), grounded = floor !== null && to <= floor, ceiling = false;
  let normal: Vec | undefined, support: TerrainSolid | undefined;
  for (const box of boxes) {
    if (!collidable(box) || !horizontalOverlap(position, box)) continue;
    const top = surfaceHeight(box, position.x, position.z), bottom = box.center.y - box.size.y / 2;
    if (to <= from && from >= top - EPS && to <= top + EPS && top >= feet) {
      const {slopeX, slopeZ} = rampSurface(box);
      normal = normalize({x: -slopeX, y: 1, z: -slopeZ});
      feet = top; grounded = normal.y >= RULES.standableNormal; support = grounded ? box : undefined;
    } else if (to > from && from + height <= bottom + EPS && to + height >= bottom && bottom - height < feet) {
      feet = bottom - height; ceiling = true; grounded = false; normal = {x: 0, y: -1, z: 0};
    }
  }
  const contact = native?.vertical(position, from, to, height);
  if (contact && (contact.normal || contact.grounded || contact.ceiling) &&
    // `to` is only the requested endpoint, not a competing surface. Native
    // shape queries may refine a contact slightly beyond it within their
    // float32 tolerance, especially during a crouch on uneven ground.
    (!(grounded || ceiling || normal) || (to <= from ? contact.feet >= feet : contact.feet <= feet))) return contact;
  return {feet, grounded, ceiling, normal, support};
}

export function fitsTerrain(position: Vec, feet: number, height: number, world: TerrainWorld) {
  const b = world.bounds, r = RULES.hullRadius;
  return (world.floor === null || feet >= (world.floor ?? 0) - EPS) &&
    (!b || position.x >= b.minX + r - EPS && position.x <= b.maxX - r + EPS &&
      position.z >= b.minZ + r - EPS && position.z <= b.maxZ - r + EPS) && fitsHull(position, feet, height, world.solids, world.native);
}

export function terrainColliders(world: TerrainWorld): readonly TerrainSolid[] {
  const b = world.bounds;
  if (!b) return world.solids;
  const h = RULES.maxVelocity * 100, w = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 2;
  return [...world.solids,
    {center: {x: b.minX - .5, y: 0, z: (b.minZ + b.maxZ) / 2}, size: {x: 1, y: h, z: w}},
    {center: {x: b.maxX + .5, y: 0, z: (b.minZ + b.maxZ) / 2}, size: {x: 1, y: h, z: w}},
    {center: {x: (b.minX + b.maxX) / 2, y: 0, z: b.minZ - .5}, size: {x: w, y: h, z: 1}},
    {center: {x: (b.minX + b.maxX) / 2, y: 0, z: b.maxZ + .5}, size: {x: w, y: h, z: 1}}];
}

export function moveOnTerrain(from: Vec, to: Vec, height: number, world: TerrainWorld, supported = false): TerrainMove {
  const boxes = terrainColliders(world), floor = world.floor === undefined ? 0 : world.floor;
  let moved = slideHull(from, to, height, boxes, world.native), stepped = false;
  const distance = (p: Vec) => (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
  // Compare ordinary sliding with up/forward/down. Actors are never stairs.
  if (supported && to.y <= from.y + EPS && moved.contacts.some(c => c.normal.y >= 0)) {
    const up = sweepHull(from, {...from, y: from.y + RULES.stepHeight}, height, boxes, world.native);
    const across = slideHull(up.position, {x: to.x, y: up.position.y, z: to.z}, height, boxes, world.native);
    const down = verticalContact(across.position, up.position.y, to.y - RULES.stepHeight, height, boxes, floor, world.native);
    const landing = {...across.position, y: down.feet};
    if (down.grounded && down.support?.traversal?.kind !== 'actor' && distance(landing) > distance(moved.position) + EPS &&
      fitsTerrain(landing, landing.y, height, world)) {
      moved = {...across, position: landing, contacts: [...across.contacts, {normal: down.normal ?? {x: 0, y: 1, z: 0}, solid: down.support}]};
      stepped = true;
    }
  }
  const down = verticalContact(moved.position, moved.position.y,
    moved.position.y - (supported && to.y <= from.y + EPS ? RULES.stepHeight : EPS), height, boxes, floor, world.native);
  const snapped = down.grounded && (supported || moved.position.y - down.feet <= EPS) &&
    (down.support?.traversal?.kind !== 'actor' || moved.position.y - down.feet <= EPS);
  if (floor !== null && moved.position.y < floor) moved.position.y = floor;
  if (snapped) moved.position.y = down.feet;
  const ground = moved.contacts.find(c => c.normal.y >= RULES.standableNormal);
  const grounded = snapped || !!ground || (floor !== null && moved.position.y <= floor + EPS);
  return {...moved, grounded, ceiling: moved.contacts.some(c => c.normal.y < -.5), stepped,
    support: snapped ? down.support : ground?.solid};
}
