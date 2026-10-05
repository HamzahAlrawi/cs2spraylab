import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {disposeGloves} from '../actor-cosmetics';

export function batchStaticMeshes(root: THREE.Object3D, retainGeometry = new Set<THREE.Object3D>()) {
  const batches = new Map<THREE.Material, Map<string, THREE.Mesh[]>>();
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh || Array.isArray(child.material)) continue;
    const attributes = Object.entries(child.geometry.attributes as THREE.NormalBufferAttributes).sort(([a], [b]) => a.localeCompare(b));
    if (Object.keys(child.geometry.morphAttributes).length || attributes.some(([, attribute]) => attribute instanceof THREE.InterleavedBufferAttribute)) continue;
    const groups = batches.get(child.material) ?? new Map<string, THREE.Mesh[]>();
    const layout = attributes.map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).join(',');
    const key = `${child.castShadow}:${child.receiveShadow}:${child.renderOrder}:${!!child.geometry.index}:${layout}`;
    const meshes = groups.get(key) ?? [];
    meshes.push(child); groups.set(key, meshes); batches.set(child.material, groups);
  }
  for (const [material, groups] of batches) for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(item => item.dispose());
    if (!geometry) continue;
    const batch = new THREE.Mesh(geometry, material);
    batch.castShadow = meshes[0].castShadow; batch.receiveShadow = meshes[0].receiveShadow; batch.renderOrder = meshes[0].renderOrder;
    batch.name = 'static-batch'; batch.updateMatrix(); batch.matrixAutoUpdate = false;
    geometry.computeBoundingSphere(); root.add(batch);
    for (const mesh of meshes) {root.remove(mesh); if (!retainGeometry.has(mesh)) mesh.geometry.dispose();}
  }
}

export function disposeSkeletons(root: THREE.Object3D) {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);});
  skeletons.forEach(skeleton => skeleton.dispose());
}

export function disposeResources(roots: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  for (const root of roots) {
    const nodes: THREE.Object3D[] = [];root.traverse(object => nodes.push(object));
    nodes.forEach(disposeGloves);
    disposeSkeletons(root);
    root.traverse(object => {
      if (object.userData.cosmeticTexture instanceof THREE.Texture) textures.add(object.userData.cosmeticTexture);
      for (const material of object.userData.cosmeticOriginalMaterials ?? []) materials.add(material);
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  geometries.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
}
