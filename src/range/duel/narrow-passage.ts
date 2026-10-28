import {UNIT, type Vec} from '../actor-physics';
import {canFitInArena, type Arena} from './geometry';
import type {DuelActorSnapshot} from './types';

export type NarrowPassage = {center: Vec; axis: {x: number; z: number}};

// Local hull probes only, called at tactical frequency. Probe both shoulders
// so ordinary wall-following in an open lane does not become a reservation.
export function narrowPassage(self: DuelActorSnapshot, waypoint: Vec, arena: Arena): NarrowPassage | null {
  const dx = waypoint.x - self.position.x, dz = waypoint.z - self.position.z;
  const length = Math.hypot(dx, dz);
  if (length < .2 || Math.abs(waypoint.y - self.feet) > .5) return null;
  const axis = {x: dx / length, z: dz / length};
  const height = (self.duckAmount > .5 ? 54 : 72) * UNIT;
  for (const step of [0, .6, 1.2]) {
    if (step > length) break;
    const center = {x: self.position.x + axis.x * step, y: self.feet, z: self.position.z + axis.z * step};
    if (!canFitInArena(center, center.y, height, arena)) continue;
    const fits = (side: number) => {
      const point = {...center, x: center.x + axis.z * side * .6, z: center.z - axis.x * side * .6};
      return canFitInArena(point, point.y, height, arena);
    };
    if (!fits(-1) && !fits(1)) return {center, axis};
  }
  return null;
}
