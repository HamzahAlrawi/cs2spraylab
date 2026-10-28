import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DuelEngine} from './DuelEngine';
import {prewarmShaders} from '../shader-warmup';
import {WeaponPreloader} from '../weapon-preloader';

vi.mock('../shader-warmup', () => ({prewarmShaders: vi.fn(), disposeWarmRenderer: vi.fn()}));
// These tests own rig lifetime, not the separately tested byte transport.
vi.mock('../combat-model-delivery',()=>({loadCombatModel:(url:string)=>new GLTFLoader().loadAsync(url)}));
vi.mock('../native-view-actions', () => ({prepareNativeViewAssembly: vi.fn()}));
vi.mock('../view-animation', () => ({ViewAnimation: class {
  cancel = vi.fn(); dispose = vi.fn(); playDraw = vi.fn(); playPickup = vi.fn(); playInspect = vi.fn(() => true);
}}));

function fixture() {
  const engine = Object.assign(Object.create(DuelEngine.prototype), {
    viewModels: new Map(), viewLoading: new Map(), viewPreloader: new WeaponPreloader(),
    viewCosmeticRevision: 0, viewRevision: 0, viewRoot: new THREE.Group(), viewScene: new THREE.Scene(),
    viewCamera: new THREE.PerspectiveCamera(), renderer: {}, disposed: false, viewAnimationElapsed: 0,
    sim: {time: 2, actors: [{equipReadyAt: 3, alive: true, weapon: {id: 'ak47'}}]}, onError: vi.fn(),
  });
  engine.viewScene.add(engine.viewRoot);
  return engine;
}
function asset() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); scene.add(mesh);
  const dispose = vi.spyOn(mesh.geometry, 'dispose');
  return {gltf: {scene, animations: []} as unknown as GLTF, dispose};
}
afterEach(() => vi.restoreAllMocks());

describe('Duel first-person model cache', () => {
  it('hot switches reuse rigs and animations synchronously, without parsing or warming shaders again', async () => {
    const engine = fixture();
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => asset().gltf);
    await engine.loadViewModel('ak47'); await engine.loadViewModel('usp'); await engine.loadViewModel('knife');
    const original = engine.viewModels.get('ak47');
    const warmed = vi.mocked(prewarmShaders).mock.calls.length;
    const pending = engine.loadViewModel('ak47');
    expect(engine.viewRoot.children).toEqual([original.scene]);
    expect(engine.viewAnimation).toBe(original.animation);
    expect(original.animation.playDraw).toHaveBeenLastCalledWith(1);
    await pending;
    for (const weapon of ['usp', 'knife', 'ak47']) await engine.loadViewModel(weapon);
    expect(load).toHaveBeenCalledTimes(3);
    expect(vi.mocked(prewarmShaders).mock.calls.length).toBe(warmed);
    expect(original.animation.dispose).not.toHaveBeenCalled();
    engine.clearViewModels();
  });
  it('deduplicates pending decodes and never replaces the selected rig with a stale request', async () => {
    const engine = fixture(), first = asset(), second = asset();
    let finish!: (value: GLTF) => void;
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockImplementationOnce(() => new Promise<GLTF>(resolve => {finish = resolve;})).mockResolvedValue(second.gltf);
    const a = engine.loadViewModel('usp'), b = engine.loadViewModel('usp');
    await engine.loadViewModel('knife'); finish(first.gltf); await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(engine.loadedViewEquipment).toBe('knife');
    expect(engine.viewRoot.children).toEqual([second.gltf.scene]);
    expect(engine.viewModels.has('usp')).toBe(true);
    engine.clearViewModels();
  });
  it('disposes stale cosmetic loads without deleting a new in-flight request for the same weapon', async () => {
    const engine = fixture(), old = asset(), current = asset();
    let finishOld!: (value: GLTF) => void, finishNew!: (value: GLTF) => void;
    vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockImplementationOnce(() => new Promise<GLTF>(resolve => {finishOld = resolve;}))
      .mockImplementationOnce(() => new Promise<GLTF>(resolve => {finishNew = resolve;}));
    const a = engine.loadViewModel('usp'); engine.clearViewModels();
    const b = engine.loadViewModel('usp');
    finishOld(old.gltf); await a;
    expect(old.dispose).toHaveBeenCalledOnce(); expect(engine.viewLoading.has('usp')).toBe(true);
    finishNew(current.gltf); await b;
    expect(engine.viewRoot.children).toEqual([current.gltf.scene]); expect(engine.onError).not.toHaveBeenCalled();
    engine.clearViewModels(); expect(current.dispose).toHaveBeenCalledOnce();
  });
  it('keeps at most three GPU rigs while cycling pickups and disposes all retained resources once', async () => {
    const engine = fixture(), assets: ReturnType<typeof asset>[] = [];
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {const model = asset(); assets.push(model); return model.gltf;});
    for (const weapon of ['ak47', 'usp', 'knife', 'deagle', 'awp', 'elite']) {
      await engine.loadViewModel(weapon);
      expect(engine.viewModels.size).toBeLessThanOrEqual(3);
      expect(engine.viewModels.has(weapon)).toBe(true);
    }
    engine.clearViewModels();
    for (const model of assets) expect(model.dispose).toHaveBeenCalledOnce();
    expect(engine.viewRoot.children).toHaveLength(0);
  });
  it('releases a late load after engine disposal instead of caching it', async () => {
    const engine = fixture(), model = asset();
    let finish!: (value: GLTF) => void;
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise<GLTF>(resolve => {finish = resolve;}));
    const pending = engine.loadViewModel('usp'); engine.disposed = true; engine.clearViewModels();
    finish(model.gltf); await pending;
    expect(model.dispose).toHaveBeenCalledOnce(); expect(engine.viewModels.size).toBe(0);
    expect(engine.onError).not.toHaveBeenCalled();
  });
});
