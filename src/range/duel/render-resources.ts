import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function batchStaticMeshes(root: THREE.Object3D) {
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh || Array.isArray(child.material)) continue;
    const meshes = batches.get(child.material) ?? [];
    meshes.push(child); batches.set(child.material, meshes);
  }
  for (const [material, meshes] of batches) {
    const geometries = meshes.map(mesh => {mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(item => item.dispose());
    if (!geometry) continue;
    const batch = new THREE.Mesh(geometry, material);
    batch.name = 'static-batch'; batch.updateMatrix(); batch.matrixAutoUpdate = false;
    geometry.computeBoundingSphere(); root.add(batch);
    for (const mesh of meshes) {root.remove(mesh); mesh.geometry.dispose();}
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
    disposeSkeletons(root);
    root.traverse(object => {
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
