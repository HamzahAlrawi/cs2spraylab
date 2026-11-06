import RAPIER from '@dimforge/rapier3d-compat';
import type {Vec} from '../actor-physics';
import type {HullSweep} from '../actor-collision';
import {prepareRapier} from '../rapier-runtime';
import {verifyMapDigest} from './map-loading';

export type NativeGrenadeArchive={version:number;mapId:string;build:string;engine:string;worldCollisionSha256:string;snapshotSha256:string};
const rotation={x:0,y:0,z:0,w:1};
const shared=new Map<string,{world:RAPIER.World;refs:number;shapes:Map<number,RAPIER.Cuboid>}>();

/** Independent, complete-map grenade queries; all resident chunks share one world. */
export async function acquireNativeGrenadeQuery(manifest:NativeGrenadeArchive,snapshot:ArrayBuffer|(()=>Promise<ArrayBuffer>),sourceWorld:string,signal?:AbortSignal) {
  signal?.throwIfAborted();await prepareRapier();
  signal?.throwIfAborted();
  if(manifest.version!==1||manifest.worldCollisionSha256!==sourceWorld||manifest.engine!==RAPIER.version()||
    !/^de_[a-z0-9_]+$/.test(manifest.mapId)||!/^[a-f0-9]{64}$/.test(manifest.snapshotSha256))
    throw Error('Native grenade collision needs rebuilding for this map/physics engine.');
  const key=`${sourceWorld}:${manifest.snapshotSha256}`;
  let entry=shared.get(key);
  if(!entry){
    const bytes=typeof snapshot==='function'?await snapshot():snapshot;
    if(bytes.byteLength>64*1024*1024)throw Error('Native grenade query exceeds memory budget.');
    await verifyMapDigest(bytes,manifest.snapshotSha256);signal?.throwIfAborted();
    entry=shared.get(key);
    if(!entry){entry={world:RAPIER.World.restoreSnapshot(new Uint8Array(bytes)),refs:0,shapes:new Map()};shared.set(key,entry);}
  }
  entry.refs++;const owned=entry;let released=false;
  return {identity:key,sweep(from:Vec,to:Vec,radius:number):HullSweep{
    if(released)return{position:{...from},fraction:0,startSolid:true};
    let shape=owned.shapes.get(radius);if(!shape){shape=new RAPIER.Cuboid(radius,radius,radius);owned.shapes.set(radius,shape);}
    const delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},length=Math.hypot(delta.x,delta.y,delta.z);
    if(length<1e-9)return{position:{...to},fraction:1,startSolid:false};
    const hit=owned.world.castShape(from,rotation,delta,shape,.0001,1,false);
    if(!hit)return{position:{...to},fraction:1,startSolid:false};
    const fraction=Math.max(0,Math.min(1,hit.time_of_impact-.0001/length));
    return{position:{x:from.x+delta.x*fraction,y:from.y+delta.y*fraction,z:from.z+delta.z*fraction},fraction,
      startSolid:false,contact:{normal:{...hit.normal1}}};
  },release(){if(released)return;released=true;if(--owned.refs===0){shared.delete(key);owned.world.free();owned.shapes.clear();}}};
}
export type NativeGrenadeQuery=Awaited<ReturnType<typeof acquireNativeGrenadeQuery>>;
