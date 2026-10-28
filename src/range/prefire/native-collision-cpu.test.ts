import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {BoxGeometry} from 'three';
import {NativeMapCollision, type NativeCollisionManifest} from './native-collision';
import type {Vec} from '../actor-physics';

const radius = 16 * .0254, cellSize = 2, contactTolerance = .0003 + .0001;
type Surface = {min: number; max: number; normal: Vec};
type Query = {position: Vec; from: number; to: number; height: number};

// Independent snapshot of the pre-optimization clipping and candidate order.
function referenceClip(vertices: Float32Array, indices: Uint32Array, triangle: number, x: number, z: number): Surface | undefined {
  let polygon: Vec[] = [];
  for (let corner = 0; corner < 3; corner++) {
    const offset = indices[triangle * 3 + corner] * 3;
    polygon.push({x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2]});
  }
  const a = polygon[0], b = polygon[1], c = polygon[2];
  const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const length = Math.hypot(nx, ny, nz);
  if (!length || Math.abs(ny) / length < .001) return;
  for (const [axis, bound, side] of [['x', x - radius, 1], ['x', x + radius, -1],
    ['z', z - radius, 1], ['z', z + radius, -1]] as const) {
    const clipped: Vec[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i], end = polygon[(i + 1) % polygon.length];
      const d1 = (start[axis] - bound) * side, d2 = (end[axis] - bound) * side;
      if (d1 >= 0) clipped.push(start);
      if ((d1 >= 0) !== (d2 >= 0)) {
        const t = d1 / (d1 - d2);
        clipped.push({x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t,
          z: start.z + (end.z - start.z) * t});
      }
    }
    polygon = clipped;
    if (!polygon.length) return;
  }
  return {min: Math.min(...polygon.map(p => p.y)), max: Math.max(...polygon.map(p => p.y)),
    normal: {x: nx / length, y: ny / length, z: nz / length}};
}

class ReferenceVertical {
  private groups: {vertices: Float32Array; indices: Uint32Array}[] = [];
  private columns = new Map<string, number[]>();
  private cache = new Map<string, Surface[]>();
  constructor(manifest: NativeCollisionManifest, binary: ArrayBuffer) {
    for (const group of manifest.groups) {
      if (!group.movement) continue;
      const vertices = new Float32Array(binary, group.offset, group.vertexCount * 3);
      const indices = new Uint32Array(binary, group.offset + group.vertexCount * 12, group.indexCount);
      const groupIndex = this.groups.length; this.groups.push({vertices, indices});
      for (let triangle = 0; triangle < indices.length / 3; triangle++) {
        const ia = indices[triangle * 3] * 3, ib = indices[triangle * 3 + 1] * 3, ic = indices[triangle * 3 + 2] * 3;
        const ax = vertices[ia], ay = vertices[ia + 1], az = vertices[ia + 2];
        const bx = vertices[ib], by = vertices[ib + 1], bz = vertices[ib + 2];
        const cx = vertices[ic], cy = vertices[ic + 1], cz = vertices[ic + 2];
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(ny) < Math.hypot(nx, ny, nz) * .001 || !ny) continue;
        for (let x = Math.floor(Math.min(ax, bx, cx) / cellSize); x <= Math.floor(Math.max(ax, bx, cx) / cellSize); x++) {
          for (let z = Math.floor(Math.min(az, bz, cz) / cellSize); z <= Math.floor(Math.max(az, bz, cz) / cellSize); z++) {
            const key = `${x}:${z}`;
            let values = this.columns.get(key);
            if (!values) {values = []; this.columns.set(key, values);}
            values.push(groupIndex * 0x1000000 + triangle);
          }
        }
      }
    }
  }
  vertical(position: Vec, from: number, to: number, height: number) {
    const key = `${position.x}:${position.z}`;
    let surfaces = this.cache.get(key);
    if (!surfaces) {
      const candidates = new Set<number>();
      for (let x = Math.floor((position.x - radius) / cellSize); x <= Math.floor((position.x + radius) / cellSize); x++) {
        for (let z = Math.floor((position.z - radius) / cellSize); z <= Math.floor((position.z + radius) / cellSize); z++) {
          for (const triangle of this.columns.get(`${x}:${z}`) ?? []) candidates.add(triangle);
        }
      }
      surfaces = [];
      for (const encoded of candidates) {
        const group = this.groups[encoded >>> 24];
        const surface = referenceClip(group.vertices, group.indices, encoded & 0xffffff, position.x, position.z);
        if (surface) surfaces.push(surface);
      }
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, surfaces);
    }
    const down = to <= from;
    let selected: Surface | undefined, feet = to;
    for (const surface of surfaces) {
      if (down ? surface.normal.y < .7 : surface.normal.y >= 0) continue;
      const contact = down ? surface.max : surface.min - height;
      if (down ? contact > from + contactTolerance || contact < to - contactTolerance :
        contact < from - contactTolerance || contact > to + contactTolerance) continue;
      if (!selected || (down ? contact > feet : contact < feet)) {selected = surface; feet = contact;}
    }
    if (!selected) return {feet: to, grounded: false, ceiling: false};
    const normal = {...selected.normal};
    return {feet, grounded: down && normal.y >= .7, ceiling: !down && normal.y < -.5, normal};
  }
}

