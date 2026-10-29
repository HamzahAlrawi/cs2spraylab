import * as THREE from 'three';
import catalog from './real-map-catalog.json';
import {UNIT, type Vec} from '../actor-physics';
import type {Settings} from '../config';
import {loadDust2, type PrefireMap} from '../prefire/map';
import {dust2Catalog, type PrefireRoute} from '../prefire/routes';
import {angleIdentity, choosePrefireAngles, prefireAnglesIncompatible} from '../prefire/occupancy';
import {randomStream} from './rng';
import type {Arena, CoverLane} from './geometry';
import {prepareNativeNavigation,installNativeNavigation} from './native-navigation';
import {verifyMapDigest} from '../prefire/map-loading';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig, type DuelConfig} from './config';
import type {DuelScenario} from './scenario';
import {disposeResources} from './render-resources';
import {chooseRealMapCourse, chooseRealMapStart, type RoundCatalog, type RoundCourse, type RoundStart} from './real-map-rounds';
import {applyManualLineup, manualLineupFromArena, validateManualLineup, type SpawnContext, type ManualLineup} from './manual-spawns';
import type {RadarOverview} from './radar';
import {fetchDeliveredAsset,prefetchDeliveredAssets,validateDelivery,type MapDelivery} from '../prefire/asset-delivery';
import {PreparedRound, decodedPreloadAllowed} from './prepared-round';
import {backgroundTurn} from '../prefire/background-work';
import {loadMapContext} from './map-context';
import {localChunkManifest} from './map-manifests';

const overviews=new WeakMap<PrefireMap,{image:ImageBitmap;bounds:RadarOverview['bounds'];
  layers:({feet:number}&NonNullable<RadarOverview['source']>)[]}>();
type BakedChunk=RoundCatalog['chunks'][string];
const chunkRounds=new WeakMap<PrefireMap,BakedChunk>();

export type RealMapChunk = typeof catalog.chunks[number];
export const realMapChunks: readonly RealMapChunk[] = catalog.chunks;
export function chooseRealMapChunk(choice: string, seed: number, previous?: string): RealMapChunk {
  const fixed=realMapChunks.find(chunk=>chunk.id===choice);if(fixed)return fixed;
  const pool=realMapChunks.filter(chunk=>chunk.id!==previous);
  return pool[Math.floor(randomStream(seed,'duel-real-map')()*pool.length)];
}
export function chunkBounds(chunk: RealMapChunk) {
  return {minX:chunk.sourceMin[0]*UNIT,maxX:chunk.sourceMax[0]*UNIT,
    minZ:-chunk.sourceMax[1]*UNIT,maxZ:-chunk.sourceMin[1]*UNIT};
}
export function chunkRenderBounds(chunk: RealMapChunk) {
  const padding=chunk.contextPaddingUnits*UNIT;
  return {min:[chunk.sourceMin[0]*UNIT-padding,chunk.sourceMin[2]*UNIT-padding,-chunk.sourceMax[1]*UNIT-padding],
    max:[chunk.sourceMax[0]*UNIT+padding,chunk.sourceMax[2]*UNIT+padding,-chunk.sourceMin[1]*UNIT+padding]};
}
export function chunkContains(chunk:RealMapChunk, point: readonly number[], margin=17) {
  return point[0]>chunk.sourceMin[0]+margin && point[0]<chunk.sourceMax[0]-margin &&
    point[1]>chunk.sourceMin[1]+margin && point[1]<chunk.sourceMax[1]-margin &&
    point[2]>=chunk.sourceMin[2] && point[2]<=chunk.sourceMax[2];
}
const facing=(from:Vec,to:Vec)=>Math.atan2(-(to.x-from.x),-(to.z-from.z));

