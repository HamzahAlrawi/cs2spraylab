import type {Arena, CoverLane, Solid} from './geometry';
import {clearSegment, routeTo} from './navigation';
import {randomStream} from './rng';

const snap = (value: number) => Math.round(value * 4) / 4;
const point = (x: number, z: number) => ({x, y: 0, z});

function candidate(seed: number): Arena {
  const random = randomStream(seed, 'cover-layout');
  const between = (low: number, high: number) => snap(low + random() * (high - low));
  const centerX = between(-1, 1), width = between(5.25, 7.75);
  const solids: Solid[] = [{center: {x: centerX, y: 1.6, z: 0}, size: {x: width, y: 3.2, z: .75}, kind: 'concrete'}];
  const lanes: CoverLane[] = [];
  const pair = (x: number, z: number, sx: number, sy: number, sz: number, kind: Solid['kind']) => {
    for (const sign of [-1, 1]) solids.push({center: {x, y: sy / 2, z: sign * z}, size: {x: sx, y: sy, z: sz}, kind});
  };
  for (const side of [-1, 1] as const) {
    const cargoX = between(7.25, 8.5), cargoZ = between(3, 4.75), cargoLength = between(2.5, 5.25);
    pair(side * cargoX, cargoZ, .75, between(2.25, 3), cargoLength, 'cargo');
    const campX = between(3.75, 5.5), campZ = between(8, 9.25), campWidth = between(3, 4.25);
    pair(side * campX, campZ, campWidth, between(2.25, 3), .75, random() < .5 ? 'concrete' : 'cargo');
    const offX = between(4.75, 5.5), offZ = between(3, 4.25), offWidth = between(1, 1.75);
    pair(side * offX, offZ, offWidth, between(1, 1.5), 1, 'barrier');
    pair(side * between(9.75, 10.25), between(8.25, 10), between(1.25, 1.75), between(1.25, 2), 1.25, 'crate');
    solids.push({center: {x: side * 10.75, y: 1.1, z: between(-.5, .5)}, size: {x: 1, y: 2.2, z: between(1, 2)}, kind: 'crate'});
    // Some layouts add a short perpendicular return, creating a proper pocket
    // rather than a scattering of isolated boxes. North/south pairing stays fair.
    if (random() < .6) pair(side * (cargoX + .5), cargoZ + cargoLength / 2 + .4, 1.75, 1.4, .65, 'barrier');
    const corner = centerX + side * width / 2;
    lanes.push({side, role: 'entry', anchor: point(corner - side * .8, -1.6),
      edge: point(corner + side * .95, -1.6), retreat: point(corner - side * 1.4, -2.15), axis: {x: side, z: 0}});
    const flankX = side * (cargoX + 1.4);
    lanes.push({side, role: 'flank', anchor: point(flankX, -cargoZ),
      edge: point(flankX, -cargoZ + cargoLength / 2 + .95), retreat: point(flankX, -cargoZ - .7), axis: {x: 0, z: 1}});
    lanes.push({side, role: 'camp', anchor: point(side * campX, -campZ - 1),
      edge: point(side * (campX + campWidth / 2 + .8), -campZ - 1),
      retreat: point(side * campX, -campZ - 1.7), axis: {x: side, z: 0}});
    lanes.push({side, role: 'offAngle', anchor: point(side * offX, -offZ - 1.3),
      edge: point(side * (offX + offWidth / 2 + .75), -offZ - 1.3),
      retreat: point(side * (offX - .35), -offZ - 1.8), axis: {x: side, z: 0}});
  }
  return {minX: -12, maxX: 12, minZ: -20, maxZ: 12, solids, lanes};
}

export function createArena(seed: number): Arena {
  // Validate once per round, never during a frame's actor update. Reject a
  // blocked pocket instead of letting navigation silently walk into its wall.
  for (let attempt = 0; attempt < 16; attempt++) {
    const arena = candidate(seed + attempt * 104729);
    if (validLayout(arena)) return arena;
  }
  const fallback = candidate(6);
  if (!validLayout(fallback)) throw new Error('Invalid fallback arena');
  return fallback;
}

function validLayout(arena: Arena) {
  if (arena.solids.some((a, i) => arena.solids.slice(i + 1).some(b =>
    Math.abs(a.center.x - b.center.x) < (a.size.x + b.size.x) / 2 &&
    Math.abs(a.center.z - b.center.z) < (a.size.z + b.size.z) / 2))) return false;
  return arena.lanes!.every(lane => clearSegment(lane.anchor, lane.edge, arena) &&
    clearSegment(lane.anchor, lane.retreat, arena) &&
    routeTo(point(0, -8), lane.anchor, arena).length > 0 && routeTo(point(0, 8), lane.anchor, arena).length > 0);
}
