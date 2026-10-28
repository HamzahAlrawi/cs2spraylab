import RAPIER from '@dimforge/rapier3d-compat';
import {prepareRapier} from '../rapier-runtime';
import type {Vec, ResolveVertical} from '../actor-physics';
import type {HullSweep} from '../actor-collision';
import type {TerrainQueries} from '../terrain';
import {validateNativeSurfaces, type NativeSurface, type NativePrimitive, type NativeSurfaceInterval, type NativeSurfaceHit} from './native-surfaces';
import {validateConvexSolid, convexRayInterval, buildSolidTree, querySolidTree, type ConvexNativeSolid} from './native-solids';
import grenadeClips from './native-grenade-clips.json';

export type NativeCollisionManifest = {version: number; unit: number; build: string; collisionSha256: string; sourceCollisionSha256?:string;
  surfaces?: NativeSurface[];
  groups: {id: number; offset: number; vertexCount: number; indexCount: number; movement: boolean; shots: boolean; tags?:string[];excludes?:string[];primitives?: NativePrimitive[]}[]};
export type NativeMapHit = NativeSurfaceHit & {distance: number; normal: Vec};
const rotation = {x: 0, y: 0, z: 0, w: 1};
const movementGroup = (1 << 16) | 1, shotGroup = (2 << 16) | 2;
const grenadeGroup=(4<<16)|4;
const skin = .0003, radius = 16 * .0254;
// Ground queries must cover the shape-cast skin. Otherwise a small uphill
// increment can miss both queries and incorrectly switch to air acceleration.
const cellSize = 2, contactTolerance = skin + .0001;
type NativeTriangles = {vertices: Float32Array; indices: Uint32Array; visited: Uint32Array};
type VerticalSurface = {min: number; max: number; normal: Vec};
type ShotSolid = ConvexNativeSolid & {primitive: NativePrimitive};
const QUERY_SCHEMA=1;
export type PreparedNativeQueries={schema:number;engine:string;collisionSha256:string;bounds:{minX:number;maxX:number;minZ:number;maxZ:number};
  ids:[number,number][];columns:[string,number[]][];solids:ShotSolid[];open:{handle:number;primitive:NativePrimitive}[]};

function clipTriangle(vertices: Float32Array, indices: Uint32Array, triangle: number, x: number, z: number,
  polygonBuffer: Float64Array, clippedBuffer: Float64Array): VerticalSurface | undefined {
  const ia = indices[triangle * 3] * 3, ib = indices[triangle * 3 + 1] * 3, ic = indices[triangle * 3 + 2] * 3;
  const ax = vertices[ia], ay = vertices[ia + 1], az = vertices[ia + 2];
  const bx = vertices[ib], by = vertices[ib + 1], bz = vertices[ib + 2];
  const cx = vertices[ic], cy = vertices[ic + 1], cz = vertices[ic + 2];
  const minX = x - radius, maxX = x + radius, minZ = z - radius, maxZ = z + radius;
  if (Math.max(ax, bx, cx) < minX || Math.min(ax, bx, cx) > maxX ||
    Math.max(az, bz, cz) < minZ || Math.min(az, bz, cz) > maxZ) return;
  const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const length = Math.hypot(nx, ny, nz);
  if (!length || Math.abs(ny) / length < .001) return;
  // Intersect the native triangle with the square Source player hull. Taking
  // the clipped extrema also catches seams/edges that corner rays miss.
  let polygon = polygonBuffer, clipped = clippedBuffer, count = 3;
  polygon[0] = ax; polygon[1] = ay; polygon[2] = az;
  polygon[3] = bx; polygon[4] = by; polygon[5] = bz;
  polygon[6] = cx; polygon[7] = cy; polygon[8] = cz;
  for (let plane = 0; plane < 4; plane++) {
    const axis = plane < 2 ? 0 : 2, side = plane % 2 ? -1 : 1;
    const bound = plane === 0 ? minX : plane === 1 ? maxX : plane === 2 ? minZ : maxZ;
    let output = 0;
    for (let i = 0; i < count; i++) {
      const start = i * 3, end = (i + 1 === count ? 0 : i + 1) * 3;
      const d1 = (polygon[start + axis] - bound) * side, d2 = (polygon[end + axis] - bound) * side;
      if (d1 >= 0) {
        clipped[output++] = polygon[start]; clipped[output++] = polygon[start + 1]; clipped[output++] = polygon[start + 2];
      }
      if ((d1 >= 0) !== (d2 >= 0)) {
        const t = d1 / (d1 - d2);
        clipped[output++] = polygon[start] + (polygon[end] - polygon[start]) * t;
        clipped[output++] = polygon[start + 1] + (polygon[end + 1] - polygon[start + 1]) * t;
        clipped[output++] = polygon[start + 2] + (polygon[end + 2] - polygon[start + 2]) * t;
      }
    }
    count = output / 3;
    if (!count) return;
    const previous = polygon; polygon = clipped; clipped = previous;
  }
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < count; i++) {min = Math.min(min, polygon[i * 3 + 1]); max = Math.max(max, polygon[i * 3 + 1]);}
  return {min, max, normal: {x: nx / length, y: ny / length, z: nz / length}};
}