function fixture() {
  const positions: number[] = [], indices: number[] = [];
  const triangle = (a: number[], b: number[], c: number[]) => {
    indices.push(positions.length / 3, positions.length / 3 + 1, positions.length / 3 + 2);
    positions.push(...a, ...b, ...c);
  };
  // Sloped support, flat seams, undersides, steep faces, degenerates, and ties.
  for (let x = -4; x < 4; x++) for (let z = -4; z < 4; z++) {
    const y = (n: number) => x < 0 ? n * .125 : 0;
    const a = [x, y(x), z], b = [x, y(x), z + 1], c = [x + 1, y(x + 1), z], d = [x + 1, y(x + 1), z + 1];
    triangle(a, b, c); triangle(b, d, c);
    triangle([x, 3, z], [x + 1, 3, z], [x, 3, z + 1]);
  }
  triangle([0, 0, 0], [1, 0, 0], [2, 0, 0]);
  triangle([0, -0, 0], [0, 0, 1], [1, -0, 0]);
  for (const tilt of [.6999999, .7, .7000001, -.4999999, -.5, -.5000001, .000999999, .001, .001000001]) {
    triangle([1, -1, 0], [1, -1, 1], [1 + tilt, Math.sqrt(1 - tilt * tilt) - 1, 0]);
  }
  triangle([0, 8, 0], [0, 8, 1], [1, 8, 0]);
  triangle([0, 8, 0], [0, 8, 1], [1, 7, 0]);
  let seed = 7129;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 0x100000000);
  for (let i = 0; i < 128; i++) {
    const point = () => [random() * 10 - 5, random() * 4 - 2, random() * 10 - 5];
    triangle(point(), point(), point());
  }
  const geometry = new BoxGeometry(1, .25, 1).rotateZ(.035).translate(42, -3, -54);
  const nativeVertices = new Float32Array(geometry.getAttribute('position').array);
  const nativeIndices = new Uint32Array(geometry.getIndex()!.array); geometry.dispose();
  const vertices = new Float32Array(positions), faces = new Uint32Array(indices);
  const binary = new ArrayBuffer(vertices.byteLength + faces.byteLength + nativeVertices.byteLength + nativeIndices.byteLength);
  new Float32Array(binary, 0, vertices.length).set(vertices);
  new Uint32Array(binary, vertices.byteLength, faces.length).set(faces);
  const offset = vertices.byteLength + faces.byteLength;
  new Float32Array(binary, offset, nativeVertices.length).set(nativeVertices);
  new Uint32Array(binary, offset + nativeVertices.byteLength, nativeIndices.length).set(nativeIndices);
  const manifest: NativeCollisionManifest = {version: 1, unit: .0254, build: 'cpu-fixture', collisionSha256: '', groups: [
    {id: 0, offset: 0, vertexCount: vertices.length / 3, indexCount: faces.length, movement: true, shots: true},
    {id: 1, offset, vertexCount: nativeVertices.length / 3, indexCount: nativeIndices.length, movement: true, shots: false},
  ]};
  return {manifest, binary};
}

function generatedQueries(count: number): Query[] {
  let seed = 803701;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 0x100000000);
  const queries: Query[] = [];
  for (let i = 0; i < count; i++) {
    const x = i % 5 === 0 ? Math.round(random() * 10 - 5) + radius + (i % 3 - 1) * 1e-12 : random() * 10 - 5;
    const z = random() * 10 - 5;
    const up = i % 3 === 0, from = random() * 6 - 2, delta = random() * 4;
    queries.push({position: {x, y: 1, z}, from, to: from + (up ? delta : -delta), height: (i % 2 ? 54 : 72) * .0254});
  }
  for (const epsilon of [-1e-9, 0, 1e-9]) for (const x of [-4 - radius, -2, 0, 2, 4 + radius, 42]) {
    for (const z of [-4 - radius, 0, 4 + radius, -54]) {
      for (const [from, to] of [[4, -4], [-4, 4], [0, -1e-7], [.0004, -.0004]])
        queries.push({position: {x: x + epsilon, y: 1, z: z + epsilon}, from, to, height: 72 * .0254});
    }
  }
  return queries;
}

function compare(collision: NativeMapCollision, reference: ReferenceVertical, queries: Query[]) {
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i], before = reference.vertical(q.position, q.from, q.to, q.height);
    expect(collision.vertical(q.position, q.from, q.to, q.height), `query ${i}: ${JSON.stringify(q)}`).toEqual(before);
  }
}

