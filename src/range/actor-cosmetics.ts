import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import data from './actor-cosmetics-data.json';

export type ActorCosmeticDefinition = Readonly<{
  id: string; label: string; equipment: 'gloves' | 'agent'; category: 'gloves' | 'agent';
  price: number; unlockLevel: number; imageUrl: string; assetKey: string; modelUrl: string;
  source: string; sourceSha256: string; assetSha256: string; rendering: string;
}>;
export type ActorCosmeticCatalog = readonly Readonly<{
  id: string; equipment: string; assetKey?: string; modelUrl?: string;
}>[];
export type ActorCosmeticProfile = Readonly<{equipped: Readonly<Record<string, string>>}>;
export const actorCosmetics = data.cosmetics as readonly ActorCosmeticDefinition[];

export interface ActorCosmeticInstance {
  readonly scene: THREE.Object3D;
  readonly animations: THREE.AnimationClip[];
  /** Detach and dispose only this instance. Cached assets and other clones survive. */
  dispose(): void;
}

function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  geometries.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
  skeletons.forEach(value => value.dispose());
}

/** Independent GPU resources make existing engine disposal routines safe. */
function cloneOwned(source: Pick<GLTF, 'scene' | 'animations'>): ActorCosmeticInstance {
  const scene = cloneSkeleton(source.scene);
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materials = new Map<THREE.Material, THREE.Material>(), textures = new Map<THREE.Texture, THREE.Texture>();
  const copyMaterial = (original: THREE.Material) => {
    let material = materials.get(original);
    if (material) return material;
    material = original.clone();
    const properties = material as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(original)) {
      if (!(value instanceof THREE.Texture)) continue;
      let texture = textures.get(value);
      if (!texture) {texture = value.clone(); textures.set(value, texture);}
      properties[key] = texture;
    }
    materials.set(original, material);
    return material;
  };
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    let geometry = geometries.get(object.geometry);
    if (!geometry) {const copy = object.geometry.clone(); geometries.set(object.geometry, copy); geometry = copy;}
    object.geometry = geometry;
    object.material = Array.isArray(object.material) ? object.material.map(copyMaterial) : copyMaterial(object.material);
  });
  let disposed = false;
  return {scene, animations: source.animations.map(clip => clip.clone()), dispose() {
    if (disposed) return;
    disposed = true; scene.removeFromParent(); disposeScene(scene);
  }};
}

/** LRU stores at most two chosen templates, not the entire shop's models. */
export class ActorCosmeticLoader {
  private readonly cache = new Map<string, GLTF>();
  private readonly pending = new Map<string, Promise<GLTF>>();
  private disposed = false;
  constructor(private readonly loader: Pick<GLTFLoader, 'loadAsync'> = new GLTFLoader(), private readonly capacity = 2) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) throw new Error('Actor cache capacity must be 1..8');
  }
  get cachedCount() {return this.cache.size;}
  async load(id: string, catalog: ActorCosmeticCatalog = actorCosmetics): Promise<ActorCosmeticInstance> {
    if (this.disposed) throw new Error('Actor cosmetic loader is disposed');
    const entry = catalog.find(item => item.id === id && (item.equipment === 'gloves' || item.equipment === 'agent'));
    if (!entry?.assetKey || !/^(agent|gloves)-[a-z0-9-]+$/.test(entry.assetKey)) throw new Error(`Unknown actor cosmetic: ${id}`);
    const url = `/models/${entry.assetKey}.glb`;
    if (entry.modelUrl && entry.modelUrl !== url) throw new Error('Actor models must use their local asset key');
    let source = this.cache.get(url);
    if (source) {this.cache.delete(url); this.cache.set(url, source);}
    else {
      let request = this.pending.get(url);
      if (!request) {
        request = this.loader.loadAsync(url).then(result => {
          if (this.disposed) {disposeScene(result.scene); throw new Error('Actor cosmetic loader is disposed');}
          this.cache.set(url, result);
          for (const [key, value] of this.cache) {
            if (this.cache.size <= this.capacity) break;
            this.cache.delete(key); disposeScene(value.scene);
          }
          return result;
        }).finally(() => this.pending.delete(url));
        this.pending.set(url, request);
      }
      source = await request;
    }
    if (this.disposed) throw new Error('Actor cosmetic loader is disposed');
    return cloneOwned(source);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cache.forEach(value => disposeScene(value.scene)); this.cache.clear();
  }
}

const defaultLoader = new ActorCosmeticLoader();

