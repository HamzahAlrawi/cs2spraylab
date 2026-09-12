import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RangeEngine } from './engine';

function rayFixture() {
  // Exercise the renderer's actual ray casting without allocating a WebGL context.
  const engine = Object.create(RangeEngine.prototype) as RangeEngine;
  const scene = new THREE.Scene(), target = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .3));
  body.position.set(0, 1, -10); target.add(body); scene.add(target);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, .1));
  wall.position.set(0, 1, -11); scene.add(wall); scene.updateMatrixWorld(true);
  engine.targetModels = [body]; engine.solids = [wall]; engine.ray = new THREE.Raycaster();
  engine.syncTargets = () => scene.updateMatrixWorld(true);
  return { engine, body, wall, target };
}

describe('Target line of sight', () => {
  const origin = { x: 0, y: 1, z: 0 }, direction = { x: 0, y: 0, z: -1 };
  it('counts a body before its backplate, but not one behind a solid', () => {
    const { engine, wall } = rayFixture();
    expect(engine.castTargets(origin, direction).length).toBeGreaterThan(0);
    wall.position.z = -9;
    expect(engine.castTargets(origin, direction)).toHaveLength(0);
  });
  it('does not score the held weapon or an inactive transfer target', () => {
    const { engine, body, target } = rayFixture();
    body.userData.skipScoring = true;
    expect(engine.castTargets(origin, direction)).toHaveLength(0);
    body.userData.skipScoring = false; target.visible = false;
    expect(engine.castTargets(origin, direction)).toHaveLength(0);
  });
});