function benchmark(collision: NativeMapCollision, reference: ReferenceVertical, queries: Query[], label: string, iterations = 8) {
  if (process.env.NATIVE_COLLISION_BENCH !== '1') return;
  const run = (target: Pick<NativeMapCollision, 'vertical'>) => {
    let checksum = 0;
    const start = performance.now();
    for (let iteration = 0; iteration < iterations; iteration++) for (const q of queries) {
      const result = target.vertical(q.position, q.from, q.to, q.height);
      checksum += result.feet + Number(result.grounded) + Number(result.ceiling);
    }
    return {ms: performance.now() - start, checksum};
  };
  run(reference); run(collision);
  const old = [], optimized = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    if (repeat % 2) {optimized.push(run(collision)); old.push(run(reference));}
    else {old.push(run(reference)); optimized.push(run(collision));}
  }
  expect(optimized.map(row => row.checksum)).toEqual(old.map(row => row.checksum));
  const median = (rows: {ms: number}[]) => rows.map(row => row.ms).sort((a, b) => a - b)[2];
  console.info('NATIVE_COLLISION_CPU', JSON.stringify({label, queries: queries.length * iterations,
    referenceMs: median(old), optimizedMs: median(optimized), speedup: median(old) / median(optimized)}));
}

describe('native vertical CPU/reference equivalence', () => {
  let collision: NativeMapCollision, reference: ReferenceVertical;
  beforeAll(async () => {
    const {manifest, binary} = fixture(); reference = new ReferenceVertical(manifest, binary);
    collision = await NativeMapCollision.create(manifest, binary);
  });
  afterAll(() => collision?.dispose());
  it('exactly preserves generated triangle clipping, ordering, seams and contact thresholds', () => {
    const queries = generatedQueries(2400);
    compare(collision, reference, queries); compare(collision, reference, queries.slice().reverse());
    benchmark(collision, reference, queries, 'generated-moving');
  }, 30000);
  it('keeps cached results independent of caller mutations and changing crouch/vertical state', () => {
    const q = {position: {x: -.2, y: 1, z: .2}, from: 1, to: -1, height: 72 * .0254};
    const first = collision.vertical(q.position, q.from, q.to, q.height);
    if (first.normal) first.normal.x = 999;
    compare(collision, reference, [q, {...q, height: 54 * .0254}, {...q, from: -1, to: 4}, q]);
  });
  it('preserves first-candidate normals for tied contacts on the hull boundary', () => {
    const q = {position: {x: radius, y: 8, z: .25}, from: 9, to: 7, height: 72 * .0254};
    compare(collision, reference, [q]);
    expect(collision.vertical(q.position, q.from, q.to, q.height)).toMatchObject({feet: 8, normal: {x: 0, y: 1, z: 0}});
  });
  it('bounds exact-coordinate caching and safely clears visited stamps on wraparound', () => {
    compare(collision, reference, generatedQueries(640));
    const cache = Reflect.get(collision, 'surfaces') as Map<string, Surface[]>;
    expect(cache.size).toBeLessThanOrEqual(256);
    Reflect.set(collision, 'queryVersion', 0xffffffff);
    const q = {position: {x: .0123456789, y: 1, z: -.987654321}, from: 1, to: -1, height: 72 * .0254};
    compare(collision, reference, [q]);
    expect(Reflect.get(collision, 'queryVersion')).toBe(1);
    compare(collision, reference, [q, ...generatedQueries(640)]);
  });
});

const nativePath = 'public/revamp/maps/dust2/collision';
describe.skipIf(!existsSync(`${nativePath}.bin`))('native Dust 2 vertical CPU/reference equivalence', () => {
  let collision: NativeMapCollision, reference: ReferenceVertical;
  beforeAll(async () => {
    const manifest = JSON.parse(readFileSync(`${nativePath}.json`, 'utf8')) as NativeCollisionManifest;
    const bytes = readFileSync(`${nativePath}.bin`);
    const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    reference = new ReferenceVertical(manifest, binary);
    collision = await NativeMapCollision.create(manifest, binary);
  }, 30000);
  afterAll(() => collision?.dispose());
  it('matches real route supports, Mid box seams, ramps, CT/B cover and changing eye hulls exactly', () => {
    const points = [[900, 910, 0], [1250, 1000, 0], [380, 1390, 0], [-1400, 2190, 1],
      [-1540, 2290, -2], [-395, 1460, -126], [180, 2180, -125], [-340, 1296, 0],
      [-468, 1232, 0], [-340, 1424, 0], [405, 1740, 96], [1450, 2750, 105],
      [1400, 800, -13], [-1880, 1186, 30], [-1640, 2820, 16]];
    const queries: Query[] = [];
    for (const [x, z, y] of points) for (let tick = 0; tick < 32; tick++) {
      const position = {x: x * .0254 + tick * .0037, y: y * .0254, z: -z * .0254 + Math.sin(tick) * .009};
      const floor = reference.vertical(position, position.y + .5, position.y - .7, 72 * .0254).feet;
      for (const height of [54 * .0254, 72 * .0254]) {
        queries.push({position, from: floor, to: floor - 1e-7, height},
          {position, from: floor + .12, to: floor - .15, height},
          {position, from: floor, to: floor + 1.5, height});
      }
    }
    compare(collision, reference, queries);
    benchmark(collision, reference, queries, 'dust2-moving');
    benchmark(collision, reference, queries.filter((_, i) => i % 6 === 0), 'dust2-cold-coordinates');
    const stationary = queries.slice(0, 24);
    benchmark(collision, reference, stationary, 'dust2-stationary', 2000);
  }, 30000);
});
