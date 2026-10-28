import type {Vec} from '../actor-physics';

type Plane = {normal: Vec; bound: number};
export type ConvexNativeSolid = {planes: Plane[]; min: Vec; max: Vec};
const axes = ['x', 'y', 'z'] as const;
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const tolerance = 2e-5;

// Closed, consistently oriented, connected two-manifold + convex halfspaces.
// Exact coordinate welding accepts split UV vertices but never bridges a gap.
export function validateConvexSolid(vertices: Float32Array, indices: Uint32Array): ConvexNativeSolid | undefined {
  const points: Vec[] = [], welded = new Map<string, number>(), remap = new Map<number, number>();
  for (const index of indices) {
    if (remap.has(index)) continue;
    const p = {x: vertices[index * 3], y: vertices[index * 3 + 1], z: vertices[index * 3 + 2]};
    const key = `${p.x}:${p.y}:${p.z}`;
    let id = welded.get(key);
    if (id === undefined) {id = points.length; points.push(p); welded.set(key, id);}
    remap.set(index, id);
  }
  if (points.length < 4 || points.length > 512) return;
  const center = {x: 0, y: 0, z: 0}, min = {x: Infinity, y: Infinity, z: Infinity}, max = {x: -Infinity, y: -Infinity, z: -Infinity};
  for (const p of points) for (const axis of axes) {
    center[axis] += p[axis] / points.length; min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]);
  }
  const edges = new Map<string, {count: number; balance: number; faces: number[]}>(), planes: Plane[] = [];
  let orientation = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ids = [remap.get(indices[i])!, remap.get(indices[i + 1])!, remap.get(indices[i + 2])!];
    const [a, b, c] = ids.map(id => points[id]);
    const normal = {x: (b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y),
      y: (b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z), z: (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)};
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (length < 1e-12) return;
    for (const axis of axes) normal[axis] /= length;
    let bound = dot(normal, a);
    const side = Math.sign(bound - dot(normal, center));
    if (!side || (orientation && side !== orientation)) return;
    orientation = side;
    if (side < 0) {for (const axis of axes) normal[axis] *= -1; bound *= -1;}
    if (points.some(p => dot(normal, p) > bound + tolerance)) return;
    planes.push({normal, bound});
    for (let j = 0; j < 3; j++) {
      const from = ids[j], to = ids[(j + 1) % 3], key = `${Math.min(from,to)}:${Math.max(from,to)}`;
      const edge = edges.get(key) ?? {count: 0, balance: 0, faces: []};
      edge.count++; edge.balance += from < to ? 1 : -1; edge.faces.push(i / 3); edges.set(key, edge);
    }
  }
  if ([...edges.values()].some(e => e.count !== 2 || e.balance !== 0)) return;
  const neighbors = Array.from({length: indices.length / 3}, () => [] as number[]);
  for (const edge of edges.values()) {const [a,b] = edge.faces; neighbors[a].push(b); neighbors[b].push(a);}
  const visited = new Set<number>(), pending = [0];
  while (pending.length) {const i = pending.pop()!; if (visited.has(i)) continue; visited.add(i); pending.push(...neighbors[i]);}
  if (visited.size !== neighbors.length || axes.some(axis => max[axis] - min[axis] < tolerance)) return;
  return {planes, min, max};
}

export function convexRayInterval(solid: ConvexNativeSolid, origin: Vec, direction: Vec) {
  let entry = 0, exit = Infinity, entryNormal = {x: 0, y: 0, z: 0}, exitNormal = entryNormal;
  for (const {normal, bound} of solid.planes) {
    const slope = dot(normal, direction), offset = bound - dot(normal, origin);
    if (Math.abs(slope) < 1e-10) {if (offset <= 1e-8) return; continue;}
    const distance = offset / slope;
    if (slope < 0 && distance >= entry) {entry = distance; entryNormal = normal;}
    if (slope > 0 && distance < exit) {exit = distance; exitNormal = normal;}
    if (exit <= entry + 1e-8) return;
  }
  return Number.isFinite(exit) ? {entry, exit, entryNormal: {...entryNormal}, exitNormal: {...exitNormal}} : undefined;
}

type Bounded = {min: Vec; max: Vec};
type Node<T> = Bounded & {left?: Node<T>; right?: Node<T>; items?: T[]};
export function buildSolidTree<T extends Bounded>(items: T[]): Node<T> | undefined {
  if (!items.length) return;
  const min = {x: Infinity,y: Infinity,z: Infinity}, max = {x: -Infinity,y: -Infinity,z: -Infinity};
  for (const item of items) for (const axis of axes) {min[axis] = Math.min(min[axis],item.min[axis]); max[axis] = Math.max(max[axis],item.max[axis]);}
  if (items.length <= 8) return {min,max,items};
  const axis = axes.reduce((a,b) => max[a]-min[a] >= max[b]-min[b] ? a : b);
  items.sort((a,b) => a.min[axis]+a.max[axis]-b.min[axis]-b.max[axis]);
  const half = Math.floor(items.length/2);
  return {min,max,left:buildSolidTree(items.slice(0,half)),right:buildSolidTree(items.slice(half))};
}
export function querySolidTree<T extends Bounded>(node: Node<T> | undefined, origin: Vec, direction: Vec, range: number, result: T[] = []): T[] {
  if (!node) return result;
  let near = 0, far = range;
  for (const axis of axes) {
    if (Math.abs(direction[axis]) < 1e-12) {if (origin[axis] < node.min[axis] || origin[axis] > node.max[axis]) return result;}
    else {
      const a = (node.min[axis]-origin[axis])/direction[axis], b = (node.max[axis]-origin[axis])/direction[axis];
      near = Math.max(near,Math.min(a,b)); far = Math.min(far,Math.max(a,b)); if (near > far) return result;
    }
  }
  if (node.items) result.push(...node.items);
  else {querySolidTree(node.left,origin,direction,range,result); querySolidTree(node.right,origin,direction,range,result);}
  return result;
}
