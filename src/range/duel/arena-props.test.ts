import {describe, expect, it} from 'vitest';
import {Box3, Group, Mesh, MeshBasicMaterial} from 'three';
import {addArenaCover} from './arena-props';
import {arenaPOIs} from './arena-pois';
import {batchStaticMeshes, disposeResources} from './render-resources';

describe('authored cover surfaces', () => {
  it.each(arenaPOIs.map(poi => [poi.id, poi] as const))('%s has no overlapping differently colored top faces', (_, poi) => {
    const group = new Group();
    const materials = {concrete: new MeshBasicMaterial(), cargo: new MeshBasicMaterial(), crate: new MeshBasicMaterial(),
      barrier: new MeshBasicMaterial(), cap: new MeshBasicMaterial(), trim: new MeshBasicMaterial(),
      hazard: new MeshBasicMaterial(), crateEdge: new MeshBasicMaterial()};
    try {
      for (const part of poi.parts) addArenaCover(part, group, materials);
      group.updateMatrixWorld(true);
      const faces = group.children.map(child => ({material: (child as Mesh).material, box: new Box3().setFromObject(child)}));
      for (let a = 0; a < faces.length; a++) for (let b = a + 1; b < faces.length; b++) {
        const first = faces[a], second = faces[b];
        if (first.material === second.material || Math.abs(first.box.max.y - second.box.max.y) > 1e-5) continue;
        const overlapX = Math.min(first.box.max.x, second.box.max.x) - Math.max(first.box.min.x, second.box.min.x);
        const overlapZ = Math.min(first.box.max.z, second.box.max.z) - Math.max(first.box.min.z, second.box.min.z);
        expect(overlapX > 1e-5 && overlapZ > 1e-5, `coplanar tops ${a}/${b} at ${first.box.max.y}`).toBe(false);
      }
      batchStaticMeshes(group);
      expect(group.children.length).toBeLessThanOrEqual(8);
      expect(group.children.every(child => (child as Mesh).geometry.attributes.position.count > 0)).toBe(true);
    } finally {
      disposeResources([group]);
      Object.values(materials).forEach(material => material.dispose());
    }
  });
});
