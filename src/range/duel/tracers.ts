import * as THREE from 'three';
import {viewmodelViewport} from '../viewmodel';

// Baked view models omit attachment bones. Locate the muzzle at the forward
// end of the weapon mesh, excluding hands; the result is cosmetic only.
export function muzzleAnchor(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const meshes: {object: THREE.Mesh; count: number; matrix: THREE.Matrix4}[] = [];
  const point = new THREE.Vector3();
  let front = -Infinity;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !/held_weapon|weapons.*weapon_/i.test(object.name)) return;
    const position = object.geometry.getAttribute('position');
    if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    meshes.push({object, count: position.count, matrix});
    for (let index = 0; index < position.count; index++) {
      object.getVertexPosition(index, point).applyMatrix4(matrix);
      front = Math.max(front, point.z);
    }
  });
  if (!Number.isFinite(front)) return undefined;
  const center = new THREE.Vector3();
  let count = 0;
  for (const {object, count: vertices, matrix} of meshes) for (let index = 0; index < vertices; index++) {
    object.getVertexPosition(index, point).applyMatrix4(matrix);
    if (point.z > front - .008) {center.add(point); count++;}
  }
  const anchor = new THREE.Object3D(); anchor.name = 'spraylab-muzzle'; anchor.position.copy(center).divideScalar(count);
  root.add(anchor);
  return anchor;
}

export function viewMuzzleToWorld(muzzle: THREE.Vector3, viewCamera: THREE.PerspectiveCamera,
  worldCamera: THREE.PerspectiveCamera, width: number, height: number) {
  const viewport = viewmodelViewport(width, height);
  const projected = muzzle.clone().project(viewCamera);
  const screenX = viewport.x + (projected.x + 1) * viewport.width / 2;
  const screenY = viewport.y + (projected.y + 1) * viewport.height / 2;
  const ray = new THREE.Vector3(screenX / width * 2 - 1, screenY / height * 2 - 1, .5)
    .unproject(worldCamera).sub(worldCamera.position).normalize();
  return ray.multiplyScalar(Math.max(.35, muzzle.distanceTo(viewCamera.position))).add(worldCamera.position);
}
