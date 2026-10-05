import {UNIT, type Vec} from '../actor-physics';
import type {Arena, Solid} from './geometry';
import type {TerrainSolid, TerrainWorld} from '../terrain';

export type SurfaceMaterial = 'concrete' | 'metal' | 'wood' | 'glass' | 'grate' | 'water';
export type RampShape = {kind: 'ramp'; axis: 'x' | 'z'; highSide: -1 | 1};
export type EnvironmentInteraction =
  | {kind: 'door'; openOffset: Vec; useRadius: number; initiallyOpen?: boolean}
  | {kind: 'breakable'; debris: 'glass' | 'vent' | 'wood'}
  | {kind: 'movable'; mass: number; damping: number; maxSpeed: number};
export type EnvironmentMetadata = {id?: string; material?: SurfaceMaterial; health?: number;
  active?: boolean; passable?: boolean; shotBlocking?: boolean; shape?: RampShape; interaction?: EnvironmentInteraction};
export type TraversalVolume = {id: string; poiId?: string; kind: 'ladder' | 'water'; center: Vec; size: Vec;
  material: SurfaceMaterial; ladder?: {axis: 'x' | 'z'; facing: -1 | 1; bottom: number; top: number; dismount: Vec};
  water?: {surfaceY: number; speedScale: number; drag: number}};
export type PartnerBoostGeometry = {base: Vec; mount: Vec; partnerTop: Vec; perch: Vec; dismount: Vec;
  platformId: string; perchId: string; approachLinkId: string; partnerStance: 'crouch'};
export type TraversalLink = {id: string; poiId?: string; kind: 'stairs' | 'ramp' | 'ladder' | 'boost' | 'wade' | 'door' | 'breakable';
  from: Vec; to: Vec; surfaceIds: string[]; volumeId?: string; requiredOpenId?: string; requiredBreakId?: string;
  requiresCrouch?: boolean; requiresPartner?: boolean; bidirectional: boolean; boost?: PartnerBoostGeometry};
export type EnvironmentPieceState = {health?: number; active: boolean; passable: boolean; open: boolean; offset: Vec; velocity: Vec};
export type EnvironmentState = {revision: number; pieces: Readonly<Record<string, EnvironmentPieceState>>};
export type EnvironmentEvent = {kind: 'opened' | 'closed' | 'damaged' | 'destroyed' | 'moved'; id: string; position: Vec; material: SurfaceMaterial};
export type EnvironmentResult = {state: EnvironmentState; events: EnvironmentEvent[]; changed: boolean};

const zero = (): Vec => ({x: 0, y: 0, z: 0});
export const environmentPieceId = (solid: Solid, index: number) => solid.id ?? `solid-${index}`;
export const surfaceMaterial = (solid: Solid): SurfaceMaterial => solid.material ??
  (solid.kind === 'crate' ? 'wood' : solid.kind === 'cargo' ? 'metal' : 'concrete');

export function createEnvironmentState(arena: Arena): EnvironmentState {
  const pieces: Record<string, EnvironmentPieceState> = {};
  arena.solids.forEach((solid, index) => {
    const id = environmentPieceId(solid, index);
    if (pieces[id]) throw new Error(`Duplicate environment surface ID: ${id}`);
    const open = solid.interaction?.kind === 'door' && !!solid.interaction.initiallyOpen;
    const health = solid.health === undefined ? undefined : Math.max(0, solid.health);
    const active = solid.active !== false && health !== 0;
    pieces[id] = {health, active, passable: !active || !!solid.passable || open, open,
      offset: open && solid.interaction?.kind === 'door' ? {...solid.interaction.openOffset} : zero(), velocity: zero()};
  });
  return {revision: 0, pieces};
}

export function resolveEnvironmentSolid(solid: Solid, index: number, state?: EnvironmentState): Solid {
  const piece = state?.pieces[environmentPieceId(solid, index)];
  if (!piece) {
    if (solid.interaction?.kind !== 'door' || !solid.interaction.initiallyOpen) return solid;
    const offset = solid.interaction.openOffset;
    return {...solid, passable: true, shotBlocking: false,
      center: {x: solid.center.x + offset.x, y: solid.center.y + offset.y, z: solid.center.z + offset.z}};
  }
  return {...solid, health: piece.health, active: piece.active, passable: piece.passable,
    // The parked open leaf is render-only; this is an authored sliding-door abstraction.
    shotBlocking: piece.open ? false : solid.shotBlocking,
    center: {x: solid.center.x + piece.offset.x, y: solid.center.y + piece.offset.y, z: solid.center.z + piece.offset.z}};
}