export function createRealMapArena(map:PrefireMap, chunk:RealMapChunk, config:DuelConfig, seed:number,rounds?:BakedChunk): Arena {
  const baked=rounds??chunkRounds.get(map);
  if(!baked || baked.collisionSha256!==map.collision.collisionSha256 || !baked.courses.length)
    throw new Error('Duel round catalog does not match the map. Run node tools/build-duel-rounds.mjs.');
  const course=chooseRealMapCourse(baked.courses,chunk.routeId,config.realMapCourse,seed);
  const source=dust2Catalog.routes.find(route=>route.id===course.id)!;
  const start=chooseRealMapStart(course,config.realMapCourse,seed);
  const candidates=course.holds.filter(hold=>start.holds.includes(angleIdentity(hold.angle)));
  const route:PrefireRoute={...source,angles:candidates.map(hold=>hold.angle),alternatives:[]};
  const active=candidates.filter(hold=>Math.hypot(hold.lane.edge.x-hold.lane.anchor.x,hold.lane.edge.z-hold.lane.anchor.z)>.15);
  const activeRound=active.length>=config.botCount && randomStream(seed,'duel-active-angles')()<.85;
  let selected=choosePrefireAngles({...route,angles:activeRound?active.map(hold=>hold.angle):route.angles},
    'random',randomStream(seed,'duel-native-holds'),dust2Catalog.density,config.botCount);
  if(selected.length!==config.botCount)selected=choosePrefireAngles(route,'random',randomStream(seed,'duel-native-holds'),dust2Catalog.density,config.botCount);
  if(selected.length!==config.botCount)throw new Error(`Not enough compatible covered holds in ${chunk.name}`);
  // A round setup often pairs nearby defenders instead of scattering every
  // teammate across the entire chunk. This is an authored training policy.
  if(config.tradeEnabled && selected.length>1 && randomStream(seed,'duel-buddy-setup')()<.75) {
    const lead=candidates.find(hold=>angleIdentity(hold.angle)===angleIdentity(selected[0]))!;
    const others=selected.slice(0,-1);
    const buddies=(activeRound?active:candidates).filter(hold=>Math.hypot(hold.source.x-lead.source.x,hold.source.z-lead.source.z)<10 &&
      Math.abs(hold.source.y-lead.source.y)<1.8 && others.every(angle=>!prefireAnglesIncompatible(angle,hold.angle)));
    if(buddies.length)selected[selected.length-1]=choosePrefireAngles({...route,angles:buddies.map(hold=>hold.angle)},
      'random',randomStream(seed,'duel-buddy-hold'),dust2Catalog.density,1)[0];
  }
  const holds=selected.map(angle=>candidates.find(hold=>angleIdentity(hold.angle)===angleIdentity(angle))!);
  // Retain occupied lanes first, then a bounded rotating set of other useful
  // angles. Tactical choices no longer collapse to the occupied spawn slots.
  const remaining=course.holds.filter(hold=>!holds.includes(hold));
  const rotation=Math.floor(randomStream(seed,'duel-angle-options')()*Math.max(1,remaining.length));
  const lanes:CoverLane[]=[...holds,...remaining.slice(rotation),...remaining.slice(0,rotation)].slice(0,32).map(({lane})=>
    ({...lane,anchor:{...lane.anchor},edge:{...lane.edge},retreat:{...lane.retreat},watch:lane.watch?{...lane.watch}:undefined}));
  const feet={...start.feet},views=course.views;
  const spawnRoll=randomStream(seed,'duel-start-stance');
  const botFeet:Vec[]=[];
  for(const hold of holds) {
    const nearby=[...botFeet,...holds.filter(other=>other!==hold).map(other=>other.source)];
    const sheltered=spawnRoll()<.7 && nearby.every(other=>Math.hypot(other.x-hold.sheltered.x,other.z-hold.sheltered.z)>.9);
    botFeet.push({... (sheltered?hold.sheltered:hold.source)});
  }
  const arena:Arena={...chunkBounds(chunk),native:map.collision,solids:[],lanes,seed,design:chunk.name,
    roundSetup:{course:course.id,start:start.viewIndex,holds:selected.map(angleIdentity)},
    spawns:{player:{feet,yaw:facing(feet,views[Math.min(start.viewIndex+1,views.length-1)])},bots:holds.map((hold,i)=>{
      const eye={...botFeet[i],y:botFeet[i].y+(selected[i].crouched?46:64)*UNIT},watch=lanes[i].watch!;
      return {feet:botFeet[i],crouched:!!selected[i].crouched,yaw:facing(eye,watch),
        pitch:Math.atan2(watch.y-eye.y,Math.hypot(watch.x-eye.x,watch.z-eye.z)),lane:i};
    })},tactical:{entry:feet,watchPoints:views,
      searchPoints:views.slice(start.viewIndex).map(p=>({...p,y:p.y-64*UNIT})).reverse()}};
  prepareNativeNavigation(arena,baked.courses.flatMap(course=>[...course.starts.map(start=>start.feet),
    ...course.holds.flatMap(hold=>[hold.source,hold.sheltered,hold.lane.edge]),...course.walk]),baked.courses.map(course=>course.walk));
  if(config.manualLineup) {
    const result=validateManualLineup(config.manualLineup,{chunkId:chunk.id,collisionSha256:map.collision.collisionSha256},map.collision);
    if(result.errors.length)throw new Error(result.errors.join(' '));
    if(config.botCount!==config.manualLineup.bots.length)throw new Error('Bot count must match the saved lineup.');
    return applyManualLineup(arena,config.manualLineup);
  }
  return arena;
}

