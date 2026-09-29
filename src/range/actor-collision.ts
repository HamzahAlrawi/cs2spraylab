import {UNIT, type Vec, type ResolveVertical} from './actor-physics';

type Box = {center: Vec; size: Vec};
const overlaps = (position: Vec, box: Box) =>
  Math.abs(position.x - box.center.x) < box.size.x / 2 + 16 * UNIT - 1e-7 &&
  Math.abs(position.z - box.center.z) < box.size.z / 2 + 16 * UNIT - 1e-7;

export function fitsHull(position: Vec, feet: number, height: number, boxes: readonly Box[]) {
  return !boxes.some(box => overlaps(position, box) && feet < box.center.y + box.size.y / 2 - 1e-7 &&
    feet + height > box.center.y - box.size.y / 2 + 1e-7);
}

// Sweep the hull vertically, using the same boxes that stop horizontal movement.
// The highest crossed top wins on descent; the lowest underside wins on ascent.
export function verticalContact(position: Vec, from: number, to: number, height: number,
  boxes: readonly Box[]): ReturnType<ResolveVertical> {
  let feet = Math.max(0, to), grounded = to <= 0, ceiling = false;
  for (const box of boxes) {
    if (!overlaps(position, box)) continue;
    const top = box.center.y + box.size.y / 2, bottom = box.center.y - box.size.y / 2;
    if (to <= from && from >= top - 1e-7 && to <= top && top >= feet) {
      feet = top; grounded = true;
    } else if (to > from && from + height <= bottom + 1e-7 && to + height >= bottom && bottom - height < feet) {
      feet = bottom - height; ceiling = true; grounded = false;
    }
  }
  return {feet, grounded, ceiling};
}
