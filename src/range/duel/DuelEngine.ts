import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {DEG, UNIT, type Vec} from '../actor-physics';
import {RangeAudio} from '../audio';
import {type Settings, type Weapon} from '../config';
import {requestRawLock} from '../input';
import {mouseAngle, VERTICAL_FOV} from '../simulation';
import {VIEWMODEL_FOV, VIEWMODEL_OFFSET, viewmodelViewport} from '../viewmodel';
import {type DuelConfig} from './config';
import {duelArena, traceSolid} from './geometry';
import {DuelSimulation} from './simulation';
import type {DuelActorSnapshot, DuelEvent} from './types';
import {DuelAnimator} from './animation';
import {batchStaticMeshes, disposeResources, disposeSkeletons} from './render-resources';
import {fullyOccluded} from './visibility';
import {muzzleAnchor, viewMuzzleToWorld} from './tracers';
import type {SpatialSound} from '../spatial-audio';
import {recoilView} from '../view-recoil';
import {RoundFlow, deathView, deathFeet} from './round-flow';
import {type Equipment, type Slot} from '../equipment';
import {DamageFeedback} from './damage-feedback';
import {loadDuelHistory, type DuelReview, type DuelHistory} from './coaching';
import {FOOTSTEP_RANGE} from '../sound-model';
import {ViewAnimation} from '../view-animation';
import {equipmentStats} from '../equipment';

export type DuelStatus = {
  phase: 'ready' | 'fighting' | 'result'; paused: boolean; outcome?: 'won' | 'lost' | 'draw';
  health: number; armor: number; ammo: number; reloading: boolean; enemies: number;
  seconds: number; kills: number; damage: number; input: string; caption: string;
  shortcutProtected: boolean;
  nextRoundIn: number;
  equipped?: Equipment; review?: DuelReview; history?: DuelHistory[];
};

type KeyboardLock = {lock(keys: string[]): Promise<void>; unlock(): void};
const keyboardLock = () => (navigator as Navigator & {keyboard?: KeyboardLock}).keyboard;

const v3 = (point: Vec) => new THREE.Vector3(point.x, point.y, point.z);
const surface = (color: string, roughness = .86) => new THREE.MeshStandardMaterial({color, roughness});

