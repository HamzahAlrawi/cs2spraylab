import {UNIT, type Vec} from '../actor-physics';
import type {Arena, Solid} from './geometry';

const CELL = .7;
const RADIUS = .49;

function blocked(x: number, z: number, arena: Arena, radius = RADIUS) {
  if (x < arena.minX + radius || x > arena.maxX - radius || z < arena.minZ + radius || z > arena.maxZ - radius) return true;
  return arena.solids.some(({center, size}: Solid) => size.y > .8 &&
    Math.abs(x - center.x) < size.x / 2 + radius && Math.abs(z - center.z) < size.z / 2 + radius);
}

export function clearSegment(a: Vec, b: Vec, arena: Arena) {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const escapingMargin = blocked(a.x, a.z, arena) && !blocked(a.x, a.z, arena, 16 * UNIT - 1e-5);
  for (let n = 0; n <= Math.ceil(distance / .23); n++) {
    const t = n / Math.max(1, Math.ceil(distance / .23));
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (!blocked(x, z, arena)) continue;
    // Collision may leave an actor inside navigation's extra safety margin.
    // Allow an initial step out of that margin, never through the physical hull.
    if (!(escapingMargin && t < 1 && distance * t < .3 && !blocked(x, z, arena, 16 * UNIT - 1e-5))) return false;
  }
  return true;
}

// A bounded, cached-resolution grid route. Only the next bend is used; movement
// still runs through the shared acceleration and collision kernel.
export function routeTo(start: Vec, goal: Vec, arena: Arena): Vec[] {
  if (clearSegment(start, goal, arena)) return [goal];
  const nx = Math.ceil((arena.maxX - arena.minX) / CELL);
  const nz = Math.ceil((arena.maxZ - arena.minZ) / CELL);
  const index = (x: number, z: number) => z * nx + x;
  const coords = (id: number) => ({x: arena.minX + (id % nx + .5) * CELL,
    z: arena.minZ + (Math.floor(id / nx) + .5) * CELL});
  const cell = (point: Vec) => ({x: Math.max(0, Math.min(nx - 1, Math.floor((point.x - arena.minX) / CELL))),
    z: Math.max(0, Math.min(nz - 1, Math.floor((point.z - arena.minZ) / CELL)))});
  // A valid world-space point can round to a blocked grid cell beside a wall.
  // Connect both endpoints to reachable nearby cells, not that single cell.
  const connected = (point: Vec, entering: boolean) => {
    const at = cell(point), result: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = at.x + dx, z = at.z + dz;
      if (x < 0 || x >= nx || z < 0 || z >= nz) continue;
      const id = index(x, z), center = {...coords(id), y: point.y};
      if (!blocked(center.x, center.z, arena) &&
        (entering ? clearSegment(point, center, arena) : clearSegment(center, point, arena))) result.push(id);
    }
    return result;
  };
  const queue = connected(start, true), ends = new Set(connected(goal, false));
  const visited = new Uint8Array(nx * nz), parent = new Int32Array(nx * nz).fill(-1);
  for (const id of queue) visited[id] = 1;
  let last = -1;
  for (let head = 0; head < queue.length && head < nx * nz; head++) {
    const here = queue[head];
    if (ends.has(here)) {last = here; break;}
    const x = here % nx, z = Math.floor(here / nx);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextX = x + dx, nextZ = z + dz;
      if (nextX < 0 || nextX >= nx || nextZ < 0 || nextZ >= nz) continue;
      const next = index(nextX, nextZ);
      if (visited[next]) continue;
      const point = coords(next);
      if (blocked(point.x, point.z, arena)) continue;
      visited[next] = 1; parent[next] = here; queue.push(next);
    }
  }
  if (last < 0) return [];
  const path: Vec[] = [];
  for (let at = last; at >= 0; at = parent[at]) {
    const point = coords(at); path.push({x: point.x, y: goal.y, z: point.z});
  }
  path.reverse();
  path.push(goal);
  const smooth: Vec[] = [];
  let from = start, cursor = 0;
  while (cursor < path.length) {
    let next = path.length - 1;
    while (next > cursor && !clearSegment(from, path[next], arena)) next--;
    if (!clearSegment(from, path[next], arena)) return [];
    smooth.push(path[next]); from = path[next]; cursor = next + 1;
  }
  return smooth;
}
