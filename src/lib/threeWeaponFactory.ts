import * as THREE from 'three';
import { WeaponModelAsset, WeaponModelPart } from './modelAssets';

function materialFor(part: WeaponModelPart) {
  const material = new THREE.MeshStandardMaterial({
    color: part.color,
    roughness: part.roughness,
    metalness: part.metalness,
    envMapIntensity: 1.15
  });
  return material;
}

export function meshForWeaponPart(part: WeaponModelPart) {
  const geometry = part.kind === 'box'
    ? new THREE.BoxGeometry(...part.size)
    : new THREE.CylinderGeometry(part.radiusTop, part.radiusBottom, part.depth, 28);
  const mesh = new THREE.Mesh(geometry, materialFor(part));
  mesh.name = part.name;
  mesh.position.set(...part.position);
  mesh.rotation.set(...part.rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildWeaponGroup(asset: WeaponModelAsset): THREE.Group {
  const group = new THREE.Group();
  group.name = asset.name;
  for (const part of asset.parts) group.add(meshForWeaponPart(part));

  const trimMaterial = new THREE.MeshStandardMaterial({ color: '#d1d5db', roughness: 0.28, metalness: 0.82 });
  const sightDot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), trimMaterial);
  sightDot.name = 'front sight highlight';
  sightDot.position.set(1.54, 0.185, 0.01);
  sightDot.castShadow = true;
  group.add(sightDot);

  // Center the static JSON coordinate system and present like a first-person inspect model.
  group.rotation.set(0.05, -0.48, 0.02);
  group.position.set(-0.44, -0.02, 0);
  return group;
}

export function disposeThreeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}
