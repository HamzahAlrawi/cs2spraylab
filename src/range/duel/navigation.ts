import {UNIT, type Vec} from '../actor-physics';
import type {Arena, Solid} from './geometry';
import {blocksMovement, environmentSolids, type EnvironmentState} from './environment';

const CELL = .7;
const RADIUS = .49;
type RouteTree = {parent: Int32Array; rank: Int32Array};
const masks = new WeakMap<Arena, {state?: EnvironmentState; solids: readonly Solid[]; nx: number; nz: number;
  blocked: Uint8Array; trees: Map<string, RouteTree>}>();

function groundObstacles(arena: Arena, state?: EnvironmentState) {
  return environmentSolids(arena, state).filter(solid => blocksMovement(solid) &&
    solid.center.y + solid.size.y / 2 > 1e-8 && solid.center.y - solid.size.y / 2 < 72 * UNIT);
}
function blocked(x: number, z: number, arena: Arena, obstacles: readonly Solid[], radius = RADIUS) {
  if (x < arena.minX + radius || x > arena.maxX - radius || z < arena.minZ + radius || z > arena.maxZ - radius) return true;
  return obstacles.some(({center, size}) => Math.abs(x - center.x) < size.x / 2 + radius && Math.abs(z - center.z) < size.z / 2 + radius);
}

export function clearSegment(a: Vec, b: Vec, arena: Arena, state?: EnvironmentState) {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const obstacles = groundObstacles(arena, state), steps = Math.max(1, Math.ceil(distance / .23));
  const escapingMargin = blocked(a.x, a.z, arena, obstacles) && !blocked(a.x, a.z, arena, obstacles, 16 * UNIT - 1e-5);
  for (let n = 0; n <= steps; n++) {
    const t = n / steps;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (!blocked(x, z, arena, obstacles)) continue;
    // Collision may leave an actor inside navigation's extra safety margin.
    // Allow an initial step out of that margin, never through the physical hull.
    if (!(escapingMargin && t < 1 && distance * t < .3 && !blocked(x, z, arena, obstacles, 16 * UNIT - 1e-5))) return false;
  }
  return true;
}

// A bounded, cached occupancy grid route. Only the next bend is used; movement
// still runs through the shared acceleration and collision kernel.
export function routeTo(start: Vec, goal: Vec, arena: Arena, state?: EnvironmentState): Vec[] {
  if (clearSegment(start, goal, arena, state)) return [goal];
  const nx = Math.ceil((arena.maxX - arena.minX) / CELL);
  const nz = Math.ceil((arena.maxZ - arena.minZ) / CELL);
  const index = (x: number, z: number) => z * nx + x;
  const coords = (id: number) => ({x: arena.minX + (id % nx + .5) * CELL,
    z: arena.minZ + (Math.floor(id / nx) + .5) * CELL});
  let mask = masks.get(arena);
  if (!mask || mask.state !== state || mask.solids !== arena.solids || mask.nx !== nx || mask.nz !== nz) {
    const cells = new Uint8Array(nx * nz), obstacles = groundObstacles(arena, state);
    for (let id = 0; id < cells.length; id++) {const p = coords(id); cells[id] = Number(blocked(p.x, p.z, arena, obstacles));}
    mask = {state, solids: arena.solids, nx, nz, blocked: cells, trees: new Map()}; masks.set(arena, mask);
  }
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
      if (!mask!.blocked[id] &&
        (entering ? clearSegment(point, center, arena, state) : clearSegment(center, point, arena, state))) result.push(id);
    }
    return result;
  };
  const roots = connected(start, true), ends = connected(goal, false);
  if (!roots.length || !ends.length) return [];
  const key = roots.join(',');
  let tree = mask.trees.get(key);
  if (!tree) {
    const queue = [...roots], parent = new Int32Array(nx * nz).fill(-1), rank = new Int32Array(nx * nz).fill(-1);
    queue.forEach((id, order) => {rank[id] = order;});
    // Round validation reuses the same starts for many goals. Preserve exact
    // cardinal BFS discovery order while retaining at most eight route trees.
    for (let head = 0; head < queue.length && head < nx * nz; head++) {
      const here = queue[head], x = here % nx, z = Math.floor(here / nx);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx, nextZ = z + dz;
        if (nextX < 0 || nextX >= nx || nextZ < 0 || nextZ >= nz) continue;
        const next = index(nextX, nextZ);
        if (rank[next] >= 0 || mask.blocked[next]) continue;
        // Cardinal cells are closer than the inflated minimum obstacle width.
        // No diagonal links cut a corner; smoothing still uses swept checks.
        rank[next] = queue.length; parent[next] = here; queue.push(next);
      }
    }
    tree = {parent, rank};
    if (mask.trees.size >= 8) mask.trees.delete(mask.trees.keys().next().value!);
    mask.trees.set(key, tree);
  }
  let last = -1;
  for (const end of ends) if (tree.rank[end] >= 0 && (last < 0 || tree.rank[end] < tree.rank[last])) last = end;
  if (last < 0) return [];
  const path: Vec[] = [];
  for (let at = last; at >= 0; at = tree.parent[at]) {
    const point = coords(at); path.push({x: point.x, y: goal.y, z: point.z});
  }
  path.reverse();
  path.push(goal);
  const smooth: Vec[] = [];
  let from = start, cursor = 0;
  while (cursor < path.length) {
    let next = path.length - 1;
    while (next > cursor && !clearSegment(from, path[next], arena, state)) next--;
    if (!clearSegment(from, path[next], arena, state)) return [];
    smooth.push(path[next]); from = path[next]; cursor = next + 1;
  }
  return smooth;
}
