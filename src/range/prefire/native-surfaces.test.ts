import {afterEach,describe,expect,it} from 'vitest';
import {BoxGeometry,PlaneGeometry} from 'three';
import {existsSync,readFileSync} from 'node:fs';
import {NativeMapCollision,type NativeCollisionManifest} from './native-collision';
import {resolveBulletRay,type PenetrationStats} from '../duel/penetration';
import {surfaceFootstepMaterial,type NativeSurface} from './native-surfaces';

const surfaces: NativeSurface[] = [
  {id:0,hash:436732118,name:'concrete',material:'concrete',gameMaterial:'C',penetrationModifier:.5},
  {id:1,hash:3076510970,name:'Wood',material:'wood',gameMaterial:'W',penetrationModifier:.9},
  {id:2,hash:417707814,name:'metal',material:'metal',gameMaterial:'M',penetrationModifier:.4},
];
const stats: PenetrationStats = {damage:100,penetration:2,rangeModifier:.98,armorRatio:1.5,headshotMultiplier:4};
const origin = {x:0,y:1,z:0}, direction = {x:0,y:0,z:-1};
const live: NativeMapCollision[] = [];
afterEach(()=>{for(const map of live)map.dispose(); live.length=0;});
async function fixture(entries: {z:number;thickness?:number;surfaceId?:number;open?:boolean;mutate?:(indices:Uint32Array)=>Uint32Array}[],version=2) {
  const chunks: Buffer[] = [], groups: NativeCollisionManifest['groups'] = []; let offset=0;
  entries.forEach((entry,id)=>{
    const geometry = entry.open ? new PlaneGeometry(4,4).translate(0,1,entry.z) : new BoxGeometry(4,4,entry.thickness ?? .1).translate(0,1,entry.z);
    const vertices = new Float32Array(geometry.getAttribute('position').array);
    const original = new Uint32Array(geometry.getIndex()!.array), indices = entry.mutate?.(original) ?? original;
    groups.push({id,offset,vertexCount:vertices.length/3,indexCount:indices.length,movement:true,shots:true,
      primitives:[{id,firstTriangle:0,triangleCount:indices.length/3,surfaceId:entry.surfaceId ?? 1,kind:entry.open?'mesh':'convex-hull'}]});
    chunks.push(Buffer.from(vertices.buffer),Buffer.from(indices.buffer)); offset+=vertices.byteLength+indices.byteLength; geometry.dispose();
  });
  const buffer=Buffer.concat(chunks), binary=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer;
  const manifest: NativeCollisionManifest={version,unit:.0254,build:'synthetic-topology',collisionSha256:'',groups,surfaces};
  const map=await NativeMapCollision.create(manifest,binary); live.push(map); return {map,manifest,binary};
}
const shot=(map:NativeMapCollision,extra={})=>resolveBulletRay({origin,direction,range:20,stats,arena:{solids:[],native:map},actors:[],...extra});

