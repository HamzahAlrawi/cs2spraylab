import type {Vec} from '../actor-physics';
import {traceSolid, type Arena} from './geometry';

export const SMOKE_CELL_SIZE = .8;
export const MAX_SMOKE_CELLS = 768;
type Volume = {position: Vec; cells: readonly Vec[]};
const volumes = new WeakMap<readonly Vec[], {origin: Vec; occupied: Set<string>}>();
const key = (x: number, y: number, z: number) => `${x}:${y}:${z}`;

/** One-time bounded six-connected fill; smoke can travel through an opening, never a wall. */
export function buildSmokeVolume(position: Vec, radius: number, arena: Arena): Vec[] {
  const seed = {...position, y: position.y + .15}, cells = [seed], seen = new Set([key(0, 0, 0)]);
  const queue = [{x: 0, y: 0, z: 0}];
  for (let at = 0; at < queue.length && cells.length < MAX_SMOKE_CELLS; at++) {
    const index = queue[at], from = cells[at];
    for (const offset of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const x = index.x + offset[0], y = index.y + offset[1], z = index.z + offset[2], id = key(x, y, z);
      if (seen.has(id)) continue;
      if (Math.hypot(x, y, z) * SMOKE_CELL_SIZE > radius || cells.length >= MAX_SMOKE_CELLS) continue;
      const to = {x: seed.x + x * SMOKE_CELL_SIZE, y: seed.y + y * SMOKE_CELL_SIZE, z: seed.z + z * SMOKE_CELL_SIZE};
      if (to.x <= arena.minX || to.x >= arena.maxX || to.z <= arena.minZ || to.z >= arena.maxZ || !arena.native && to.y < 0) continue;
      const direction = {x: offset[0], y: offset[1], z: offset[2]};
      if (traceSolid(from, direction, arena, SMOKE_CELL_SIZE + .02).distance < SMOKE_CELL_SIZE + .01) continue;
      seen.add(id); cells.push(to); queue.push({x, y, z});
    }
  }
  return cells;
}

/** Static cell index shared by sight, interior overlay and fire interactions. */
export function smokeContains(point: Vec, effect: Volume) {
  if (!effect.cells.length) return true;
  let cached = volumes.get(effect.cells);
  if (!cached) {
    const origin = effect.cells[0];
    cached = {origin, occupied: new Set(effect.cells.map(cell => key(Math.round((cell.x-origin.x)/SMOKE_CELL_SIZE),
      Math.round((cell.y-origin.y)/SMOKE_CELL_SIZE), Math.round((cell.z-origin.z)/SMOKE_CELL_SIZE))))};
    volumes.set(effect.cells, cached);
  }
  return cached.occupied.has(key(Math.round((point.x-cached.origin.x)/SMOKE_CELL_SIZE),
    Math.round((point.y-cached.origin.y)/SMOKE_CELL_SIZE), Math.round((point.z-cached.origin.z)/SMOKE_CELL_SIZE)));
}
