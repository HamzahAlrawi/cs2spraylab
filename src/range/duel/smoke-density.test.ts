import {describe, expect, it} from 'vitest';
import {buildSmokeDensity, SMOKE_GRID_SIZE, pointInSmokeHole, smokeHoleRadius} from './smoke-density';
import {SmokeRenderer} from './smoke-render';
import type {UtilityEffect} from './utilities';
const cloud = (): UtilityEffect => ({id: 1, actorId: 0, side: 'player', kind: 'smoke', type: 'smoke',
  position: {x: 0, y: 1, z: 0}, radius: 4.2, cells: [{x: 0, y: 1, z: 0}], startedAt: 0, expiresAt: 20, holes: []});
describe('volume smoke density and holes', () => {
  it('rasterizes reachable cells only into a bounded byte volume', () => {
    const grid = buildSmokeDensity(cloud());
    expect(grid.data).toHaveLength(SMOKE_GRID_SIZE ** 3);
    expect(grid.data.filter(value => value === 255).length).toBeGreaterThan(0);
    expect(grid.data[0]).toBe(0);
    expect(buildSmokeDensity({...cloud(), cells: []}).data.some(Boolean)).toBe(false);
  });
  it('cuts a bullet-width capsule even when no coarse cell center lies along the ray', () => {
    const hole = {from: {x: -8, y: 1.2, z: .2}, to: {x: 8, y: 1.2, z: .2}, radius: .12, startedAt: 2, expiresAt: 2.35};
    expect(pointInSmokeHole({x: 0, y: 1.2, z: .2}, hole, 2.1)).toBe(true);
    expect(pointInSmokeHole({x: 0, y: 1, z: 0}, hole, 2.1)).toBe(false);
    expect(smokeHoleRadius(hole, 2.3)).toBeGreaterThan(0);
    expect(smokeHoleRadius(hole, 2.3)).toBeLessThan(hole.radius);
    expect(smokeHoleRadius(hole, 2.35)).toBe(0);
    expect(smokeHoleRadius(hole, 1)).toBe(0);
  });
  it('supports HE spheres and refills without deleting the entire cloud', () => {
    const hole = {from: {x: 0, y: 1, z: 0}, to: {x: 0, y: 1, z: 0}, radius: 3, startedAt: 2, expiresAt: 3};
    expect(pointInSmokeHole({x: 1, y: 1, z: 0}, hole, 2.3)).toBe(true);
    expect(pointInSmokeHole({x: 4, y: 1, z: 0}, hole, 2.3)).toBe(false);
    expect(pointInSmokeHole({x: 1, y: 1, z: 0}, hole, 3)).toBe(false);
  });
  it('retains textures across ordinary frames and disposes on expiry/replay rewind', () => {
    const renderer = new SmokeRenderer(), effect = cloud();
    renderer.update([effect], 2); expect(renderer.retainedVolumes).toBe(1);
    renderer.update([effect], 3); expect(renderer.retainedVolumes).toBe(1);
    renderer.update([effect], 0); expect(renderer.retainedVolumes).toBe(0);
    renderer.update([effect], 2); expect(renderer.count).toBe(1);
    renderer.update([effect], 20); expect(renderer.retainedVolumes).toBe(0);
    renderer.dispose(); renderer.dispose(); renderer.update([effect], 2); expect(renderer.count).toBe(0);
  });
});
