import type {Vec} from './actor-physics';

// Static convar defaults; solver tolerances are not movement tuning.
// Provenance and approximation boundaries: docs/terrain-contact-audit.md.
export const TERRAIN_RULES = {
  unit: .0254, hullRadius: 16 * .0254, standingHeight: 72 * .0254,
  crouchingHeight: 54 * .0254, stepHeight: 18 * .0254, standableNormal: .7,
  ladderSpeedScale: .78, ladderDampen: .2, ladderAngle: -.707, ladderDetachSpeed: 270 * .0254,
  waterSpeedScale: .9, waterAccelerate: 10, waterFriction: 1,
  bhopWindow: .0078125, jumpSpamTime: .015625, maxVelocity: 3500 * .0254,
} as const;
export const CONTACT_EPSILON = 1e-7;
export type ContactId = string | number;
export type Traversal =
  | {kind: 'solid'; friction?: number}
  | {kind: 'ramp'; axis: 'x' | 'z'; rise: number; direction?: 1 | -1; friction?: number}
  | {kind: 'ladder'; normal: Vec}
  | {kind: 'water'; current?: Vec; surfaceY?: number; speedScale?: number; drag?: number}
  | {kind: 'actor'; actorId: ContactId};
export type TerrainSolid = {center: Vec; size: Vec; id?: ContactId; traversal?: Traversal};
export type TerrainBounds = {minX: number; maxX: number; minZ: number; maxZ: number};
export type TerrainWorld = {solids: readonly TerrainSolid[]; floor?: number | null; bounds?: TerrainBounds};
export type Plane = {normal: Vec; distance: number};

export const collidable = (solid: TerrainSolid) =>
  solid.traversal?.kind !== 'water' && solid.traversal?.kind !== 'ladder';
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
export const add = (a: Vec, b: Vec): Vec => ({x: a.x + b.x, y: a.y + b.y, z: a.z + b.z});
export const subtract = (a: Vec, b: Vec): Vec => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
export const scale = (a: Vec, n: number): Vec => ({x: a.x * n, y: a.y * n, z: a.z * n});
export const normalize = (a: Vec): Vec => {
  const length = Math.hypot(a.x, a.y, a.z);
  return length ? scale(a, 1 / length) : {x: 0, y: 0, z: 0};
};

export function rampSurface(solid: TerrainSolid) {
  const ramp = solid.traversal;
  if (ramp?.kind !== 'ramp') return {slopeX: 0, slopeZ: 0, centerHeight: solid.center.y + solid.size.y / 2};
  const length = solid.size[ramp.axis];
  if (!(length > 0 && ramp.rise >= 0 && ramp.rise <= solid.size.y)) throw new RangeError('Invalid ramp dimensions');
  const slope = ramp.rise / length * (ramp.direction ?? 1);
  return {slopeX: ramp.axis === 'x' ? slope : 0, slopeZ: ramp.axis === 'z' ? slope : 0,
    centerHeight: solid.center.y + solid.size.y / 2 - ramp.rise / 2};
}

export function surfaceHeight(solid: TerrainSolid, x: number, z: number, radius = TERRAIN_RULES.hullRadius) {
  const surface = rampSurface(solid);
  const px = Math.max(solid.center.x - solid.size.x / 2, Math.min(solid.center.x + solid.size.x / 2,
    x + Math.sign(surface.slopeX) * radius));
  const pz = Math.max(solid.center.z - solid.size.z / 2, Math.min(solid.center.z + solid.size.z / 2,
    z + Math.sign(surface.slopeZ) * radius));
  return surface.centerHeight + surface.slopeX * (px - solid.center.x) + surface.slopeZ * (pz - solid.center.z);
}

// Convex box/wedge expanded by the square player hull. Flat top clips the
// ramp's expanded plane at its high end.
export function hullPlanes(solid: TerrainSolid, height: number, radius = TERRAIN_RULES.hullRadius): Plane[] {
  const {center: c, size: s} = solid;
  const planes: Plane[] = [
    {normal: {x: 1, y: 0, z: 0}, distance: c.x + s.x / 2 + radius},
    {normal: {x: -1, y: 0, z: 0}, distance: -c.x + s.x / 2 + radius},
    {normal: {x: 0, y: 0, z: 1}, distance: c.z + s.z / 2 + radius},
    {normal: {x: 0, y: 0, z: -1}, distance: -c.z + s.z / 2 + radius},
    {normal: {x: 0, y: -1, z: 0}, distance: -c.y + s.y / 2 + height},
    {normal: {x: 0, y: 1, z: 0}, distance: c.y + s.y / 2},
  ];
  if (solid.traversal?.kind === 'ramp') {
    const {slopeX, slopeZ, centerHeight} = rampSurface(solid);
    const normal = normalize({x: -slopeX, y: 1, z: -slopeZ});
    planes.push({normal, distance: (centerHeight - slopeX * c.x - slopeZ * c.z +
      radius * (Math.abs(slopeX) + Math.abs(slopeZ))) * normal.y});
  }
  return planes;
}

export function horizontalOverlap(position: Vec, solid: TerrainSolid, radius = TERRAIN_RULES.hullRadius) {
  return Math.abs(position.x - solid.center.x) < solid.size.x / 2 + radius - CONTACT_EPSILON &&
    Math.abs(position.z - solid.center.z) < solid.size.z / 2 + radius - CONTACT_EPSILON;
}

export function waterLevel(position: Vec, feet: number, height: number, solids: readonly TerrainSolid[]): 0 | 1 | 2 | 3 {
  let level: 0 | 1 | 2 | 3 = 0;
  for (const solid of solids) {
    if (solid.traversal?.kind !== 'water' || !horizontalOverlap(position, solid, 0)) continue;
    const bottom = solid.center.y - solid.size.y / 2, top = solid.traversal.surfaceY ?? solid.center.y + solid.size.y / 2;
    const submerged = (y: number) => y >= bottom && y < top;
    const next = submerged(feet + CONTACT_EPSILON) ?
      submerged(feet + height - 8 * TERRAIN_RULES.unit) ? 3 : submerged(feet + height / 2) ? 2 : 1 : 0;
    level = Math.max(level, next) as 0 | 1 | 2 | 3;
  }
  return level;
}

export function ladderAt(position: Vec, feet: number, height: number, solids: readonly TerrainSolid[]) {
  return solids.find(solid => solid.traversal?.kind === 'ladder' && horizontalOverlap(position, solid) &&
    feet < solid.center.y + solid.size.y / 2 && feet + height > solid.center.y - solid.size.y / 2);
}
