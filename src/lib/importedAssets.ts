import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { WeaponId } from '../types';

export type ImportedWeaponAsset = {
  id: 'ak47' | 'm4a1';
  fbxUrl: string;
  baseColorUrl: string;
  normalUrl?: string;
  roughnessUrl?: string;
  metalnessUrl?: string;
  targetLength: number;
  firstPersonPosition: [number, number, number];
  firstPersonRotation: [number, number, number];
  isSuppressed?: boolean;
};

export const importedMapAssets = {
  floorColor: '/concrete2/Concrete012_1K-JPG_Color.jpg',
  floorNormal: '/concrete2/Concrete012_1K-JPG_NormalGL.jpg',
  floorRoughness: '/concrete2/Concrete012_1K-JPG_Roughness.jpg',
  wallColor: '/concretewall/textures/concrete_wall_006_diff_4k.jpg',
  indoorPreview: '/morenvironments/IndoorEnvironmentHDRI018_1K_TONEMAPPED.jpg'
} as const;

const ak47Asset: ImportedWeaponAsset = {
  id: 'ak47',
  fbxUrl: '/AK-47/AK47.fbx',
  baseColorUrl: '/AK-47/AK47_Base_Color.png',
  normalUrl: '/AK-47/AK47_Normal_DirectX.png',
  roughnessUrl: '/AK-47/AK47_Roughness.png',
  metalnessUrl: '/AK-47/AK47_Metallic.png',
  targetLength: 0.84,
  // Tuned as a right-hand FPS viewmodel: lower-right, less center-blocking, barrel angled toward crosshair.
  firstPersonPosition: [0.68, -0.68, -0.82],
  firstPersonRotation: [-0.04, Math.PI / 2 - 0.48, -0.08]
};

const m4a1Asset: ImportedWeaponAsset = {
  id: 'm4a1',
  fbxUrl: '/M4A1/M4A1.fbx',
  baseColorUrl: '/M4A1/M4A1_Base_Color.png',
  normalUrl: '/M4A1/M4A1_Normal.png',
  roughnessUrl: '/M4A1/M4A1_Roughness.png',
  metalnessUrl: '/M4A1/M4A1_Metallic.png',
  targetLength: 0.82,
  // Tuned as a right-hand FPS viewmodel: lower-right, less center-blocking, barrel angled toward crosshair.
  firstPersonPosition: [0.68, -0.67, -0.82],
  firstPersonRotation: [-0.04, Math.PI / 2 - 0.46, -0.075]
};

export function getImportedWeaponAsset(weaponId: WeaponId): ImportedWeaponAsset | undefined {
  if (weaponId === 'ak47' || weaponId === 'galil') return ak47Asset;
  if (weaponId === 'm4a4' || weaponId === 'famas' || weaponId === 'sg553') return m4a1Asset;
  if (weaponId === 'm4a1s') return { ...m4a1Asset, isSuppressed: true, targetLength: 0.94 };
  return undefined;
}

const fbxLoader = new FBXLoader();
const textureLoader = new THREE.TextureLoader();
const weaponCache = new Map<string, Promise<THREE.Group>>();
const textureCache = new Map<string, THREE.Texture>();

export function loadManagedTexture(url: string, options?: { srgb?: boolean; repeat?: [number, number] }) {
  let texture = textureCache.get(url);
  if (!texture) {
    texture = textureLoader.load(url);
    textureCache.set(url, texture);
  }
  if (options?.srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (options?.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...options.repeat);
  }
  texture.anisotropy = 8;
  return texture;
}

function makeWeaponMaterial(asset: ImportedWeaponAsset) {
  const material = new THREE.MeshStandardMaterial({
    map: loadManagedTexture(asset.baseColorUrl, { srgb: true }),
    roughnessMap: asset.roughnessUrl ? loadManagedTexture(asset.roughnessUrl) : undefined,
    metalnessMap: asset.metalnessUrl ? loadManagedTexture(asset.metalnessUrl) : undefined,
    normalMap: asset.normalUrl ? loadManagedTexture(asset.normalUrl) : undefined,
    roughness: 0.72,
    metalness: 0.38
  });

  // Most imported gun textures use DirectX normals. Inverting Y makes them render correctly in Three/OpenGL.
  if (asset.normalUrl?.includes('DirectX')) material.normalScale = new THREE.Vector2(1, -1);
  return material;
}

function normalizeModel(model: THREE.Group, targetLength: number) {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  model.position.sub(center);
  const longestAxis = Math.max(size.x, size.y, size.z, 0.001);
  model.scale.multiplyScalar(targetLength / longestAxis);
}

function addSuppressor(root: THREE.Group) {
  const suppressor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.065, 0.42, 28),
    new THREE.MeshStandardMaterial({ color: '#111827', metalness: 0.72, roughness: 0.42 })
  );
  suppressor.rotation.z = Math.PI / 2;
  suppressor.position.set(0.76, 0.025, 0.02);
  suppressor.castShadow = true;
  suppressor.receiveShadow = true;
  root.add(suppressor);
}

async function loadBaseWeapon(asset: ImportedWeaponAsset) {
  const cacheKey = `${asset.id}:${asset.isSuppressed ? 'suppressed' : 'standard'}:${asset.targetLength}`;
  if (!weaponCache.has(cacheKey)) {
    weaponCache.set(cacheKey, fbxLoader.loadAsync(asset.fbxUrl).then((fbx: THREE.Group) => {
      const root = new THREE.Group();
      const material = makeWeaponMaterial(asset);
      fbx.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.material = material.clone();
        }
      });
      root.add(fbx);
      normalizeModel(root, asset.targetLength);
      if (asset.isSuppressed) addSuppressor(root);
      return root;
    }));
  }
  const base = await weaponCache.get(cacheKey)!;
  return base.clone(true);
}

export async function loadImportedWeaponGroup(weaponId: WeaponId): Promise<THREE.Group | undefined> {
  const asset = getImportedWeaponAsset(weaponId);
  if (!asset) return undefined;
  const group = await loadBaseWeapon(asset);
  group.position.set(...asset.firstPersonPosition);
  group.rotation.set(...asset.firstPersonRotation);
  return group;
}

export function createImportedConcreteMaterial(kind: 'floor' | 'wall') {
  if (kind === 'floor') {
    return new THREE.MeshStandardMaterial({
      map: loadManagedTexture(importedMapAssets.floorColor, { srgb: true, repeat: [6, 12] }),
      normalMap: loadManagedTexture(importedMapAssets.floorNormal, { repeat: [6, 12] }),
      roughnessMap: loadManagedTexture(importedMapAssets.floorRoughness, { repeat: [6, 12] }),
      roughness: 0.88,
      metalness: 0.02
    });
  }

  return new THREE.MeshStandardMaterial({
    map: loadManagedTexture(importedMapAssets.wallColor, { srgb: true, repeat: [2.8, 1.4] }),
    roughness: 0.82,
    metalness: 0.02
  });
}