// Rapier supplies static shape queries only. The shared trainer motor still
// determines velocity, acceleration, friction, crouch, gravity and shot timing.
export class NativeMapCollision implements TerrainQueries {
  readonly build: string;
  readonly collisionSha256: string;
  readonly bounds = {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity};
  private readonly world: RAPIER.World;
  private readonly shapes = new Map<number, RAPIER.Cuboid>();
  private readonly sphereShapes=new Map<number,RAPIER.Ball>();
  private readonly grenadeShapes=new Map<number,RAPIER.Cuboid>();
  private readonly ids = new Map<number, number>();
  private readonly sourceSurfaces = new Map<number, NativeSurface>();
  private readonly primitiveGroups = new Map<number, NativePrimitive[]>();
  private readonly openShots: {collider: RAPIER.Collider; primitive: NativePrimitive}[] = [];
  private solidTree?: ReturnType<typeof buildSolidTree<ShotSolid>>;
  readonly surfaceDiagnostics = {validatedSolids:0,opaquePrimitives:0,sourceSurfaces:0};
  private readonly triangles: NativeTriangles[] = [];
  private readonly corpseMeshes = new Map<string, {vertices: Float32Array; indices: Uint32Array}>();
  private readonly columns = new Map<string, Uint32Array>();
  private readonly surfaces = new Map<string, VerticalSurface[]>();
  // A triangle clipped against four half-planes has at most seven vertices.
  private readonly clipA = new Float64Array(24);
  private readonly clipB = new Float64Array(24);
  private queryVersion = 0;
  private disposed = false;
  static async create(manifest: NativeCollisionManifest, binary: ArrayBuffer,prepared?:{metadata:PreparedNativeQueries;snapshot?:ArrayBuffer}) {
    if (![1, 2].includes(manifest.version) || manifest.unit !== .0254) throw new Error('Unsupported map units or collision version');
    if (!Array.isArray(manifest.groups) || !manifest.groups.length || manifest.groups.length > 64) throw new Error('Invalid map collision groups');
    if (manifest.version === 2) {
      if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length > 4096) throw new Error('Invalid native surface table');
      validateNativeSurfaces(manifest.surfaces);
    }
    const groupIds = new Set<number>(), primitiveIds = new Set<number>();
    for (const group of manifest.groups) {
      const length = group.vertexCount * 12 + group.indexCount * 4;
      if (![group.id, group.offset, group.vertexCount, group.indexCount].every(Number.isSafeInteger) ||
        groupIds.has(group.id) || group.vertexCount < 3 || group.indexCount < 3 || group.offset % 4 || group.offset < 0 ||
        group.offset + length > binary.byteLength || group.indexCount % 3 ||
        typeof group.movement !== 'boolean' || typeof group.shots !== 'boolean') throw new Error('Invalid map collision buffer');
      const positions = new Float32Array(binary, group.offset, group.vertexCount * 3);
      const indices = new Uint32Array(binary, group.offset + group.vertexCount * 12, group.indexCount);
      if (positions.some(value => !Number.isFinite(value)) || indices.some(index => index >= group.vertexCount)) throw new Error('Invalid map collision geometry');
      groupIds.add(group.id);
      if (manifest.version === 2) {
        if (!Array.isArray(group.primitives) || group.primitives.length > 100000) throw new Error('Invalid native solid table');
        let end = 0;
        for (const primitive of group.primitives) {
          if (![primitive.id, primitive.firstTriangle, primitive.triangleCount, primitive.surfaceId].every(Number.isSafeInteger) ||
            primitive.id < 0 || primitiveIds.has(primitive.id) || primitive.firstTriangle !== end || primitive.triangleCount < 1 ||
            !manifest.surfaces!.some(s => s.id === primitive.surfaceId) || !['convex-hull', 'mesh'].includes(primitive.kind)) throw new Error('Invalid native solid metadata');
          if (primitive.triangleSurfaces && (primitive.kind !== 'mesh' || primitive.triangleSurfaces.length !== primitive.triangleCount ||
            primitive.triangleSurfaces.some(id=>!manifest.surfaces!.some(s=>s.id===id)))) throw new Error('Invalid native triangle surfaces');
          primitiveIds.add(primitive.id); end += primitive.triangleCount;
        }
        if (end !== group.indexCount / 3) throw new Error('Incomplete native solid metadata');
      }
    }
    await prepareRapier();
    const valid=prepared?.metadata.schema===QUERY_SCHEMA && prepared.metadata.engine===RAPIER.version() &&
      prepared.metadata.collisionSha256===manifest.collisionSha256 && (!prepared.snapshot||prepared.snapshot.byteLength<=64*1024*1024);
    return new NativeMapCollision(manifest,binary,valid?prepared:undefined);
  }
  private constructor(manifest: NativeCollisionManifest, binary: ArrayBuffer,prepared?:{metadata:PreparedNativeQueries;snapshot?:ArrayBuffer}) {
    this.build = manifest.build; this.collisionSha256 = manifest.collisionSha256;
    this.world = prepared?.snapshot?RAPIER.World.restoreSnapshot(new Uint8Array(prepared.snapshot)):new RAPIER.World({x: 0, y: 0, z: 0});
    for (const surface of manifest.version === 2 ? manifest.surfaces! : []) this.sourceSurfaces.set(surface.id, Object.freeze({...surface}));
    this.surfaceDiagnostics.sourceSurfaces = this.sourceSurfaces.size;
    if(prepared) {
      try {
        const data=prepared.metadata;
        const openIds=new Set(data.open.map(item=>item.primitive.id));
        Object.assign(this.bounds,data.bounds);
        if(prepared.snapshot)for(const [handle,id] of data.ids)this.ids.set(handle,id);
        for(const group of manifest.groups) {
          const vertices=new Float32Array(binary,group.offset,group.vertexCount*3),indices=new Uint32Array(binary,group.offset+group.vertexCount*12,group.indexCount);
          if(!prepared.snapshot) {
            const bits=Number(group.movement)|Number(group.shots)*2;
            const collider=this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices).setCollisionGroups((bits<<16)|bits));
            this.ids.set(collider.handle,group.id);
            for(const primitive of group.primitives??[])if(openIds.has(primitive.id)) {
              const remap=new Map<number,number>(),positions:number[]=[],local:number[]=[];
              for(const index of indices.subarray(primitive.firstTriangle*3,(primitive.firstTriangle+primitive.triangleCount)*3)) {
                if(!remap.has(index)){remap.set(index,remap.size);positions.push(...vertices.subarray(index*3,index*3+3));}local.push(remap.get(index)!);
              }
              const open=this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(local)).setCollisionGroups(0));
              this.openShots.push({collider:open,primitive});
            }
          }
          if(manifest.version===2)this.primitiveGroups.set(group.id,group.primitives!.map(p=>({...p})));
          if(group.movement)this.triangles.push({vertices:new Float32Array(binary,group.offset,group.vertexCount*3),
            indices:new Uint32Array(binary,group.offset+group.vertexCount*12,group.indexCount),visited:new Uint32Array(group.indexCount/3)});
        }
        for(const [key,values] of data.columns)this.columns.set(key,new Uint32Array(values));
        this.solidTree=buildSolidTree(data.solids);
        if(prepared.snapshot)for(const open of data.open){const collider=this.world.getCollider(open.handle);if(!collider)throw new Error('Missing prepared collider');
          this.openShots.push({collider,primitive:open.primitive});}
        this.surfaceDiagnostics.validatedSolids=data.solids.length;this.surfaceDiagnostics.opaquePrimitives=data.open.length;
        this.configureGrenadeQueries(manifest);
        this.world.step();
        return;
      }catch(error){this.world.free();throw error;}
    }
    const columns = new Map<string, number[]>();
    const shotSolids: ShotSolid[] = [];
    try {
    for (const group of manifest.groups) {
      const vertices = new Float32Array(binary, group.offset, group.vertexCount * 3);
      const indices = new Uint32Array(binary, group.offset + group.vertexCount * 12, group.indexCount);
      for (let i = 0; i < vertices.length; i += 3) {
        this.bounds.minX = Math.min(this.bounds.minX, vertices[i]); this.bounds.maxX = Math.max(this.bounds.maxX, vertices[i]);
        this.bounds.minZ = Math.min(this.bounds.minZ, vertices[i + 2]); this.bounds.maxZ = Math.max(this.bounds.maxZ, vertices[i + 2]);
      }
      const bits = Number(group.movement) | Number(group.shots) * 2;
      const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setCollisionGroups((bits << 16) | bits));
      this.ids.set(collider.handle, group.id);
      if (manifest.version === 2) {
        this.primitiveGroups.set(group.id, group.primitives!.map(p => ({...p})));
        if (group.shots) for (const primitive of group.primitives!) {
          const subset = indices.subarray(primitive.firstTriangle * 3, (primitive.firstTriangle + primitive.triangleCount) * 3);
          const solid = primitive.kind === 'convex-hull' ? validateConvexSolid(vertices, subset) : undefined;
          if (solid) shotSolids.push({...solid, primitive: {...primitive}});
          else {
            // Separate query-only meshes keep open geometry in front of or
            // inside hull intervals opaque. They never affect the actor motor.
            const remap = new Map<number, number>(), localVertices: number[] = [], localIndices: number[] = [];
            for (const index of subset) {
              if (!remap.has(index)) {remap.set(index, remap.size); localVertices.push(...vertices.subarray(index * 3, index * 3 + 3));}
              localIndices.push(remap.get(index)!);
            }
            const open = this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(localVertices), new Uint32Array(localIndices)).setCollisionGroups(0));
            this.openShots.push({collider: open, primitive: {...primitive}});
          }
        }
      }
      if (group.movement) {
        const groupIndex = this.triangles.length;
        this.triangles.push({vertices, indices, visited: new Uint32Array(indices.length / 3)});
        for (let triangle = 0; triangle < indices.length / 3; triangle++) {
          const ia = indices[triangle * 3] * 3, ib = indices[triangle * 3 + 1] * 3, ic = indices[triangle * 3 + 2] * 3;
          const ax = vertices[ia], ay = vertices[ia + 1], az = vertices[ia + 2];
          const bx = vertices[ib], by = vertices[ib + 1], bz = vertices[ib + 2];
          const cx = vertices[ic], cy = vertices[ic + 1], cz = vertices[ic + 2];
          const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
          const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
          const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          if (Math.abs(ny) < Math.hypot(nx, ny, nz) * .001 || !ny) continue;
          const encoded = groupIndex * 0x1000000 + triangle;
          if (triangle >= 0x1000000) throw new Error('Native collision group exceeds triangle index range');
          for (let x = Math.floor(Math.min(ax, bx, cx) / cellSize); x <= Math.floor(Math.max(ax, bx, cx) / cellSize); x++) {
            for (let z = Math.floor(Math.min(az, bz, cz) / cellSize); z <= Math.floor(Math.max(az, bz, cz) / cellSize); z++) {
              const key = `${x}:${z}`;
              let values = columns.get(key);
              if (!values) {values = []; columns.set(key, values);}
              values.push(encoded);
            }
          }
        }
      }
    }
    for (const [key, values] of columns) this.columns.set(key, new Uint32Array(values));
    this.solidTree = buildSolidTree(shotSolids);
    this.surfaceDiagnostics.validatedSolids = shotSolids.length;
    this.surfaceDiagnostics.opaquePrimitives = this.openShots.length;
    this.configureGrenadeQueries(manifest);this.world.step();
    } catch (error) {this.world.free(); throw error;}
  }
  exportPrepared():{metadata:PreparedNativeQueries;snapshot:Uint8Array} {
    if(this.disposed)throw new Error('Cannot prepare a disposed collision world');
    const solids:ShotSolid[]=[];
    const visit=(node:typeof this.solidTree)=>{if(!node)return;if(node.items)solids.push(...node.items);else{visit(node.left);visit(node.right);}};
    visit(this.solidTree);
    return {snapshot:this.world.takeSnapshot(),metadata:{schema:QUERY_SCHEMA,engine:RAPIER.version(),collisionSha256:this.collisionSha256,
      bounds:{...this.bounds},ids:[...this.ids],columns:[...this.columns].map(([key,values])=>[key,Array.from(values)]),
      solids,open:this.openShots.map(({collider,primitive})=>({handle:collider.handle,primitive}))}};
  }
  private shape(height: number) {
    let shape = this.shapes.get(height);
    if (!shape) {shape = new RAPIER.Cuboid(radius, height / 2, radius); if (this.shapes.size > 32) this.shapes.clear(); this.shapes.set(height, shape);}
    return shape;
  }
  sweep(from: Vec, to: Vec, height: number): HullSweep {
    if (this.disposed) return {position: {...from}, fraction: 0, startSolid: true};
    const delta = {x: to.x - from.x, y: to.y - from.y, z: to.z - from.z};
    if (Math.hypot(delta.x, delta.y, delta.z) < 1e-10) return {position: {...from}, fraction: 1, startSolid: false};
    const hit = this.world.castShape({x: from.x, y: from.y + height / 2 + skin, z: from.z}, rotation, delta,
      this.shape(height), 0, 1, false, undefined, movementGroup);
    if (!hit) return {position: {...to}, fraction: 1, startSolid: false};
    const fraction = Math.max(0, Math.min(1, hit.time_of_impact - skin / Math.max(skin, Math.hypot(delta.x, delta.y, delta.z))));
    return {position: {x: from.x + delta.x * fraction, y: from.y + delta.y * fraction, z: from.z + delta.z * fraction},
      fraction, contact: {normal: {...hit.normal1}}, startSolid: false};
  }
  sweepSphere(from:Vec,to:Vec,radius:number):HullSweep {
    if(this.disposed)return {position:{...from},fraction:0,startSolid:true};
    let shape=this.sphereShapes.get(radius);if(!shape){shape=new RAPIER.Ball(radius);this.sphereShapes.set(radius,shape);}
    const delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},length=Math.hypot(delta.x,delta.y,delta.z);
    if(length<1e-9)return {position:{...to},fraction:1,startSolid:false};
    const hit=this.world.castShape(from,rotation,delta,shape,.0001,1,false,undefined,movementGroup);
    if(!hit)return {position:{...to},fraction:1,startSolid:false};
    const fraction=Math.max(0,Math.min(1,hit.time_of_impact-.0001/length));
    return {position:{x:from.x+delta.x*fraction,y:from.y+delta.y*fraction,z:from.z+delta.z*fraction},fraction,
      contact:{normal:{...hit.normal1}},startSolid:false};
  }
  private configureGrenadeQueries(manifest:NativeCollisionManifest) {
    const groups=new Map(manifest.groups.map(group=>[group.id,group]));
    for(const [handle,id]of this.ids) {
      const group=groups.get(id),collider=this.world.getCollider(handle);if(!group||!collider)continue;
      const tags=group.tags??[],excluded=group.excludes??[];
      const grenade=!tags.some(tag=>['playerclip','npcclip','sky'].includes(tag.toLowerCase()))&&
        !excluded.some(tag=>['grenade','csgo_grenade'].includes(tag.toLowerCase()));
      const bits=Number(group.movement)|Number(group.shots)*2|Number(grenade)*4;
      collider.setCollisionGroups((bits<<16)|bits);
    }
    if(manifest.collisionSha256!==grenadeClips.collisionSha256&&manifest.sourceCollisionSha256!==grenadeClips.collisionSha256)return;
    let present=false;this.world.forEachCollider(collider=>{if(collider.collisionGroups()===grenadeGroup)present=true;});
    if(!present)this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(grenadeClips.vertices),new Uint32Array(grenadeClips.indices))
      .setCollisionGroups(grenadeGroup));
  }
  sweepGrenade(from:Vec,to:Vec,radius:number):HullSweep {
    if(this.disposed)return{position:{...from},fraction:0,startSolid:true};
    let shape=this.grenadeShapes.get(radius);if(!shape){shape=new RAPIER.Cuboid(radius,radius,radius);this.grenadeShapes.set(radius,shape);}
    const delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},length=Math.hypot(delta.x,delta.y,delta.z);
    if(length<1e-9)return{position:{...to},fraction:1,startSolid:false};
    const hit=this.world.castShape(from,rotation,delta,shape,.0001,1,false,undefined,grenadeGroup);
    if(!hit)return{position:{...to},fraction:1,startSolid:false};
    const fraction=Math.max(0,Math.min(1,hit.time_of_impact-.0001/length));
    return{position:{x:from.x+delta.x*fraction,y:from.y+delta.y*fraction,z:from.z+delta.z*fraction},fraction,
      contact:{normal:{...hit.normal1}},startSolid:false};
  }
  /** Bounded cosmetic copy of exact movement triangles, never live combat bodies. */
  corpseGeometry(center: Vec, extent: number) {
    const size = Math.min(8, Math.max(1, extent)), radius = size + 2, vertices: number[] = [];
    if (this.disposed) return {vertices: new Float32Array(), indices: new Uint32Array()};
    const x = Math.floor(center.x / 4) * 4 + 2, y = Math.floor(center.y / 4) * 4 + 2, z = Math.floor(center.z / 4) * 4 + 2;
    const key = `${x}:${y}:${z}:${size}`, cached = this.corpseMeshes.get(key);
    if (cached) return cached;
    // Grounding columns intentionally omit vertical faces. Copy directly from
    // source movement triangles so walls, stair risers and cover sides survive.
    // No per-triangle objects; nearby deaths reuse an 8-entry / 4 MiB cache.
    for (const group of this.triangles) {
      const p = group.vertices, ids = group.indices;
      for (let t = 0; t < ids.length; t += 3) {
        const a = ids[t] * 3, b = ids[t + 1] * 3, c = ids[t + 2] * 3;
        if (Math.min(p[a], p[b], p[c]) > x + radius || Math.max(p[a], p[b], p[c]) < x - radius ||
          Math.min(p[a + 1], p[b + 1], p[c + 1]) > y + radius || Math.max(p[a + 1], p[b + 1], p[c + 1]) < y - radius ||
          Math.min(p[a + 2], p[b + 2], p[c + 2]) > z + radius || Math.max(p[a + 2], p[b + 2], p[c + 2]) < z - radius) continue;
        vertices.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
      }
    }
    const result = {vertices: new Float32Array(vertices), indices: Uint32Array.from({length: vertices.length / 3}, (_, i) => i)};
    const bytes = (mesh: typeof result) => mesh.vertices.byteLength + mesh.indices.byteLength;
    if (bytes(result) <= 4 * 1024 ** 2) {
      while (this.corpseMeshes.size && (this.corpseMeshes.size >= 8 ||
        Array.from(this.corpseMeshes.values()).reduce((sum, mesh) => sum + bytes(mesh), bytes(result)) > 4 * 1024 ** 2))
        this.corpseMeshes.delete(this.corpseMeshes.keys().next().value!);
      this.corpseMeshes.set(key, result);
    }
    return result;
  }

  fits(position: Vec, feet: number, height: number) {
    if (this.disposed) return false;
    const shape = new RAPIER.Cuboid(radius - skin, height / 2 - skin, radius - skin);
    return !this.world.intersectionWithShape({x: position.x, y: feet + height / 2 + skin, z: position.z}, rotation,
      shape, undefined, movementGroup);
  }
  vertical(position: Vec, from: number, to: number, height: number): ReturnType<ResolveVertical> {
    if (this.disposed) return {feet: from, grounded: false, ceiling: false};
    const key = `${position.x}:${position.z}`;
    let surfaces = this.surfaces.get(key);
    if (!surfaces) {
      this.queryVersion = (this.queryVersion + 1) >>> 0;
      if (!this.queryVersion) {
        for (const group of this.triangles) group.visited.fill(0);
        this.queryVersion = 1;
      }
      surfaces = [];
      for (let x = Math.floor((position.x - radius) / cellSize); x <= Math.floor((position.x + radius) / cellSize); x++) {
        for (let z = Math.floor((position.z - radius) / cellSize); z <= Math.floor((position.z + radius) / cellSize); z++) {
          const candidates = this.columns.get(`${x}:${z}`);
          if (!candidates) continue;
          for (const encoded of candidates) {
            const group = this.triangles[encoded >>> 24], triangle = encoded & 0xffffff;
            if (group.visited[triangle] === this.queryVersion) continue;
            group.visited[triangle] = this.queryVersion;
            const surface = clipTriangle(group.vertices, group.indices, triangle, position.x, position.z, this.clipA, this.clipB);
            if (surface) surfaces.push(surface);
          }
        }
      }
      if (this.surfaces.size >= 256) this.surfaces.delete(this.surfaces.keys().next().value!);
      this.surfaces.set(key, surfaces);
    }
    const down = to <= from;
    let selected: VerticalSurface | undefined, feet = to;
    for (const surface of surfaces) {
      // Vertical queries categorize support, not wall sliding (the hull sweep
      // already resolves that). A beveled/steep box side must not mask the
      // walkable floor just beneath it and turn wall pressure into tiny falls.
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
  ray(origin: Vec, direction: Vec, maxDistance: number): NativeMapHit | undefined {
    if (this.disposed) return;
    if (!(maxDistance > 0) || !Number.isFinite(origin.x + origin.y + origin.z + direction.x + direction.y + direction.z)) return;
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(origin, direction), maxDistance, true, undefined, shotGroup);
    return hit ? {distance: hit.timeOfImpact, normal: {...hit.normal}, ...this.hitMetadata(hit)} : undefined;
  }
  private hitMetadata(hit: RAPIER.RayColliderIntersection): NativeSurfaceHit {
    const groupId = this.ids.get(hit.collider.handle) ?? -1, primitives = this.primitiveGroups.get(groupId);
    if (!primitives) return {surfaceId: groupId}; // Version 1 IDs are masks, not materials.
    const triangle = hit.featureId;
    if (triangle === undefined) return {surfaceId: -1};
    let low = 0, high = primitives.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1, p = primitives[mid];
      if (triangle < p.firstTriangle) high = mid - 1;
      else if (triangle >= p.firstTriangle + p.triangleCount) low = mid + 1;
      else {
        const surfaceId = p.triangleSurfaces?.[triangle - p.firstTriangle] ?? p.surfaceId;
        return {surfaceId, primitiveId: p.id, surface: this.materialForSurface(surfaceId)};
      }
    }
    return {surfaceId: -1};
  }
  materialForSurface(surfaceId: number): NativeSurface | undefined {return this.sourceSurfaces.get(surfaceId);}
  traceSolid(origin: Vec, direction: Vec, range: number): NativeSurfaceInterval[] {
    if (this.disposed || (!(range === Infinity || Number.isFinite(range))) || range < 0 ||
      ![origin.x,origin.y,origin.z,direction.x,direction.y,direction.z].every(Number.isFinite)) return [];
    const length = Math.hypot(direction.x,direction.y,direction.z);
    if (length < 1e-12) return [];
    const unit = {x: direction.x/length,y: direction.y/length,z: direction.z/length};
    if (!this.primitiveGroups.size) {
      const hit = this.ray(origin,unit,range);
      return hit ? [{...hit,entry:hit.distance,entryNormal:hit.normal,validated:false}] : [];
    }
    const result: NativeSurfaceInterval[] = [];
    for (const solid of querySolidTree(this.solidTree,origin,unit,range)) {
      const interval = convexRayInterval(solid,origin,unit);
      if (interval && interval.entry <= range) result.push({...interval,validated:true,primitiveId:solid.primitive.id,
        surfaceId:solid.primitive.surfaceId,surface:this.materialForSurface(solid.primitive.surfaceId)});
    }
    const ray = new RAPIER.Ray(origin,unit);
    for (const {collider,primitive} of this.openShots) {
      const hit = collider.castRayAndGetNormal(ray,range,true);
      if (hit) {
        const surfaceId = hit.featureId === undefined ? primitive.surfaceId : primitive.triangleSurfaces?.[hit.featureId] ?? primitive.surfaceId;
        result.push({entry:hit.timeOfImpact,entryNormal:{...hit.normal},validated:false,
          primitiveId:primitive.id,surfaceId,surface:this.materialForSurface(surfaceId)});
      }
    }
    return result.sort((a,b) => a.entry-b.entry || (a.primitiveId ?? -1)-(b.primitiveId ?? -1));
  }
  floorSurfaceAt(x: number, z: number, from = 20, distance = 40): NativeMapHit | undefined {
    if (this.disposed) return;
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({x,y:from,z},{x:0,y:-1,z:0}),distance,true,undefined,movementGroup);
    return hit && hit.normal.y >= .7 ? {distance:hit.timeOfImpact,normal:{...hit.normal},...this.hitMetadata(hit)} : undefined;
  }
  floorAt(x: number, z: number, from = 20, distance = 40) {
    const hit = this.floorSurfaceAt(x,z,from,distance);
    return hit ? from - hit.distance : undefined;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free(); this.shapes.clear(); this.grenadeShapes.clear();this.sphereShapes.clear();this.columns.clear(); this.surfaces.clear(); this.triangles.length = 0; this.corpseMeshes.clear();
    this.ids.clear(); this.sourceSurfaces.clear(); this.primitiveGroups.clear(); this.openShots.length = 0; this.solidTree = undefined;
  }
}
