import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {InfernoRenderer, INFERNO_RENDER_CELLS} from './inferno-render';
import native from './inferno-presentation-native.json';
import type {UtilityEffect} from './utilities';

const fire = (kind: 'molotov' | 'incendiary'): UtilityEffect => ({id: 1, actorId: 0, side: 'player', kind,
  type: 'fire', position: {x: 0, y: 0, z: 0}, radius: 3, startedAt: 0, expiresAt: 7,
  cells: [{x: 1, y: 2, z: 3}, {x: 2, y: 2, z: 3}], holes: []});
describe('installed inferno layers', () => {
  it('retains current source hashes and nonempty bounded atlases instead of the burning-character sprite', () => {
    expect(native.build).toBe('2000938');
    for (const asset of Object.values(native.assets)) {
      expect(asset.texture).not.toContain('fire_burning_character');
      expect(asset.particleSha256).toMatch(/^[a-f0-9]{64}$/);
      const bytes = readFileSync(`public/revamp${asset.url}`);
      expect(bytes.length).toBe(asset.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(asset.frames).toBeLessThanOrEqual(24);
    }
  });
  it('uses distinct incendiary flames, anchored ground, bounded pools and retained GPU arrays', () => {
    const renderer = new InfernoRenderer(), camera = new THREE.PerspectiveCamera();
    const mesh = (name: string) => renderer.group.getObjectByName(name) as THREE.InstancedMesh;
    const buffer = mesh('utility-fire').instanceMatrix.array;
    renderer.update([fire('molotov')], 2, camera);
    expect(mesh('utility-fire').count).toBe(2); expect(mesh('utility-fire-ground').count).toBe(2);
    const matrix = new THREE.Matrix4(); mesh('utility-fire-ground').getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeCloseTo(2.012);
    renderer.update([fire('incendiary')], 3, camera);
    expect(mesh('utility-fire').count).toBe(0); expect(mesh('utility-fire-incendiary').count).toBe(2);
    const huge = {...fire('molotov'), cells: Array.from({length: 500}, (_, x) => ({x, y: 0, z: 0}))};
    renderer.update([huge], 3, camera); expect(mesh('utility-fire').count).toBe(INFERNO_RENDER_CELLS);
    expect(mesh('utility-fire').instanceMatrix.array).toBe(buffer);
    renderer.update([huge], 7, camera); expect(mesh('utility-fire').count).toBe(0);
    renderer.dispose(); renderer.dispose();
  });
});