function routeArrows(course:RoundCourse,start:RoundStart):THREE.Group {
  const views=course.walk.map(p=>({...p,y:p.y+64*UNIT})),points:Vec[]=[];
  const first=views.reduce((best,p,index)=>Math.hypot(p.x-start.feet.x,p.z-start.feet.z)<
    Math.hypot(views[best].x-start.feet.x,views[best].z-start.feet.z)?index:best,0);
  for(const point of views.slice(first))if(!points.length||Math.hypot(point.x-points[points.length-1].x,point.z-points[points.length-1].z)>1.35)points.push(point);
  const group=new THREE.Group();group.name='duel-route-arrows';
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.25,0,.22,0,0,-.15,-.12,0,.22, .25,0,.22,.12,0,.22,0,0,-.15],3));
  const material=new THREE.MeshBasicMaterial({color:'#46dbc4',side:THREE.DoubleSide,depthWrite:false,
    polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,transparent:true,opacity:.78});
  const mesh=new THREE.InstancedMesh(geometry,material,Math.max(0,points.length-1)),transform=new THREE.Object3D();
  for(let i=0;i<points.length-1;i++) {
    const p=points[i],next=points[i+1];
    transform.position.set(p.x,p.y-64*UNIT+.035,p.z);transform.rotation.y=facing(p,next);
    transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
  }
  mesh.instanceMatrix.needsUpdate=true;group.add(mesh);return group;
}

async function chunkManifest(chunk:RealMapChunk,signal:AbortSignal) {
  signal.throwIfAborted();
  const base=`/maps/dust2/duel/${chunk.id}/`,manifest=localChunkManifest(chunk.id);
  if(manifest.version!==1 || manifest.id!==chunk.id || manifest.map!==catalog.map || manifest.routeId!==chunk.routeId ||
    JSON.stringify(manifest.sourceMin)!==JSON.stringify(chunk.sourceMin) || JSON.stringify(manifest.sourceMax)!==JSON.stringify(chunk.sourceMax) ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceCollisionSha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.collisionManifestSha256) || !/^[a-f0-9]{64}$/.test(manifest.visualManifestSha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.navigationSha256))
    throw new Error('Map chunk metadata does not match the selected course.');
  const delivery:MapDelivery|undefined=manifest.delivery
    ? validateDelivery(JSON.parse(new TextDecoder().decode(await fetchDeliveredAsset(manifest.delivery,signal)))):undefined;
  return {base,manifest,delivery};
}
export async function loadRealMapChunk(chunk:RealMapChunk,signal:AbortSignal,background=false) {
  const {base,manifest,delivery}=await chunkManifest(chunk,signal);
  const read=async(name:string)=>{
    if(delivery?.files[name])return fetchDeliveredAsset(delivery.files[name],signal);
    const response=await fetch(base+name,{signal});if(!response.ok)throw new Error('Map resource unavailable');return response.arrayBuffer();
  };
  const navigationTask=(async()=>{
    const bytes=await read('navigation.json');if(bytes.byteLength>8*1024*1024)throw new Error('Map navigation exceeds loading budget');
    await verifyMapDigest(bytes,manifest.navigationSha256);return JSON.parse(new TextDecoder().decode(bytes));
  })();
  const radarTask=manifest.radar?(async()=>{
    const bytes=await read('radar.json');await verifyMapDigest(bytes,manifest.radar.sha256);
    const radar=JSON.parse(new TextDecoder().decode(bytes));
    const imageBytes=await read('radar.png');await verifyMapDigest(imageBytes,radar.imageSha256);return {radar,imageBytes};
  })():undefined;
  const roundTask=delivery?.files['round-data.json']?read('round-data.json').then(bytes=>JSON.parse(new TextDecoder().decode(bytes)) as BakedChunk):undefined;
  void navigationTask.catch(()=>{});void radarTask?.catch(()=>{});void roundTask?.catch(()=>{});
  // Distant context is one shared, visual-only decode, never another collision
  // world. Own its lease even if the precise chunk fails or is cancelled.
  const contextTask=loadMapContext(signal).catch(()=>undefined);
  const map=await loadDust2(signal,{base,visibility:!!delivery?.files['visibility.bin'],delivery,background,hashes:{'collision.json':manifest.collisionManifestSha256,'visual.json':manifest.visualManifestSha256}})
    .catch(async error=>{(await contextTask)?.dispose();throw error;});
  try {
    const context=await contextTask;
    if(context) {
      const dispose=map.dispose.bind(map);map.dispose=()=>{context.dispose();dispose();};
      context.attach(map.scene,chunkRenderBounds(chunk));
    }
    if(roundTask) {
      const rounds=await roundTask;
      if(rounds.collisionSha256!==map.collision.collisionSha256||!Array.isArray(rounds.courses)||!rounds.courses.length)
        throw new Error('Round setup does not match the downloaded map');
      chunkRounds.set(map,rounds);
    }
    if(radarTask) {
      const {radar,imageBytes}=await radarTask;
      if(radar.version!==1 || radar.collisionSha256!==map.collision.collisionSha256 || radar.image!=='radar.png' ||
        !Array.isArray(radar.layers) || !radar.layers.length || radar.layers.length>64)throw new Error('Invalid map overview');
      const image=await createImageBitmap(new Blob([imageBytes],{type:'image/png'}));
      if(signal.aborted){image.close();signal.throwIfAborted();}
      overviews.set(map,{image,bounds:radar.bounds,layers:radar.layers});
      const dispose=map.dispose.bind(map);map.dispose=()=>{overviews.delete(map);image.close();dispose();};
    }
    signal.throwIfAborted();
    installNativeNavigation({...chunkBounds(chunk),solids:[],native:map.collision},await navigationTask);
    return map;
  }catch(error){map.dispose();throw error;}
}

