import type {Vec} from '../actor-physics';
import {rayBox, traceSolid, type Arena} from './geometry';
import type {DuelActorSnapshot} from './types';

// Cull only when one convex solid occludes every corner of an oversized
// character/weapon box. Separate walls cannot accidentally hide a visible gap.
export function fullyOccluded(eye: Vec, actor: DuelActorSnapshot, arena: Arena) {
  const center = {x: actor.position.x, y: actor.feet + 1.1, z: actor.position.z};
  const dx = center.x - eye.x, dy = center.y - eye.y, dz = center.z - eye.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 2) return false;
  const hit = traceSolid(eye, {x: dx / distance, y: dy / distance, z: dz / distance}, arena, distance);
  if (hit.surfaceId < 0) return false;
  const solid = arena.solids[hit.surfaceId];
  const min = {x: solid.center.x - solid.size.x / 2, y: solid.center.y - solid.size.y / 2, z: solid.center.z - solid.size.z / 2};
  const max = {x: solid.center.x + solid.size.x / 2, y: solid.center.y + solid.size.y / 2, z: solid.center.z + solid.size.z / 2};
  for (const x of [-1.25, 1.25]) for (const z of [-1.25, 1.25]) for (const y of [-.1, 2.25]) {
    const vx = center.x + x - eye.x, vy = actor.feet + y - eye.y, vz = center.z + z - eye.z;
    const length = Math.hypot(vx, vy, vz);
    const blockedAt = rayBox(eye, {x: vx / length, y: vy / length, z: vz / length}, min, max, length);
    if (!Number.isFinite(blockedAt) || blockedAt < .01 || blockedAt >= length - .01) return false;
  }
  return true;
}
