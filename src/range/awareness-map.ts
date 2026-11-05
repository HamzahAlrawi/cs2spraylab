import type {Group} from 'three';
import {UNIT,type Vec} from './actor-physics';
import {loadNativeMap,type PrefireMap} from './prefire/map';
import {nativeMaps} from './prefire/maps';
import type {PrefireCatalog} from './prefire/schema';
import {sourcePoint} from './prefire/route-helpers';
import {backgroundBudget} from './prefire/background-work';
import {loadNativeRadar,type NativeRadarLease} from './duel/native-radar-cache';
import {installNativeNavigation,type NativeNavigationData} from './duel/native-navigation';
import type {Arena} from './duel/geometry';
import {fetchDeliveredAsset,validateDelivery} from './prefire/asset-delivery';

export type AwarenessLocation={feet:Vec;edge?:Vec};
export type AwarenessWorld={mapId:string;name:string;scene:Group;arena:Arena;sources:readonly AwarenessLocation[];
  updateView(position:Vec):void;radarOverview(feet:number):import('./duel/radar').RadarOverview|undefined;
  loadingReport():PrefireMap['loadStats'];dispose():void};

/** Sparse, supported route graph for acoustic diffraction; never a new collision world. */
export async function buildAwarenessArena(map:PrefireMap,catalog:PrefireCatalog,signal:AbortSignal) {
  const bounds=map.collision.bounds;
  if(!bounds||![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite)||
    bounds.minX>=bounds.maxX||bounds.minZ>=bounds.maxZ)throw Error('Sound practice requires full native map bounds.');
  const arena:Arena={...bounds,solids:[],native:map.collision,design:`${catalog.name} / sound awareness`};
  const sources:AwarenessLocation[]=[],nodes:NativeNavigationData['nodes']=[],ids=new Map<string,number>();
  const turn=backgroundBudget(signal),height=72*UNIT;
  const supported=(p:Vec)=>{
    const floor=map.collision.vertical(p,p.y+6*UNIT,p.y-6*UNIT,height);
    return floor.grounded&&map.collision.fits(p,floor.feet,height)?{...p,y:floor.feet}:undefined;
  };
  const clear=(a:Vec,b:Vec)=>{
    const x=b.x-a.x,y=b.y-a.y,z=b.z-a.z,d=Math.hypot(x,y,z);
    return d<.03||!map.collision.ray({...a,y:a.y+1.2},{x:x/d,y:y/d,z:z/d},d-.02);
  };
  const add=(p:Vec)=>{
    const key=[p.x,p.y,p.z].map(n=>Math.round(n*20)).join(':');
    let id=ids.get(key);if(id!==undefined)return id;
    if(nodes.length>=6000)return -1;
    id=nodes.length;ids.set(key,id);nodes.push({point:p,links:[]});sources.push({feet:p});return id;
  };
  const link=(a:number,b:number)=>{
    if(a<0||b<0||a===b||nodes[a].links.length>=64||nodes[b].links.length>=64)return;
    if(!nodes[a].links.includes(b))nodes[a].links.push(b);
    if(!nodes[b].links.includes(a))nodes[b].links.push(a);
  };
  let spawn:Vec|undefined,look:Vec|undefined;
  for(const route of catalog.routes){
    const start=supported(sourcePoint(route.spawn));if(!spawn&&start){spawn=start;look=sourcePoint(route.look);}
    const path=[route.spawn,...route.path].map(sourcePoint);let previous=-1;
    for(let i=0;i<path.length;i++){
      const a=path[Math.max(0,i-1)],b=path[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)/1.5));
      for(let j=i?1:0;j<=steps;j++){
        await turn();const t=j/steps,p=supported({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
        if(!p){previous=-1;continue;}
        const id=add(p);
        if(previous>=0&&id>=0&&clear(nodes[previous].point,p))link(previous,id);
        previous=id;
      }
    }
    for(const angle of [...route.angles,...route.alternatives??[]]){
      await turn();const p=supported(sourcePoint(angle.position));if(p)add(p);
    }
  }
  if(!spawn||!nodes.length)throw Error('No supported starting position in this map.');
  // Connect intersecting authored routes without an expensive whole-map flood fill.
  const cells=new Map<string,number[]>(),cell=(x:number,z:number)=>`${x}:${z}`;
  for(let i=0;i<nodes.length;i++){
    await turn();const p=nodes[i].point,x=Math.floor(p.x/2),z=Math.floor(p.z/2);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const other of cells.get(cell(x+dx,z+dz))??[]){
      const q=nodes[other].point;
      if(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<1.8&&clear(p,q))link(i,other);
    }
    const bucket=cells.get(cell(x,z))??[];bucket.push(i);cells.set(cell(x,z),bucket);
  }
  installNativeNavigation(arena,{version:1,nodes});
  const bot=nodes.find(n=>Math.hypot(n.point.x-spawn!.x,n.point.z-spawn!.z)>5)?.point??nodes[0].point;
  arena.spawns={player:{feet:spawn,yaw:Math.atan2(-(look!.x-spawn.x),-(look!.z-spawn.z))},bots:[{feet:bot,yaw:0}]};
  return {arena,sources};
}

export async function loadAwarenessWorld(mapId:string,signal:AbortSignal):Promise<AwarenessWorld> {
  const definition=nativeMaps.get(mapId);
  const [mapResult,catalogResult,radarResult]=await Promise.allSettled([
    (async()=>{
      const delivery=definition.fullDelivery?validateDelivery(JSON.parse(new TextDecoder().decode(
        await fetchDeliveredAsset(definition.fullDelivery,signal)))):undefined;
      return loadNativeMap(signal,{base:definition.base,sharedTextureBase:definition.sharedTextureBase,delivery});
    })(),
    nativeMaps.loadCatalog(mapId),definition.radar?loadNativeRadar(signal,definition):Promise.resolve(undefined),
  ]);
  const map=mapResult.status==='fulfilled'?mapResult.value:undefined;
  const radar:NativeRadarLease|undefined=radarResult.status==='fulfilled'?radarResult.value:undefined;
  try {
    signal.throwIfAborted();
    if(mapResult.status==='rejected')throw mapResult.reason;
    if(catalogResult.status==='rejected')throw catalogResult.reason;
    if(radarResult.status==='rejected')throw radarResult.reason;
    const {arena,sources}=await buildAwarenessArena(map!,catalogResult.value,signal);let disposed=false;
    return {mapId,name:definition.name,scene:map!.scene,arena,sources,
      updateView:position=>map!.updateVisibility?.(position),radarOverview:()=>radar?.overview,
      loadingReport:()=>map!.loadStats,dispose(){if(disposed)return;disposed=true;radar?.dispose();map!.dispose();}};
  }catch(error){radar?.dispose();map?.dispose();throw error;}
}