export class DuelEngine {
  sim: DuelSimulation;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, .03, 120);
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, .01, 10);
  readonly viewRoot = new THREE.Group();
  readonly actors = new THREE.Group();
  readonly covers = new THREE.Group();
  readonly effects = new THREE.Group();
  readonly audio = new RangeAudio();
  readonly keys = new Set<string>();
  private readonly cleanup: (() => void)[] = [];
  private readonly observer: ResizeObserver;
  private frame = 0;
  private last = 0;
  private statusAt = 0;
  private disposed = false;
  private paused = false;
  private pointer: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private seed = Math.floor(Math.random() * 0x7fffffff);
  private viewAnimation?: ViewAnimation;
  private kick = 0;
  private inputName = 'Ready';
  private caption = '';
  private captionUntil = 0;
  private ownsFullscreen = false;
  private shortcutProtected = false;
  private kills = 0;
  private damage = 0;
  private models = new Map<number, THREE.Group>();
  private animators = new Map<number, DuelAnimator>();
  private targetScene?: THREE.Object3D;
  private targetClips: THREE.AnimationClip[] = [];
  private motionReady = false;
  private worldWeapons = new Map<Weapon, THREE.Object3D>();
  private worldLoading = new Set<Weapon>();
  private viewRevision = 0;
  private effectLife: {object: THREE.Object3D; until: number}[] = [];
  private width = 1;
  private height = 1;
  private readonly followPoint = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projectionView = new THREE.Matrix4();
  private readonly actorBounds = new THREE.Sphere(new THREE.Vector3(), 1.9);
  private animationTimes = new Map<number, number>();
  private animationClock = 0;
  private viewMuzzle?: THREE.Object3D;
  private botMuzzles = new Map<number, THREE.Object3D>();
  private readonly roundFlow = new RoundFlow();
  private sessionStarted = false;
  private deaths = new Map<number, number>();
  private readonly damageFeedback: DamageFeedback;
  private readonly shell = new THREE.Group();
  private renderedEquipment?: Equipment;
  private history = loadDuelHistory();
  private wasReloading = false;

  constructor(private readonly host: HTMLElement, private readonly crosshair: HTMLElement,
    private readonly onStatus: (status: DuelStatus) => void,
    private readonly onError: (message: string) => void, private settings: Settings, private config: DuelConfig) {
    this.sim = this.createSimulation();
    this.damageFeedback = new DamageFeedback(host);
    this.renderer = new THREE.WebGLRenderer({antialias: settings.quality !== 'low', powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.quality === 'low' ? 1 : 1.5));
    this.renderer.domElement.dataset.duel = 'true';
    this.renderer.domElement.setAttribute('aria-label', 'AI Duel arena');
    this.renderer.domElement.tabIndex = 0;
    host.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color('#9baaa5');
    this.scene.fog = new THREE.Fog('#9baaa5', 36, 75);
    this.scene.add(new THREE.HemisphereLight('#f5f7ef', '#4d5d55', 2));
    this.scene.add(new THREE.AmbientLight('#bec9c3', .7));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.4);
    sun.position.set(-9, 18, 8); this.scene.add(sun);
    this.viewScene.add(new THREE.HemisphereLight('#ffffff', '#66675b', 1.4));
    const viewLight = new THREE.DirectionalLight('#fff2dd', 2); viewLight.position.set(-2, 4, 2); this.viewScene.add(viewLight);
    this.viewScene.add(this.viewRoot);
    const floorMaterial = surface('#a5aea3');
    const floorTexture = new THREE.TextureLoader().load('/textures/floor.webp');
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(12, 16);
    floorMaterial.map = floorTexture;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, .18, 32), floorMaterial);
    floor.position.set(0, -.1, -4); this.scene.add(floor);
    const wallMaterial = surface('#899891');
    const wallTexture = new THREE.TextureLoader().load('/textures/wall.webp');
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(5, 2);
    wallMaterial.map = wallTexture;
    for (const [x, z, sx, sz] of [[-12, -4, .35, 32], [12, -4, .35, 32], [0, -20, 24, .35], [0, 12, 24, .35]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 4, sz), wallMaterial);
      wall.position.set(x, 2, z); this.scene.add(wall);
    }
    const postMaterial = surface('#506d70', .5);
    const lampMaterial = new THREE.MeshBasicMaterial({color: '#e6dfb5'});
    for (const side of [-1, 1]) {
      for (const z of [-15, -8, -1, 6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(.22, 4.4, .22), postMaterial);
        post.position.set(side * 11.7, 2.2, z); this.scene.add(post);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.1, .06, .3),
          lampMaterial);
        lamp.position.set(side * 10.9, 4.25, z); this.scene.add(lamp);
      }
    }
    this.decorateShell();
    const lane = new THREE.Mesh(new THREE.BoxGeometry(.08, .005, 30), surface('#c5c7a6'));
    lane.position.set(0, .002, -4); this.scene.add(lane);
    for (const object of [...this.scene.children]) if (object instanceof THREE.Mesh) this.shell.add(object);
    this.shell.scale.set(config.arenaScale, 1, config.arenaScale);
    this.scene.add(this.shell); batchStaticMeshes(this.shell);
    this.scene.add(this.actors, this.covers, this.effects);
    this.rebuildCovers();
    this.bindInput();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.resize();
    void this.loadTarget(); void this.loadViewModel(settings.weapon);
    this.report();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  private createSimulation() {
    const seed = this.seed++;
    const simulation = new DuelSimulation(this.config, seed, duelArena(seed, this.config.arenaScale), this.settings.weapon);
    simulation.playerAspect = this.camera.aspect;
    return simulation;
  }

  private rebuildCovers() {
    const oldMaterials = new Set<THREE.Material>();
    for (const child of this.covers.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.geometry.dispose();
      for (const mat of Array.isArray(child.material) ? child.material : [child.material]) oldMaterials.add(mat);
    }
    oldMaterials.forEach(material => material.dispose());
    this.covers.clear();
    const materials = {
      concrete: surface('#697a77'), cargo: surface('#465f64', .64), crate: surface('#967b59', .79),
      barrier: surface('#b3ad91'), cap: surface('#a8b7b1', .55), trim: surface('#354e52', .55),
      hazard: surface('#ddbf70', .62), crateEdge: surface('#654e38'),
    };
    const add = (size: [number, number, number], point: [number, number, number], material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...point); this.covers.add(mesh);
    };
    for (const {center, size, kind = 'concrete'} of this.sim.arena.solids) {
      add([size.x, size.y, size.z], [center.x, center.y, center.z], materials[kind]);
      const horizontal = size.x >= size.z;
      if (kind === 'crate') {
        add([size.x + .035, .07, size.z + .035], [center.x, center.y + size.y / 2, center.z], materials.crateEdge);
        add([size.x + .05, .07, size.z + .05], [center.x, center.y - size.y / 2 + .06, center.z], materials.crateEdge);
      } else {
        add([size.x + .04, .06, size.z + .04], [center.x, center.y + size.y / 2, center.z], materials.cap);
      }
      if (kind === 'cargo') {
        const length = horizontal ? size.x : size.z;
        for (let n = 1; n < Math.ceil(length / 1.3); n++) {
          const shift = -length / 2 + n * length / Math.ceil(length / 1.3);
          add(horizontal ? [.035, size.y * .9, size.z + .03] : [size.x + .03, size.y * .9, .035],
            [center.x + (horizontal ? shift : 0), center.y, center.z + (horizontal ? 0 : shift)], materials.trim);
        }
      } else if (kind === 'barrier') {
        add(horizontal ? [size.x + .035, .06, size.z + .04] : [size.x + .04, .06, size.z + .035],
          [center.x, center.y + size.y / 2 - .12, center.z], materials.hazard);
      } else if (kind === 'concrete') {
        for (const face of [-1, 1]) add(horizontal ? [size.x * .82, .04, .025] : [.025, .04, size.z * .82],
          [center.x + (horizontal ? 0 : face * (size.x / 2 + .014)), .48,
            center.z + (horizontal ? face * (size.z / 2 + .014) : 0)], materials.hazard);
      }
    }
    batchStaticMeshes(this.covers);
  }

  private decorateShell() {
    const steel = surface('#344647', .53);
    const trim = surface('#889794', .57);
    const amber = surface('#d2ad61', .65);
    const panel = surface('#52615c', .73);
    const lamp = new THREE.MeshBasicMaterial({color: '#e9ecdc'});
    const add = (size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position); this.scene.add(mesh);
      return mesh;
    };
    add([24, .22, 32], [0, 5.9, -4], new THREE.MeshBasicMaterial({color: '#677873'}));
    for (const z of [-19, -14, -9, -4, 1, 6, 11]) {
      add([24, .26, .16], [0, 5.68, z], steel);
      for (const x of [-8, 0, 8]) {
        add([2.6, .06, .48], [x, 5.51, z], steel);
        add([2.35, .02, .34], [x, 5.47, z], lamp);
      }
    }
    for (const x of [-11.72, 11.72]) {
      for (const z of [-17, -11, -5, 1, 7]) {
        add([.32, 5.45, .42], [x, 2.72, z], steel);
        add([.54, .12, .64], [x, .06, z], trim);
        add([.37, 1.1, .48], [x, .68, z], amber);
      }
      add([.08, .08, 30], [x * .91, 3.75, -4], trim);
      for (const z of [-15, -5, 5]) {
        add([.08, 1.55, .76], [x * .98, .82, z], panel);
        for (let slot = 0; slot < 5; slot++) add([.09, .022, .56], [x * .975, .38 + slot * .19, z], steel);
      }
    }
    for (const side of [-1, 1]) for (const z of [-11, 3]) {
      add([1.4, .02, 3.1], [side * 9.6, .015, z], trim);
      add([.11, .02, 3.1], [side * 8.85, .03, z], amber);
    }
    for (const z of [-19.79, 11.79]) {
      add([2.6, 3.3, .04], [0, 1.66, z], steel);
      add([2.28, 3.04, .045], [0, 1.55, z + (z < 0 ? .03 : -.03)], panel);
      add([2.6, .12, .07], [0, 3.36, z + (z < 0 ? .04 : -.04)], amber);
    }
  }

  private async loadTarget() {
    try {
      const {scene, animations} = await new GLTFLoader().loadAsync('/models/target.glb');
      if (this.disposed) {disposeResources([scene]); return;}
      this.targetScene = scene; this.targetClips = animations;
      this.rebuildActors();
      this.loadWorldWeapons();
      try {
        const motion = await new GLTFLoader().loadAsync('/models/duel-motion.glb');
        if (this.disposed) return;
        this.targetClips = motion.animations;
        this.motionReady = true;
        this.rebuildActors();
      } catch { /* Keep the baseline idle/run set if local native clips are absent. */ }
    } catch { if (!this.disposed) this.onError('The player model is unavailable. Run npm run assets:build, then reload.'); }
  }

  private rebuildActors() {
    this.animators.forEach(animator => animator.dispose()); this.animators.clear();
    this.animationTimes.clear();
    this.botMuzzles.clear();
    disposeSkeletons(this.actors);
    this.actors.clear(); this.models.clear();
    if (!this.targetScene) return;
    for (const actor of this.sim.snapshot().slice(1)) {
      const root = new THREE.Group();
      const model = cloneSkeleton(this.targetScene);
      const held = this.attachWorldWeapon(model, actor.equipment as Weapon);
      const muzzle = held ? muzzleAnchor(held) : undefined;
      if (muzzle) this.botMuzzles.set(actor.id, muzzle);
      root.add(model); this.actors.add(root); this.models.set(actor.id, root);
      this.animators.set(actor.id, new DuelAnimator(model, this.targetClips, (actor.id * .317) % 1));
    }
  }

  private loadWorldWeapons() {
    for (const weapon of new Set(this.sim.snapshot().slice(1).map(actor => actor.equipment as Weapon))) {
      if (weapon === 'm4a1s' || this.worldWeapons.has(weapon) || this.worldLoading.has(weapon)) continue;
      this.worldLoading.add(weapon);
      void new GLTFLoader().loadAsync(`/models/${weapon}.glb`).then(({scene}) => {
        if (this.disposed) {disposeResources([scene]); return;}
        this.worldWeapons.set(weapon, scene);
        this.rebuildActors();
      }).catch(() => {
        if (!this.disposed) this.onError(`The ${weapon} world model is unavailable. Run npm run assets:build, then reload.`);
      }).finally(() => this.worldLoading.delete(weapon));
    }
  }

  private attachWorldWeapon(model: THREE.Object3D, weapon: Weapon) {
    // GLTFLoader sanitizes periods in animation node names.
    const held = model.getObjectByName('held_weapon_target001') ?? model.getObjectByName('held_weapon_target.001');
    if (weapon === 'm4a1s') return held;
    const mount = model.getObjectByName('wpn');
    const source = this.worldWeapons.get(weapon);
    if (!held || !mount || !source) return held;
    held.visible = false;
    const replacement = source.clone(true);
    replacement.name = `held_${weapon}`;
    replacement.position.copy(held.position);
    replacement.quaternion.copy(held.quaternion);
    replacement.scale.copy(held.scale);
    mount.add(replacement);
    return replacement;
  }

  private async loadViewModel(weapon: Equipment) {
    this.renderedEquipment = weapon;
    const revision = ++this.viewRevision;
    try {
      const {scene, animations} = await new GLTFLoader().loadAsync(`/models/view-${weapon}.glb`);
      if (this.disposed || revision !== this.viewRevision) {disposeResources([scene]); return;}
      this.viewAnimation?.dispose();
      disposeResources([this.viewRoot]);
      this.viewRoot.clear(); scene.rotation.y = Math.PI; this.viewRoot.add(scene);
      this.viewAnimation = new ViewAnimation(scene, animations);
      this.viewMuzzle = muzzleAnchor(scene);
    } catch { if (!this.disposed && revision === this.viewRevision) this.onError('The weapon model is unavailable. Run npm run assets:build, then reload.'); }
  }

  setSettings(settings: Settings) {
    if (settings === this.settings) return;
    const weaponChanged = settings.weapon !== this.settings.weapon;
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = settings;
    if (weaponChanged) void this.loadViewModel(settings.weapon);
    if (weaponChanged) this.restart();
    if (qualityChanged) this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.quality === 'low' ? 1 : 1.5));
    this.resize();
  }

  setConfig(config: DuelConfig) {
    if (config === this.config) return;
    this.config = config;
    this.restart();
  }

  restart(continuous = false) {
    this.paused = false; this.pointer = null;
    if (!continuous) {
      this.keys.clear();
      this.sessionStarted = false;
      this.releaseShortcuts();
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    }
    this.sim = this.createSimulation(); this.kills = this.damage = 0;
    this.shell.scale.set(this.config.arenaScale, 1, this.config.arenaScale);
    this.damageFeedback.clear(); this.wasReloading = false;
    this.roundFlow.reset(); this.deaths.clear();
    this.caption = ''; this.captionUntil = 0; this.kick = 0;
    this.clearEffects(); this.rebuildCovers(); this.rebuildActors(); this.report();
    this.loadWorldWeapons();
    if (continuous) {this.sim.start(); this.updateMovement(); this.report();}
  }

  async enter() {
    if (this.sim.phase === 'ready') this.sim.start(); else this.sim.resume();
    this.sessionStarted = true;
    this.paused = false;
    this.renderer.domElement.focus({preventScroll: true});
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.inputName = coarse ? 'Touch' : 'Mouse';
    const stage = this.host.closest('.range-stage') as HTMLElement | null;
    const pointerLock = !coarse ? requestRawLock(this.renderer.domElement) : Promise.resolve<'drag'>('drag');
    const fullscreen = !coarse && this.config.shortcutProtection && !document.fullscreenElement && stage?.requestFullscreen
      ? stage.requestFullscreen().then(() => {this.ownsFullscreen = true; return true;}).catch(() => false)
      : Promise.resolve(!!document.fullscreenElement);
    void this.audio.unlock(this.settings.weapon);
    void this.audio.unlock('usp'); void this.audio.unlock('knife');
    for (const actor of this.sim.actors.slice(1)) if (actor.weapon.id !== this.settings.weapon) void this.audio.unlock(actor.weapon.id);
    if (!coarse) {
      const full = await fullscreen;
      if (full && keyboardLock()) {
        try {await keyboardLock()!.lock(['KeyW']); this.shortcutProtected = true;}
        catch {this.shortcutProtected = false;}
      }
      const mode = await pointerLock;
      if (mode === 'drag') this.inputName = 'Drag aim';
    }
    this.report();
  }

  private releaseShortcuts() {
    if (this.shortcutProtected) keyboardLock()?.unlock();
    this.shortcutProtected = false;
    if (this.ownsFullscreen) {
      this.ownsFullscreen = false;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
  }

  pause() {
    if (this.sim.phase === 'ready') return;
    this.paused = true; this.sim.pause(); this.keys.clear(); this.updateMovement();
    this.caption = ''; this.captionUntil = 0;
    this.damageFeedback.clear();
    this.releaseShortcuts();
    this.sim.command(0, {fireHeld: false});
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.report();
  }

  private listen(target: EventTarget, name: string, callback: EventListener) {
    target.addEventListener(name, callback); this.cleanup.push(() => target.removeEventListener(name, callback));
  }

  private bindInput() {
    const canvas = this.renderer.domElement;
    this.listen(canvas, 'pointerdown', ((event: PointerEvent) => {
      if (event.button !== 0) return;
      if (this.sim.phase === 'ready' || this.paused) { void this.enter(); return; }
      if (this.sim.phase !== 'fighting') return;
      this.pointer = event.pointerId; this.pointerX = event.clientX; this.pointerY = event.clientY;
      if (event.pointerType !== 'mouse') this.sim.command(0, {firePressed: true});
      else this.sim.command(0, {fireHeld: true, firePressed: true});
      if (!document.pointerLockElement) canvas.setPointerCapture(event.pointerId);
    }) as EventListener);
    this.listen(document, 'pointermove', ((event: PointerEvent) => {
      if (this.sim.phase !== 'fighting' || this.paused) return;
      let dx = 0, dy = 0;
      if (document.pointerLockElement === canvas && event.pointerType === 'mouse') {
        dx = event.movementX; dy = event.movementY;
      } else if (this.pointer === event.pointerId) {
        dx = event.clientX - this.pointerX; dy = event.clientY - this.pointerY;
        this.pointerX = event.clientX; this.pointerY = event.clientY;
      }
      const scale = event.pointerType === 'mouse' ? mouseAngle(1, this.settings.sensitivity) : .0025;
      if (dx || dy) this.sim.command(0, {yawDelta: -dx * scale,
        pitchDelta: -dy * scale * (this.settings.invertY ? -1 : 1)});
    }) as EventListener);
    this.listen(document, 'pointerup', ((event: PointerEvent) => {
      if (this.pointer !== event.pointerId) return;
      this.pointer = null; this.sim.command(0, {fireHeld: false});
    }) as EventListener);
    this.listen(canvas, 'pointercancel', (() => this.pause()) as EventListener);
    this.listen(canvas, 'contextmenu', (event => event.preventDefault()) as EventListener);
    this.listen(window, 'keydown', ((event: KeyboardEvent) => {
      if (event.ctrlKey && event.code === 'KeyW' && this.sessionStarted) event.preventDefault();
      if (event.code === 'Escape' && this.sim.phase !== 'ready') {this.pause(); return;}
      if (this.sim.phase === 'ready' || this.paused || event.target instanceof HTMLElement && event.target.matches('input,select,button,textarea')) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyC', 'Space'].includes(event.code)) {
        event.preventDefault(); this.keys.add(event.code); this.updateMovement();
      }
      if (event.code === 'KeyR' && !event.repeat) this.sim.command(0, {reloadPressed: true});
      if (['Digit1', 'Digit2', 'Digit3'].includes(event.code) && !event.repeat) this.equip(Number(event.code.slice(-1)) as Slot);
    }) as EventListener);
    this.listen(window, 'keyup', ((event: KeyboardEvent) => {this.keys.delete(event.code); this.updateMovement();}) as EventListener);
    this.listen(window, 'blur', (() => this.pause()) as EventListener);
    this.listen(document, 'visibilitychange', (() => {if (document.hidden) this.pause();}) as EventListener);
    this.listen(document, 'pointerlockchange', (() => {
      if (document.pointerLockElement !== canvas && this.inputName !== 'Drag aim' && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
    this.listen(document, 'fullscreenchange', (() => {
      if (this.ownsFullscreen && !document.fullscreenElement && this.sim.phase !== 'ready') {
        this.ownsFullscreen = false;
        this.pause();
      }
    }) as EventListener);
  }

  private updateMovement() {
    this.sim.command(0, {forward: +this.keys.has('KeyW') - +this.keys.has('KeyS'),
      side: +this.keys.has('KeyD') - +this.keys.has('KeyA'),
      walk: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'), jump: this.keys.has('Space')});
  }

  equip(slot: Slot) {this.sim.equipPlayer(slot); this.report(); this.renderer.domElement.focus({preventScroll: true});}

  private processEvents(events: DuelEvent[]) {
    if (!events.length) return;
    const shots = new Map<number, Extract<DuelEvent, {kind: 'fire'}>>();
    const endpoints = new Map<number, Vec>();
    const player = this.sim.snapshot()[0];
    for (const event of events) {
      if (event.kind === 'fire') {
        shots.set(event.shotId, event);
        if (event.actorId === 0) {this.kick = 1; this.audio.play(event.equipment, this.settings.volume);}
        else this.audio.play(event.equipment, this.settings.volume, this.soundLocation(event.origin));
      } else if (event.kind === 'sound') {
        const dx = event.point.x - player.position.x, dz = event.point.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        const own = event.actorId === 0;
        if (distance < FOOTSTEP_RANGE) {
          const point = {...event.point, y: (this.sim.actors[event.actorId]?.feet ?? 0) + .06};
          const support = this.sim.arena.solids.find(solid => Math.abs(solid.center.y + solid.size.y / 2 - point.y + .06) < .05 &&
            Math.abs(point.x - solid.center.x) < solid.size.x / 2 + .2 && Math.abs(point.z - solid.center.z) < solid.size.z / 2 + .2);
          const material = support?.kind === 'crate' ? 'wood' : support?.kind === 'cargo' ? 'metal' : 'concrete';
          this.audio.playStep(this.settings.volume * (own ? .45 : 1), 0, event.sound === 'landing',
            own ? undefined : this.soundLocation(point, FOOTSTEP_RANGE), material);
        }
      } else if (event.kind === 'surface') endpoints.set(event.shotId, event.point);
      else if (event.kind === 'hit') {
        endpoints.set(event.shotId, event.point);
        if (event.lethal && !this.deaths.has(event.victim)) this.deaths.set(event.victim, this.animationClock);
        if (event.shooter === 0) {
          this.audio.playHit(event.group === 'head', event.armorDamage > 0, false, this.settings.volume);
          this.damage += event.healthDamage;
          if (event.lethal) this.kills++;
          this.caption = event.group === 'head' ? 'HEADSHOT' : 'BODY HIT';
          this.captionUntil = this.animationClock + .65;
        } else if (event.victim === 0) {
          const source = this.sim.actors[event.shooter]?.position;
          if (source) this.damageFeedback.hit(player.position, source, event.healthDamage, this.animationClock);
          this.audio.playHit(event.group === 'head', event.armorDamage > 0, true, this.settings.volume);
          this.caption = `HIT -${Math.round(event.healthDamage)}`;
          this.captionUntil = this.animationClock + .65;
        }
        if (event.lethal) this.audio.playEvent('death', this.settings.volume * .4,
          event.victim === 0 ? undefined : this.soundLocation(event.point));
      } else if (event.kind === 'round') {
        this.roundFlow.finish();
        this.history.unshift({date: new Date().toISOString(), outcome: event.outcome, review: this.sim.coach.review()});
        this.history = this.history.slice(0, 50);
        try {localStorage.setItem('spraylab.duel.history.v1', JSON.stringify(this.history));} catch { /* Session-only history. */ }
      }
    }
    for (const [id, shot] of shots) {
      const trail = shot.actorId === 0 ? 10 : 5;
      const end = endpoints.get(id) ?? {x: shot.origin.x + shot.direction.x * trail,
        y: shot.origin.y + shot.direction.y * trail, z: shot.origin.z + shot.direction.z * trail};
      let start: THREE.Vector3 | undefined;
      if (shot.actorId === 0 && this.viewMuzzle) {
        this.viewScene.updateMatrixWorld(true);
        start = viewMuzzleToWorld(this.viewMuzzle.getWorldPosition(new THREE.Vector3()), this.viewCamera,
          this.camera, this.width, this.height);
      } else if (shot.actorId > 0) {
        const muzzle = this.botMuzzles.get(shot.actorId);
        muzzle?.updateWorldMatrix(true, false);
        start = muzzle?.getWorldPosition(new THREE.Vector3());
      }
      if (start && shot.equipment !== 'knife') {
        const delta = v3(end).sub(start), length = delta.length();
        const endpointAhead = v3(end).sub(this.camera.position).dot(this.camera.getWorldDirection(new THREE.Vector3())) > .1;
        const obstruction = traceSolid(start, delta.clone().normalize(), this.sim.arena, length);
        if (length > .15 && endpointAhead && obstruction.distance >= length - .08) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, v3(end)]),
            new THREE.LineBasicMaterial({color: shot.actorId === 0 ? '#e5d177' : '#ed8c66', transparent: true, opacity: .65}));
          this.effects.add(line); this.effectLife.push({object: line, until: this.animationClock + .065});
        }
      }
      if (endpoints.has(id)) {
        const impact = new THREE.Mesh(new THREE.SphereGeometry(.023 * this.settings.impactSize, 6, 4),
          new THREE.MeshBasicMaterial({color: shot.actorId === 0 ? '#e6d170' : '#e99b78'}));
        impact.position.copy(v3(end)); this.effects.add(impact); this.effectLife.push({object: impact, until: this.animationClock + 2});
      }
    }
  }

  private soundLocation(point: Vec, range = 55): SpatialSound {
    const delta = v3(point).sub(this.camera.position), distance = delta.length();
    return {position: point, range, occluded: distance > .1 &&
      traceSolid(this.camera.position, delta.normalize(), this.sim.arena, distance - .05).distance < distance - .05};
  }

  private clearEffects() {
    for (const effect of this.effectLife) {
      this.effects.remove(effect.object);
      if (effect.object instanceof THREE.Line || effect.object instanceof THREE.Mesh) {
        effect.object.geometry.dispose();
        (effect.object.material as THREE.Material).dispose();
      }
    }
    this.effectLife = [];
  }

  private syncActors(snapshots: DuelActorSnapshot[], dt: number) {
    this.animationClock += dt;
    this.frustum.setFromProjectionMatrix(this.projectionView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    for (const actor of snapshots.slice(1)) {
      const model = this.models.get(actor.id);
      if (!model) continue;
      this.actorBounds.center.set(actor.position.x, actor.feet + 1, actor.position.z);
      model.visible = this.frustum.intersectsSphere(this.actorBounds) &&
        (!this.covers.visible || !fullyOccluded(this.camera.position, actor, this.sim.arena));
      const deathAge = this.animationClock - (this.deaths.get(actor.id) ?? this.animationClock);
      model.position.set(actor.position.x, actor.alive ? actor.feet : deathFeet(actor, deathAge, this.sim.arena.solids), actor.position.z);
      model.rotation.y = actor.yaw - Math.PI;
      if (model.visible) {
        const elapsed = this.animationTimes.has(actor.id) ? this.animationClock - this.animationTimes.get(actor.id)! : dt;
        this.animators.get(actor.id)?.update(this.sim.phase === 'result' && actor.alive
          ? {...actor, velocity: {x: 0, z: 0}} : actor, dt > 0 ? elapsed : 0, actor.alive ? undefined : deathAge);
        this.animationTimes.set(actor.id, this.animationClock);
      }
    }
  }

  private resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.width = width; this.height = height;
    this.renderer.setSize(width, height);
    this.camera.aspect = this.settings.aspect === 'native' ? width / height
      : this.settings.aspect.split(':').map(Number).reduce((a, b) => a / b);
    this.sim.playerAspect = this.camera.aspect;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = viewmodelViewport(width, height).aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  private report() {
    const [player, ...bots] = this.sim.snapshot();
    this.onStatus({phase: this.sim.phase, paused: this.paused, outcome: this.sim.outcome,
      health: player.health, armor: player.armor, ammo: player.ammo, reloading: player.reloading,
      enemies: bots.filter(bot => bot.alive).length, seconds: this.sim.time, kills: this.kills,
      damage: this.damage, input: this.inputName, caption: this.animationClock < this.captionUntil ? this.caption : '',
      shortcutProtected: this.shortcutProtected, nextRoundIn: this.roundFlow.remaining(this.config.feedbackSeconds),
      equipped: player.equipment, review: this.sim.coach.review(), history: this.history});
  }

  private tick(timestamp: number) {
    if (this.disposed) return;
    const dt = this.last ? Math.min((timestamp - this.last) / 1000, .25) : 0;
    this.last = timestamp;
    if (this.sessionStarted && this.roundFlow.advance(dt, this.paused, this.config.feedbackSeconds)) this.restart(true);
    this.sim.advance(dt);
    const events = this.sim.drainEvents();
    const snapshots = this.sim.renderSnapshot();
    const player = snapshots[0];
    if (player.equipment !== this.renderedEquipment) {
      void this.loadViewModel(player.equipment);
      void this.audio.unlock(player.equipment).then(() => {
        if (!this.disposed && this.sim.actors[0].weapon.id === player.equipment && !this.paused)
          this.audio.playEvent(`${player.equipment}-draw`, this.settings.volume * .5);
      });
    }
    if (player.reloading && !this.wasReloading) this.audio.playEvent(`${player.equipment}-reload`, this.settings.volume * .55);
    this.wasReloading = player.reloading;
    this.viewAnimation?.update(Math.max(0, this.sim.actors[0].weapon.reloadUntil - this.sim.time), equipmentStats(player.equipment).reload);
    const visualRecoil = this.sim.actors[0].weapon.recovery.predict(this.sim.accumulator);
    const view = recoilView(player.yaw, player.pitch, visualRecoil);
    const deathAge = this.animationClock - (this.deaths.get(0) ?? this.animationClock);
    const death = deathView(deathAge, player.position.y - player.feet);
    this.camera.position.set(player.position.x, player.position.y, player.position.z);
    if (!player.alive) this.camera.position.y = deathFeet(player, deathAge, this.sim.arena.solids) + death.height;
    this.camera.rotation.set(view.pitch + (player.alive ? 0 : death.pitch), view.yaw, player.alive ? 0 : death.roll, 'YXZ');
    this.camera.updateMatrixWorld();
    this.syncActors(snapshots, this.sim.phase !== 'ready' && !this.paused ? dt : 0);
    this.kick = Math.max(0, this.kick - dt * 8);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.viewRoot.position.set(VIEWMODEL_OFFSET.x,
      VIEWMODEL_OFFSET.y + Math.sin(this.sim.time * 12) * Math.min(speed, 1) * .002 - (player.alive ? 0 : death.weaponDrop * .5), this.kick * .018);
    this.viewRoot.visible = player.alive || deathAge < .25;
    this.viewRoot.rotation.x = this.kick * (player.equipment === 'knife' ? -.6 : .035) + view.weaponPitch;
    this.viewRoot.rotation.y = view.weaponYaw;
    this.viewRoot.rotation.z = player.equipment === 'knife' ? this.kick * -.45 : 0;
    this.audio.updateListener(this.camera.position, view.yaw, view.pitch);
    this.processEvents(events);
    this.damageFeedback.update(this.animationClock, player.yaw);
    const recoil = this.settings.follow ? this.sim.actors[0].weapon.recovery.recoil : {yaw: 0, pitch: 0};
    const yaw = player.yaw - recoil.yaw * DEG, pitch = player.pitch + recoil.pitch * DEG;
    const followPoint = this.followPoint.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(10).add(this.camera.position).project(this.camera);
    if (!this.settings.follow) followPoint.set(0, 0, 0);
    this.crosshair.style.visibility = player.alive ? '' : 'hidden';
    this.crosshair.style.transform = `translate(${followPoint.x * this.width / 2}px, ${-followPoint.y * this.height / 2}px)`;
    this.crosshair.style.setProperty('--motion-gap', this.settings.crosshair.dynamic ? `${speed * 1.2 + this.kick * 4}px` : '0px');
    for (let i = this.effectLife.length - 1; i >= 0; i--) {
      const effect = this.effectLife[i];
      if (effect.object instanceof THREE.Line) (effect.object.material as THREE.LineBasicMaterial).opacity =
        Math.max(0, (effect.until - this.animationClock) / .065) * .65;
      if (this.animationClock < effect.until) continue;
      this.effects.remove(effect.object);
      if (effect.object instanceof THREE.Line || effect.object instanceof THREE.Mesh) {
        effect.object.geometry.dispose(); (effect.object.material as THREE.Material).dispose();
      }
      this.effectLife.splice(i, 1);
    }
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.autoClear = true; this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false; this.renderer.clearDepth();
    const viewport = viewmodelViewport(this.width, this.height);
    this.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.renderer.render(this.viewScene, this.viewCamera);
    if (timestamp - this.statusAt > 100) {this.statusAt = timestamp; this.report();}
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.pause(); this.releaseShortcuts(); this.observer.disconnect();
    this.cleanup.forEach(fn => fn()); this.clearEffects(); this.audio.dispose(); this.damageFeedback.dispose();
    this.animators.forEach(animator => animator.dispose()); this.viewAnimation?.dispose();
    disposeResources([this.scene, this.viewScene, ...this.worldWeapons.values(), ...(this.targetScene ? [this.targetScene] : [])]);
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
