import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RangeEngine } from './engine';
import { defaults, Weapon } from './config';
import { Simulation } from './simulation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

it('bounds the GPU weapon cache and never evicts the selected assembly', () => {
  const engine = Object.create(RangeEngine.prototype) as RangeEngine;
  engine.sim = new Simulation({...defaults, weapon: 'm4a4'});
  engine.modelCache = new Map<Weapon, THREE.Object3D>(['ak47', 'm4a4', 'm4a1s', 'galil', 'famas'].map(id => [id as Weapon, new THREE.Group()]));
  const dispose = vi.fn(); engine.disposeObject = dispose;
  engine.trimModelCache();
  expect([...engine.modelCache.keys()]).toEqual(['m4a4', 'galil', 'famas']);
  expect(dispose).toHaveBeenCalledTimes(2);
});

it('clears hit feedback immediately when pausing so it cannot cover the entry button', () => {
  const engine = Object.create(RangeEngine.prototype) as RangeEngine;
  engine.sim = new Simulation(defaults);
  engine.renderer = {domElement: {}} as THREE.WebGLRenderer;
  engine.hitmarker = {style: {opacity: '1'}} as HTMLElement;
  engine.hitCaption = {style: {opacity: '1'}} as HTMLDivElement;
  engine.hitTime = .45;
  vi.stubGlobal('document', {pointerLockElement: null});
  try {
    engine.pause();
    expect(engine.hitTime).toBe(0);
    expect(engine.hitmarker.style.opacity).toBe('0');
    expect(engine.hitCaption.style.opacity).toBe('0');
  } finally { vi.unstubAllGlobals(); }
});

it('preserves native target units and origin instead of fitting its loading pose to a height', async () => {
  const engine = Object.create(RangeEngine.prototype) as RangeEngine;
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(.75, 2.0392, 1));
  body.position.y = .98; scene.add(body);
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue({scene, animations: []} as never);
  engine.sim = new Simulation(defaults); engine.modelCache = new Map();
  engine.targets = [new THREE.Group(), new THREE.Group()];
  engine.targetModels = []; engine.mixers = []; engine.targetActions = [];
  engine.onError = vi.fn();
  try {
    await engine.loadTarget();
    expect(engine.onError).not.toHaveBeenCalled();
    expect(engine.loadedTarget).toBe(true);
    expect(scene.scale.toArray()).toEqual([1, 1, 1]);
    expect(scene.position.toArray()).toEqual([0, 0, 0]);
    expect(engine.targetModels.every(m => m.scale.equals(scene.scale))).toBe(true);
  } finally { load.mockRestore(); }
});
