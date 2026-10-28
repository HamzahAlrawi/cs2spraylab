import {UNIT, type Vec} from '../actor-physics';
import {sourcePoint, type PrefireAngle, type SourcePoint} from './routes';
import type {NativeMapCollision} from './native-collision';

type Collision = Pick<NativeMapCollision, 'vertical' | 'fits'>;

// Small floor tolerances account for sampled pawn feet and float hull queries.
// Horizontal relocation or snapping to a floor several metres below is never
// appropriate for a common-angle training target.
export function placePrefireTarget(collision: Collision, point: SourcePoint, crouched = false): Vec {
  const p = sourcePoint(point), height = (crouched ? 54 : 72) * UNIT;
  const support = collision.vertical(p, p.y + 6 * UNIT, p.y - 6 * UNIT, height);
  if (!support.grounded || Math.abs(support.feet - p.y) > 6 * UNIT || !collision.fits(p, support.feet, height)) {
    throw new Error(`Practice position ${point.join(', ')} does not fit this map revision.`);
  }
  return {...p, y: support.feet};
}

export function prefirePeekPosition(collision: Collision & Pick<NativeMapCollision, 'sweep'>, angle: PrefireAngle): Vec | undefined {
  const anchor = placePrefireTarget(collision, angle.position, angle.crouched);
  if (angle.peek) {
    const peek = placePrefireTarget(collision, angle.peek, angle.crouched);
    return collision.sweep(anchor, peek, (angle.crouched ? 54 : 72) * UNIT).fraction >= .999 ? peek : undefined;
  }
  if (!angle.moving || !angle.rotation) return;
  const yaw = angle.rotation[1] * Math.PI / 180, height = (angle.crouched ? 54 : 72) * UNIT;
  // Optional movement is a local drill variation. The source anchor is fixed;
  // only a short, supported, unobstructed lateral excursion is permitted.
  for (const distance of [64, 48, 32]) for (const side of [1, -1]) {
    const target: SourcePoint = [angle.position[0] - Math.sin(yaw) * distance * side,
      angle.position[1] + Math.cos(yaw) * distance * side, angle.position[2]];
    try {
      const peek = placePrefireTarget(collision, target, angle.crouched);
      if (Math.abs(peek.y - anchor.y) > 3 * UNIT || collision.sweep(anchor, peek, height).fraction < .999) continue;
      let supported = true;
      for (let i = 1; i < 8; i++) {
        const t = i / 8, p = {x: anchor.x + (peek.x - anchor.x) * t, y: anchor.y + (peek.y - anchor.y) * t, z: anchor.z + (peek.z - anchor.z) * t};
        const floor = collision.vertical(p, p.y + 3 * UNIT, p.y - 3 * UNIT, height);
        if (!floor.grounded || Math.abs(floor.feet - p.y) > 3 * UNIT || !collision.fits(p, floor.feet, height)) {supported = false; break;}
      }
      if (supported) return peek;
    } catch { /* No valid lateral standing/crouched hull at this candidate. */ }
  }
}
