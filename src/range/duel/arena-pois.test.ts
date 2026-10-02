import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {arenaPOIs, footprintOf, footprintsOverlap, placePOI, poiThemes} from './arena-pois';
import {propDetails} from './arena-props';
import {batchStaticMeshes} from './render-resources';

describe('authored POI library', () => {
  it('contains at least fifty distinct authored plans, not height or box-count variants', () => {
    expect(arenaPOIs.length).toBeGreaterThanOrEqual(50);
    expect(new Set(arenaPOIs.map(p => p.id)).size).toBe(arenaPOIs.length);
    const plans = arenaPOIs.map(p => JSON.stringify(p.parts.map(s => [s.center.x, s.center.z, s.size.x, s.size.z]).sort()));
    expect(new Set(plans).size).toBeGreaterThanOrEqual(50);
    for (const theme of poiThemes) {
      expect(arenaPOIs.filter(p => p.theme === theme)).toHaveLength(9);
      expect(arenaPOIs.filter(p => p.theme === theme && p.spawnCover)).toHaveLength(3);
    }
  });

  it.each(arenaPOIs)('$id has a coherent bounded assembly without overlaps or narrow pseudo-aisles', template => {
    expect(template.use.length).toBeGreaterThan(20);
    expect(template.parts.length).toBeGreaterThanOrEqual(3);
    expect(template.parts.length).toBeLessThanOrEqual(5);
    expect(new Set(template.parts.map(p => p.label)).size).toBe(template.parts.length);
    expect(template.footprint.maxX - template.footprint.minX).toBeLessThanOrEqual(5.6 + 1e-8);
    expect(template.footprint.maxZ - template.footprint.minZ).toBeLessThanOrEqual(3.6 + 1e-8);
    for (const [index, a] of template.parts.entries()) {
      expect(Math.min(a.size.x, a.size.y, a.size.z)).toBeGreaterThan(0);
      expect(a.center.y - a.size.y / 2).toBe(0);
      expect(a.size.y).toBeGreaterThan(.8);
      for (const b of template.parts.slice(index + 1)) {
        const fa = footprintOf([a]), fb = footprintOf([b]);
        expect(footprintsOverlap(fa, fb), `${template.id}: ${a.label} / ${b.label}`).toBe(false);
        const dx = Math.max(fa.minX - fb.maxX, fb.minX - fa.maxX, 0);
        const dz = Math.max(fa.minZ - fb.maxZ, fb.minZ - fa.maxZ, 0);
        if (dx + dz > 1e-8) expect(Math.hypot(dx, dz), `${template.id}: narrow gap ${a.label} / ${b.label}`).toBeGreaterThanOrEqual(1.2 - 1e-8);
      }
    }
    if (template.spawnCover) {
      const back = template.parts[0];
      expect(back.size.x).toBeGreaterThanOrEqual(3.4);
      expect(back.size.y).toBeGreaterThanOrEqual(2);
      expect(back.center.z).toBe(0);
      expect(template.footprint.maxZ).toBeLessThanOrEqual(.3 + 1e-8);
    }
  });

  it('mirrors whole bundles and records exact world-space reservations without mutating templates', () => {
    const snapshot = JSON.stringify(arenaPOIs);
    for (const template of arenaPOIs) for (const mx of [-1, 1] as const) for (const mz of [-1, 1] as const) {
      const {solids, instance} = placePOI(template, {x: 8, y: 0, z: -7}, mx, mz, 'test', 5);
      expect(instance.solidIndices).toEqual(solids.map((_, i) => i + 5));
      expect(instance.footprint).toEqual(footprintOf(solids));
      expect(instance.reservation.minX).toBeCloseTo(instance.footprint.minX - .6);
      expect(instance.reservation.maxZ).toBeCloseTo(instance.footprint.maxZ + .6);
      solids.forEach((s, i) => {
        expect(s.center.x).toBe(8 + mx * template.parts[i].center.x);
        expect(s.center.z).toBe(-7 + mz * template.parts[i].center.z);
        expect(s.size).toEqual(template.parts[i].size);
        expect(s.poiId).toBe('test');
      });
    }
    expect(JSON.stringify(arenaPOIs)).toBe(snapshot);
  });

  it('bounds static decoration geometry and merges it using the existing engine batcher', () => {
    const materials = {metal: new THREE.MeshBasicMaterial(), dark: new THREE.MeshBasicMaterial(), label: new THREE.MeshBasicMaterial(), wood: new THREE.MeshBasicMaterial()};
    const root = new THREE.Group();
    for (const template of arenaPOIs) for (const solid of template.parts) {
      const group = new THREE.Group();
      propDetails(solid, group, materials);
      expect(group.children.length).toBeLessThanOrEqual(32);
      for (const child of [...group.children]) {
        const mesh = child as THREE.Mesh;
        expect(mesh.matrixAutoUpdate).toBe(false);
        expect(Object.values(materials)).toContain(mesh.material);
        const bounds = new THREE.Box3().setFromObject(mesh);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(bounds.min[axis]).toBeGreaterThanOrEqual(solid.center[axis] - solid.size[axis] / 2 - .061);
          expect(bounds.max[axis]).toBeLessThanOrEqual(solid.center[axis] + solid.size[axis] / 2 + .061);
        }
        root.add(mesh);
      }
    }
    batchStaticMeshes(root);
    expect(root.children.length).toBeLessThanOrEqual(4);
    for (const child of root.children) (child as THREE.Mesh).geometry.dispose();
    Object.values(materials).forEach(material => material.dispose());
  });
});
