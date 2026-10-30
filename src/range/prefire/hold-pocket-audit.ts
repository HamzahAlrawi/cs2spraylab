import {UNIT} from '../actor-physics';
import {sourcePoint} from './route-helpers';
import type {SourcePoint} from './schema';
import type {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import {walkPrefireAuditPath} from './spawn-audit';

export type HoldPocketStatus = 'accepted-local' | 'blocked-corridor' | 'ambiguous';

// Offline diagnostic only: binned means are not the original observed feet.
// A passing local corridor cannot certify all rounds pooled into that bin.
export function auditHoldPocket(collision: NativeMapCollision, from: SourcePoint, to: SourcePoint): HoldPocketStatus {
  if (!from.every(Number.isFinite) || !to.every(Number.isFinite) ||
    Math.hypot(to[0] - from[0], to[1] - from[1]) > 96 || Math.abs(to[2] - from[2]) > 24) return 'ambiguous';
  for (const crouched of [false, true]) {
    try {placePrefireTarget(collision, from, crouched); placePrefireTarget(collision, to, crouched);}
    catch {return 'ambiguous';}
  }
  const a = sourcePoint(from), b = sourcePoint(to), dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  for (const crouched of [false, true]) {
    let points;
    try {points = walkPrefireAuditPath(collision, [from, to], crouched);}
    catch {return 'blocked-corridor';}
    let traveled = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i) traveled += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
      const offset = length ? Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / length : Math.hypot(p.x - a.x, p.z - a.z);
      if (offset > 4 * UNIT || traveled > length + 8 * UNIT) return 'blocked-corridor';
    }
  }
  return 'accepted-local';
}
