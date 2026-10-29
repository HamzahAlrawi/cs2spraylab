import type {Vec} from '../actor-physics';
import {MAX_SMOKE_CELLS, SMOKE_CELL_SIZE} from './smoke-volume';
import type {SmokeHole, UtilityEffect} from './utilities';

// Browser rendering budgets, not extracted Source 2 fluid/voxel parameters.
export const SMOKE_GRID_SIZE = 48;
export const SMOKE_EXTINCTION = 2.8;
export const SMOKE_RENDER_STEPS = 64;
export type SmokeDensityGrid = {data: Uint8Array; min: Vec; size: Vec};

/** Static density occupancy. Rebuilt on cell changes, never on camera movement. */
export function buildSmokeDensity(effect: Pick<UtilityEffect, 'cells' | 'position' | 'radius'>): SmokeDensityGrid {
  const n = SMOKE_GRID_SIZE, data = new Uint8Array(n ** 3);
  const radius = Math.max(SMOKE_CELL_SIZE, effect.radius + SMOKE_CELL_SIZE);
  const min = {x: effect.position.x - radius, y: effect.position.y - radius, z: effect.position.z - radius};
  const size = {x: radius * 2, y: radius * 2, z: radius * 2};
  const index = (value: number, axis: keyof Vec) => (value - min[axis]) / size[axis] * n;
  // Rasterize only geometry-reachable cells. Empty snapshots never become spheres.
  for (const cell of effect.cells.slice(0, MAX_SMOKE_CELLS)) {
    const low = (axis: keyof Vec) => Math.max(0, Math.ceil(index(cell[axis] - SMOKE_CELL_SIZE / 2, axis) - .5));
    const high = (axis: keyof Vec) => Math.min(n - 1, Math.floor(index(cell[axis] + SMOKE_CELL_SIZE / 2, axis) - .5));
    const x0 = low('x'), x1 = high('x'), y0 = low('y'), y1 = high('y'), z0 = low('z'), z1 = high('z');
    if (x1 < x0 || y1 < y0 || z1 < z0) continue;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++)
      data.fill(255, (z * n + y) * n + x0, (z * n + y) * n + x1 + 1);
  }
  return {data, min, size};
}

export function sameSmokeCells(a: readonly Vec[], b: readonly Vec[]) {
  return a === b || a.length === b.length && a.every((point, i) =>
    point.x === b[i].x && point.y === b[i].y && point.z === b[i].z);
}

/** Shared refill envelope for visual and AI smoke holes; constants are presentation approximations. */
export function smokeHoleRadius(hole: SmokeHole, time: number) {
  if (time < hole.startedAt || time >= hole.expiresAt) return 0;
  const life = hole.expiresAt - hole.startedAt;
  const tail = Math.min(.35, life * .4);
  const fraction = Math.max(0, Math.min(1, (hole.expiresAt - time) / Math.max(.001, tail)));
  return hole.radius * fraction * fraction * (3 - 2 * fraction);
}

export function pointInSmokeHole(point: Vec, hole: SmokeHole, time: number) {
  const radius = smokeHoleRadius(hole, time);
  if (!radius) return false;
  const dx = hole.to.x - hole.from.x, dy = hole.to.y - hole.from.y, dz = hole.to.z - hole.from.z;
  const squared = dx * dx + dy * dy + dz * dz;
  const t = squared > 1e-12 ? Math.max(0, Math.min(1,
    ((point.x - hole.from.x) * dx + (point.y - hole.from.y) * dy + (point.z - hole.from.z) * dz) / squared)) : 0;
  return Math.hypot(point.x - hole.from.x - dx * t, point.y - hole.from.y - dy * t, point.z - hole.from.z - dz * t) < radius;
}
