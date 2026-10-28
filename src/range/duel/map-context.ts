import {Box3,Matrix4,Material,Mesh,Texture,Vector3,type Object3D} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {fetchDeliveredAsset,validDeliveredAsset} from '../prefire/asset-delivery';
import {localMapContextManifest} from './map-manifests';

export type ContextBounds={min:readonly number[];max:readonly number[]};
export type MapContext={readonly root:Object3D;attach(parent:Object3D,renderBounds:ContextBounds):void;dispose():void};
const base='/maps/dust2/duel/context/';
const vertexMarker='#include <project_vertex>',fragmentMarker='#include <clipping_planes_fragment>';

function validateBounds(bounds:ContextBounds) {
  if(!bounds || bounds.min.length!==3 || bounds.max.length!==3 ||
    bounds.min.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(bounds.max[i])||v>=bounds.max[i]))throw Error('Invalid context renderBounds');
}

// Both tests and shader use world metres, not Source units or actor-local space.
export function contextContains(point:Vector3,bounds:ContextBounds) {
  validateBounds(bounds);
  return bounds.min.every((min,i)=>point.getComponent(i)>=min && point.getComponent(i)<=bounds.max[i]);
}

function clipMaterial(material:Material,min:Vector3,max:Vector3) {
  const atlas=material.userData.duelContextAtlas as {size:number;tileSize:number;gutter:number}|undefined;
  material.polygonOffset=true;material.polygonOffsetFactor=1;material.polygonOffsetUnits=1;
  material.onBeforeCompile=shader=>{
    if(!shader.vertexShader.includes(vertexMarker)||!shader.fragmentShader.includes(fragmentMarker))throw Error('Unsupported context shader');
    shader.uniforms.duelContextMin={value:min};shader.uniforms.duelContextMax={value:max};
    shader.vertexShader='varying vec3 duelContextWorld;\n'+shader.vertexShader.replace(vertexMarker,
      vertexMarker+'\nduelContextWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader='varying vec3 duelContextWorld;\nuniform vec3 duelContextMin;\nuniform vec3 duelContextMax;\n'+
      shader.fragmentShader.replace(fragmentMarker,fragmentMarker+
        '\nif(all(greaterThanEqual(duelContextWorld,duelContextMin))&&all(lessThanEqual(duelContextWorld,duelContextMax))) discard;');
    if(atlas) {
      shader.uniforms.duelContextAtlas={value:new Vector3(atlas.size,atlas.tileSize,atlas.gutter)};
      shader.vertexShader='attribute vec4 _context_tile;\nvarying vec4 duelContextTile;\n'+shader.vertexShader.replace(vertexMarker,
        vertexMarker+'\nduelContextTile=_context_tile;');
      shader.fragmentShader='varying vec4 duelContextTile;\nuniform vec3 duelContextAtlas;\n'+shader.fragmentShader.replace('#include <map_fragment>',`
        vec2 contextUV=fract(vMapUv);
        if(duelContextTile.z>1.5)contextUV.x=1.0-abs(mod(vMapUv.x,2.0)-1.0);
        else if(duelContextTile.z>.5)contextUV.x=clamp(vMapUv.x,0.0,1.0);
        if(duelContextTile.w>1.5)contextUV.y=1.0-abs(mod(vMapUv.y,2.0)-1.0);
        else if(duelContextTile.w>.5)contextUV.y=clamp(vMapUv.y,0.0,1.0);
        float contextInner=duelContextAtlas.y-2.0*duelContextAtlas.z;
        if(duelContextTile.z>.5)contextUV.x=clamp(contextUV.x,.5/contextInner,1.0-.5/contextInner);
        if(duelContextTile.w>.5)contextUV.y=clamp(contextUV.y,.5/contextInner,1.0-.5/contextInner);
        vec2 contextAtlasUV=duelContextTile.xy+(vec2(duelContextAtlas.z)+contextUV*contextInner)/duelContextAtlas.x;
        diffuseColor*=textureGrad(map,contextAtlasUV,dFdx(vMapUv)*contextInner/duelContextAtlas.x,dFdy(vMapUv)*contextInner/duelContextAtlas.x);
      `);
    }
  };
  material.customProgramCacheKey=()=> atlas?'duel-distant-context-atlas-v2':'duel-distant-context-v1';
}

async function loadAsset(signal:AbortSignal):Promise<Object3D> {
  signal.throwIfAborted();
  const metadata=localMapContextManifest();
  if(![1,2].includes(metadata.version)||metadata.map!=='dust2'||metadata.visualOnly!==true||!validDeliveredAsset(metadata.delivery)||
    metadata.delivery.decodedBytes>5_000_000||metadata.delivery.decodedSha256!==metadata.sha256)throw Error('Invalid native context delivery');
  const bytes=await fetchDeliveredAsset(metadata.delivery,signal);signal.throwIfAborted();
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes,base)).scene;
}

