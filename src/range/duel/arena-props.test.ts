import {describe, expect, it} from 'vitest';
import {Box3, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3} from 'three';
import {addArenaCover, addArenaTraversal, createEnvironmentRenderMap, environmentRenderMetadata, propDetails, syncEnvironmentRenderMap} from './arena-props';
import {arenaPOIs, environmentPOIs, placePOI} from './arena-pois';
import {batchStaticMeshes, disposeResources} from './render-resources';
import {createEnvironmentState, damageEnvironmentPiece, useEnvironmentPiece} from './environment';
import {raySolidInterval, testArena} from './geometry';
import {createArena} from './arena-layout';
import {UNIT} from '../actor-physics';

const coverMaterials = () => ({concrete: new MeshBasicMaterial(), cargo: new MeshBasicMaterial(), crate: new MeshBasicMaterial(),
  barrier: new MeshBasicMaterial(), cap: new MeshBasicMaterial(), trim: new MeshBasicMaterial(),
  hazard: new MeshBasicMaterial(), crateEdge: new MeshBasicMaterial(), glass: new MeshBasicMaterial({transparent: true, opacity: .25}),
  water: new MeshBasicMaterial({transparent: true, opacity: .55}), metal: new MeshBasicMaterial(), grate: new MeshBasicMaterial()});

describe('authored cover surfaces', () => {
  it.each([.65, 1.5])('renders landmark cover and unobstructed entry exposures at scale %s', scale => {
    for (let seed = 0; seed < 12; seed++) {
      const arena = createArena(seed, {scale}), root = new Group(), materials = coverMaterials();
      try {
        for (const solid of arena.solids) addArenaCover(solid, root, materials);
        root.updateMatrixWorld(true);
        const forward = new Vector3(0, 0, 1), far = Math.max(...arena.solids.filter(s => !s.poiId).map(s => s.center.z + s.size.z / 2)) + .95;
        for (const lane of arena.lanes!.filter(l => l.role === 'entry')) {
          const ray = (p: typeof lane.anchor) => new Raycaster(new Vector3(p.x, 64 * UNIT, p.z), forward, 0, far - p.z);
          expect(ray(lane.anchor).intersectObjects(root.children).length).toBeGreaterThan(0);
          expect(ray(lane.edge).intersectObjects(root.children)).toHaveLength(0);
        }
      } finally {disposeResources([root]); Object.values(materials).forEach(material => material.dispose());}
    }
  });

  it('varies shell graphics deterministically, with bounded geometry at arbitrary authored heights', () => {
    const materials = {metal: new MeshBasicMaterial(), dark: new MeshBasicMaterial(), label: new MeshBasicMaterial(), wood: new MeshBasicMaterial()};
    try {
      for (const style of ['kiosk', 'planter', 'generator', 'vent', 'cabinet', 'pallets', 'movable'] as const) {
        const variants = new Set<string>();
        for (let index = 0; index < 24; index++) {
          const solid = {id: `detail-${index}`, style, center: {x: 0, y: 1.05, z: 0}, size: {x: 1.2, y: 2.1, z: 1}};
          const group = new Group(), repeat = new Group();
          try {
            propDetails(solid, group, materials); propDetails(solid, repeat, materials);
            const signature = (root: Group) => JSON.stringify(root.children.map(child => {
              const mesh = child as Mesh;
              return [mesh.position.toArray(), Array.from(mesh.geometry.attributes.position.array), Object.values(materials).indexOf(mesh.material as MeshBasicMaterial)];
            }));
            expect(signature(group)).toBe(signature(repeat)); variants.add(signature(group));
            expect(group.children.length).toBeLessThanOrEqual(32);
            for (const child of group.children) {
              expect(child.matrixAutoUpdate).toBe(false);
              const bounds = new Box3().setFromObject(child);
              for (const axis of ['x', 'y', 'z'] as const) {
                expect(bounds.min[axis]).toBeGreaterThanOrEqual(solid.center[axis] - solid.size[axis] / 2 - .061);
                expect(bounds.max[axis]).toBeLessThanOrEqual(solid.center[axis] + solid.size[axis] / 2 + .061);
              }
            }
          } finally {disposeResources([group, repeat]);}
        }
        expect(variants.size, style).toBeGreaterThanOrEqual(3);
      }
    } finally {Object.values(materials).forEach(material => material.dispose());}
  });

  it.each([.65, 1, 1.5])('renders seeded arrangements through existing static batches and stable dynamic groups at scale %s', scale => {
    const materials = coverMaterials();
    try {
      for (let seed = 0; seed < 24; seed++) {
        const arena = createArena(seed, {scale}), before = JSON.stringify(arena), root = new Group();
        try {
          for (const solid of arena.solids.filter(s => !s.interaction)) addArenaCover(solid, root, materials);
          root.updateMatrixWorld(true);
          const faces = root.children.map(child => ({material: (child as Mesh).material, box: new Box3().setFromObject(child)}));
          for (const [index, a] of faces.entries()) for (const b of faces.slice(index + 1)) {
            if (a.material === b.material || Math.abs(a.box.max.y - b.box.max.y) > 1e-5) continue;
            expect(Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x) > 1e-5 &&
              Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z) > 1e-5,
            `seed ${seed}, scale ${scale}, coplanar top ${a.box.max.y}`).toBe(false);
          }
          batchStaticMeshes(root);
          expect(root.children.length).toBeLessThanOrEqual(Object.keys(materials).length);
          const dynamic = createEnvironmentRenderMap(arena, root, materials);
          expect(dynamic.size).toBe(arena.solids.filter(s => s.interaction).length);
          for (const volume of arena.traversalVolumes!) addArenaTraversal(volume, root, materials);
          expect(root.children.every(child => child instanceof Group || (child as Mesh).geometry.attributes.position.count > 0)).toBe(true);
          expect(JSON.stringify(arena)).toBe(before);
        } finally {disposeResources([root]);}
      }
    } finally {Object.values(materials).forEach(material => material.dispose());}
  });

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
