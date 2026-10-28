import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {arenaPOIs, environmentPOIs, footprintOf, footprintsOverlap, placePOI, poiThemes} from './arena-pois';
import {propDetails} from './arena-props';
import {batchStaticMeshes} from './render-resources';
import {canFitInArena, testArena} from './geometry';
import {routeTo} from './navigation';
import {UNIT} from '../actor-physics';

describe('authored POI library', () => {
  it('contains at least fifty distinct authored plans, not height or box-count variants', () => {
    expect(arenaPOIs.length).toBeGreaterThanOrEqual(50);
    expect(new Set(arenaPOIs.map(p => p.id)).size).toBe(arenaPOIs.length);
    const plans = arenaPOIs.map(p => JSON.stringify(p.parts.map(s => [s.center.x, s.center.z, s.size.x, s.size.z]).sort()));
    expect(new Set(plans).size).toBeGreaterThanOrEqual(50);
    for (const theme of poiThemes) {
      expect(arenaPOIs.filter(p => p.theme === theme).length).toBeGreaterThanOrEqual(11);
      expect(arenaPOIs.filter(p => p.theme === theme && p.spawnCover).length).toBeGreaterThanOrEqual(3);
      expect(arenaPOIs.filter(p => p.theme === theme && !p.spawnCover && p.footprint.maxX - p.footprint.minX <= 3).length).toBeGreaterThanOrEqual(2);
      expect(environmentPOIs.filter(p => p.theme === theme).length).toBeGreaterThanOrEqual(4);
      expect(new Set(environmentPOIs.filter(p => p.theme === theme).flatMap(p => p.links!.map(l => l.kind))).size).toBeGreaterThanOrEqual(2);
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

  it.each(environmentPOIs)('$id keeps a dry ground bypass and accessible entries under both lane facings', template => {
    const before = JSON.stringify(template);
    for (const mx of [-1, 1] as const) for (const mz of [-1, 1] as const) {
      const placed = placePOI(template, {x: 2, y: 0, z: -3}, mx, mz, 'lane', 0);
      const arena = {...testArena(), solids: [...placed.solids, ...placed.volumes.filter(v => v.kind === 'water').map(v => ({
        center: {...v.center, y: 1}, size: {...v.size, y: 2}, kind: 'concrete' as const}))]};
      const a = {x: 0, y: 0, z: -9}, b = {x: 0, y: 0, z: 4};
      expect(routeTo(a, b, arena).length).toBeGreaterThan(0);
      const entries = placed.links.flatMap(l => [l.from, l.to, ...(l.boost ? [l.boost.dismount] : [])]).filter(p => p.y === 0);
      for (const p of entries) {
        expect(canFitInArena(p, 0, 72 * UNIT, arena)).toBe(true);
        expect(routeTo(a, p, arena).length).toBeGreaterThan(0);
        expect(routeTo(b, p, arena).length).toBeGreaterThan(0);
      }
      for (const l of placed.links) {
        expect(l.surfaceIds.every(id => placed.solids.some(s => s.id === id))).toBe(true);
        if (l.volumeId) expect(placed.volumes.some(v => v.id === l.volumeId)).toBe(true);
      }
    }
    expect(JSON.stringify(template)).toBe(before);
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
