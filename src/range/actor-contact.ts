import type {ActorKinematics, Vec} from './actor-physics';
import {fitsTerrain} from './actor-collision';
import {CONTACT_EPSILON as EPS, TERRAIN_RULES as RULES,
  type ContactId, type TerrainSolid, type TerrainWorld} from './terrain';

export type ActorPose = {position: Vec; feet: number; duckAmount?: number; height?: number};
export type ContactActor = ActorPose & {
  id: ContactId; alive?: boolean; grounded?: boolean; verticalVelocity?: number;
  velocity?: {x: number; z: number}; previous?: ActorPose;
};
export type ActorContact = {kind: 'none' | 'side' | 'a-on-b' | 'b-on-a'; normal: Vec; depth: number};
export type ActorSupport = {id: ContactId; feet: number; actor: ContactActor; velocity: Vec; grounded: boolean};

export function actorHeight(actor: ActorPose) {
  const duck = Math.max(0, Math.min(1, actor.duckAmount ?? 0));
  const curve = duck * duck * (3 - 2 * duck);
  return actor.height ?? RULES.standingHeight - (RULES.standingHeight - RULES.crouchingHeight) * curve;
}

export function actorHull(actor: ContactActor): TerrainSolid {
  const height = actorHeight(actor);
  return {id: actor.id, center: {x: actor.position.x, y: actor.feet + height / 2, z: actor.position.z},
    size: {x: RULES.hullRadius * 2, y: height, z: RULES.hullRadius * 2}, traversal: {kind: 'actor', actorId: actor.id}};
}

export function actorContactSolids(actors: readonly ContactActor[], selfId?: ContactId) {
  const solids: TerrainSolid[] = [];
  for (const actor of actors) if (actor.alive !== false && actor.id !== selfId) solids.push(actorHull(actor));
  return solids;
}

const overlappingFootprints = (a: ActorPose, b: ActorPose) =>
  Math.abs(a.position.x - b.position.x) < RULES.hullRadius * 2 - EPS &&
  Math.abs(a.position.z - b.position.z) < RULES.hullRadius * 2 - EPS;

export function classifyActorContact(a: ContactActor, b: ContactActor): ActorContact {
  const none: ActorContact = {kind: 'none', normal: {x: 0, y: 0, z: 0}, depth: 0};
  if (a.id === b.id || a.alive === false || b.alive === false) return none;
  const dx = a.position.x - b.position.x, dz = a.position.z - b.position.z;
  const px = RULES.hullRadius * 2 - Math.abs(dx), pz = RULES.hullRadius * 2 - Math.abs(dz);
  if (px <= EPS || pz <= EPS) return none;
  const aTop = a.feet + actorHeight(a), bTop = b.feet + actorHeight(b);
  if (Math.abs(a.feet - bTop) <= EPS) return {kind: 'a-on-b', normal: {x: 0, y: 1, z: 0}, depth: 0};
  if (Math.abs(b.feet - aTop) <= EPS) return {kind: 'b-on-a', normal: {x: 0, y: -1, z: 0}, depth: 0};
  if (a.feet >= bTop - EPS || b.feet >= aTop - EPS) return none;
  // Overlapping spawns are separated horizontally, never teleported onto heads.
  // Deterministic ID tie-break avoids oscillation for coincident actors.
  const sign = String(a.id) < String(b.id) ? -1 : 1;
  return px <= pz ? {kind: 'side', normal: {x: Math.sign(dx) || sign, y: 0, z: 0}, depth: px} :
    {kind: 'side', normal: {x: 0, y: 0, z: Math.sign(dz) || sign}, depth: pz};
}

export function findActorSupport(actor: ActorPose & {id?: ContactId; verticalVelocity?: number}, bodies: readonly ContactActor[]): ActorSupport | undefined {
  for (const body of bodies) {
    if (body.id === actor.id || body.alive === false || !overlappingFootprints(actor, body)) continue;
    const top = body.feet + actorHeight(body);
    if (Math.abs(actor.feet - top) > EPS || (actor.verticalVelocity ?? 0) > (body.verticalVelocity ?? 0) + EPS) continue;
    return {id: body.id, feet: top, actor: body, grounded: body.grounded ?? body.feet === 0,
      velocity: {x: body.velocity?.x ?? 0, y: body.verticalVelocity ?? 0, z: body.velocity?.z ?? 0}};
  }
  return undefined;
}

