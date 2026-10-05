import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {DEG, UNIT, type Vec} from '../actor-physics';
import {RangeAudio} from '../audio';
import {gameData,loadoutWeapon, type Settings, type Weapon} from '../config';
import {requestRawLock} from '../input';
import {mouseAngle, VERTICAL_FOV} from '../simulation';
import {VIEWMODEL_FOV, VIEWMODEL_OFFSET, viewmodelViewport} from '../viewmodel';
import {botConfig, type DuelConfig} from './config';
import {duelArena, traceSolid} from './geometry';
import {DuelSimulation} from './simulation';
import type {DuelActorSnapshot, DuelEvent} from './types';
import {DuelAnimator, nativeGestureClips} from './animation';
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
import {ScopeOverlay} from '../scope-overlay';
import {addArenaCover,addArenaTraversal,createEnvironmentRenderMap,syncEnvironmentRenderMap} from './arena-props';
import {blocksMovement} from './environment';
import {AcousticScene} from '../spatial-audio';
import {seedForDesign} from './arena-layout';
import {applyCosmetic, cosmeticAsset, cosmeticCatalog} from '../cosmetics';
import weaponMounts from '../weapon-mounts.json';
import {equippedCosmetic,type DuelXpSetup,type ProgressionController} from '../progression';
import {prepareNativeViewAssembly} from '../native-view-actions';
import {ActorCosmeticLoader, loadAgent, type ActorCosmeticInstance} from '../actor-cosmetics';
import {REVOLVER_WINDUP} from '../weapon-actions';
import {FrameMetrics, FramePacer, PerformanceMeter, qualityPolicy, renderPixelRatio} from '../performance';
import {ShortcutGuard} from '../shortcut-guard';
import {MuzzleFlashes, ShotEffects} from '../weapon-effects';
import {DuelRadar} from './radar';
import {actorShadows,ActorShadowRenderer} from './shadow-scene';