export const blocksMovement = (solid: Solid) => solid.active !== false && solid.health !== 0 && !solid.passable;
export const blocksShots = (solid: Solid) => solid.active !== false && solid.health !== 0 && solid.shotBlocking !== false;
export function environmentSolids(arena: Arena, state?: EnvironmentState): Solid[] {
  return arena.solids.map((solid, index) => resolveEnvironmentSolid(solid, index, state));
}

// Adapter to the movement worker's contract. Volumes never enter arena.solids.
export function environmentTerrainWorld(arena: Arena, state?: EnvironmentState): TerrainWorld {
  const solids: TerrainSolid[] = environmentSolids(arena, state).flatMap((solid, index) => blocksMovement(solid) ? [{
    id: environmentPieceId(solid, index), center: solid.center, size: solid.size,
    traversal: solid.shape ? {kind: 'ramp' as const, axis: solid.shape.axis, rise: solid.size.y, direction: solid.shape.highSide} : {kind: 'solid' as const},
  }] : []);
  for (const volume of arena.traversalVolumes ?? []) {
    if (volume.kind === 'ladder' && volume.ladder) {
      const normal: Vec = {x: 0, y: 0, z: 0}; normal[volume.ladder.axis] = volume.ladder.facing;
      solids.push({id: volume.id, center: volume.center, size: volume.size, traversal: {kind: 'ladder', normal}});
    } else if (volume.kind === 'water') solids.push({id: volume.id, center: volume.center, size: volume.size, traversal: {kind: 'water'}});
  }
  return {solids, floor: 0, bounds: {minX: arena.minX, maxX: arena.maxX, minZ: arena.minZ, maxZ: arena.maxZ}};
}

function replacePiece(state: EnvironmentState, id: string, piece: EnvironmentPieceState): EnvironmentState {
  return {revision: state.revision + 1, pieces: {...state.pieces, [id]: piece}};
}
const unchanged = (state: EnvironmentState): EnvironmentResult => ({state, events: [], changed: false});
const finiteVec = (v: Vec) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
function closestPoint(p: Vec, solid: Solid): Vec {
  return {x: Math.max(solid.center.x - solid.size.x / 2, Math.min(solid.center.x + solid.size.x / 2, p.x)),
    y: Math.max(solid.center.y - solid.size.y / 2, Math.min(solid.center.y + solid.size.y / 2, p.y)),
    z: Math.max(solid.center.z - solid.size.z / 2, Math.min(solid.center.z + solid.size.z / 2, p.z))};
}
function segmentHits(a: Vec, b: Vec, solid: Solid) {
  let near = 0, far = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = b[axis] - a[axis], low = solid.center[axis] - solid.size[axis] / 2, high = solid.center[axis] + solid.size[axis] / 2;
    if (Math.abs(delta) < 1e-10) {if (a[axis] < low || a[axis] > high) return false; continue;}
    let enter = (low - a[axis]) / delta, exit = (high - a[axis]) / delta;
    if (enter > exit) [enter, exit] = [exit, enter];
    near = Math.max(near, enter); far = Math.min(far, exit);
    if (far < near) return false;
  }
  return near < 1 - 1e-6 && far > 1e-6;
}

export function useEnvironmentPiece(arena: Arena, state: EnvironmentState, id: string, userEye: Vec,
  occupants: readonly {center: Vec; size: Vec}[] = []): EnvironmentResult {
  if (!finiteVec(userEye)) return unchanged(state);
  const index = arena.solids.findIndex((solid, i) => environmentPieceId(solid, i) === id);
  const authored = arena.solids[index], piece = state.pieces[id];
  if (!authored || authored.interaction?.kind !== 'door' || !piece?.active) return unchanged(state);
  const target = closestPoint(userEye, authored);
  if (Math.hypot(target.x - userEye.x, target.y - userEye.y, target.z - userEye.z) > authored.interaction.useRadius) return unchanged(state);
  const solids = environmentSolids(arena, state);
  if (solids.some((solid, i) => i !== index && blocksMovement(solid) && segmentHits(userEye, target, solid))) return unchanged(state);
  // Closing must not trap an actor inside the closed leaf.
  if (piece.open && occupants.some(body => boxesOverlap(authored, body))) return unchanged(state);
  const open = !piece.open;
  const next = {...piece, open, passable: open || !!authored.passable,
    offset: open ? {...authored.interaction.openOffset} : zero()};
  return {state: replacePiece(state, id, next), changed: true, events: [{kind: open ? 'opened' : 'closed', id,
    position: {...authored.center}, material: surfaceMaterial(authored)}]};
}

