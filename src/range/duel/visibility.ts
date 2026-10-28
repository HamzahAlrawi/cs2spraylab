import type {Vec} from '../actor-physics';
import {raySolidInterval, traceSolid, type Arena} from './geometry';
import type {DuelActorSnapshot} from './types';

// Cull only when one convex solid occludes every corner of an oversized
// character/weapon box. Separate walls cannot accidentally hide a visible gap.
export function fullyOccluded(eye: Vec, actor: DuelActorSnapshot, arena: Arena,
  envelope = {radius: 1.25, low: -.1, high: 2.25}) {
  if (!arena.solids.length) return false;
  const center = {x: actor.position.x, y: actor.feet + (envelope.low + envelope.high) / 2, z: actor.position.z};
  const dx = center.x - eye.x, dy = center.y - eye.y, dz = center.z - eye.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 2) return false;
  const hit = traceSolid(eye, {x: dx / distance, y: dy / distance, z: dz / distance}, arena, distance);
  if (hit.surfaceId < 0 || hit.source === 'native') return false;
  const solid = arena.solids[hit.surfaceId];
  if (!solid) return false;
  for (const x of [-envelope.radius, envelope.radius]) for (const z of [-envelope.radius, envelope.radius]) for (const y of [envelope.low, envelope.high]) {
    const vx = center.x + x - eye.x, vy = actor.feet + y - eye.y, vz = center.z + z - eye.z;
    const length = Math.hypot(vx, vy, vz);
    const blockedAt = raySolidInterval(eye, {x: vx / length, y: vy / length, z: vz / length}, solid, length)?.entryDistance ?? Infinity;
    if (!Number.isFinite(blockedAt) || blockedAt < .01 || blockedAt >= length - .01) return false;
  }
  return true;
}