export type DuelStatus = {
  phase: 'ready' | 'fighting' | 'result'; paused: boolean; outcome?: 'won' | 'lost' | 'draw';
  health: number; armor: number; ammo: number; reloading: boolean; enemies: number;
  seconds: number; kills: number; damage: number; input: string; caption: string;
  shortcutProtected: boolean;
  nextRoundIn: number;
  equipped?: Equipment; review?: DuelReview; history?: DuelHistory[];
  loadout?: {primary: Weapon | null; sidearm: Settings['sidearm'] | null}; pickup?: Equipment;
  interaction?:string;
  reserve?:number; reloadSilent?:boolean; recharge?:number;
  arenaDesign?: string;
};

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
  private readonly dynamicCovers = new THREE.Group();
  private environmentModels = new Map<string,THREE.Group>();
  private environmentRevision = -1;
  private readonly acoustics = new AcousticScene([], 'warehouse');
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
  private shortcuts: ShortcutGuard;
  private entering = false;
  private enterRevision = 0;
  private kills = 0;
  private damage = 0;
  private models = new Map<number, THREE.Group>();
  private heldWeapons = new Map<number, THREE.Object3D>();
  private animators = new Map<number, DuelAnimator>();
  private gestureClips=new Map<Equipment,THREE.AnimationClip[]>();
  private gestureLoading=new Set<Equipment>();
  private targetScene?: THREE.Object3D;
  private targetClips: THREE.AnimationClip[] = [];
  private motionReady = false;
  private worldWeapons = new Map<Equipment, THREE.Object3D>();
  private worldLoading = new Set<Equipment>();
  private viewRevision = 0;
  private shotEffects: ShotEffects;
  private viewFlashes: MuzzleFlashes;
  private shotCounts = new Map<number, number>();
  private ownTraceColor = new THREE.Color('#fff0c9');
  private enemyTraceColor = new THREE.Color('#ffd0a4');
  private width = 1;
  private height = 1;
  private readonly followPoint = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projectionView = new THREE.Matrix4();
  private readonly actorBounds = new THREE.Sphere(new THREE.Vector3(), 1.9);
  private animationTimes = new Map<number, number>();
  private animationClock = 0;
  private viewAnimationElapsed = 0;
  private pacer = new FramePacer();
  private metrics = new FrameMetrics();
  private meter: PerformanceMeter;
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
  private scope: ScopeOverlay;
  private dropModels = new Map<number, THREE.Object3D>();
  private pickupDrawing = false;
  private cosmeticKey = '';
  private xpAttempt: string | null = null;
  private xpRevision = 0;
  private xpDamage = new Map<number, number>();
  private actorLoader = new ActorCosmeticLoader();
  private agentInstance?: ActorCosmeticInstance;
  private agentRevision = 0;
  private readonly radar: DuelRadar;
  private radarAt = 0;
  private readonly actorShadows=new ActorShadowRenderer();
  private shadowAt=0;

  constructor(private readonly host: HTMLElement, private readonly crosshair: HTMLElement,
    private readonly onStatus: (status: DuelStatus) => void,
    private readonly onError: (message: string) => void, private settings: Settings, private config: DuelConfig,
    private readonly progression?: ProgressionController) {
    this.cosmeticKey = JSON.stringify(progression?.getSnapshot().profile.equipped);
    this.sim = this.createSimulation();
    this.radar = new DuelRadar(host);
    this.scope = new ScopeOverlay(host);
    this.damageFeedback = new DamageFeedback(host);
    this.meter = new PerformanceMeter(host); this.meter.configure(settings.showFps);
    this.shortcuts = new ShortcutGuard(host.closest('.range-stage'));
    this.renderer = new THREE.WebGLRenderer({antialias: qualityPolicy(settings.quality).shadows, powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
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
    this.scene.add(this.actors, this.covers, this.dynamicCovers, this.effects,this.actorShadows.group);
    this.audio.setAcoustics(this.acoustics);
    this.shotEffects = new ShotEffects(this.effects); this.viewFlashes = new MuzzleFlashes(this.viewScene, 2);
    this.rebuildCovers();
    this.bindInput();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.resize();
    void this.loadTarget(); void this.loadViewModel(loadoutWeapon(settings));
    this.report();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  private createSimulation() {
    const seed = seedForDesign(this.seed++, this.config.mapDesign);
    const simulation = new DuelSimulation(this.config, seed, duelArena(seed, this.config.arenaScale), this.settings.weapon, this.settings.sidearm, this.settings.primaryEnabled);
    simulation.playerAspect = this.camera.aspect;
    return simulation;
  }

  private rebuildCovers() {
    disposeResources([this.covers,this.dynamicCovers]);
    this.covers.clear();this.dynamicCovers.clear();
    const materials = {
      concrete: surface('#697a77'), cargo: surface('#465f64', .64), crate: surface('#967b59', .79),
      barrier: surface('#b3ad91'), cap: surface('#a8b7b1', .55), trim: surface('#354e52', .55),
      hazard: surface('#ddbf70', .62), crateEdge: surface('#654e38'),
      glass:new THREE.MeshStandardMaterial({color:'#88b9bb',transparent:true,opacity:.35,roughness:.15,depthWrite:false}),
      water:new THREE.MeshStandardMaterial({color:'#3d767a',transparent:true,opacity:.62,roughness:.28,depthWrite:false}),
    };
    for (const solid of this.sim.authoredArena.solids) if(!solid.interaction&&solid.active!==false) addArenaCover(solid, this.covers, materials);
    for (const volume of this.sim.arena.traversalVolumes??[])addArenaTraversal(volume,this.covers,materials);
    this.environmentModels=createEnvironmentRenderMap(this.sim.authoredArena,this.dynamicCovers,materials);
    batchStaticMeshes(this.covers);
    this.environmentRevision=-1;this.syncEnvironment();
  }

  private syncEnvironment() {
    if(this.environmentRevision===this.sim.environment.revision)return;
    this.environmentRevision=this.sim.environment.revision;
    syncEnvironmentRenderMap(this.environmentModels,this.sim.environment);
    this.acoustics.setBoxes(this.sim.arena.solids.filter(blocksMovement));
    for(const animator of this.animators.values())animator.setDeathWorld({floor:0,boxes:this.sim.arena.solids.filter(blocksMovement)});
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
    const revision = ++this.agentRevision;
    try {
      const profile=this.progression?.getSnapshot().profile;
      const id = profile ? equippedCosmetic(profile,cosmeticCatalog,'agent')?.id : undefined;
      const instance = id && id !== 'agent-standard' ? await loadAgent(id, undefined, this.actorLoader) : undefined;
      const {scene, animations} = instance ?? await new GLTFLoader().loadAsync('/models/target.glb');
      if (this.disposed || revision !== this.agentRevision) {if (instance) instance.dispose(); else disposeResources([scene]); return;}
      const oldScene = this.targetScene, oldInstance = this.agentInstance;
      this.agentInstance = instance;
      this.targetScene = scene; this.targetClips = animations;
      this.rebuildActors();
      if (oldInstance) oldInstance.dispose(); else if (oldScene) disposeResources([oldScene]);
      this.loadWorldWeapons();
      try {
        const motion = await new GLTFLoader().loadAsync('/models/duel-motion.glb?v=extended-actions-2');
        if (this.disposed || revision !== this.agentRevision) {disposeResources([motion.scene]);return;}
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
    this.actors.clear(); this.models.clear(); this.heldWeapons.clear();
    if (!this.targetScene) return;
    for (const actor of this.sim.snapshot().slice(1)) {
      const root = new THREE.Group();
      const model = cloneSkeleton(this.targetScene);
      const held = this.attachWorldWeapon(model, actor.equipment);
      if (held) {held.visible = actor.alive; this.heldWeapons.set(actor.id, held);}
      const muzzle = held ? muzzleAnchor(held) : undefined;
      if (muzzle) this.botMuzzles.set(actor.id, muzzle);
      root.add(model); this.actors.add(root); this.models.set(actor.id, root);
      const animator=new DuelAnimator(model, this.targetClips, (actor.id * .317) % 1, actor.equipment);
      animator.addGestureClips(this.gestureClips.get(actor.equipment)??[]);
      animator.setDeathWorld({floor:0,boxes:this.sim.arena.solids.filter(blocksMovement)});
      this.animators.set(actor.id,animator);
    }
  }

  private loadWorldWeapons() {
    for (const weapon of new Set(this.sim.snapshot().slice(1).map(actor => actor.equipment))) {
      this.loadGesturePack(weapon);
      const cached = this.worldWeapons.get(weapon);
      if (cached) {this.worldWeapons.delete(weapon); this.worldWeapons.set(weapon, cached); continue;}
      if (this.worldLoading.has(weapon)) continue;
      this.worldLoading.add(weapon);
      void new GLTFLoader().loadAsync(`/models/${weapon}.glb`).then(({scene}) => {
        if (this.disposed) {disposeResources([scene]); return;}
        this.worldWeapons.set(weapon, scene);
        this.rebuildActors();
        this.trimWorldWeapons();
      }).catch(() => {
        if (!this.disposed) this.onError(`The ${weapon} world model is unavailable. Run npm run assets:build, then reload.`);
      }).finally(() => this.worldLoading.delete(weapon));
    }
    this.trimWorldWeapons();
  }

  private loadGesturePack(equipment:Equipment) {
    if(this.gestureClips.has(equipment)||this.gestureLoading.has(equipment))return;
    this.gestureLoading.add(equipment);
    void new GLTFLoader().loadAsync(`/models/duel-gestures/${equipment}.glb`).then(asset=>{
      const {scene} = asset, animations = nativeGestureClips(asset);
      disposeResources([scene]);
      if(this.disposed)return;
      this.gestureClips.set(equipment,animations);
      for(const actor of this.sim.snapshot().slice(1))if(actor.equipment===equipment)
        this.animators.get(actor.id)?.addGestureClips(animations);
      const active=new Set(this.sim.snapshot().map(actor=>actor.equipment));
      for(const id of this.gestureClips.keys())if(this.gestureClips.size>8&&!active.has(id))this.gestureClips.delete(id);
    }).catch(()=>{/* Keep native locomotion when an action has no imported world clip. */})
      .finally(()=>this.gestureLoading.delete(equipment));
  }

  private trimWorldWeapons() {
    const active = new Set(this.sim.snapshot().slice(1).map(actor => actor.equipment));
    for (const drop of this.sim.drops) if (!drop.picked) active.add(drop.equipment);
    for (const [weapon, scene] of this.worldWeapons) {
      if (this.worldWeapons.size <= 8) break;
      if (active.has(weapon)) continue;
      this.worldWeapons.delete(weapon); disposeResources([scene]);
    }
  }

  private attachWorldWeapon(model: THREE.Object3D, weapon: Equipment) {
    // GLTFLoader sanitizes periods in animation node names.
    const held = model.getObjectByName('held_weapon_target001') ?? model.getObjectByName('held_weapon_target.001');
    if (weapon === 'm4a1s' && held) return held;
    const mount = model.getObjectByName('wpn');
    const source = this.worldWeapons.get(weapon);
    if (!mount || !source) return held;
    if (held) held.visible = false;
    const replacement = source.clone(true);
    replacement.name = `held_${weapon}`;
    new THREE.Matrix4().fromArray(weaponMounts.mounts[weapon].inverseBind).decompose(
      replacement.position, replacement.quaternion, replacement.scale);
    mount.add(replacement);
    return replacement;
  }

  private async loadViewModel(weapon: Equipment) {
    this.renderedEquipment = weapon;
    const revision = ++this.viewRevision;
    try {
      const profile = this.progression?.getSnapshot().profile;
      const asset = profile ? cosmeticAsset(profile, weapon) : weapon;
      const {scene, animations} = await new GLTFLoader().loadAsync(`/models/view-${asset}.glb`);
      prepareNativeViewAssembly(scene);
      try {if (profile) await applyCosmetic(scene, profile, weapon);}
      catch {disposeResources([scene]); throw new Error('Cosmetic could not load');}
      if (this.disposed || revision !== this.viewRevision) {disposeResources([scene]); return;}
      this.viewAnimation?.dispose();
      disposeResources([this.viewRoot]);
      this.viewRoot.clear(); scene.rotation.y = Math.PI; this.viewRoot.add(scene);
      this.viewAnimation = new ViewAnimation(scene, animations);
      this.viewMuzzle = muzzleAnchor(scene);
      if (weapon === 'elite') {muzzleAnchor(scene, 'left'); muzzleAnchor(scene, 'right');}
      const duration = Math.max(.01, this.sim.actors[0].equipReadyAt - this.sim.time);
      if (this.pickupDrawing) this.viewAnimation.playPickup(duration); else this.viewAnimation.playDraw(duration);
      this.pickupDrawing = false;
    } catch { if (!this.disposed && revision === this.viewRevision) this.onError('The weapon model is unavailable. Run npm run assets:build, then reload.'); }
  }

  async refreshCosmetics() {
    const key = JSON.stringify(this.progression?.getSnapshot().profile.equipped);
    if (key === this.cosmeticKey) return;
    const oldAgent = JSON.parse(this.cosmeticKey || '{}')?.agent;
    this.cosmeticKey = key;
    if (oldAgent !== this.progression?.getSnapshot().profile.equipped.agent) await this.loadTarget();
    await this.loadViewModel(this.sim.actors[0].weapon.id);
  }

  private xpSetup(): DuelXpSetup {
    return {playerHealth: this.config.playerHealth, playerArmor: this.config.playerArmor,
      bots: this.sim.actors.slice(1).map((actor, index) => ({id: String(actor.id), ...botConfig(this.config, index)}))};
  }

  private beginProgression() {
    this.xpDamage.clear();
    this.xpAttempt = this.progression?.beginDuel(this.xpSetup(), String(this.xpRevision)) ?? null;
  }

  setSettings(settings: Settings) {
    if (settings === this.settings) return;
    const weaponChanged = settings.weapon !== this.settings.weapon || settings.sidearm !== this.settings.sidearm || settings.primaryEnabled !== this.settings.primaryEnabled;
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = settings;
    if (weaponChanged) void this.loadViewModel(loadoutWeapon(settings));
    if (weaponChanged) this.restart();
    if (qualityChanged) this.metrics.resetResolution();
    this.meter.configure(settings.showFps);
    this.resize();
  }

  setConfig(config: DuelConfig) {
    if (config === this.config) return;
    this.config = config;
    this.restart();
  }

  restart(continuous = false) {
    if (this.xpAttempt) this.progression?.cancelAttempt(this.xpAttempt);
    this.xpAttempt = null; this.xpRevision++;
    this.paused = false; this.pointer = null; this.pickupDrawing = false; this.viewAnimation?.cancel();
    for (const object of this.dropModels.values()) this.scene.remove(object);
    this.dropModels.clear();
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
    this.audio.stopVoices();this.clearEffects(); this.rebuildCovers(); this.rebuildActors(); this.report();
    this.loadWorldWeapons();
    if (continuous) {this.sim.start(); this.beginProgression(); this.updateMovement(); this.report();}
  }

  async enter() {
    if (this.disposed || this.entering) return;
    const revision = ++this.enterRevision; this.entering = true;
    if (this.sim.phase === 'ready') {this.sim.start(); this.beginProgression();} else this.sim.resume();
    this.sessionStarted = true;
    this.paused = false;
    this.renderer.domElement.focus({preventScroll: true});
    const coarse = matchMedia('(pointer: coarse)').matches;
    const supported = typeof this.renderer.domElement.requestPointerLock === 'function';
    this.inputName = coarse ? 'Touch' : 'Mouse';
    const pointerLock = !coarse ? requestRawLock(this.renderer.domElement) : Promise.resolve<'drag'>('drag');
    const guard = this.shortcuts.enter(!coarse && supported && this.config.shortcutProtection);
    void this.audio.unlock(this.settings.weapon);
    void this.audio.unlock(this.settings.sidearm); void this.audio.unlock('knife');
    for (const actor of this.sim.actors.slice(1)) if (actor.weapon.id !== this.settings.weapon) void this.audio.unlock(actor.weapon.id);
    try {
      const mode = await pointerLock;
      await guard;
      if (revision !== this.enterRevision || this.disposed || this.paused) return;
      if (!coarse && supported && (mode === 'drag' || document.pointerLockElement !== this.renderer.domElement)) {
        this.pause(); this.inputName = 'Mouse capture blocked. Click Resume duel again.';
      } else this.inputName = coarse ? 'Touch' : !supported ? 'Drag aim (mouse capture unsupported)' : mode === 'raw' ? 'Raw mouse' : 'Standard mouse';
      this.report();
    } finally {
      if (revision === this.enterRevision) this.entering = false;
      if ((this.disposed || this.paused) && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    }
  }

  private releaseShortcuts() {
    this.enterRevision++; this.entering = false;
    this.shortcuts?.release();
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
      if (event.button === 2 && this.sim.phase === 'fighting' && !this.paused) {
        event.preventDefault(); this.sim.command(0, {secondaryPressed: true, secondaryHeld: true}); return;
      }
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
      const scale = (event.pointerType === 'mouse' ? mouseAngle(1, this.settings.sensitivity) : .0025) * this.sim.actors[0].weapon.actions.sensitivityScale;
      if (dx || dy) this.sim.command(0, {yawDelta: -dx * scale,
        pitchDelta: -dy * scale * (this.settings.invertY ? -1 : 1)});
    }) as EventListener);
    this.listen(document, 'pointerup', ((event: PointerEvent) => {
      if (event.button === 2) {this.sim.command(0, {secondaryHeld: false}); return;}
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
      if (event.code === 'Space' && !event.repeat) this.sim.command(0,{jumpPressed:true});
      if (event.code === 'KeyR' && !event.repeat) this.sim.command(0, {reloadPressed: true,reloadHeld:true});
      if (event.code === 'KeyF' && !event.repeat) {event.preventDefault(); this.inspect();}
      if (event.code === 'KeyE' && !event.repeat) {event.preventDefault(); this.sim.command(0,{usePressed:true});this.pickup();}
      if (event.code === 'KeyG' && !event.repeat) {event.preventDefault();this.sim.command(0,{dropPressed:true});}
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(event.code) && !event.repeat) this.equip(Number(event.code.slice(-1)) as Slot);
    }) as EventListener);
    this.listen(window, 'keyup', ((event: KeyboardEvent) => {this.keys.delete(event.code);if(event.code==='KeyR')this.sim.command(0,{reloadHeld:false}); this.updateMovement();}) as EventListener);
    this.listen(window, 'blur', (() => {if (!this.entering) this.pause();}) as EventListener);
    this.listen(document, 'visibilitychange', (() => {if (document.hidden) this.pause();}) as EventListener);
    this.listen(document, 'pointerlockchange', (() => {
      if (this.entering) return;
      if (document.pointerLockElement !== canvas && this.inputName !== 'Drag aim' && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
    this.listen(document, 'fullscreenchange', (() => {
      if (!this.entering && this.shortcuts.protected && !document.fullscreenElement && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
  }

  private updateMovement() {
    this.sim.command(0, {forward: +this.keys.has('KeyW') - +this.keys.has('KeyS'),
      side: +this.keys.has('KeyD') - +this.keys.has('KeyA'),
      walk: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'), jump: this.keys.has('Space')});
  }

  equip(slot: Slot) {this.sim.command(0,{equipSlot:slot});if(this.sim.phase==='ready')this.sim.equipPlayer(slot); this.report(); this.renderer.domElement.focus({preventScroll: true});}
  pickup() {
    if(!this.sim.nearestPickup())return;
    this.pickupDrawing=true;this.sim.command(0,{pickupPressed:true});
    this.renderer.domElement.focus({preventScroll:true});
  }
  inspect() {const actor = this.sim.actors[0]; if (actor.alive && !actor.weapon.reloadUntil && !actor.command.fireHeld && this.sim.time >= actor.equipReadyAt) {
    if(this.viewAnimation?.playInspect())this.audio.playAction(0,this.sim.actors[0].weapon.id,'inspect',this.sim.time,{local:true,volume:this.settings.volume*.5});
  }}
  secondary() {this.sim.command(0, {secondaryPressed: true});}

  private processEvents(events: DuelEvent[]) {
    if (!events.length) return;
    const shots = new Map<number, Extract<DuelEvent, {kind: 'fire'}>>();
    const endpoints = new Map<number, Vec[]>();
    const endpoint=(shotId:number,point:Vec)=>{
      const points=endpoints.get(shotId)??[];points.push(point);endpoints.set(shotId,points);
    };
    const player = this.sim.snapshot()[0];
    for (const event of events) {
      if(event.kind==='action') {
        const actor=this.sim.actors[event.actorId],local=event.actorId===0;
        const action=event.action==='reload-start'?(actor.weapon.reloadEmpty?'reload-empty':'reload'):
          event.action==='reload-cancel'?'cancel':event.action;
        if(!action.startsWith('reload'))this.audio.playAction(event.actorId,event.equipment,action,this.sim.time,
          {local,silent:event.silent,volume:this.settings.volume*.55,spatial:local?undefined:this.soundLocation(actor.position)});
        this.animators.get(event.actorId)?.playAction(event.equipment,action,{crouched:(actor.duckAmount??0)>.5,
          duration:action.startsWith('reload')?equipmentStats(event.equipment).reload:undefined});
      }else if(event.kind==='environment') {
        if(event.action==='break')this.audio.playImpact(this.sim.authoredArena.solids.find(solid=>solid.id===event.environmentId)?.material==='glass'?'glass':'metal',
          this.settings.volume*.6,this.soundLocation(event.point));
      }else if (event.kind === 'pickup') {
        const model = this.dropModels.get(event.dropId);
        if (model) this.scene.remove(model);
        this.dropModels.delete(event.dropId);
      } else if (event.kind === 'fire') {
        shots.set(event.shotId, event);
        this.animators.get(event.actorId)?.playAction(event.equipment,event.alternate?'fire-alt':'fire',
          {side:this.sim.actors[event.actorId].weapon.ammo%2?'right':'left',lastShot:this.sim.actors[event.actorId].weapon.ammo===0});
        if (event.actorId === 0) {
          const weapon = this.sim.actors[0].weapon;
          this.viewAnimation?.playFire(event.equipment,{side:weapon.ammo%2?'right':'left',lastShot:weapon.ammo===0,alternate:weapon.actions.alternateFire,zoomed:weapon.actions.zoom>0,
            ...(['awp','ssg08'].includes(event.equipment)?{duration:weapon.actions.base.cycle}:{})});
          this.kick = 1;
        }
        const location=event.actorId===0?undefined:this.soundLocation(event.origin);
        if(event.equipment==='knife')this.audio.playKnife(event.alternate?'stab':'slash',this.settings.volume,location);
        else this.audio.play(event.equipment,this.settings.volume,location);
        this.audio.playAction(event.actorId,event.equipment,event.alternate?'fire-alt':'fire',this.sim.time,
          {local:event.actorId===0,volume:this.settings.volume*.45,spatial:location});
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
      } else if (event.kind === 'surface') {
        endpoint(event.shotId,event.point);
        this.shotEffects.impact(v3(event.point),this.settings.impactSize,event.shooter===0?this.ownTraceColor:this.enemyTraceColor,this.animationClock);
        if(event.phase!=='exit')this.audio.playImpact(['wood','metal','glass'].includes(event.material??'')?event.material as 'wood'|'metal'|'glass':'concrete',
          this.settings.volume*.35,this.soundLocation(event.point));
      }
      else if (event.kind === 'hit') {
        endpoint(event.shotId,event.point);
        this.shotEffects.impact(v3(event.point),this.settings.impactSize,event.shooter===0?this.ownTraceColor:this.enemyTraceColor,this.animationClock);
        if(event.lethal)this.animationTimes.delete(event.victim);
        if (event.lethal && !this.deaths.has(event.victim)) this.deaths.set(event.victim, this.animationClock);
        if (event.lethal && event.victim > 0) {
          const held = this.heldWeapons.get(event.victim);
          if (held) held.visible = false;
        }
        if (event.shooter === 0) {
          this.xpDamage.set(event.victim, (this.xpDamage.get(event.victim) ?? 0) + event.healthDamage);
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
        if (this.xpAttempt) this.progression?.completeDuel(this.xpAttempt, {
          completion: 'completed', outcome: event.outcome, activeSeconds:this.sim.time, review: this.sim.coach.review(),
          opponents: this.sim.actors.slice(1).map(actor => ({id: String(actor.id), healthDamage: this.xpDamage.get(actor.id) ?? 0, killed: !actor.alive})),
        }, this.xpSetup(), String(this.xpRevision));
        this.xpAttempt = null;
        this.history.unshift({date: new Date().toISOString(), outcome: event.outcome, review: this.sim.coach.review()});
        this.history = this.history.slice(0, 50);
        try {localStorage.setItem('spraylab.duel.history.v1', JSON.stringify(this.history));} catch { /* Session-only history. */ }
      }
    }
    for (const [id, shot] of shots) {
      const count = this.shotCounts.get(shot.actorId) ?? 0;
      this.shotCounts.set(shot.actorId, count + 1);
      const trail = Math.min(shot.actorId === 0 ? 10 : 5,equipmentStats(shot.equipment).range*UNIT);
      let start: THREE.Vector3 | undefined;
      if (shot.actorId === 0 && this.viewMuzzle) {
        const ammo = this.sim.actors[0].weapon.ammo;
        const barrel = shot.equipment === 'elite' ? this.viewRoot.getObjectByName(`spraylab-muzzle-${ammo % 2 ? 'right' : 'left'}`) ?? this.viewMuzzle : this.viewMuzzle;
        this.viewFlashes.fire(barrel, shot.equipment, this.animationClock);
        this.viewScene.updateMatrixWorld(true);
        start = viewMuzzleToWorld(barrel.getWorldPosition(new THREE.Vector3()), this.viewCamera,
          this.camera, this.width, this.height);
      } else if (shot.actorId > 0) {
        const muzzle = this.botMuzzles.get(shot.actorId);
        this.shotEffects.flashes.fire(muzzle, shot.equipment, this.animationClock, true);
        muzzle?.updateWorldMatrix(true, false);
        start = muzzle?.getWorldPosition(new THREE.Vector3());
      }
      const points=endpoints.get(id)??[];
      const directions=shot.pelletDirections??[shot.direction];
      for(const direction of directions) {
      const matching=points.filter(point=>{
        const delta=v3(point).sub(v3(shot.origin));
        return delta.lengthSq()>.001&&delta.normalize().dot(v3(direction))>.99999;
      }).sort((a,b)=>v3(a).distanceToSquared(v3(shot.origin))-v3(b).distanceToSquared(v3(shot.origin)));
      const end=matching[0]??{x:shot.origin.x+direction.x*trail,y:shot.origin.y+direction.y*trail,z:shot.origin.z+direction.z*trail};
      if (start && shot.equipment !== 'knife') {
        const delta = v3(end).sub(start), length = delta.length();
        const endpointAhead = v3(end).sub(this.camera.position).dot(this.camera.getWorldDirection(new THREE.Vector3())) > .1;
        const obstruction = traceSolid(start, delta.clone().normalize(), this.sim.arena, length);
        if (length > .15 && endpointAhead && obstruction.distance >= length - .08) {
          this.shotEffects.trace(shot.equipment, count, start, v3(end), this.animationClock,
            shot.actorId === 0 ? this.ownTraceColor : this.enemyTraceColor);
        }
      }
      }
    }
  }

  private soundLocation(point: Vec, range = 55): SpatialSound {
    const delta = v3(point).sub(this.camera.position), distance = delta.length();
    return {position: point, range, occluded: distance > .1 &&
      traceSolid(this.camera.position, delta.normalize(), this.sim.arena, distance - .05).distance < distance - .05};
  }

  private clearEffects() {
    this.shotEffects.clear(); this.viewFlashes.clear(); this.shotCounts.clear();
  }

  private syncDrops() {
    for(const drop of this.sim.drops) {
      if(drop.picked)continue;
      const existing=this.dropModels.get(drop.id);
      if(existing){existing.position.copy(v3(drop.position));continue;}
      const source=this.worldWeapons.get(drop.equipment);if(!source)continue;
      const model=source.clone(true);model.position.copy(v3(drop.position));
      model.rotation.set(0,this.sim.actors[drop.id]?.yaw??0,Math.PI/2);
      model.userData.spraylabDropId=drop.id;
      this.scene.add(model);this.dropModels.set(drop.id,model);
    }
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
      if (!actor.alive && !this.deaths.has(actor.id)) {
        this.deaths.set(actor.id, this.animationClock); this.animationTimes.delete(actor.id);
      }
      const deathAge = this.animationClock - (this.deaths.get(actor.id) ?? this.animationClock);
      model.position.set(actor.position.x, actor.alive ? actor.feet : deathFeet(actor, deathAge, this.sim.arena.solids,
        this.sim.actors[actor.id].verticalVelocity), actor.position.z);
      model.rotation.y = actor.yaw - Math.PI;
      if (model.visible || !actor.alive) {
        const elapsed = this.animationTimes.has(actor.id) ? this.animationClock - this.animationTimes.get(actor.id)! : dt;
        if (dt > 0 && this.animationTimes.has(actor.id) && elapsed < 1 / this.metrics.animationRate(this.settings.quality)) continue;
        const weapon=this.sim.actors[actor.id].weapon;
        this.animators.get(actor.id)?.update(this.sim.phase === 'result' && actor.alive
          ? {...actor, velocity: {x: 0, z: 0}} : actor, dt > 0 ? elapsed : 0, actor.alive ? undefined : deathAge,
          {reloadRemaining:Math.max(0,weapon.reloadUntil-this.sim.time),reloadDuration:weapon.reload.phaseDuration||equipmentStats(actor.equipment).reload,
            reloadPhase:weapon.reloadPhase,reloadProgress:weapon.reload.progress,
            deathVelocity:{...actor.velocity,y:actor.verticalVelocity??0}});
        this.animationTimes.set(actor.id, this.animationClock);
      }
    }
  }

  private resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.width = width; this.height = height;
    this.renderer.setPixelRatio(renderPixelRatio(width, height, devicePixelRatio || 1, this.settings.quality, this.metrics.adaptive));
    this.renderer.setSize(width, height);
    this.camera.aspect = this.settings.aspect === 'native' ? width / height
      : this.settings.aspect.split(':').map(Number).reduce((a, b) => a / b);
    this.sim.playerAspect = this.camera.aspect;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = viewmodelViewport(width, height).aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  private report() {
    const [player, ...bots] = this.sim.renderSnapshot();
    this.onStatus({phase: this.sim.phase, paused: this.paused, outcome: this.sim.phase==='result'?this.sim.outcome:undefined,
      health: player.health, armor: player.armor, ammo: player.ammo, reloading: player.reloading,
      reserve:player.reserve,reloadSilent:player.reloadSilent,recharge:Math.max(0,this.sim.actors[0].weapon.rechargeUntil-this.sim.time),
      enemies: bots.filter(bot => bot.alive).length, seconds: this.sim.time, kills: this.kills,
      damage: this.damage, input: this.inputName, caption: this.animationClock < this.captionUntil ? this.caption : '',
      shortcutProtected: this.shortcuts.protected, nextRoundIn: this.roundFlow.remaining(this.config.feedbackSeconds),
      equipped: player.equipment, review: this.sim.coach.review(), history: this.history,
      loadout: this.sim.loadout, pickup: this.sim.nearestPickup()?.equipment, interaction:this.sim.nearestDoor()?.open?'Close door':this.sim.nearestDoor()?'Open door':undefined, arenaDesign: this.sim.arena.design});
  }

  private tick(timestamp: number) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(time => this.tick(time));
    const active = this.sim.phase !== 'ready' && !this.paused;
    if (document.hidden || !this.pacer.ready(timestamp, active ? this.settings.frameLimit : 15)) {
      if (document.hidden) this.last = timestamp;
      return;
    }
    const cpuStart = performance.now();
    const dt = this.last ? Math.min((timestamp - this.last) / 1000, .25) : 0;
    this.last = timestamp;
    if (this.sessionStarted && this.roundFlow.advance(dt, this.paused, this.config.feedbackSeconds)) this.restart(true);
    this.sim.advance(dt);
    this.syncEnvironment();this.syncDrops();
    const snapshots = this.sim.renderSnapshot();
    const events=this.sim.drainEvents();
    const player = snapshots[0];
    const viewWeapon=this.sim.actors[0].weapon;
    if(timestamp-this.shadowAt>=50){this.shadowAt=timestamp;this.actorShadows.update(actorShadows(snapshots,this.sim.arena));}
    if(timestamp-this.radarAt>=100) {this.radarAt=timestamp;this.radar.update(player,this.sim.radar.snapshot(this.sim.time),this.sim.time,this.sim.arena,this.config);}
    if (player.equipment !== this.renderedEquipment) {
      void this.loadViewModel(player.equipment);
      void this.audio.unlock(player.equipment).then(() => {
        if (!this.disposed && this.sim.actors[0].weapon.id === player.equipment && !this.paused)
          if(!this.audio.playAction(0,player.equipment,'draw',this.sim.time,{local:true,volume:this.settings.volume*.5,duration:equipmentStats(player.equipment).deploy}))
            this.audio.playEvent(`${player.equipment}-draw`, this.settings.volume * .5);
      });
    }
    this.wasReloading = player.reloading;
    this.viewAnimationElapsed += active ? dt : 0;
    if (this.viewAnimationElapsed >= 1 / this.metrics.animationRate(this.settings.quality)) {
    this.viewAnimation?.update(Math.max(0,viewWeapon.reloadUntil-this.sim.time), viewWeapon.reload.phaseDuration||equipmentStats(player.equipment).reload, this.viewAnimationElapsed,
      {reloadEmpty:viewWeapon.reloadEmpty,ammo:viewWeapon.ammo,equipment:viewWeapon.id,reloadPhase:viewWeapon.reloadPhase,
        reloadProgress:viewWeapon.reload.progress,charging:viewWeapon.actions.charging,chargeDuration:REVOLVER_WINDUP});
    this.viewAnimationElapsed = 0;
    }
    const visualRecoil = viewWeapon.recovery.predict(this.sim.accumulator);
    const punch = this.sim.actors[0].punch.predict(this.paused || this.sim.phase !== 'fighting' ? 0 : this.sim.accumulator,
      viewWeapon.recovery.angle);
    const view = recoilView(player.yaw - punch.yaw * DEG, player.pitch + punch.pitch * DEG, visualRecoil);
    const deathAge = this.animationClock - (this.deaths.get(0) ?? this.animationClock);
    const death = deathView(deathAge, player.position.y - player.feet);
    this.camera.position.set(player.position.x, player.position.y, player.position.z);
    if (!player.alive) this.camera.position.y = deathFeet(player, deathAge, this.sim.arena.solids,
      this.sim.actors[0].verticalVelocity) + death.height;
    this.camera.rotation.set(view.pitch + (player.alive ? 0 : death.pitch), view.yaw, punch.roll * DEG + (player.alive ? 0 : death.roll), 'YXZ');
    const scoped = this.scope.update(viewWeapon.actions, this.camera, player.alive);
    this.camera.updateMatrixWorld();
    this.syncActors(snapshots, this.sim.phase !== 'ready' && !this.paused ? dt : 0);
    this.kick = Math.max(0, this.kick - dt * 8);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.viewRoot.position.set(VIEWMODEL_OFFSET.x,
      VIEWMODEL_OFFSET.y + Math.sin(this.sim.time * 12) * Math.min(speed, 1) * .002 - (player.alive ? 0 : death.weaponDrop * .5), this.kick * .018);
    this.viewRoot.visible = !scoped && (player.alive || deathAge < .25);
    this.viewRoot.rotation.x = this.kick * (player.equipment === 'knife' ? 0 : .035) + view.weaponPitch;
    this.viewRoot.rotation.y = view.weaponYaw;
    this.viewRoot.rotation.z = 0;
    this.audio.updateListener(this.camera.position, view.yaw, view.pitch);
    for(const actor of snapshots) {
      const state=actor.id===0?viewWeapon:this.sim.actors[actor.id].weapon;
      this.audio.syncActor({id:actor.id,generation:actor.generation,equipment:actor.equipment,alive:actor.alive,
        reloading:actor.reloading,local:actor.id===0,silent:actor.reloadSilent,reloadEmpty:state.reloadEmpty,
        reloadRemaining:Math.max(0,state.reloadUntil-this.sim.time),reloadDuration:state.reload.phaseDuration||equipmentStats(actor.equipment).reload,
        reloadPhase:state.reloadPhase,reloadProgress:state.reload.progress},
        this.sim.time,this.settings.volume*.55,actor.id===0?undefined:this.soundLocation(actor.position));
    }
    this.processEvents(events);
    this.audio.updateActions(this.sim.time);
    this.damageFeedback.update(this.animationClock, player.yaw);
    const recoil = this.settings.follow ? viewWeapon.recovery.recoil : {yaw: 0, pitch: 0};
    const yaw = player.yaw - (recoil.yaw + punch.yaw) * DEG, pitch = player.pitch + (recoil.pitch + punch.pitch) * DEG;
    const followPoint = this.followPoint.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(10).add(this.camera.position).project(this.camera);
    if (!this.settings.follow) followPoint.set(0, 0, 0);
    this.crosshair.style.visibility = player.alive && !scoped && (player.equipment==='knife'||gameData.weapons[player.equipment].showCrosshair) ? '' : 'hidden';
    this.crosshair.style.transform = `translate(${followPoint.x * this.width / 2}px, ${-followPoint.y * this.height / 2}px)`;
    this.crosshair.style.setProperty('--motion-gap', this.settings.crosshair.dynamic ? `${speed * 1.2 + this.kick * 4}px` : '0px');
    this.shotEffects.update(this.animationClock); this.viewFlashes.update(this.animationClock);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.autoClear = true; this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false; this.renderer.clearDepth();
    const viewport = viewmodelViewport(this.width, this.height);
    this.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.renderer.render(this.viewScene, this.viewCamera);
    const oldResolution = this.metrics.adaptive;
    if (this.metrics.sample(dt, performance.now() - cpuStart, this.settings.quality === 'auto', active, this.settings.frameLimit)) {
      this.meter.update(this.metrics, this.renderer.getPixelRatio());
      if (oldResolution !== this.metrics.adaptive) this.resize();
    }
    if (events.some(event => event.kind === 'hit' || event.kind === 'round') || timestamp - this.statusAt > 100) {
      this.statusAt = timestamp; this.report();
    }
  }

  dispose() {
    if (this.xpAttempt) this.progression?.cancelAttempt(this.xpAttempt);
    this.disposed = true; cancelAnimationFrame(this.frame); this.pause(); this.releaseShortcuts(); this.observer.disconnect();
    this.cleanup.forEach(fn => fn()); this.clearEffects(); this.audio.dispose(); this.damageFeedback.dispose();
    this.animators.forEach(animator => animator.dispose()); this.viewAnimation?.dispose(); this.scope.dispose();
    this.gestureClips.clear();
    this.meter.dispose();
    this.radar.dispose();
    this.actorShadows.dispose();
    this.shotEffects.dispose(); this.viewFlashes.dispose();
    disposeResources([this.scene, this.viewScene, ...this.worldWeapons.values(), ...(this.targetScene && !this.agentInstance ? [this.targetScene] : [])]);
    this.agentRevision++;this.agentInstance?.dispose();this.actorLoader.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