export function damageEnvironmentPiece(arena: Arena, state: EnvironmentState, id: string, damage: number,
  impulse: Vec = zero()): EnvironmentResult {
  if (!Number.isFinite(damage) || damage < 0 || !finiteVec(impulse)) return unchanged(state);
  const index = arena.solids.findIndex((solid, i) => environmentPieceId(solid, i) === id);
  const solid = arena.solids[index], piece = state.pieces[id];
  if (!solid || !piece?.active || !solid.interaction || solid.interaction.kind === 'door') return unchanged(state);
  const health = piece.health === undefined ? undefined : Math.max(0, piece.health - damage);
  const destroyed = health === 0, movable = solid.interaction.kind === 'movable' ? solid.interaction : undefined;
  let velocity = {...piece.velocity};
  if (movable && !destroyed) {
    velocity = {x: velocity.x + impulse.x / Math.max(.1, movable.mass), y: 0, z: velocity.z + impulse.z / Math.max(.1, movable.mass)};
    const speed = Math.hypot(velocity.x, velocity.z), factor = Math.min(1, movable.maxSpeed / Math.max(speed, 1e-9));
    velocity.x *= factor; velocity.z *= factor;
  }
  if (destroyed) velocity = zero();
  if (health === piece.health && velocity.x === piece.velocity.x && velocity.z === piece.velocity.z) return unchanged(state);
  const next = {...piece, health, active: !destroyed, passable: destroyed || piece.passable, velocity};
  const position = resolveEnvironmentSolid(solid, index, state).center;
  const events: EnvironmentEvent[] = health !== piece.health ? [{kind: destroyed ? 'destroyed' : 'damaged', id, position: {...position}, material: surfaceMaterial(solid)}] : [];
  return {state: replacePiece(state, id, next), events, changed: true};
}

function boxesOverlap(a: {center: Vec; size: Vec}, b: {center: Vec; size: Vec}) {
  return (['x', 'y', 'z'] as const).every(axis => Math.abs(a.center[axis] - b.center[axis]) < (a.size[axis] + b.size[axis]) / 2 - 1e-8);
}

// Grounded planar props use bounded swept substeps. This is not a general rigid-body solver.
export function advanceEnvironment(arena: Arena, state: EnvironmentState, dt: number,
  occupants: readonly {center: Vec; size: Vec}[] = []): EnvironmentResult {
  if (!Number.isFinite(dt) || dt <= 0) return unchanged(state);
  const elapsed = Math.min(dt, .25), pieces = {...state.pieces}, events: EnvironmentEvent[] = [];
  let changed = false;
  for (const [index, authored] of arena.solids.entries()) {
    if (authored.interaction?.kind !== 'movable') continue;
    const id = environmentPieceId(authored, index), piece = pieces[id];
    if (!piece?.active || Math.hypot(piece.velocity.x, piece.velocity.z) < 1e-5) continue;
    const velocity = {...piece.velocity}, offset = {...piece.offset};
    const steps = Math.max(1, Math.ceil(Math.hypot(velocity.x, velocity.z) * elapsed / .08));
    for (let step = 0; step < steps; step++) for (const axis of ['x', 'z'] as const) {
      const candidate = {...authored, center: {x: authored.center.x + offset.x, y: authored.center.y + offset.y, z: authored.center.z + offset.z}};
      candidate.center[axis] += velocity[axis] * elapsed / steps;
      const hits = candidate.center.x - candidate.size.x / 2 < arena.minX || candidate.center.x + candidate.size.x / 2 > arena.maxX ||
        candidate.center.z - candidate.size.z / 2 < arena.minZ || candidate.center.z + candidate.size.z / 2 > arena.maxZ ||
        occupants.some(body => boxesOverlap(candidate, body)) || arena.solids.some((other, otherIndex) => {
          if (index === otherIndex) return false;
          const resolved = resolveEnvironmentSolid(other, otherIndex, {revision: state.revision, pieces});
          return blocksMovement(resolved) && boxesOverlap(candidate, resolved);
        });
      if (hits) velocity[axis] = 0;
      else offset[axis] = candidate.center[axis] - authored.center[axis];
    }
    const damping = Math.exp(-authored.interaction.damping * elapsed);
    velocity.x *= damping; velocity.z *= damping;
    if (Math.hypot(velocity.x, velocity.z) < .01) {velocity.x = 0; velocity.z = 0;}
    pieces[id] = {...piece, offset, velocity}; changed = true;
    if (Math.hypot(offset.x - piece.offset.x, offset.z - piece.offset.z) > 1e-8) events.push({kind: 'moved', id,
      position: {x: authored.center.x + offset.x, y: authored.center.y + offset.y, z: authored.center.z + offset.z}, material: surfaceMaterial(authored)});
  }
  return changed ? {state: {revision: state.revision + 1, pieces}, events, changed} : unchanged(state);
}

