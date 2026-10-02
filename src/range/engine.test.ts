import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RangeEngine } from './engine';
import { defaults, modeNames, Mode, Weapon } from './config';
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

it.each([true, false])('keeps touch or genuinely unsupported capture usable (touch=%s)', async coarse => {
  const engine = Object.create(RangeEngine.prototype) as RangeEngine;
  const request = vi.fn().mockRejectedValue(new Error('Touch must not request pointer lock'));
  const guard = {enter:vi.fn().mockResolvedValue(undefined)};
  Object.assign(engine,{enterRevision:0,sim:{active:false,equipped:'ak47',settings:defaults},
    renderer:{domElement:{focus:vi.fn(),requestPointerLock:coarse ? request : undefined}},
    audio:{unlock:vi.fn().mockResolvedValue(undefined)},shortcuts:guard});
  vi.stubGlobal('matchMedia',()=>({matches:coarse}));
  try {
    await engine.enter();
    expect(engine.sim.active).toBe(true); expect(engine.inputStatus).toBe(coarse ? 'Touch' : 'Drag aim (mouse capture unsupported)');
    expect(request).not.toHaveBeenCalled(); expect(guard.enter).toHaveBeenCalledWith(false);
  } finally {vi.unstubAllGlobals();}
});

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
    const cast = vi.spyOn(body, 'raycast');
    body.userData.skipScoring = true;
    expect(engine.castTargets(origin, direction)).toHaveLength(0);
    expect(cast).not.toHaveBeenCalled();
    body.userData.skipScoring = false; target.visible = false;
    expect(engine.castTargets(origin, direction)).toHaveLength(0);
  });
  it('blocks cover shots and ignores a wall only when its whole lane is hidden', () => {
    const {engine,wall}=rayFixture();
    const lane=new THREE.Group();wall.parent!.add(lane);lane.add(wall);wall.position.z=-9;
    expect(engine.castTargets(origin,direction)).toHaveLength(0);
    lane.visible=false;
    expect(engine.castTargets(origin,direction).length).toBeGreaterThan(0);
  });
});

it('R8 secondary icon fires once while held pointer input can repeat at native cadence',()=>{
  const engine=Object.create(RangeEngine.prototype) as RangeEngine;
  engine.sim=new Simulation({...defaults,mode:'guided',weapon:'revolver',spread:false});
  engine.sim.active=true;
  let shots=0;engine.sim.onShot=()=>shots++;
  engine.secondary();expect(shots).toBe(1);expect(engine.sim.firing).toBe(false);
  for(let tick=0;tick<70;tick++)engine.sim.step(1/128);
  expect(shots).toBe(1);
  engine.secondary(true);for(let tick=0;tick<140;tick++)engine.sim.step(1/128);
  expect(shots).toBeGreaterThan(3);
  engine.sim.release('mouse');const before=shots;
  for(let tick=0;tick<140;tick++)engine.sim.step(1/128);
  expect(shots).toBe(before);
});

it.each(Object.keys(modeNames).filter(mode => mode !== 'hearing') as Mode[])('shows distinct head/body feedback for actual hits in %s mode',mode=>{
  const {engine,body,wall,target}=rayFixture();
  engine.sim=new Simulation({...defaults,mode});
  Object.assign(engine, {xpTargets: new Set(), viewAnimations: new Map(), viewMuzzles: new Map(), viewFlashes: {fire: vi.fn()}});
  body.position.z=0;target.position.z=-10;
  engine.targets=[target];engine.impacts=new THREE.Group();
  engine.markerGeometry=new THREE.SphereGeometry(.018,6,4);
  engine.hitMaterial=new THREE.MeshBasicMaterial();engine.bodyMaterial=new THREE.MeshBasicMaterial();engine.missMaterial=new THREE.MeshBasicMaterial();
  engine.hitmarker={style:{}} as HTMLElement;engine.hitCaption={style:{},textContent:''} as HTMLDivElement;
  engine.audio={play:vi.fn(),playHit:vi.fn()} as unknown as RangeEngine['audio'];
  try {
    for(const [y,label,color] of [[1.7,'HEADSHOT','#ffdc59'],[1.1,'BODY HIT','#51edee']] as const){
      engine.shot({index:0,at:0,origin:{x:0,y,z:0},direction:{x:0,y:0,z:-1},recoil:{yaw:0,pitch:0}});
      expect(engine.hitCaption.textContent).toBe(label);
      expect(engine.hitCaption.style.color).toBe(color);expect(engine.hitTime).toBe(.45);
      expect(engine.sim.samples[engine.sim.samples.length-1]?.hit).toBe(true);
    }
    expect(engine.sim.hits).toBe(2);expect(engine.sim.heads).toBe(1);
  } finally {
    engine.markerGeometry.dispose();engine.hitMaterial.dispose();engine.bodyMaterial.dispose();engine.missMaterial.dispose();
    body.geometry.dispose();wall.geometry.dispose();
  }
});

it('bounds the GPU weapon cache and never evicts the selected assembly', () => {
  const engine = Object.create(RangeEngine.prototype) as RangeEngine;
  engine.sim = new Simulation({...defaults, weapon: 'm4a4'});
  engine.modelCache = new Map<Weapon, THREE.Object3D>(['ak47', 'm4a4', 'm4a1s', 'galil', 'famas'].map(id => [id as Weapon, new THREE.Group()]));
  const dispose = vi.fn(); engine.disposeObject = dispose;
  engine.viewAnimations = new Map();
  Object.assign(engine, {viewMuzzles: new Map()});
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
  engine.clearInput = vi.fn();
  vi.stubGlobal('document', {pointerLockElement: null});
  try {
    engine.pause();
    expect(engine.clearInput).toHaveBeenCalledOnce();
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
