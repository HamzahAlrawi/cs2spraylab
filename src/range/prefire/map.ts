import * as THREE from 'three';
import {GLTFLoader, type GLTF, type GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {NativeMapCollision, type NativeCollisionManifest,type PreparedNativeQueries} from './native-collision';
import {disposeResources} from '../duel/render-resources';
import type {Vec} from '../actor-physics';
import type {SourcePoint} from './schema';
import {NativeVisibility} from './native-visibility.mjs';
import {placePrefireTarget} from './placement';
import {createLoadScope, createTaskLimiter, loadBounded, validateMapResources, validateTexturePack, verifyMapDigest, type MapResource} from './map-loading';
import {SharedBitmapCache} from './bitmap-cache';
import {fetchDeliveredAsset,type MapDelivery} from './asset-delivery';
import {prepareCollision} from './collision-preparation';
import {backgroundTurn,backgroundBudget} from './background-work';
import {releasePreparedLighting} from './lighting';
import {compileRetainedShaders} from '../shader-warmup';
type DecodedTexture={width:number;height:number;texture:THREE.Texture;close():void};
const sharedBitmaps = new SharedBitmapCache<DecodedTexture>();

export type PrefireMap = {scene: THREE.Group; collision: NativeMapCollision; settle(point: SourcePoint): Vec; updateVisibility?(point: Vec): void;
  residentBytes?:number;loadStats?: {decodedFresh: number; decodedReused: number; milliseconds: number; warmBudgetBytes: number}; dispose(): void};
export function settleNativePosition(collision: NativeMapCollision, point: SourcePoint): Vec {
  return placePrefireTarget(collision, point);
}
// Parent calls after attaching the map and configuring the actual scene lights.
export async function compileMapShaders(renderer: Pick<THREE.WebGLRenderer,'compileAsync'>, scene: THREE.Scene,
  camera: THREE.Camera, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await compileRetainedShaders(renderer,scene,camera);
  signal?.throwIfAborted();
}
export type NativeMapLoadOptions = {base: string; visibility?: boolean; hashes?: Record<string,string>;
  delivery?:MapDelivery;background?:boolean; sharedTextureBase?:string};
export async function loadNativeMap(signal: AbortSignal | undefined, options: NativeMapLoadOptions): Promise<PrefireMap> {
  const started = performance.now();
  let decodedFresh = 0, decodedReused = 0;
  const base = options.base;
  if(!/^\/maps\/[a-zA-Z0-9_\-/]+\/$/.test(base))throw Error('Invalid native map asset base.');
  const scope = createLoadScope(signal), network = createTaskLimiter(4), decode = createTaskLimiter(options?.background?1:4);
  const resourceWork=createTaskLimiter(1),resourceTurn=backgroundBudget(scope.signal);
  const fetchChecked = async (name: string) => {
    scope.signal.throwIfAborted();
    const delivered=options?.delivery?.files[name];
    if(delivered)return new Response(await fetchDeliveredAsset(delivered,scope.signal));
    const response = await fetch(base + name, {signal:scope.signal});
    if (!response.ok) throw new Error('Native map assets are unavailable. Rebuild the selected map package.');
    return response;
  };
  const scene = new THREE.Group();
  let collision: NativeMapCollision | undefined;
  let collisionTask:Promise<void>|undefined;
  const decodedImages = new Set<ImageBitmap>();
  const decodedSources = new Map<string, Promise<THREE.Texture>>();
  const sharedImages=new Set<ImageBitmap>(),leases=new Map<string,ReturnType<typeof sharedBitmaps.acquire>>();
  const releaseLeases=()=>{for(const lease of leases.values())lease.release();leases.clear();};
  scope.signal.addEventListener('abort',releaseLeases,{once:true});
  const resourceHashes = new Map<string, string>();
  const releaseImage = (image: ImageBitmap) => {if(!sharedImages.has(image))image.close();};
  const resourceUrls = new Map<string,Promise<string>>();
  const urls = new Set<string>();
  const pendingParses = new Set<Promise<unknown>>();
  const orphanTextures = new Set<THREE.Texture>(), orphanMaterials = new Set<THREE.Material>(), orphanGeometry = new Set<THREE.BufferGeometry>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; collision?.dispose();
    releasePreparedLighting(scene);
    scene.traverse(node=>{
      if (!(node instanceof THREE.Mesh)) return;
      orphanGeometry.delete(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        orphanMaterials.delete(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) orphanTextures.delete(value);
      }
    });
    disposeResources([scene]);
    for (const texture of orphanTextures) texture.dispose();
    for (const material of orphanMaterials) material.dispose();
    for (const geometry of orphanGeometry) geometry.dispose();
    for (const image of decodedImages) releaseImage(image); decodedImages.clear(); scene.clear();
    releaseLeases();sharedImages.clear();
  };
  const trackParser = (parser: GLTFParser) => {
    const dependency = parser.getDependency.bind(parser), geometries = parser.loadGeometries.bind(parser), imageSource = parser.loadImageSource.bind(parser);
    const track = <T>(promise: Promise<T>, collect: (value:T)=>void) => {
      const tracked = promise.then(value=>{collect(value); return value;});
      pendingParses.add(tracked);
      tracked.then(()=>pendingParses.delete(tracked),()=>pendingParses.delete(tracked));
      return tracked;
    };
    parser.loadGeometries = (...args) => track(geometries(...args),items=>items.forEach(item=>orphanGeometry.add(item)));
    parser.loadImageSource = (...args) => {
      scope.signal.throwIfAborted();
      const source = parser.json.images?.[args[0]], key = source?.uri;
      let pending = key ? decodedSources.get(key) : undefined;
      if (!pending) {
        const hash = key ? resourceHashes.get(key) : undefined;
        if(hash) {
          let lease=leases.get(hash);
          if(!lease) {
            lease=sharedBitmaps.acquire(hash,async signal=>{
              const texture=await decode(()=>imageSource(...args),signal);
              const image=texture.image as ImageBitmap;
              return {width:image.width,height:image.height,texture,close(){texture.dispose();image.close?.();}};
            });
            leases.set(hash,lease);if(lease.reused)decodedReused++;else decodedFresh++;
          }
          pending=lease.value.then(source=>{
            sharedImages.add(source.texture.image);decodedImages.add(source.texture.image);return source.texture;
          });
        }else {decodedFresh++;pending=decode(()=>imageSource(...args),scope.signal);}
        if (key) decodedSources.set(key,pending);
      }
      // Samplers/UV transforms belong to individual textures; the decoded image can be shared.
      return track(pending.then(texture => texture.clone()),texture=>{
      orphanTextures.add(texture); if (texture.image?.close) decodedImages.add(texture.image);
      });
    };
    parser.getDependency = (type,index) => track(dependency(type,index),value=>{
      if (value instanceof THREE.Texture) {orphanTextures.add(value); if (value.image?.close) decodedImages.add(value.image);}
      if (value instanceof THREE.Material) orphanMaterials.add(value);
    });
    return {name:'SprayLabResourceOwnership'};
  };
  try {
    const names = options?.visibility === false ? ['collision.json','collision.bin','visual.json']
      : ['collision.json','collision.bin','visual.json','visibility.json','visibility.bin'];
    if(options?.delivery?.files['query-cache.json'])names.push('query-cache.json');
    const pendingFiles=new Map(names.map(name=>[name,network(async()=> {
        const response=await fetchChecked(name), bytes=await response.arrayBuffer();
        if(options?.hashes?.[name])await verifyMapDigest(bytes,options.hashes[name]);
        return name.endsWith('.json') ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
      },scope.signal)]));
    // Observe every concurrent request even when an earlier manifest fails.
    const fileDrain=Promise.allSettled([...pendingFiles.values()]);
    void fileDrain;
    const [manifest,visuals]=await Promise.all([pendingFiles.get('collision.json'),pendingFiles.get('visual.json')]);
    collisionTask=(async()=>{
      const binary=await pendingFiles.get('collision.bin');
      await verifyMapDigest(binary,(manifest as NativeCollisionManifest).collisionSha256);
      // Let visual requests reach the network before synchronous query construction.
      await new Promise<void>(resolve=>setTimeout(resolve,0));scope.signal.throwIfAborted();
      const prepared=pendingFiles.has('query-cache.json')?{metadata:await pendingFiles.get('query-cache.json') as PreparedNativeQueries}:undefined;
      collision=await prepareCollision(manifest,binary,prepared?.metadata,scope.signal);scope.signal.throwIfAborted();
    })();
    void collisionTask.catch(error=>scope.abort(error));
    const visibilityTask=options?.visibility===false?undefined:Promise.all([
      pendingFiles.get('visibility.json'),pendingFiles.get('visibility.bin')]).then(([metadata,bytes])=>
        new NativeVisibility(metadata,new Uint8Array(bytes)));
    void visibilityTask?.catch(error=>scope.abort(error));
    const visibleMeshes: {mesh: THREE.Mesh; clusters: number[]}[] = [];
    if (visuals.version !== 2 || !Array.isArray(visuals.files) || !visuals.files.length || visuals.files.length > 64 ||
      new Set(visuals.files).size !== visuals.files.length || visuals.files.some((file:string) => !/^visual-\d+\.gltf$/.test(file))) throw new Error('Native map visuals need rebuilding.');
    const inventory = validateMapResources(visuals.resources as MapResource[]);
    const texturePack=validateTexturePack(visuals.texturePack,inventory);
    const packedImages=new Map(texturePack?.images.map(image=>[image.name,image]));
    const sharedImagesInventory=new Map(options?.delivery?.textures?.images.map(image=>[image.name,image]));
    const sharedPacks=new Map<number,Promise<ArrayBuffer>>();
    let packBytes:Promise<ArrayBuffer>|undefined;
    const packedBytes=()=>packBytes??=network(async()=>{
      const bytes=await (await fetchChecked(texturePack!.name)).arrayBuffer();
      if(bytes.byteLength!==texturePack!.bytes)throw new Error('Texture pack size mismatch');
      await verifyMapDigest(bytes,texturePack!.sha256);scope.signal.throwIfAborted();return bytes;
    },scope.signal);
    const textureBase=options?.visibility===false && options.sharedTextureBase && visuals.textureBase===options.sharedTextureBase ? visuals.textureBase : undefined;
    const resourceUrl = (name:string): Promise<string> => {
      const existing = resourceUrls.get(name); if (existing) return existing;
      const resource = inventory.get(name);
      if (!resource) return Promise.reject(new Error('Unlisted native map resource'));
      const packed=packedImages.get(name);
      const shared=sharedImagesInventory.get(name);
      const read=shared ? async()=>{
        let pending=sharedPacks.get(shared.bundle);
        if(!pending){pending=network(()=>fetchDeliveredAsset(options!.delivery!.textures!.bundles[shared.bundle],scope.signal),scope.signal);sharedPacks.set(shared.bundle,pending);}
        const bytes=await pending;return bytes.slice(shared.offset,shared.offset+shared.length);
      }:packed ? async()=>{
        const bytes=await packedBytes();return bytes.slice(packed.offset,packed.offset+packed.length);
      }:()=>network(async()=>{
        const response = textureBase && name.endsWith('.webp')
          ? await fetch(textureBase+name,{signal:scope.signal}) : await fetchChecked(name);
        if(!response.ok)throw new Error('Native map texture unavailable.');
        return response.arrayBuffer();
      },scope.signal);
      const pending = (async()=>{
        const bytes=await read();
        if (bytes.byteLength !== resource.bytes) throw new Error('Map resource size mismatch');
        await verifyMapDigest(bytes,resource.sha256); scope.signal.throwIfAborted();
        const url = await resourceWork(async()=>{
          if(options?.background)await resourceTurn();
          return URL.createObjectURL(new Blob([bytes],{type:name.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'}));
        },scope.signal);
        resourceHashes.set(url,resource.sha256);
        urls.add(url); return url;
      })();
      resourceUrls.set(name,pending); return pending;
    };
    const textures = new Map<string, THREE.Texture>();
    const assets = await loadBounded(visuals.files as string[],options?.background?1:2,async(file,_index,workerSignal): Promise<GLTF> => {
      try {
      const bytes = await network(async()=> (await fetchChecked(file)).arrayBuffer(),scope.signal);
      if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Map sector exceeds loading budget');
      if (visuals.fileHashes?.[file]) await verifyMapDigest(bytes,visuals.fileHashes[file]);
      const json = JSON.parse(new TextDecoder().decode(bytes));
      const references: {uri:string}[] = [...(json.buffers ?? []),...(json.images ?? [])].filter(reference=>
        !(reference.uri === undefined && reference.extensions?.EXT_meshopt_compression?.fallback));
      await Promise.all(references.map(async reference=>{reference.uri = await resourceUrl(reference.uri);}));
      workerSignal.throwIfAborted(); scope.signal.throwIfAborted();
      if(options?.background)await backgroundTurn(scope.signal);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(trackParser);
      const asset = await loader.parseAsync(JSON.stringify(json),base);
      // Own the scene before validation/cancellation so late completion is freed.
      scene.add(asset.scene); workerSignal.throwIfAborted(); scope.signal.throwIfAborted();
      if ((await asset.parser.getDependencies('texture')).some(texture=>!texture)) throw new Error('Native map texture decoding failed');
      asset.scene.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const material = node.material as THREE.MeshStandardMaterial;
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
          const texture = material[slot];
          if (!texture) continue;
          if (texture.image?.close) decodedImages.add(texture.image);
          const materialIndex = asset.parser.associations.get(material)?.materials;
          const materialDef = asset.parser.json.materials[materialIndex!];
          const textureDef = slot === 'map' ? materialDef.pbrMetallicRoughness?.baseColorTexture
            : slot === 'roughnessMap' || slot === 'metalnessMap' ? materialDef.pbrMetallicRoughness?.metallicRoughnessTexture
            : slot === 'aoMap' ? materialDef.occlusionTexture : slot === 'normalMap' ? materialDef.normalTexture : materialDef.emissiveTexture;
          const index = textureDef?.index;
          if (index === undefined) throw new Error('Missing native map texture association.');
          const definition = asset.parser.json.textures[index];
          const imageIndex = definition.extensions?.EXT_texture_webp?.source ?? definition.source;
          const imageUri = asset.parser.json.images[imageIndex].uri;
          const key = JSON.stringify([imageUri, texture.colorSpace, texture.channel, texture.wrapS, texture.wrapT, texture.repeat.toArray(), texture.offset.toArray(), texture.rotation]);
          const shared = textures.get(key);
          if (!shared) {textures.set(key, texture); texture.anisotropy = 2;}
          else if (shared !== texture) {
            texture.dispose(); orphanTextures.delete(texture); material[slot] = shared;
          }
        }
        if (material.userData.nativeOverlay) {
          material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
          material.depthWrite = false; node.renderOrder = 1;
        }
        if(!node.geometry.boundingSphere)node.geometry.computeBoundingSphere();
        const clusters: number[] = node.userData.nativeClusters ?? node.parent?.userData.nativeClusters ?? [0];
        visibleMeshes.push({mesh: node, clusters});
      });
      return asset;
      } catch (error) {scope.abort(error); throw error;}
    },scope.signal);
    // Preserve manifest scene order even when sectors finish out of order.
    for (const asset of assets) scene.add(asset.scene);
    const visibility=await visibilityTask;
    if(visibility&&visibleMeshes.some(({clusters})=>clusters.some(cluster=>!Number.isInteger(cluster)||cluster<0||
      cluster>=visibility.metadata.m_nBaseClusterCount)))throw new Error('Invalid native mesh visibility clusters.');
    await collisionTask;
    // Texture clones may share an ImageBitmap across UV channels. Never close
    // it while another texture still needs its first GPU upload.
    const retainedImages = new Set([...textures.values()].map(texture => texture.image));
    for (const image of decodedImages) if (!retainedImages.has(image)) {releaseImage(image); decodedImages.delete(image);}
    scene.updateMatrixWorld(true);
    scene.traverse(node => {node.updateMatrix(); node.matrixAutoUpdate = false;node.matrixWorldAutoUpdate=false;});
    const retainedGeometry = new Set<THREE.BufferGeometry>(), retainedMaterials = new Set<THREE.Material>(), retainedTextures = new Set<THREE.Texture>();
    scene.traverse(node=>{
      if (!(node instanceof THREE.Mesh)) return;
      retainedGeometry.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        retainedMaterials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) retainedTextures.add(value);
      }
    });
    for (const texture of orphanTextures) if (!retainedTextures.has(texture)) texture.dispose();
    for (const material of orphanMaterials) if (!retainedMaterials.has(material)) material.dispose();
    for (const geometry of orphanGeometry) if (!retainedGeometry.has(geometry)) geometry.dispose();
    orphanTextures.clear(); orphanMaterials.clear(); orphanGeometry.clear();
    const loadedCollision = collision!;
    const buffers=new Set<ArrayBufferLike>();
    for(const geometry of retainedGeometry){
      if(geometry.index)buffers.add(geometry.index.array.buffer);
      for(const attribute of Object.values(geometry.attributes))buffers.add('data' in attribute?attribute.data.array.buffer:attribute.array.buffer);
    }
    const images=new Set([...retainedTextures].map(texture=>texture.image as {width:number;height:number}));
    const residentBytes=[...buffers].reduce((sum,buffer)=>sum+buffer.byteLength*2,0)+
      [...images].reduce((sum,image)=>sum+(image.width||1)*(image.height||1)*4*4/3,0)+
      (await pendingFiles.get('collision.bin') as ArrayBuffer).byteLength*6;
    let lastKey = 'unset';
    return {scene, collision:loadedCollision,residentBytes, settle: point => settleNativePosition(loadedCollision, point),
      loadStats: {decodedFresh, decodedReused, milliseconds: performance.now() - started, warmBudgetBytes: 32 * 1024 * 1024},
      updateVisibility(point) {
        if (!visibility) return;
        const row = visibility.pointRow([point.x / .0254, -point.z / .0254, point.y / .0254]);
        if (lastKey === visibility.key) return;
        lastKey = visibility.key;
        for (const {mesh, clusters} of visibleMeshes) mesh.visible = NativeVisibility.visible(clusters, row);
      },
      dispose};
  } catch (error) {
    scope.abort(error);
    if(collisionTask)await Promise.allSettled([collisionTask]);
    while (pendingParses.size) await Promise.allSettled([...pendingParses]);
    await Promise.allSettled([...resourceUrls.values()]);
    dispose(); throw error;
  } finally {
    scope.signal.removeEventListener('abort',releaseLeases);
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear(); resourceUrls.clear(); decodedSources.clear(); scope.dispose();
  }
}

/** @deprecated Compatibility for old extraction/audit tools, never used by map selection. */
export async function loadDust2(signal?:AbortSignal, options?:NativeMapLoadOptions):Promise<PrefireMap> {
  const {dust2Map} = await import('./maps/dust2');
  return loadNativeMap(signal,{base:dust2Map.base,sharedTextureBase:dust2Map.sharedTextureBase,...options});
}