export function traversalAt(arena: Arena, feet: Vec, height: number): TraversalVolume[] {
  return (arena.traversalVolumes ?? []).filter(volume => Math.abs(feet.x - volume.center.x) <= volume.size.x / 2 &&
    Math.abs(feet.z - volume.center.z) <= volume.size.z / 2 && feet.y < volume.center.y + volume.size.y / 2 &&
    feet.y + height > volume.center.y - volume.size.y / 2);
}

export function availableTraversalLinks(arena: Arena, state?: EnvironmentState, partnerAvailable = false): TraversalLink[] {
  const authored = new Map(arena.solids.map((solid, index) => [environmentPieceId(solid, index), solid]));
  const active = (id: string) => {
    const solid = authored.get(id), piece = state?.pieces[id];
    return !!solid && (piece ? piece.active : solid.active !== false && solid.health !== 0);
  };
  const open = (id: string) => {
    const solid = authored.get(id);
    return state?.pieces[id]?.open ?? (solid?.interaction?.kind === 'door' && !!solid.interaction.initiallyOpen);
  };
  return (arena.traversalLinks ?? []).filter(link => (!link.requiresPartner || partnerAvailable) &&
    (!link.requiredOpenId || open(link.requiredOpenId)) &&
    (!link.requiredBreakId || authored.has(link.requiredBreakId) && !active(link.requiredBreakId)) &&
    link.surfaceIds.every(id => id === link.requiredBreakId || active(id)));
}

export type BoostPOI = {id: string; poiId?: string; base: Vec; landing: Vec; rise: number;
  requiresPartner: boolean; surfaceIds: string[]; bidirectional: boolean};
export function boostPOIs(arena: Arena, state?: EnvironmentState): BoostPOI[] {
  // Include partner-required opportunities as metadata; selection still needs a partner.
  return availableTraversalLinks(arena, state, true).filter(link => link.kind === 'boost').map(link => ({
    id: link.id, poiId: link.poiId, base: {...link.boost?.base ?? link.from}, landing: {...link.to}, rise: link.to.y - link.from.y,
    requiresPartner: !!link.requiresPartner, surfaceIds: [...link.surfaceIds], bidirectional: link.bidirectional,
  }));
}

export type ArenaBoostPOI = PartnerBoostGeometry & {id: string; poiId?: string; requiresPartner: true; lookAt: Vec};
export function arenaBoostPOIs(arena: Arena, state?: EnvironmentState): ArenaBoostPOI[] {
  return availableTraversalLinks(arena, state, true).flatMap(link => {
    const boost = link.boost;
    if (link.kind !== 'boost' || !link.requiresPartner || !boost) return [];
    const side = boost.perch.x < (arena.minX + arena.maxX) / 2 ? -1 : 1;
    const angle = arena.lanes?.find(lane => lane.role === 'entry' && lane.side === side)?.edge;
    // An authored common-angle prior, not a query of hidden opponent positions.
    const lookAt = angle ? {...angle, y: angle.y + 64 * UNIT} : {x: (arena.minX + arena.maxX) / 2, y: 64 * UNIT, z: 0};
    return [{...boost, id: link.id, poiId: link.poiId, requiresPartner: true as const,
      base: {...boost.base}, mount: {...boost.mount}, partnerTop: {...boost.partnerTop}, perch: {...boost.perch}, dismount: {...boost.dismount}, lookAt}];
  });
}

export type ShadowFootprint = {id: string; material: SurfaceMaterial; points: {x: number; z: number}[]};
export function shadowFootprints(arena: Arena, sunToward: Vec, state?: EnvironmentState, groundY = 0): ShadowFootprint[] {
  if (!finiteVec(sunToward) || sunToward.y <= 1e-4) return [];
  return environmentSolids(arena, state).flatMap((solid, index) => {
    if (solid.active === false || solid.health === 0 || surfaceMaterial(solid) === 'glass') return [];
    const points: {x: number; z: number}[] = [];
    for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [-1, 1]) {
      const height = Math.max(0, solid.center.y + y * solid.size.y / 2 - groundY);
      points.push({x: solid.center.x + x * solid.size.x / 2 - sunToward.x / sunToward.y * height,
        z: solid.center.z + z * solid.size.z / 2 - sunToward.z / sunToward.y * height});
    }
    points.sort((a, b) => a.x - b.x || a.z - b.z);
    const cross = (a: typeof points[number], b: typeof a, c: typeof a) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const half = (input: typeof points) => {
      const result: typeof points = [];
      for (const p of input) {while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], p) <= 0) result.pop(); result.push(p);}
      return result.slice(0, -1);
    };
    return [{id: environmentPieceId(solid, index), material: surfaceMaterial(solid), points: [...half(points), ...half([...points].reverse())]}];
  });
}