// Supply previous/current snapshots once per simulation slice. Stance changes
// move the support top too; no launch impulse is invented when a base stands.
export function supportDisplacement(actor: Pick<ActorKinematics, 'supportId' | 'position' | 'feet' | 'verticalVelocity'>,
  bodies: readonly ContactActor[]): Vec {
  const body = bodies.find(other => other.id === actor.supportId && other.alive !== false);
  if (!body?.previous || actor.verticalVelocity > (body.verticalVelocity ?? 0) + EPS ||
    Math.abs(actor.feet - body.previous.feet - actorHeight(body.previous)) > EPS ||
    !overlappingFootprints(actor, body.previous)) return {x: 0, y: 0, z: 0};
  return {x: body.position.x - body.previous.position.x,
    y: body.feet + actorHeight(body) - body.previous.feet - actorHeight(body.previous),
    z: body.position.z - body.previous.position.z};
}

export function separateActorPair<A extends ContactActor, B extends ContactActor>(a: A, b: B,
  options: {immovableA?: boolean; immovableB?: boolean; canOccupy?: (pose: ActorPose, id: ContactId) => boolean} = {}) {
  const contact = classifyActorContact(a, b);
  if (contact.kind !== 'side') return {a, b, contact, separated: true};
  if (options.immovableA && options.immovableB) return {a, b, contact, separated: false};
  const translate = <T extends ContactActor>(actor: T, distance: number): T => ({...actor,
    position: {...actor.position, x: actor.position.x + contact.normal.x * distance,
      z: actor.position.z + contact.normal.z * distance}});
  const fit = (pose: ContactActor) => options.canOccupy?.(pose, pose.id) ?? true;
  const aWeight = options.immovableA ? 0 : options.immovableB ? 1 : .5;
  const bWeight = options.immovableB ? 0 : options.immovableA ? 1 : .5;
  let nextA = translate(a, contact.depth * aWeight), nextB = translate(b, -contact.depth * bWeight);
  if (fit(nextA) && fit(nextB)) return {a: nextA, b: nextB, contact, separated: true};
  nextA = translate(a, contact.depth); nextB = translate(b, -contact.depth);
  if (!options.immovableA && fit(nextA)) return {a: nextA, b, contact, separated: true};
  if (!options.immovableB && fit(nextB)) return {a, b: nextB, contact, separated: true};
  return {a, b, contact, separated: false};
}

export function supportedActorStack(base: ContactActor, bodies: readonly ContactActor[]) {
  const riders: ContactActor[] = [], seen = new Set<ContactId>([base.id]), queue = [base];
  for (let i = 0; i < queue.length; i++) {
    for (const body of bodies) {
      if (seen.has(body.id) || body.alive === false) continue;
      if (classifyActorContact(body, queue[i]).kind !== 'a-on-b') continue;
      seen.add(body.id); riders.push(body); queue.push(body);
    }
  }
  return riders;
}

// Test the whole raised stack, including ceilings and unrelated actors. Main
// may apply these poses after advancing a base, or use this as a stance guard.
export function resizeSupportedStack(base: ContactActor, next: ActorPose, bodies: readonly ContactActor[], world: TerrainWorld) {
  const riders = supportedActorStack(base, bodies), delta = next.feet + actorHeight(next) - base.feet - actorHeight(base);
  const moved = [{...base, ...next}, ...riders.map(body => ({...body, feet: body.feet + delta,
    position: {...body.position, y: body.position.y + delta}}))];
  const ids = new Set(moved.map(body => body.id));
  const others = bodies.filter(body => !ids.has(body.id) && body.alive !== false);
  const stationarySolids = [...world.solids, ...actorContactSolids(others)], movedHulls = moved.map(actorHull);
  for (let i = 0; i < moved.length; i++) {
    const body = moved[i], solids = [...stationarySolids, ...movedHulls.filter((_, j) => j !== i)];
    if (!fitsTerrain(body.position, body.feet, actorHeight(body), {...world, solids})) return undefined;
  }
  return moved;
}
