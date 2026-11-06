import RAPIER from '@dimforge/rapier3d-compat';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {prepareRapier} from '../rapier-runtime';
import {acquireNativeGrenadeQuery} from './native-grenade-query';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
  await prepareRapier();const world=new RAPIER.World({x:0,y:0,z:0});
  world.createCollider(RAPIER.ColliderDesc.cuboid(.1,3,3).setTranslation(10,2,0));world.step();
  const bytes=world.takeSnapshot();world.free();
  return {manifest:{version:1,mapId:'de_fixture',build:'fixture',engine:RAPIER.version(),worldCollisionSha256:'a'.repeat(64),snapshotSha256:hash(bytes)},
    bytes:bytes.slice().buffer as ArrayBuffer};
}
describe('shared whole-map native grenade queries',()=>{
  it('keeps surfaces outside a combat chunk queryable and shares/relinquishes the prepared world',async()=>{
    const {manifest,bytes}=await fixture(),restore=vi.spyOn(RAPIER.World,'restoreSnapshot');
    const decode=vi.fn(async()=>bytes);
    const a=await acquireNativeGrenadeQuery(manifest,bytes,manifest.worldCollisionSha256),
      b=await acquireNativeGrenadeQuery(manifest,decode,manifest.worldCollisionSha256);
    try{
      expect(restore).toHaveBeenCalledOnce();expect(a.identity).toBe(b.identity);
      expect(decode).not.toHaveBeenCalled();
      const from={x:0,y:2,z:0},to={x:20,y:2,z:0};
      expect(a.sweep(from,to,.0508).position.x).toBeCloseTo(9.849,3);
      a.release();expect(b.sweep(from,to,.0508).fraction).toBeLessThan(1);
      b.release();b.release();expect(b.sweep(from,to,.0508).startSolid).toBe(true);
      const c=await acquireNativeGrenadeQuery(manifest,bytes,manifest.worldCollisionSha256);
      expect(restore).toHaveBeenCalledTimes(2);c.release();
    }finally{a.release();b.release();restore.mockRestore();}
  });
  it('rejects foreign, corrupt and incompatible prepared worlds',async()=>{
    const {manifest,bytes}=await fixture();
    await expect(acquireNativeGrenadeQuery(manifest,bytes,'b'.repeat(64))).rejects.toThrow('rebuilding');
    await expect(acquireNativeGrenadeQuery({...manifest,engine:'old'},bytes,manifest.worldCollisionSha256)).rejects.toThrow('rebuilding');
    const corrupt=bytes.slice(0);new Uint8Array(corrupt)[20]^=1;
    await expect(acquireNativeGrenadeQuery(manifest,corrupt,manifest.worldCollisionSha256)).rejects.toThrow();
    const aborted=new AbortController();aborted.abort();
    await expect(acquireNativeGrenadeQuery(manifest,bytes,manifest.worldCollisionSha256,aborted.signal)).rejects.toThrow();
  });
});

describe.each(['dust2','mirage'])('%s local native grenade archive (not a lineup parity certificate)',assetId=>{
  const base=`public/revamp/maps/${assetId}/`;
  it.skipIf(!existsSync(base+'grenade-collision.json'))('pins native entity PHYS and restores its exact query snapshot',async()=>{
    const manifest=JSON.parse(readFileSync(base+'grenade-collision.json','utf8')),binary=readFileSync(base+'grenade-collision.bin'),
      bytes=readFileSync(base+'grenade-query.bin'),world=JSON.parse(readFileSync(base+'collision.json','utf8'));
    expect(manifest.mapSha256).toBe(world.mapSha256);expect(manifest.worldCollisionSha256).toBe(world.collisionSha256);
    expect(hash(binary)).toBe(manifest.binarySha256);expect(hash(bytes)).toBe(manifest.snapshotSha256);
    expect(manifest.sources.some((source:{kind:string})=>source.kind==='func_clip_vphysics')).toBe(true);
    const query=await acquireNativeGrenadeQuery(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length) as ArrayBuffer,world.collisionSha256);
    try{
      // Probe the independently extracted thin grenade clip, not a visual triangle or playerclip.
      const from=assetId==='dust2'?{x:7,y:1,z:-64}:{x:-11,y:0,z:-18.5};
      const to=assetId==='dust2'?{...from,z:-66}:{...from,x:-13};
      const contact=query.sweep(from,to,2*.0254);
      expect(contact.fraction).toBeLessThan(1);expect(contact.contact).toBeDefined();
    }finally{query.release();}
  });
});