describe('native source surfaces and validated solids',()=>{
  it('retains source identities for hits, floors and shared audio selection',async()=>{
    const {map}=await fixture([{z:-2,surfaceId:1}]);
    expect(map.ray(origin,direction,10)).toMatchObject({surfaceId:1,primitiveId:0,surface:{name:'Wood'}});
    expect(map.floorSurfaceAt(0,-2,5,10)).toMatchObject({surfaceId:1,surface:{name:'Wood'}});
    expect(surfaceFootstepMaterial(map.materialForSurface(1))).toBe('wood');
    expect(surfaceFootstepMaterial(surfaces[2])).toBe('metal');
    expect(map.materialForSurface(999)).toBeUndefined();
    expect(surfaceFootstepMaterial()).toBe('concrete');
  });
  it.each([
    ['sand','sand'], ['dirt','dirt'], ['tile','tile'], ['carpet','carpet'], ['gravel','gravel'],
    ['chainlink','chainlink'], ['metalgrate','metalgrate'], ['metalvent','metalvent'],
    ['metalpanel','metalvehicle'], ['metal_sand_barrel','metalbarrel'], ['rubbertire','rubber'],
    ['Wood_Dense','wood_solid'], ['Wood_Solid','wood'], ['Wood_Plank','woodbox'],
    ['pottery','glassbottle'], ['tile_survivalCase','silent'],
  ])('uses native footstep inheritance for %s, independently of bullet family', (name, bank) => {
    expect(surfaceFootstepMaterial({id: 0, hash: 0, name, material: 'concrete'})).toBe(bank);
  });
  it('matches generated wood/metal/concrete damage including total-distance falloff',async()=>{
    for(const surface of surfaces){
      const {map}=await fixture([{z:-2,surfaceId:surface.id}]);
      const native=shot(map);
      const interval=map.traceSolid(origin,direction,20)[0];
      expect(interval.validated).toBe(true);
      const generated=resolveBulletRay({origin,direction,range:20,stats,actors:[],arena:{solids:[{
        center:{x:0,y:1,z:-(interval.entry+interval.exit!)/2},size:{x:4,y:4,z:interval.exit!-interval.entry},material:surface.material}]}});
      expect(native.residualDamage).toBeCloseTo(generated.residualDamage,10);
      expect(native.surfaces.map(c=>c.phase)).toEqual(['entry','exit']);
      expect(native.surfaces[0].nativeSurface?.hash).toBe(surface.hash);
    }
  });
  it('uses geometric chords in both directions, at triangle seams and oblique angles',async()=>{
    const {map}=await fixture([{z:-2}]);
    for(const x of [0,1e-7,-1e-7]){
      const a=map.traceSolid({...origin,x},direction,10)[0];
      const b=map.traceSolid({x,y:1,z:-4},{x:0,y:0,z:1},10)[0];
      expect(a.exit!-a.entry).toBeCloseTo(.1,6);
      expect(b.exit!-b.entry).toBeCloseTo(a.exit!-a.entry,10);
      expect(a.entryNormal.z).toBe(1); expect(b.entryNormal.z).toBe(-1);
    }
    const angled=map.traceSolid({x:-1,y:1,z:0},{x:.2,y:0,z:-1},10)[0];
    expect(angled.exit!-angled.entry).toBeCloseTo(.1*Math.hypot(.2,1),6);
    expect(map.traceSolid({x:2,y:1,z:0},direction,10)).toEqual([]); // Tangent to hull, not inside it.
  });
  it('handles two touching solids separately and never bridges an air gap',async()=>{
    const {map}=await fixture([{z:-2},{z:-2.1,surfaceId:2},{z:-4}]);
    const intervals=map.traceSolid(origin,direction,10);
    expect(intervals).toHaveLength(3);
    expect(intervals[1].entry).toBeCloseTo(intervals[0].exit!,6);
    expect(intervals.every(i=>i.exit!-i.entry<.101)).toBe(true);
    expect(shot(map).penetrations).toBe(3);
    expect(shot(map,{maxPenetrations:1}).stopped).toBe('penetration-limit');
    expect(shot(map,{origin:{x:0,y:1,z:-6},direction:{x:0,y:0,z:1}}).penetrations).toBe(3);
  });
  it('stops at thick masonry, open meshes and invalid claimed hull topology',async()=>{
    for(const entry of [{z:-4,thickness:3,surfaceId:0},{z:-2,open:true},{z:-2,mutate:(i:Uint32Array)=>i.slice(3)}]){
      const {map}=await fixture([entry]); const result=shot(map);
      expect(result.stopped).toBe('surface'); expect(result.surfaces.map(s=>s.phase)).toEqual(['entry']);
    }
  });
  it('does not skip an open surface embedded inside a valid hull',async()=>{
    const {map}=await fixture([{z:-2,thickness:.2},{z:-2,open:true}]);
    const result=shot(map);
    expect(result.stopped).toBe('surface'); expect(result.surfaces.map(s=>s.primitiveId)).toEqual([0,1]);
    expect(result.surfaces[1].thickness).toBe(0);
  });
  it('retains true exits beyond range and handles an origin inside',async()=>{
    const {map}=await fixture([{z:0,thickness:.1}]);
    const interval=map.traceSolid(origin,direction,.01)[0];
    expect(interval.entry).toBe(0); expect(interval.exit).toBeCloseTo(.05,6);
    const result=shot(map,{range:.01}); expect(result.surfaces).toHaveLength(1); expect(result.distance).toBe(.01);
  });
  it('keeps legacy masks opaque even when metadata happens to be present',async()=>{
    const {map}=await fixture([{z:-2}],1);
    expect(map.materialForSurface(1)).toBeUndefined();
    expect(map.traceSolid(origin,direction,10)[0]).toMatchObject({validated:false});
    expect(shot(map).stopped).toBe('surface');
    map.dispose(); map.dispose(); expect(map.traceSolid(origin,direction,10)).toEqual([]);
  });
  it('rejects incomplete solid coverage and absent surface IDs',async()=>{
    const {manifest,binary}=await fixture([{z:-2}]);
    const invalid=structuredClone(manifest); invalid.groups[0].primitives![0].triangleCount--;
    await expect(NativeMapCollision.create(invalid,binary)).rejects.toThrow('Incomplete');
    invalid.groups[0].primitives![0].surfaceId=999;
    await expect(NativeMapCollision.create(invalid,binary)).rejects.toThrow('Invalid native solid');
  });
});

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('regenerated Dust 2 source metadata',()=>{
  it('loads the actual configured public root and resolves known source surfaces',async()=>{
    const manifest: NativeCollisionManifest=JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json','utf8'));
    expect(manifest.version).toBe(2); expect(manifest.build).toMatch(/^\d+$/);
    expect(manifest.surfaces?.find(s=>s.hash===3076510970)).toMatchObject({name:'Wood',gameMaterial:'W'});
    expect(manifest.surfaces?.find(s=>s.hash===417707814)).toMatchObject({name:'metal',penetrationModifier:.4});
    expect(manifest.surfaces?.find(s=>s.hash===436732118)).toMatchObject({name:'concrete',penetrationModifier:.5});
    const bytes=readFileSync('public/revamp/maps/dust2/collision.bin');
    const map=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer); live.push(map);
    expect(map.materialForSurface(0)?.name).toBe('concrete');
    expect(manifest.groups.some(g=>g.primitives?.some(p=>p.triangleSurfaces?.length))).toBe(true);
  },30000);
});