// The last chunk is retained, detached, for the previous fight's replay. At most
// two history chunks plus one prepared next chunk survive on capable devices.
// Only the active one is rendered/simulated; constrained devices prefetch bytes.
export class RealMapSession implements DuelScenario {
  readonly kind='duel-map' as const;
  readonly scene=new THREE.Group();
  private arrows:THREE.Group;
  private disposed=false;
  private previous?:PrefireMap;
  private previousChunk?:RealMapChunk;
  private viewedMap?:PrefireMap;
  private prefetchAbort?:AbortController;
  private prefetchId?:string;
  private readonly prepared=new PreparedRound<PrefireMap>();
  get name(){return this.chunk.name;}
  spawnContext():SpawnContext {return {chunkId:this.chunk.id,collisionSha256:this.map.collision.collisionSha256};}
  validateLineup(lineup:unknown){return validateManualLineup(lineup,this.spawnContext(),this.map.collision);}
  curatedLineup(key:string):ManualLineup {
    const arena=createRealMapArena(this.map,this.chunk,{...this.config,manualLineup:null,realMapCourse:'standard'},0);
    return manualLineupFromArena(this.spawnContext(),arena,key);
  }
  private constructor(private map:PrefireMap,public chunk:RealMapChunk,private config:DuelConfig) {
    this.arrows=new THREE.Group();this.arrows.name='duel-route-arrows';this.arrows.visible=config.routeGuide;
    this.scene.add(map.scene,this.arrows);
  }
  static async load(config:DuelConfig,seed:number,signal:AbortSignal) {
    const chunk=chooseRealMapChunk(config.realMapChunk,seed);
    const map=await loadRealMapChunk(chunk,signal);
    try {signal.throwIfAborted();return new RealMapSession(map,chunk,config);}catch(error){map.dispose();throw error;}
  }
  configureDuel(config:DuelConfig){
    if(config.realMapChunk!==this.config.realMapChunk){this.prefetchAbort?.abort();this.prefetchId=undefined;this.prepared.cancel();}
    this.config=config;this.arrows.visible=config.routeGuide;
  }
  prefetchRound(seed:number,warm?:(scene:THREE.Group,signal:AbortSignal)=>Promise<void>) {
    const device=navigator as Navigator&{deviceMemory?:number;connection?:{saveData?:boolean;effectiveType?:string}};
    const connection=device.connection;
    if(connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType??'')) {
      this.prefetchAbort?.abort();this.prepared.cancel();this.prefetchId=undefined;return;
    }
    const chunk=chooseRealMapChunk(this.config.realMapChunk,seed,this.chunk.id);
    if(chunk.id===this.chunk.id||chunk.id===this.previousChunk?.id||chunk.id===this.prefetchId)return;
    this.prefetchAbort?.abort();const controller=new AbortController();this.prefetchAbort=controller;this.prefetchId=chunk.id;
    if(decodedPreloadAllowed(device)) {
      const pending=this.prepared.start(chunk.id,async signal=>{
        await backgroundTurn(signal);
        const map=await loadRealMapChunk(chunk,signal,true);
        try {await warm?.(map.scene,signal);signal.throwIfAborted();return map;}
        catch(error){map.dispose();throw error;}
      });
      void pending?.catch(()=>{if(this.prefetchId===chunk.id&&!controller.signal.aborted)this.prefetchId=undefined;});
      return;
    }
    // Low-memory devices retain only bounded compressed bytes, not a third scene.
    void chunkManifest(chunk,controller.signal).then(async({delivery})=>{
      if(!delivery)return;
      await prefetchDeliveredAssets([...Object.values(delivery.files),...(delivery.textures?.bundles??[])],controller.signal);
    }).catch(()=>{if(this.prefetchAbort===controller)this.prefetchId=undefined;});
  }
  create(settings:Settings,seed:number) {
    const config=sanitizeDuelConfig({...this.config,arenaScale:1,shortcutProtection:settings.protectShortcuts});
    const arena=createRealMapArena(this.map,this.chunk,config,seed),baked=chunkRounds.get(this.map)!;
    const course=baked.courses.find(course=>course.id===arena.roundSetup!.course);
    const start=course?.starts.find(start=>start.viewIndex===arena.roundSetup!.start);
    const arrows=course&&start?routeArrows(course,start):new THREE.Group();arrows.name='duel-route-arrows';arrows.visible=this.config.routeGuide;
    this.scene.remove(this.arrows);disposeResources([this.arrows]);this.arrows=arrows;this.scene.add(arrows);
    return new DuelSimulation(config,seed,arena,settings.weapon,settings.sidearm,settings.primaryEnabled);
  }
  async stageRound(seed:number,signal:AbortSignal,warm:(scene:THREE.Group,signal:AbortSignal)=>Promise<void>) {
    signal.throwIfAborted();
    const chunk=chooseRealMapChunk(this.config.realMapChunk,seed,this.chunk.id);
    if(chunk.id===this.chunk.id||chunk.id===this.previousChunk?.id)return;
    this.prefetchId=chunk.id;
    this.prepared.start(chunk.id,async preparation=>{
      const map=await loadRealMapChunk(chunk,preparation,true);
      try{await warm(map.scene,preparation);preparation.throwIfAborted();return map;}
      catch(error){map.dispose();throw error;}
    });
    await this.prepared.wait(chunk.id,signal);
  }
  async prepareRound(seed:number,signal:AbortSignal) {
    const chunk=chooseRealMapChunk(this.config.realMapChunk,seed,this.chunk.id);
    if(chunk.id===this.chunk.id)return false;
    if(this.prepared.key!==chunk.id)this.prepared.cancel();
    let map:PrefireMap;
    if(this.previous && this.previousChunk?.id===chunk.id) {
      map=this.previous;this.previous=undefined;this.previousChunk=undefined;
    }else {
      this.previous?.dispose();this.previous=undefined;this.previousChunk=undefined;
      try {map=await this.prepared.take(chunk.id,signal)??await loadRealMapChunk(chunk,signal);}
      catch(error){signal.throwIfAborted();if(this.disposed)throw error;map=await loadRealMapChunk(chunk,signal);}
    }
    try {
      signal.throwIfAborted();if(this.disposed)throw new DOMException('Disposed','AbortError');
      // create() installs the selected baked-course guide immediately after
      // this swap. Do not physically walk an unrelated temporary route here.
      const arrows=new THREE.Group();arrows.name='duel-route-arrows';arrows.visible=this.config.routeGuide;
      const old=this.map,oldArrows=this.arrows,oldChunk=this.chunk;
      this.scene.remove(old.scene,oldArrows);this.map=map;this.viewedMap=undefined;this.chunk=chunk;this.arrows=arrows;
      this.scene.add(map.scene,arrows);disposeResources([oldArrows]);this.previous=old;this.previousChunk=oldChunk;return true;
    }catch(error){map.dispose();throw error;}
  }
  loadingReport(){return this.map.loadStats;}
  updateView(position:Vec){(this.viewedMap??this.map).updateVisibility?.(position);}
  radarOverview(feet:number):RadarOverview|undefined {
    const overview=overviews.get(this.map);if(!overview)return;
    const source=overview.layers.reduce((best,layer)=>Math.abs(layer.feet-feet)<Math.abs(best.feet-feet)?layer:best);
    return {image:overview.image,bounds:overview.bounds,source};
  }
  replayMap(hash?:string) {
    this.previous?.scene.removeFromParent();this.map.scene.removeFromParent();
    const shown=hash && hash===this.previous?.collision.collisionSha256 ? this.previous : this.map;
    this.viewedMap=shown;
    this.scene.add(shown.scene);this.arrows.visible=!hash && this.config.routeGuide;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.prefetchAbort?.abort();this.prepared.cancel();disposeResources([this.arrows]);this.map.dispose();this.previous?.dispose();this.scene.clear();}
}
