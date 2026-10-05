import {describe, expect, it} from 'vitest';
import {Box3, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3} from 'three';
import {addArenaCover, addArenaTraversal, createEnvironmentRenderMap, environmentRenderMetadata, syncEnvironmentRenderMap} from './arena-props';
import {arenaPOIs, environmentPOIs, placePOI} from './arena-pois';
import {batchStaticMeshes, disposeResources} from './render-resources';
import {createEnvironmentState, damageEnvironmentPiece, useEnvironmentPiece} from './environment';
import {raySolidInterval, testArena} from './geometry';

const coverMaterials = () => ({concrete: new MeshBasicMaterial(), cargo: new MeshBasicMaterial(), crate: new MeshBasicMaterial(),
  barrier: new MeshBasicMaterial(), cap: new MeshBasicMaterial(), trim: new MeshBasicMaterial(),
  hazard: new MeshBasicMaterial(), crateEdge: new MeshBasicMaterial(), glass: new MeshBasicMaterial({transparent: true, opacity: .25}),
  water: new MeshBasicMaterial({transparent: true, opacity: .55}), metal: new MeshBasicMaterial(), grate: new MeshBasicMaterial()});

describe('authored cover surfaces', () => {
  it.each([...arenaPOIs, ...environmentPOIs].map(poi => [poi.id, poi] as const))('%s has no overlapping differently colored top faces', (_, poi) => {
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
  it('renders true mirrored wedges with the same entry points and outward normals as combat', () => {
    const template = environmentPOIs.find(p => p.id === 'service-access-ramp')!;
    for (const mirrorZ of [-1, 1] as const) {
      const placed = placePOI(template, {x: 0, y: 0, z: 0}, 1, mirrorZ, 'slope', 0), ramp = placed.solids.find(s => s.shape)!;
      const group = new Group(), materials = coverMaterials();
      try {
        addArenaCover(ramp, group, materials); group.updateMatrixWorld(true);
        expect(group.children).toHaveLength(1);
        for (const along of [-.9, 0, .9]) {
          const origin = {x: 0, y: 4, z: ramp.center.z + along}, direction = {x: 0, y: -1, z: 0};
          const ray = new Raycaster(new Vector3(origin.x, origin.y, origin.z), new Vector3(0, -1, 0));
          const hit = ray.intersectObjects(group.children)[0];
          expect(hit).toBeDefined(); expect(hit.distance).toBeCloseTo(raySolidInterval(origin, direction, ramp)!.entryDistance, 5);
          expect(hit.face!.normal.y).toBeGreaterThan(0);
        }
      } finally {disposeResources([group]); Object.values(materials).forEach(material => material.dispose());}
    }
  });
  it('keeps dynamic groups addressable and syncs visibility/offset without mutating static geometry', () => {
    const templates = ['switchback-security-door', 'loading-receiving-glass'].map(id => environmentPOIs.find(p => p.id === id)!);
    const solids = templates.flatMap((t, index) => placePOI(t, {x: 5 * index, y: 0, z: 0}, 1, 1, `poi-${index}`, 0).solids);
    const arena = {...testArena(), solids}, state = createEnvironmentState(arena), group = new Group(), materials = coverMaterials();
    try {
      const groups = createEnvironmentRenderMap(arena, group, materials);
      expect(groups.size).toBe(2); expect(environmentRenderMetadata(arena).filter(p => p.dynamic)).toHaveLength(2);
      const opened = useEnvironmentPiece(arena, state, 'poi-0/panel', {x: 0, y: 1.6, z: -.9}).state;
      const broken = damageEnvironmentPiece(arena, opened, 'poi-1/panel', 100).state;
      syncEnvironmentRenderMap(groups, broken);
      expect(groups.get('poi-0/panel')!.position.y).toBe(2.35);
      expect(groups.get('poi-1/panel')!.visible).toBe(false);
      syncEnvironmentRenderMap(groups, state);
      expect(groups.get('poi-0/panel')!.position.y).toBe(0); expect(groups.get('poi-1/panel')!.visible).toBe(true);
    } finally {disposeResources([group]); Object.values(materials).forEach(material => material.dispose());}
  });
  it('places water above the floor and bounds ladder rung counts independently of quality', () => {
    const materials = coverMaterials(), root = new Group();
    try {
      for (const template of environmentPOIs) {
        const placed = placePOI(template, {x: 0, y: 0, z: 0}, 1, 1, template.id, 0);
        for (const volume of placed.volumes) {
          const group = addArenaTraversal(volume, root, materials);
          expect(group.userData.traversalId).toBe(volume.id);
          if (volume.kind === 'water') {expect(group.children).toHaveLength(1); expect(group.children[0].position.y).toBeGreaterThan(.01);}
          else {expect(group.children.length).toBeLessThanOrEqual(16); expect(group.children.length).toBeGreaterThanOrEqual(3);}
        }
      }
    } finally {disposeResources([root]); Object.values(materials).forEach(material => material.dispose());}
  });
});