/** Parent supplies shared duel-motion clips and attaches a gun directly to wpn. */
export async function loadAgent(id: string, catalog: ActorCosmeticCatalog = actorCosmetics, loader = defaultLoader) {
  if (!catalog.some(entry => entry.id === id && entry.equipment === 'agent')) throw new Error(`Unknown agent: ${id}`);
  return loader.load(id, catalog);
}

export interface GloveApplication {
  readonly id: string;
  readonly meshes: readonly THREE.SkinnedMesh[];
  /** Call before disposing/replacing the view assembly. Restores default hands. */
  dispose(): void;
}

/** No new animated bones: native inverse binds address the current view rig. */
export function bindGloves(root: THREE.Object3D, source: ActorCosmeticInstance, id: string): GloveApplication {
  const bones = new Map<string, THREE.Bone>(), defaults: THREE.Mesh[] = [], meshes: THREE.SkinnedMesh[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Bone) bones.set(object.name, object);
    if (object instanceof THREE.Mesh && /firstperson.*(?:default_gloves|gloves_arms)/i.test(object.name) &&
      !object.userData.actor_cosmetic) defaults.push(object);
  });
  source.scene.traverse(object => {if (object instanceof THREE.SkinnedMesh) meshes.push(object);});
  if (!defaults.length || !meshes.length) throw new Error('Native skinned first-person hands are required for glove replacement');
  for (const mesh of meshes) for (const bone of mesh.skeleton.bones) {
    if (!bones.has(bone.name)) throw new Error(`View assembly is missing native glove bone ${bone.name}`);
  }
  const originals = new Set(meshes.map(mesh => mesh.skeleton));
  const container = new THREE.Group(); container.name = `cosmetic_${id}`;
  source.scene.updateMatrixWorld(true);
  for (const mesh of meshes) {
    const original = mesh.skeleton, bind = mesh.bindMatrix.clone();
    const matrix = new THREE.Matrix4().copy(source.scene.matrixWorld).invert().multiply(mesh.matrixWorld);
    mesh.removeFromParent(); container.add(mesh);
    matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.bind(new THREE.Skeleton(original.bones.map(bone => bones.get(bone.name)!), original.boneInverses.map(value => value.clone())), bind);
    mesh.frustumCulled = false;
    mesh.userData.actor_cosmetic = id;
  }
  originals.forEach(skeleton => skeleton.dispose());
  const visibility = defaults.map(mesh => mesh.visible);
  defaults.forEach(mesh => {mesh.visible = false;}); root.add(container);
  let disposed = false;
  return {id, meshes, dispose() {
    if (disposed) return;
    disposed = true; container.removeFromParent(); disposeScene(container); source.dispose();
    defaults.forEach((mesh, index) => {mesh.visible = visibility[index];});
  }};
}

const applications = new WeakMap<THREE.Object3D, {revision: number; handle?: GloveApplication}>();

/** Defaults are represented by no chosen native cosmetic; no asset is fetched. */
export async function applyGloves(root: THREE.Object3D, selection: ActorCosmeticProfile | string | null | undefined,
  catalog: ActorCosmeticCatalog = actorCosmetics, loader = defaultLoader): Promise<GloveApplication | undefined> {
  const state = applications.get(root) ?? {revision: 0}; applications.set(root, state);
  const revision = ++state.revision;
  const id = typeof selection === 'string' ? selection : selection?.equipped.gloves;
  if (!id || !catalog.some(entry => entry.id === id && entry.equipment === 'gloves' && entry.assetKey)) {
    state.handle?.dispose(); state.handle = undefined; return;
  }
  if (state.handle?.id === id) return state.handle;
  const source = await loader.load(id, catalog);
  if (revision !== state.revision) {source.dispose(); return;}
  let handle: GloveApplication;
  // Validate before retiring the currently worn pair.
  const names = new Set<string>(); root.traverse(object => {if (object instanceof THREE.Bone) names.add(object.name);});
  let missing: string | undefined;
  source.scene.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) for (const bone of object.skeleton.bones) if (!names.has(bone.name)) missing = bone.name;
  });
  if (missing) {source.dispose(); throw new Error(`View assembly is missing native glove bone ${missing}`);}
  state.handle?.dispose(); state.handle = undefined;
  try {handle = bindGloves(root, source, id);} catch (error) {source.dispose(); throw error;}
  const dispose = handle.dispose;
  handle = {...handle, dispose() {
    dispose();
    if (state.handle === handle) {state.handle = undefined; state.revision++;}
  }};
  state.handle = handle; return handle;
}

/** Cancels pending selection, detaches replacements, restores native defaults. */
export function disposeGloves(root: THREE.Object3D) {
  const state = applications.get(root);
  if (!state) return;
  state.revision++; state.handle?.dispose(); state.handle = undefined;
}