function releaseAsset(root:Object3D) {
  const geometry=new Set<Mesh['geometry']>(),materials=new Set<Material>(),textures=new Set<Texture>();
  root.traverse(node=>{if(node instanceof Mesh) {
    geometry.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])materials.add(material);
  }});
  for(const material of materials)for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);
  geometry.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());
  textures.forEach(value=>{value.dispose();value.source.data?.close?.();});
}

/** One cached decode across chunks. Each lease has its own bounds/materials;
 * geometries/textures stay shared. Attach only to an identity-world render parent,
 * never to the collision map, radar bake root, or gameplay raycast collection.
 * Dispose leases on chunk eviction; clear the cache on session teardown. */
export class MapContextCache {
  private entry?:{promise:Promise<Object3D>;controller:AbortController;waiters:number;settled:boolean};
  private leases=0;
  private clearing=false;
  constructor(private readonly loader:(signal:AbortSignal)=>Promise<Object3D>=loadAsset) {}
  async load(signal?:AbortSignal):Promise<MapContext> {
    signal?.throwIfAborted();if(this.clearing)throw Error('Context cache is clearing');
    if(!this.entry) {
      const controller=new AbortController(),entry={controller,waiters:0,settled:false,promise:undefined as unknown as Promise<Object3D>};
      entry.promise=Promise.resolve().then(()=>this.loader(controller.signal)).then(source=>{
        if(controller.signal.aborted){releaseAsset(source);controller.signal.throwIfAborted();}
        entry.settled=true;return source;
      }).catch(error=>{if(this.entry===entry)this.entry=undefined;throw error;});
      this.entry=entry;
    }
    const entry=this.entry;entry.waiters++;
    let abort:()=>void=()=>{};
    const cancelled=new Promise<never>((_resolve,reject)=>{
      abort=()=>reject(signal?.reason??new DOMException('Context cancelled','AbortError'));
      signal?.addEventListener('abort',abort,{once:true});
    });
    let source:Object3D;
    try {source=await Promise.race([entry.promise,cancelled]);signal?.throwIfAborted();}
    finally {
      signal?.removeEventListener('abort',abort);entry.waiters--;
      if(!entry.settled&&!entry.waiters){entry.controller.abort();if(this.entry===entry)this.entry=undefined;}
    }
    if(this.clearing||this.entry!==entry)throw Error('Context cache is clearing');
    const root=source.clone(true),materials=new Map<Material,Material>(),meshBounds=new Map<Mesh,Box3>();
    const min=new Vector3(),max=new Vector3();let disposed=false;
    root.name='duel-distant-native-context';root.visible=false;root.userData.visualOnly=true;root.userData.nativeContext=true;
    root.traverse(node=>{if(node instanceof Mesh) {
      node.castShadow=false;node.receiveShadow=false;node.frustumCulled=true;node.raycast=()=>{};node.userData.nativeContext=true;
      const array=Array.isArray(node.material);
      const cloned=(array?node.material as Material[]:[node.material as Material]).map(original=>{
        const cached=materials.get(original);if(cached)return cached;
        const material:Material=original.clone();clipMaterial(material,min,max);materials.set(original,material);return material;
      });
      node.material=array?cloned:cloned[0];
    }});
    root.updateWorldMatrix(true,true);
    root.traverse(node=>{if(node instanceof Mesh) {
      if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
      meshBounds.set(node,node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld));
    }});
    this.leases++;
    return {root,attach(parent,bounds) {
      if(disposed)throw Error('Context lease disposed');validateBounds(bounds);
      parent.updateWorldMatrix(true,false);
      const identity=new Matrix4();
      if(!parent.matrixWorld.equals(identity))throw Error('Context parent must preserve native world coordinates');
      min.fromArray(bounds.min);max.fromArray(bounds.max);
      const cutout=new Box3(min,max);
      for(const [mesh,box] of meshBounds)mesh.visible=!cutout.containsBox(box);
      parent.add(root);root.visible=true;
    },dispose:()=>{
      if(disposed)return;disposed=true;root.removeFromParent();materials.forEach(value=>value.dispose());this.leases--;
    }};
  }
  async dispose() {
    if(this.leases)throw Error('Dispose context leases before clearing cache');
    if(this.clearing)throw Error('Context cache is already clearing');
    this.clearing=true;
    const entry=this.entry;this.entry=undefined;entry?.controller.abort();
    try {if(entry)releaseAsset(await entry.promise);}catch(error){
      if(!entry?.controller.signal.aborted)throw error;
    }finally{this.clearing=false;}
  }
}

const cache=new MapContextCache();
export const loadMapContext=(signal?:AbortSignal)=>cache.load(signal);
export const disposeMapContextCache=()=>cache.dispose();
