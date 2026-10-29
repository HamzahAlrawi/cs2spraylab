import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {DEG, STEP, UNIT, type Vec} from '../actor-physics';
import {RangeAudio} from '../audio';
import {gameData,loadoutWeapon, type Settings, type Weapon} from '../config';
import {bindGameplayWheel, requestRawLock} from '../input';
import {VERTICAL_FOV} from '../simulation';
import {actionsForCode, grenadeForControl, ignoreGameplayKey, isEditingTarget, movementControls, type ControlAction} from '../controls';
import {mouseLookDelta} from '../input-sensitivity';
import {VIEWMODEL_FOV, VIEWMODEL_OFFSET, viewmodelViewport} from '../viewmodel';
import {botConfig, type DuelConfig} from './config';
import {duelArena, traceSolid} from './geometry';
import {DuelSimulation} from './simulation';
import type {DuelActorSnapshot, DuelEvent} from './types';
import {DuelAnimator, nativeGestureClips} from './animation';
import {prepareRapier} from '../rapier-runtime';
import {deathCameraGoal} from './death-camera';
import {batchStaticMeshes, disposeResources, disposeSkeletons} from './render-resources';
import {fullyOccluded} from './visibility';
import {muzzleAnchor, viewMuzzleToWorld} from './tracers';
import type {SpatialSound} from '../spatial-audio';
import {recoilView} from '../view-recoil';
import {RoundFlow, deathView, deathFeet} from './round-flow';
import {sampleHitReaction} from './hit-reaction';
import {equipmentControlSlot, type Equipment, type Slot} from '../equipment';
import {DamageFeedback} from './damage-feedback';
import {loadDuelHistory, type DuelReview, type DuelHistory} from './coaching';
import {FOOTSTEP_RANGE} from '../sound-model';
import {ViewAnimation} from '../view-animation';
import {equipmentStats} from '../equipment';
import {ScopeOverlay} from '../scope-overlay';
import {addArenaCover,addArenaTraversal,createEnvironmentRenderMap,syncEnvironmentRenderMap} from './arena-props';
import {blocksMovement} from './environment';
import {AcousticScene} from '../spatial-audio';
import {configureArenaAcoustics} from './native-acoustics';
import {nativeFlinchClips} from './native-flinch';
import {loadCombatModel} from '../combat-model-delivery';
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
import type {DuelScenario, PrefireStats} from './scenario';
import {PrefireLighting,takePreparedLighting} from '../prefire/lighting';
import {StepView} from './step-view';
import type {ShotState} from '../shot-state';
import {NativeActorHitboxes} from './actor-hitboxes';
import {type CombatRecording, type ReplayActor, type ReplayShot, downloadRecording} from './combat-replay';
import {PlaybackScene, type ReplayVisual} from './playback-scene';
import {surfaceFootstepMaterial} from '../prefire/native-surfaces';
import {setupKey} from '../setup-key';
import {prewarmShaders, compileRetainedShaders, warmRetainedFirstUse, disposeWarmRenderer} from '../shader-warmup';
import {WeaponPreloader} from '../weapon-preloader';
import {prepareSceneGpu} from './scene-preparation';
import {backgroundFrame} from '../prefire/background-work';
import {KillFeedModel,type KillFeedEntry} from './kill-feed';
import {CharacterHitEffects} from './character-hit-effects';
import {type UtilityKind, type UtilityInventory, utilityNames} from './utility-loadout';
import {nextUtility} from './utility-ui';
import {UtilityRenderer, utilityFlashOpacity} from './utility-render';
import {nativeUtilityPresentation, utilityNativeTiming, utilityThrowAction, UtilitySoundTimeline, type UtilityViewAction} from './utility-presentation';
import {GrenadePointerInput} from './grenade-pointer-input';
import type {SpawnPose} from './manual-spawns';

export type DuelStatus = {
  phase: 'ready' | 'fighting' | 'result'; paused: boolean; outcome?: 'won' | 'lost' | 'draw';
  health: number; armor: number; ammo: number; reloading: boolean; enemies: number;
  seconds: number; kills: number; damage: number; input: string; caption: string;
  shortcutProtected: boolean;
  nextRoundIn: number;
  equipped?: Equipment; review?: DuelReview; history?: DuelHistory[];
  loadout?: {primary: Weapon | null; sidearm: Settings['sidearm'] | null}; pickup?: Equipment; pickupUtility?: UtilityKind;
  interaction?:string;
  reserve?:number; reloadSilent?:boolean; recharge?:number;
  arenaDesign?: string;
  loadingMap?: boolean;
  preparingNextRound?:boolean;
  nextRoundError?:string;
  postWinPlayable?:boolean;
  prefire?: PrefireStats;
  lastShot?: {weapon: Equipment; state: ShotState};
  replayShots?: number;
  replayAvailable?: boolean;
  completedRound?: {id: string; setupKey: string; review: DuelReview};
  killFeed?: readonly KillFeedEntry[];
  selectedUtility?: UtilityKind;
  utilityInventory?: UtilityInventory;
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
  private loadingMap = false;
  private mapAbort?: AbortController;
  private nextRoundAbort?:AbortController;
  private nextRoundError?:string;
  private seamlessHandoff=false;
  private paused = false;
  private pointer: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private seed = Math.floor(Math.random() * 0x7fffffff);
  private criticalReady=false;
  private actorBuildRevision=0;
  private prefetchedSeed=-1;
  private pendingMapSelection=false;
  private pendingSetupRestart=false;
  private prefetchAt=-Infinity;
  private viewAnimation?: ViewAnimation;
  private loadedViewEquipment?: Equipment;
  private pendingInspect?: Equipment;
  private presentingUtility?: UtilityKind;
  private kick = 0;
  private inputName = 'Ready';
  private caption = '';
  private captionUntil = 0;
  private shortcuts: ShortcutGuard;
  private entering = false;
  private enterRevision = 0;
  private kills = 0;
  private damage = 0;
  private lastShot?: DuelStatus['lastShot'];
  private models = new Map<number, THREE.Group>();
  private heldWeapons = new Map<number, THREE.Object3D>();
  private readonly actorWeaponCache = new Map<number, Map<Equipment, THREE.Object3D>>();
  private readonly actorEquipment = new Map<number, Equipment>();
  private heldGrenades = new Map<number, THREE.Group>();
  private utilityGestures: THREE.AnimationClip[] = [];
  private utilityPreparing?: Promise<void>;
  private utilityActorActions = new Map<number, {selectedAt: number; primedAt?: number}>();
  private utilityThrownAt = new Map<number, number>();
  private utilitySounds = new Map<number,{key:string;kind:UtilityKind;action:UtilityViewAction;started:number;timeline:UtilitySoundTimeline}>();
  private utilityEffectSounds = new Map<number, {type: string; position: Vec; expiresAt: number}>();
  private readonly mouseButtons = new GrenadePointerInput();
  private spawnAuthoring = false;
  private animators = new Map<number, DuelAnimator>();
  private hitboxes = new Map<number, NativeActorHitboxes>();
  private poseTimes = new Map<number, number>();
  private sampledPoses = new Set<number>();
  private gestureClips=new Map<Equipment,THREE.AnimationClip[]>();
  private gestureLoading=new Set<Equipment>();
  private targetScene?: THREE.Object3D;
  private targetClips: THREE.AnimationClip[] = [];
  private motionReady = false;
  private worldWeapons = new Map<Equipment, THREE.Object3D>();
  private worldLoading = new Map<Equipment,Promise<void>>();
  private viewRevision = 0;
  private viewCosmeticRevision = 0;
  private readonly viewModels = new Map<Equipment, {scene: THREE.Group; animation: ViewAnimation; muzzle?: THREE.Object3D}>();
  private readonly viewLoading = new Map<Equipment, Promise<void>>();
  private readonly viewPreloader = new WeaponPreloader();
  private shotEffects: ShotEffects;
  private readonly killFeed = new KillFeedModel();
  private characterHits: CharacterHitEffects;
  private readonly utilityRenderer: UtilityRenderer;
  private readonly utilityFlash: HTMLDivElement;
  private readonly utilitySmoke: HTMLDivElement;
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
  private playerCorpse?: {root: THREE.Group; animator: DuelAnimator; origin: THREE.Vector3; rotation: THREE.Quaternion; orbitYaw: number};
  private readonly deathFocus = new THREE.Vector3();
  private readonly deathCamera = new THREE.Vector3();
  private readonly deathRotation = new THREE.Quaternion();
  private readonly deathLookMatrix = new THREE.Matrix4();
  private animationTimes = new Map<number, number>();
  private animationClock = 0;
  private viewAnimationElapsed = 0;
  private pacer = new FramePacer();
  private metrics = new FrameMetrics();
  private meter: PerformanceMeter;
  private viewMuzzle?: THREE.Object3D;
  private botMuzzles = new Map<number, THREE.Object3D>();
  private readonly roundFlow = new RoundFlow();
  private readonly stepView = new StepView();
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
  private mapLighting?: PrefireLighting;
  private previousRecording?: CombatRecording;
  private completedRound?: DuelStatus['completedRound'];
  private readonly reviewIdentity = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private replayView?: {recording: CombatRecording; shot?: ReplayShot; time: number; overview: boolean; diagnostic: boolean};
  private readonly replayScene = new PlaybackScene();
  private replayRevision = 0;
  private replayAssets = new Map<Equipment, THREE.Object3D>();

  constructor(private readonly host: HTMLElement, private readonly crosshair: HTMLElement,
    private readonly onStatus: (status: DuelStatus) => void,
    private readonly onError: (message: string) => void, private settings: Settings, private config: DuelConfig,
    private readonly progression?: ProgressionController, private readonly scenario?: DuelScenario) {
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
    if (!scenario) {
      this.scene.add(new THREE.HemisphereLight('#f5f7ef', '#4d5d55', 2));
      this.scene.add(new THREE.AmbientLight('#bec9c3', .7));
      const sun = new THREE.DirectionalLight('#fff4dc', 2.4);
      sun.position.set(-9, 18, 8); this.scene.add(sun);
    }
    this.viewScene.add(new THREE.HemisphereLight('#ffffff', '#66675b', 1.4));
    const viewLight = new THREE.DirectionalLight('#fff2dd', 2); viewLight.position.set(-2, 4, 2); this.viewScene.add(viewLight);
    this.viewScene.add(this.viewRoot);
    if (!scenario) {
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
    }
    for (const object of [...this.scene.children]) if (object instanceof THREE.Mesh) this.shell.add(object);
    this.shell.scale.set(config.arenaScale, 1, config.arenaScale);
    this.scene.add(this.shell); batchStaticMeshes(this.shell);
    if (scenario) {
      this.shell.visible = false;
      this.scene.add(scenario.scene);
      this.mapLighting = new PrefireLighting(this.scene, scenario.scene);
      this.mapLighting.configure(this.renderer, settings.quality);
      this.scene.background = new THREE.Color('#bbc9d1');
      this.scene.fog = new THREE.Fog('#bbc9d1', 75, 150);
      this.camera.far = 180;
      this.camera.updateProjectionMatrix();
      this.renderer.domElement.setAttribute('aria-label', scenario.kind === 'duel-map' ? 'Dust 2 Duel map chunk' : 'Dust 2 prefire map');
    }
    this.scene.add(this.actors, this.covers, this.dynamicCovers, this.effects,this.actorShadows.group, this.replayScene.group);
    this.audio.setAcoustics(this.acoustics);
    this.shotEffects = new ShotEffects(this.effects); this.viewFlashes = new MuzzleFlashes(this.viewScene, 2);
    this.characterHits = new CharacterHitEffects(this.effects);
    this.utilityRenderer = new UtilityRenderer(this.effects, this.viewScene);
    this.utilityFlash = document.createElement('div'); this.utilityFlash.className = 'duel-utility-flash';
    this.utilityFlash.setAttribute('aria-hidden', 'true'); host.append(this.utilityFlash);
    this.utilitySmoke = document.createElement('div'); this.utilitySmoke.className = 'duel-utility-interior-smoke';
    this.utilitySmoke.setAttribute('aria-hidden', 'true'); host.append(this.utilitySmoke);
    this.rebuildCovers();
    this.bindInput();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.resize();
    void Promise.all([this.loadTarget(),this.loadViewModel(loadoutWeapon(settings)),prepareRapier(),
      this.config.utilitiesEnabled ? this.prepareUtilities() : Promise.resolve()]).then(async()=>{
      if(this.disposed)return;
      if(!this.targetScene||!this.loadedViewEquipment)return;
      this.audio.prepare();
      if (this.config.utilitiesEnabled && this.settings.volume > 0) void this.audio.preloadUtilities().catch(() => {});
      await Promise.all([scenario?compileRetainedShaders(this.renderer,this.scene,this.camera):prewarmShaders(this.renderer,this.scene,this.camera),prewarmShaders(this.renderer,this.viewScene,this.viewCamera)]);
      if(!this.disposed) {
        warmRetainedFirstUse(this.renderer,this.scene,this.camera,[this.actors]);
        warmRetainedFirstUse(this.renderer,this.viewScene,this.viewCamera,[this.viewRoot,this.utilityRenderer.held]);
      }
      if(this.disposed)return;
      this.criticalReady=true;this.preloadViewModels();this.report();
    }).catch(()=>{if(!this.disposed)this.onError('The range could not finish preparing. Reload to retry.');});
    this.report();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  private createSimulation() {
    const seed = seedForDesign(this.seed++, this.config.mapDesign);
    this.scenario?.configureDuel?.(this.config);
    const simulation = this.scenario?.create(this.settings, seed) ?? new DuelSimulation(this.config, seed, duelArena(seed, this.config.arenaScale), this.settings.weapon, this.settings.sidearm, this.settings.primaryEnabled);
    simulation.configureUtilities(this.config);
    if (this.scenario && this.scenario.kind !== 'duel-map') this.config = simulation.config;
    simulation.playerAspect = this.camera.aspect;
    simulation.actorHitPose = (actor, time) => this.sampleActorHitPose(actor, time);
    simulation.actorSensorPose = simulation.actorHitPose;
    simulation.actorPoseTick = (actor, time) => this.animators.get(actor.id)?.recordPose(actor, time, simulation.actorBodyYaw(actor, time));
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
    configureArenaAcoustics(this.acoustics,this.sim.arena);
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
      const {scene, animations} = instance ?? await loadCombatModel('/models/target.glb');
      if (this.disposed || revision !== this.agentRevision) {if (instance) instance.dispose(); else disposeResources([scene]); return;}
      const oldScene = this.targetScene, oldInstance = this.agentInstance;
      this.agentInstance = instance;
      this.targetScene = scene; this.targetClips = animations;
      this.rebuildActors();
      if (!this.sessionStarted || this.paused) prewarmShaders(this.renderer,this.scene,this.camera);
      if (oldInstance) oldInstance.dispose(); else if (oldScene) disposeResources([oldScene]);
      const weaponsReady=this.loadWorldWeapons();
      try {
        const [motion,flinches]=await Promise.all([loadCombatModel('/models/duel-motion.glb?v=extended-actions-2'),
          loadCombatModel('/models/duel-flinches.glb').catch(()=>undefined)]);
        if (this.disposed || revision !== this.agentRevision) {disposeResources([motion.scene,...(flinches?[flinches.scene]:[])]);return;}
        this.targetClips = [...motion.animations,...(flinches?nativeFlinchClips(flinches):[])];
        if(flinches)disposeResources([flinches.scene]);
        this.motionReady = true;
        this.rebuildActors();
      } catch { /* Keep the baseline idle/run set if local native clips are absent. */ }
      await weaponsReady;
      if (this.config.utilitiesEnabled) await this.prepareUtilities();
    } catch { if (!this.disposed) this.onError('The player model is unavailable. Run npm run assets:build, then reload.'); }
  }

  private rebuildActors() {
    this.clearActors();
    if (!this.targetScene) return;
    for (const actor of this.sim.snapshot().slice(1)) this.buildActor(actor);
  }

  private async rebuildActorsPrepared(signal:AbortSignal) {
    this.clearActors();
    if (!this.targetScene) return;
    const revision=this.actorBuildRevision;
    for(const actor of this.sim.snapshot().slice(1)) {
      await backgroundFrame(signal);
      if(this.disposed||revision!==this.actorBuildRevision)return;
      this.buildActor(actor);
    }
  }

  private clearActors() {
    this.actorBuildRevision++;
    this.clearPlayerCorpse();
    this.animators.forEach(animator => animator.dispose()); this.animators.clear();
    this.animationTimes.clear();
    this.hitboxes.clear(); this.poseTimes.clear(); this.sampledPoses.clear();
    this.botMuzzles.clear();
    for (const mesh of this.heldGrenades.values()) this.utilityRenderer.releaseWorldHeld(mesh);
    this.heldGrenades.clear();
    this.utilityActorActions.clear(); this.utilityThrownAt.clear();
    disposeSkeletons(this.actors);
    this.actors.clear(); this.models.clear(); this.heldWeapons.clear(); this.actorWeaponCache.clear(); this.actorEquipment.clear();
  }

  private buildActor(actor:DuelActorSnapshot) {
    if(!this.targetScene)return;
    const root = new THREE.Group();
    const model = cloneSkeleton(this.targetScene);
    const held = this.attachWorldWeapon(model, actor.equipment);
    if (held) {
      held.visible = actor.alive && !actor.utility; this.heldWeapons.set(actor.id, held);
      if (this.worldWeapons.has(actor.equipment) || actor.equipment === 'm4a1s') {
        this.actorWeaponCache.set(actor.id, new Map([[actor.equipment, held]])); this.actorEquipment.set(actor.id, actor.equipment);
      }
    }
    const utilityMount = model.getObjectByName('hand_R');
    if (utilityMount) this.heldGrenades.set(actor.id, this.utilityRenderer.createWorldHeld(utilityMount));
    const muzzle = held ? muzzleAnchor(held) : undefined;
    if (muzzle) this.botMuzzles.set(actor.id, muzzle);
    root.add(model); this.actors.add(root); this.models.set(actor.id, root);
    const animator=new DuelAnimator(model, this.targetClips, (actor.id * .317) % 1, actor.equipment);
    animator.addGestureClips(this.gestureClips.get(actor.equipment)??[]);
    animator.addGestureClips(this.utilityGestures);
    animator.setDeathWorld({floor:0,boxes:this.sim.arena.solids.filter(blocksMovement)});
    let nextBodySound=0;
    animator.onDeathContact=contact=>{
      if(this.animationClock<nextBodySound||!['pelvis','spine_2','head_0'].includes(contact.body))return;
      nextBodySound=this.animationClock+1;
      this.audio.playBodyContact(contact.speed,this.settings.volume,this.soundLocation(contact.point));
    };
    this.animators.set(actor.id,animator);
    animator.recordPose(actor, this.sim.time, this.sim.actorBodyYaw(actor));
    const hitboxes = new NativeActorHitboxes(root);
    if (hitboxes.pose.capsules.length === 19) this.hitboxes.set(actor.id, hitboxes);
  }

  // Sample on the authoritative firing tick, not from the last rendered frame.
  // Reuse the rig and capsule buffers; no second skeleton or per-frame ray sweep.
  private sampleActorHitPose(actor: DuelActorSnapshot, time = this.sim.time) {
    const hitboxes = this.hitboxes.get(actor.id), model = this.models.get(actor.id), animator = this.animators.get(actor.id);
    if (!hitboxes || !model || !animator || !actor.alive) return;
    model.position.set(actor.position.x, actor.feet, actor.position.z);
    const bodyYaw = this.sim.actorBodyYaw(actor, time);
    model.rotation.y = bodyYaw - Math.PI;
    const weapon = this.sim.actors[actor.id].weapon;
    animator.update(actor, 0, undefined,
      {reloadRemaining: Math.max(0, weapon.reloadUntil - this.sim.time), reloadDuration: weapon.reload.phaseDuration || equipmentStats(actor.equipment).reload,
        reloadPhase: weapon.reloadPhase, reloadProgress: weapon.reload.progress, bodyYaw, poseTime: time});
    this.poseTimes.set(actor.id, time);
    this.sampledPoses.add(actor.id);
    model.updateWorldMatrix(true, true);
    return hitboxes.capture();
  }

  private loadWorldWeapons() {
    const jobs:Promise<void>[]=[];
    for (const weapon of new Set(this.sim.actors.slice(1).flatMap(actor => [actor.weapon.id, ...actor.inventory.keys()]))) {
      this.loadGesturePack(weapon);
      const cached = this.worldWeapons.get(weapon);
      if (cached) {this.worldWeapons.delete(weapon); this.worldWeapons.set(weapon, cached); continue;}
      const pending=this.worldLoading.get(weapon);if(pending){jobs.push(pending);continue;}
      const job=loadCombatModel(`/models/${weapon}.glb`).then(({scene}) => {
        if (this.disposed) {disposeResources([scene]); return;}
        this.worldWeapons.set(weapon, scene);
        for(const actor of this.sim.snapshot().slice(1)) {
          if(actor.equipment!==weapon)continue;
          const model=this.models.get(actor.id);if(!model)continue;
          const previous=this.heldWeapons.get(actor.id);if(previous)previous.visible=false;
          const held=this.attachWorldWeapon(model,weapon);if(!held)continue;
          held.visible=actor.alive&&!actor.utility;this.heldWeapons.set(actor.id,held);
          const cache = this.actorWeaponCache.get(actor.id) ?? new Map<Equipment, THREE.Object3D>();
          cache.set(weapon, held); this.actorWeaponCache.set(actor.id, cache); this.actorEquipment.set(actor.id, weapon);
          const muzzle=muzzleAnchor(held);if(muzzle)this.botMuzzles.set(actor.id,muzzle);
        }
        this.trimWorldWeapons();
      }).catch(() => {
        if (!this.disposed) this.onError(`The ${weapon} world model is unavailable. Run npm run assets:build, then reload.`);
      }).finally(() => this.worldLoading.delete(weapon));
      this.worldLoading.set(weapon,job);jobs.push(job);
    }
    this.trimWorldWeapons();
    return Promise.all(jobs).then(()=>{});
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
    const active = new Set(this.sim.actors.slice(1).flatMap(actor => [actor.weapon.id, ...actor.inventory.keys()]));
    for (const drop of this.sim.drops) if (!drop.picked) active.add(drop.equipment);
    for (const [weapon, scene] of this.worldWeapons) {
      if (this.worldWeapons.size <= 8) break;
      if (active.has(weapon)) continue;
      this.worldWeapons.delete(weapon); disposeResources([scene]);
    }
  }

  private attachWorldWeapon(model: THREE.Object3D, weapon: Equipment, source = this.worldWeapons.get(weapon)) {
    // GLTFLoader sanitizes periods in animation node names.
    const held = model.getObjectByName('held_weapon_target001') ?? model.getObjectByName('held_weapon_target.001');
    if (weapon === 'm4a1s' && held) return held;
    const mount = model.getObjectByName('wpn');
    if (!mount || !source) return held;
    if (held) held.visible = false;
    const replacement = source.clone(true);
    replacement.name = `held_${weapon}`;
    new THREE.Matrix4().fromArray(weaponMounts.mounts[weapon].inverseBind).decompose(
      replacement.position, replacement.quaternion, replacement.scale);
    mount.add(replacement);
    return replacement;
  }

  private async prepareViewModel(weapon: Equipment) {
    if (this.viewModels.has(weapon)) return;
    let pending = this.viewLoading.get(weapon);
    if (!pending) {
      const cosmeticRevision = this.viewCosmeticRevision;
      const profile = this.progression?.getSnapshot().profile;
      const asset = profile ? cosmeticAsset(profile, weapon) : weapon;
      pending = (async () => {
        const {scene, animations} = await loadCombatModel(`/models/view-${asset}.glb`);
        prepareNativeViewAssembly(scene);
        try {if (profile) await applyCosmetic(scene, profile, weapon);}
        catch {disposeResources([scene]); throw new Error('Cosmetic could not load');}
        if (this.disposed || cosmeticRevision !== this.viewCosmeticRevision) {disposeResources([scene]); return;}
        scene.rotation.y = Math.PI;
        const model = {scene, animation: new ViewAnimation(scene, animations), muzzle: muzzleAnchor(scene)};
        if (weapon === 'elite') {muzzleAnchor(scene, 'left'); muzzleAnchor(scene, 'right');}
        this.viewModels.set(weapon, model);
        // Snapshot the new assembly with the real view lights, then detach before the next render.
        this.viewScene.add(scene);
        prewarmShaders(this.renderer, this.viewScene, this.viewCamera);
        scene.removeFromParent();
      })().finally(() => {if (cosmeticRevision === this.viewCosmeticRevision) this.viewLoading.delete(weapon);});
      this.viewLoading.set(weapon, pending);
    }
    await pending;
  }

  private trimViewModels() {
    // Each native GLB includes its own glove textures; bound retained GPU assemblies.
    for (const [weapon, model] of this.viewModels) {
      if (this.viewModels.size <= 3) break;
      if (weapon === this.renderedEquipment || weapon === this.loadedViewEquipment) continue;
      this.viewModels.delete(weapon); model.animation.dispose(); disposeResources([model.scene]);
    }
  }

  private prepareUtilities() {
    if (this.settings.volume > 0) void this.audio.preloadUtilities().catch(() => {});
    return this.utilityPreparing ??= Promise.all([this.utilityRenderer.prepare(), loadCombatModel('/models/utility-gestures.glb')])
      .then(async ([, asset]) => {
        disposeResources([asset.scene]); if (this.disposed) return;
        this.utilityGestures = nativeGestureClips(asset);
        for (const animator of this.animators.values()) animator.addGestureClips(this.utilityGestures);
        await this.utilityRenderer.setGloves(this.progression?.getSnapshot().profile);
        this.utilityRenderer.warmParticleTextures(this.renderer);
        await this.utilityRenderer.smoke.prepare(this.renderer);
      }).catch(error => {this.utilityPreparing = undefined; throw error;});
  }

  private preloadViewModels() {
    if (this.disposed) return;
    const {primary, sidearm} = this.sim.loadout;
    this.viewPreloader.start([...(primary ? [primary] : []), ...(sidearm ? [sidearm] : []), 'knife'], async weapon => {
      await this.prepareViewModel(weapon); this.trimViewModels();
    }, () => !this.disposed && (!this.sessionStarted || this.paused));
  }

  private clearViewModels() {
    this.viewPreloader.cancel(); this.viewCosmeticRevision++; this.viewRevision++;
    this.viewRoot.clear(); this.viewLoading.clear();
    this.viewAnimation = undefined; this.loadedViewEquipment = undefined; this.viewMuzzle = undefined;
    for (const model of this.viewModels.values()) {model.animation.dispose(); disposeResources([model.scene]);}
    this.viewModels.clear();
  }

  private async loadViewModel(weapon: Equipment) {
    if (this.pendingInspect !== weapon) this.pendingInspect = undefined;
    this.renderedEquipment = weapon;
    const revision = ++this.viewRevision;
    try {
      // No await or GLTF decode on a hot switch: attach the existing rig immediately.
      if (!this.viewModels.has(weapon)) await this.prepareViewModel(weapon);
      if (this.disposed || revision !== this.viewRevision) {this.trimViewModels(); return;}
      const model = this.viewModels.get(weapon);
      if (!model) return;
      this.viewModels.delete(weapon); this.viewModels.set(weapon, model);
      this.viewAnimation?.cancel();
      this.viewRoot.clear(); this.viewRoot.add(model.scene);
      this.viewAnimation = model.animation; this.viewAnimationElapsed = 0;
      this.loadedViewEquipment = weapon;
      this.viewMuzzle = model.muzzle;
      const duration = Math.max(.01, this.sim.actors[0].equipReadyAt - this.sim.time);
      if (this.pickupDrawing) this.viewAnimation.playPickup(duration); else this.viewAnimation.playDraw(duration);
      this.pickupDrawing = false;
      if (this.pendingInspect === weapon && this.sim.actors[0].weapon.id === weapon) {this.pendingInspect = undefined; this.inspect();}
      this.trimViewModels();
    } catch { if (!this.disposed && revision === this.viewRevision) this.onError('The weapon model is unavailable. Run npm run assets:build, then reload.'); }
  }

  async refreshCosmetics() {
    const key = JSON.stringify(this.progression?.getSnapshot().profile.equipped);
    if (key === this.cosmeticKey) return;
    const oldAgent = JSON.parse(this.cosmeticKey || '{}')?.agent;
    this.cosmeticKey = key;
    this.clearViewModels();
    if (oldAgent !== this.progression?.getSnapshot().profile.equipped.agent) await this.loadTarget();
    await this.loadViewModel(this.sim.actors[0].weapon.id);
    await this.utilityRenderer.setGloves(this.progression?.getSnapshot().profile);
    this.preloadViewModels();
  }

  private xpSetup(): DuelXpSetup {
    return {playerHealth: this.config.playerHealth, playerArmor: this.config.playerArmor,
      bots: this.sim.actors.slice(1).map((actor, index) => ({id: String(actor.id), ...botConfig(this.config, index)}))};
  }

  private beginProgression() {
    this.xpDamage.clear();
    if (this.scenario && this.scenario.kind !== 'duel-map') return;
    this.xpAttempt = this.progression?.beginDuel(this.xpSetup(), String(this.xpRevision)) ?? null;
  }

  setSettings(settings: Settings) {
    if (settings === this.settings) return;
    const weaponChanged = settings.weapon !== this.settings.weapon || settings.sidearm !== this.settings.sidearm || settings.primaryEnabled !== this.settings.primaryEnabled;
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = settings;
    if (this.scenario) this.config = {...this.config, shortcutProtection: settings.protectShortcuts};
    if (weaponChanged) {
      if(this.loadingMap)this.pendingSetupRestart=true;else this.restart(false,false);
    }
    if (weaponChanged) void this.loadViewModel(loadoutWeapon(settings));
    if (weaponChanged) this.preloadViewModels();
    if (qualityChanged) {
      this.metrics.resetResolution();
      this.mapLighting?.configure(this.renderer, settings.quality);
    }
    this.meter.configure(settings.showFps);
    this.resize();
  }

  setConfig(config: DuelConfig) {
    if (config === this.config) return;
    const changeMap = this.scenario?.kind === 'duel-map' && config.realMapChunk !== this.config.realMapChunk;
    const displayOnly=this.scenario?.kind==='duel-map' &&
      JSON.stringify({...config,routeGuide:false})===JSON.stringify({...this.config,routeGuide:false});
    this.config = config;
    if (config.utilitiesEnabled) void this.prepareUtilities().catch(() => this.onError('Grenade models could not load. Reload to retry.'));
    this.scenario?.configureDuel?.(config);
    if(displayOnly){this.report();return;}
    if(this.loadingMap){if(changeMap)this.pendingMapSelection=true;else this.pendingSetupRestart=true;return;}
    this.restart(false,changeMap);
  }

  restart(continuous = false, changeMap = true) {
    if (this.loadingMap) return;
    if(continuous && this.sim.phase === 'result' && this.scenario?.stageRound) {
      if(this.nextRoundAbort)return;
      const controller=new AbortController();this.nextRoundAbort=controller;this.nextRoundError=undefined;this.report();
      void this.scenario.stageRound(this.seed,controller.signal,
        (scene,signal)=>prepareSceneGpu(this.renderer,scene,this.scene,this.camera,signal,this.settings.quality)).then(()=>{
        if(this.disposed||controller.signal.aborted)return;
        this.nextRoundAbort=undefined;this.activateRound(continuous,changeMap);
      }).catch(error=>{
        if(this.disposed||controller.signal.aborted)return;
        this.nextRoundAbort=undefined;this.roundFlow.reset();
        this.nextRoundError=error instanceof Error?error.message:'Next round unavailable';this.report();
      });
      return;
    }
    this.nextRoundAbort?.abort();this.nextRoundAbort=undefined;
    this.activateRound(continuous,changeMap);
  }

  private activateRound(continuous:boolean,changeMap:boolean) {
    this.seamlessHandoff=continuous&&this.sim.postWinPlayable;
    this.nextRoundError=undefined;
    this.closeReplay();
    this.mapAbort = new AbortController();this.loadingMap=true;
    this.sim.pause();this.audio.stopVoices();this.report();
    const preparation=changeMap&&this.scenario?.prepareRound
      ? this.scenario.prepareRound(this.seed,this.mapAbort.signal):Promise.resolve(false);
    void preparation.then(async changed=>{
      if(this.disposed)return;
      if(changed) {
        if(this.mapLighting) {
          this.scene.remove(this.mapLighting.sky,this.mapLighting.fill,this.mapLighting.sun,this.mapLighting.sun.target);
          this.mapLighting.dispose();
        }
        this.mapLighting=takePreparedLighting(this.scene,this.scenario!.scene)??new PrefireLighting(this.scene,this.scenario!.scene);
        this.mapLighting.configure(this.renderer,this.settings.quality);
      }
      const pausedDuringLoad=this.paused;
      const weaponsReady=this.finishRestart(continuous,true);
      await this.rebuildActorsPrepared(this.mapAbort!.signal);
      await weaponsReady;
      if(this.disposed)return;
      const player=this.sim.snapshot()[0];
      this.camera.position.copy(player.position);this.camera.rotation.set(player.pitch,player.yaw,0,'YXZ');this.camera.updateMatrixWorld();
      this.syncActors(this.sim.snapshot(),0);
      await compileRetainedShaders(this.renderer,this.scene,this.camera);
      if(this.disposed)return;
      this.mapLighting?.beginFrame(this.renderer,this.camera.position);
      warmRetainedFirstUse(this.renderer,this.scene,this.camera,[this.actors,this.scenario?.scene.getObjectByName('duel-route-arrows')].filter((root):root is THREE.Object3D=>!!root));
      this.loadingMap=false;this.seamlessHandoff=false;
      if(continuous){this.sim.start();this.beginProgression();this.updateMovement();}
      this.last=0;this.report();
      if(continuous && (pausedDuringLoad||this.paused))this.pause();
      if(this.pendingMapSelection){this.pendingMapSelection=false;this.pendingSetupRestart=false;this.restart(false,true);}
      else if(this.pendingSetupRestart){this.pendingSetupRestart=false;this.restart(false,false);}
    }).catch(error=>{
      if(this.disposed || this.mapAbort?.signal.aborted)return;
      this.loadingMap=false;this.seamlessHandoff=false;
      if(this.pendingMapSelection){this.pendingMapSelection=false;this.pendingSetupRestart=false;this.restart(false,true);return;}
      if(this.pendingSetupRestart){this.pendingSetupRestart=false;this.restart(false,false);return;}
      this.pause();
      this.onError(error instanceof Error ? error.message : 'Could not load this map chunk.');
    });
  }

  private finishRestart(continuous = false, deferStart = false) {
    const recording = this.sim.replay.release();
    if (recording.shots.length || recording.frames.length > 1) this.previousRecording = recording;
    this.closeReplay();
    this.scenario?.beforeRestart?.(this.sim.outcome, continuous);
    if (this.xpAttempt) this.progression?.cancelAttempt(this.xpAttempt);
    this.xpAttempt = null; this.xpRevision++;
    this.paused = false; this.pointer = null; this.mouseButtons.reset(); this.pickupDrawing = false; this.viewAnimation?.cancel();
    for (const object of this.dropModels.values()) this.scene.remove(object);
    this.dropModels.clear();
    if (!continuous) {
      this.keys.clear();
      this.sessionStarted = false;
      this.releaseShortcuts();
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    }
    this.sim = this.createSimulation(); this.sim.setSpawnAuthoring(this.spawnAuthoring);
    this.kills = this.damage = 0; this.lastShot = undefined;
    this.stepView.reset();
    this.shell.scale.set(this.config.arenaScale, 1, this.config.arenaScale);
    this.damageFeedback.clear(); this.wasReloading = false;
    this.roundFlow.reset(); this.deaths.clear();
    this.caption = ''; this.captionUntil = 0; this.kick = 0;
    this.audio.stopVoices();this.clearEffects(); this.rebuildCovers();
    if(!deferStart)this.rebuildActors();
    this.report();
    const weaponsReady=this.loadWorldWeapons();
    this.last=0;
    if (continuous && !deferStart) {this.sim.start(); this.beginProgression(); this.updateMovement(); this.report();}
    return weaponsReady;
  }

  async enter() {
    if (this.disposed || this.entering || this.loadingMap || !this.criticalReady) return;
    this.closeReplay();
    const revision = ++this.enterRevision; this.entering = true;
    this.last=0;
    if (this.sim.phase === 'ready') {this.sim.start(); if (!this.spawnAuthoring) this.beginProgression();} else this.sim.resume();
    this.sessionStarted = true;
    this.paused = false;
    this.renderer.domElement.focus({preventScroll: true});
    const coarse = matchMedia('(pointer: coarse)').matches;
    const supported = typeof this.renderer.domElement.requestPointerLock === 'function';
    this.inputName = coarse ? 'Touch' : 'Mouse';
    const pointerLock = !coarse ? requestRawLock(this.renderer.domElement) : Promise.resolve<'drag'>('drag');
    const guard = this.shortcuts.enter(!coarse && supported && this.config.shortcutProtection);
    void this.audio.unlock(this.settings.weapon);
    if (this.config.utilitiesEnabled && this.settings.volume > 0) void this.audio.preloadUtilities().catch(() => {});
    void this.audio.unlock(this.settings.sidearm); void this.audio.unlock('knife');
    for (const weapon of new Set(this.sim.actors.slice(1).flatMap(actor => [actor.weapon.id, ...actor.inventory.keys()])))
      if (weapon !== this.settings.weapon) void this.audio.unlock(weapon);
    try {
      const mode = await pointerLock;
      await guard;
      if (revision !== this.enterRevision || this.disposed || this.paused) return;
      if (!coarse && supported && (mode === 'drag' || document.pointerLockElement !== this.renderer.domElement)) {
        this.pause(); this.inputName = 'Mouse capture blocked. Click Resume duel again.';
      } else this.inputName = coarse ? 'Touch' : !supported ? 'Drag aim (mouse capture unsupported)' : mode === 'raw' ? 'Raw mouse (verify cm/360)' : 'Standard mouse (raw unverified)';
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
    if (this.sim.phase === 'ready'&&!this.loadingMap) return;
    this.paused = true; this.sim.pause(); this.mouseButtons.reset(); this.keys.clear(); this.updateMovement();
    this.caption = ''; this.captionUntil = 0;
    for(const action of this.utilitySounds.values())action.timeline.cancel();this.utilitySounds.clear();this.audio.cancelUtilityCues();
    this.damageFeedback.clear();
    this.releaseShortcuts();
    this.sim.command(0, {fireHeld: false, secondaryHeld: false});
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.report();
  }

  private listen(target: EventTarget, name: string, callback: EventListener) {
    target.addEventListener(name, callback); this.cleanup.push(() => target.removeEventListener(name, callback));
  }

  private bindInput() {
    const canvas = this.renderer.domElement;
    const mouseSample = (event: MouseEvent | PointerEvent) => {
      if (!this.sim.playable || this.paused || this.entering || this.replayView ||
        document.pointerLockElement !== canvas && event.target !== canvas && this.pointer === null) return;
      const command = this.mouseButtons.update(event);
      if (command) this.sim.command(0, command);
    };
    // A second mouse button changes pointermove.buttons, not pointerdown;
    // mousedown/up also report chord edges when the mouse never moves.
    this.listen(canvas, 'mousedown', mouseSample as EventListener);
    this.listen(document, 'mouseup', mouseSample as EventListener);
    const weaponSlot = (): Slot => {
      const id = this.sim.actors[0].weapon.id;
      return id === 'knife' ? 3 : id === 'zeus' ? 4 : id === this.sim.loadout.sidearm ? 2 : 1;
    };
    let observedSlot = weaponSlot(), previousSlot: Slot = observedSlot === 1 ? 2 : 1;
    this.cleanup.push(bindGameplayWheel(canvas, () => this.settings.controls,
      () => this.sim.playable && !this.paused && !this.entering, actions => {
        const currentSlot = weaponSlot();
        if (currentSlot !== observedSlot) {previousSlot = observedSlot; observedSlot = currentSlot;}
        if (actions.includes('jump')) this.sim.command(0, {jumpPressed: true});
        if (actions.includes('reload')) this.sim.command(0, {reloadPressed: true});
        if (actions.includes('inspect')) this.inspect();
        if (actions.includes('use')) this.sim.command(0, {usePressed: true});
        if (actions.includes('pickup')) this.pickup();
        if (actions.includes('drop')) this.sim.command(0, {dropPressed: true});
        this.equipControls(actions, currentSlot);
        if (actions.includes('lastWeapon')) this.equip(this.sim.selectedUtility ? currentSlot : previousSlot);
      }));
    this.listen(canvas, 'pointerdown', ((event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button === 2) {event.preventDefault(); mouseSample(event); return;}
      if (event.button !== 0) return;
      if (this.sim.phase === 'ready' || this.paused) { void this.enter(); return; }
      if (!this.sim.playable) return;
      this.pointer = event.pointerId; this.pointerX = event.clientX; this.pointerY = event.clientY;
      if (event.pointerType !== 'mouse') this.sim.command(0, {firePressed: true});
      else mouseSample(event);
      if (!document.pointerLockElement) canvas.setPointerCapture(event.pointerId);
    }) as EventListener);
    this.listen(document, 'pointermove', ((event: PointerEvent) => {
      if (!this.sim.playable || this.paused) return;
      if (event.pointerType === 'mouse') mouseSample(event);
      let dx = 0, dy = 0;
      if (document.pointerLockElement === canvas && event.pointerType === 'mouse') {
        dx = event.movementX; dy = event.movementY;
      } else if (this.pointer === event.pointerId) {
        dx = event.clientX - this.pointerX; dy = event.clientY - this.pointerY;
        this.pointerX = event.clientX; this.pointerY = event.clientY;
      }
      if (dx || dy) {
        const actions = this.sim.actors[0].weapon.actions;
        const utility = !!this.sim.selectedUtility;
        const touchScale = .0025 * (utility ? 1 : actions.sensitivityScale);
        this.sim.command(0, event.pointerType === 'mouse' ? mouseLookDelta(dx, dy, this.settings, utility ? 90 : actions.horizontalFov) :
          {yawDelta: -dx * touchScale, pitchDelta: -dy * touchScale * (this.settings.invertY ? -1 : 1)});
      }
    }) as EventListener);
    this.listen(document, 'pointerup', ((event: PointerEvent) => {
      if (event.pointerType === 'mouse') mouseSample(event);
      if (event.button === 2) return;
      if (this.pointer !== event.pointerId) return;
      this.pointer = null; if (event.pointerType !== 'mouse') this.sim.command(0, {fireHeld: false});
    }) as EventListener);
    this.listen(canvas, 'pointercancel', (() => this.pause()) as EventListener);
    this.listen(canvas, 'contextmenu', (event => event.preventDefault()) as EventListener);
    this.listen(window, 'keydown', ((event: KeyboardEvent) => {
      if (ignoreGameplayKey(event)) return;
      if (event.code === 'Escape' && this.sim.phase !== 'ready') {this.pause(); return;}
      if (this.sim.phase === 'ready' || this.paused) return;
      const currentSlot = weaponSlot();
      if (currentSlot !== observedSlot) {previousSlot = observedSlot; observedSlot = currentSlot;}
      const actions = actionsForCode(this.settings.controls, event.code);
      if (!actions.length) return;
      event.preventDefault(); this.keys.add(event.code); this.updateMovement();
      if (event.repeat) return;
      if (actions.includes('jump')) this.sim.command(0, {jumpPressed: true});
      if (actions.includes('reload')) this.sim.command(0, {reloadPressed: true, reloadHeld: true});
      if (actions.includes('inspect')) this.inspect();
      if (actions.includes('use')) this.sim.command(0, {usePressed: true});
      if (actions.includes('pickup')) this.pickup();
      if (actions.includes('drop')) this.sim.command(0, {dropPressed: true});
      this.equipControls(actions, currentSlot);
      if (actions.includes('lastWeapon')) this.equip(this.sim.selectedUtility ? currentSlot : previousSlot);
    }) as EventListener);
    this.listen(window, 'keyup', ((event: KeyboardEvent) => {
      this.keys.delete(event.code);
      if (actionsForCode(this.settings.controls, event.code).includes('reload')) this.sim.command(0, {reloadHeld: false});
      this.updateMovement();
    }) as EventListener);
    this.listen(window, 'focusin', (event => {if (!this.paused && isEditingTarget(event.target)) this.pause();}) as EventListener);
    this.listen(window, 'blur', (() => {if (!this.entering) this.pause();}) as EventListener);
    this.listen(document, 'visibilitychange', (() => {if (document.hidden) this.pause();}) as EventListener);
    this.listen(document, 'pointerlockchange', (() => {
      if (this.entering) return;
      if (document.pointerLockElement !== canvas && !this.inputName.startsWith('Drag aim') && this.inputName !== 'Touch' && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
    this.listen(document, 'fullscreenchange', (() => {
      if (!this.entering && this.shortcuts.protected && !document.fullscreenElement && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
  }

  private updateMovement() {
    this.sim.command(0, movementControls(this.settings.controls, this.keys));
  }

  captureSpawnPose(): SpawnPose | undefined {
    const actor = this.sim.actors[0], native = this.sim.arena.native;
    if (!this.spawnAuthoring || !actor.alive || !actor.grounded || (actor.duckAmount ?? 0) > .01 || !native ||
      !native.fits(actor.position, actor.feet, 72 * UNIT)) return;
    return {feet: {x: actor.position.x, y: actor.feet, z: actor.position.z}, yaw: actor.yaw, pitch: actor.pitch};
  }

  setSpawnAuthoring(enabled: boolean): boolean {
    if (this.scenario?.kind !== 'duel-map' || this.loadingMap) return false;
    if (enabled === this.spawnAuthoring) return true;
    this.pause(); this.spawnAuthoring = enabled;
    if (this.xpAttempt) this.progression?.cancelAttempt(this.xpAttempt);
    this.xpAttempt = null; this.restart(false, false);
    return true;
  }

  openReplay() {
    this.pause();
    const current = this.sim.replay.export();
    const recording = this.sim.phase !== 'ready' && (current.frames.length > 1 || current.shots.length) ? current : this.previousRecording;
    if (!recording) return;
    const revision = ++this.replayRevision;
    this.replayScene.setActorFactory((actor, source) => this.createReplayActor(actor, source));
    void this.replayScene.prepareUtilities(recording).catch(()=>{});
    for (const equipment of new Set(recording.frames.flatMap(frame => frame.actors.map(actor => actor.equipment)))) {
      if (this.worldWeapons.has(equipment) || this.replayAssets.has(equipment)) continue;
      void new GLTFLoader().loadAsync(`/models/${equipment}.glb`).then(({scene}) => {
        if (this.disposed || revision !== this.replayRevision) {disposeResources([scene]); return;}
        this.replayAssets.set(equipment, scene);
        this.replayScene.setActorFactory((actor, source) => this.createReplayActor(actor, source));
      }).catch(() => { /* Keep the recorded body visible if a weapon asset is unavailable. */ });
    }
    return recording;
  }
  private createReplayActor(actor: ReplayActor, recording: CombatRecording): ReplayVisual | undefined {
    if (!this.targetScene) return;
    const model = cloneSkeleton(this.targetScene), root = new THREE.Group(); root.add(model);
    const weapon = this.attachWorldWeapon(model, actor.equipment, this.replayAssets.get(actor.equipment) ?? this.worldWeapons.get(actor.equipment));
    const animator = new DuelAnimator(model, this.targetClips, 0, actor.equipment);
    animator.addGestureClips(this.gestureClips.get(actor.equipment) ?? []);
    animator.addGestureClips(this.utilityGestures);
    for (const frame of recording.frames) {
      const sample = frame.actors.find(item => item.id === actor.id);
      if (sample) animator.recordPose(sample, frame.time, sample.bodyYaw ?? sample.yaw);
    }
    let utilityGesture = false;
    return {root, utilityMount:model.getObjectByName('hand_R'),weapons:weapon?[weapon]:[],
      updateUtility:pose=>{
        if(pose)animator.playAction(pose.kind==='molotov'?'utility-molotov':'utility',pose.action,
          {startedAt:pose.startedAt,duration:pose.duration,crouched:pose.crouched});
        else if(utilityGesture)animator.playAction(actor.equipment,'cancel');
        utilityGesture=!!pose;
      },
      update: (sample, time, deathAge) => {
        animator.update(utilityGesture?{...sample,action:undefined,reloading:false}:sample,0,deathAge,
          {bodyYaw:sample.bodyYaw??sample.yaw,poseTime:time});
      }, dispose: () => {animator.dispose(); disposeSkeletons(root); root.removeFromParent();}};
  }
  showReplay(recording: CombatRecording, shot: ReplayShot | undefined, time: number, overview: boolean, diagnostic = false) {
    this.audio.setFlashExposure(0);
    this.scenario?.replayMap?.(recording.setup?.geometrySha256);
    if(this.scenario?.kind==='duel-map' && this.mapLighting)this.mapLighting.sun.castShadow=false;
    this.replayView = {recording, shot, time, overview, diagnostic};
    this.replayScene.show(recording, shot, time, diagnostic);
    this.actors.visible = this.effects.visible = this.actorShadows.group.visible = false;
    if (this.replayScene.hasWorld) this.covers.visible = this.dynamicCovers.visible = this.shell.visible = false;
    this.crosshair.style.visibility = 'hidden';
    this.scope.element.hidden = true; this.radar.canvas.hidden = true;
    this.utilityFlash.style.opacity = '0'; this.utilityRenderer.held.visible = false;
    this.utilitySmoke.style.opacity = '0';
  }
  closeReplay() {
    this.scenario?.replayMap?.();
    if(this.scenario?.kind==='duel-map')this.mapLighting?.configure(this.renderer,this.settings.quality);
    this.replayRevision++;
    this.replayView = undefined; this.replayScene.clear();
    for (const source of this.replayAssets.values()) disposeResources([source]); this.replayAssets.clear();
    this.actors.visible = this.effects.visible = this.actorShadows.group.visible = true;
    this.covers.visible = this.dynamicCovers.visible = true; this.shell.visible = !this.scenario;
    this.crosshair.style.visibility = 'visible';
  }
  performanceReport() {const assets = this.scenario?.loadingReport?.(); return {...this.metrics.exportReport({quality: this.settings.quality, browser: navigator.userAgent,
    frameLimit: this.settings.frameLimit, mode: this.scenario && this.scenario.kind !== 'duel-map' ? 'prefire' : 'duel', route: this.scenario?.name,
    botCount: this.sim.actors.length - 1, intervalSource: 'raw', loading: assets ? assets.decodedReused ? 'warm' : 'cold' : 'unknown'}, true), assets};}
  exportReplay(recording: CombatRecording) {downloadRecording(recording, this.performanceReport());}

  equip(slot: Slot) {this.utilityRenderer.cancelHeld();this.sim.selectUtility(null);this.sim.command(0,{equipSlot:slot,fireHeld:false,secondaryHeld:false});if(this.sim.phase==='ready')this.sim.equipPlayer(slot); this.report(); this.renderer.domElement.focus({preventScroll: true});}
  private equipControls(actions: ControlAction[], currentSlot: Slot) {
    for (const action of actions) {
      const slot = equipmentControlSlot(action, this.sim.actors[0].command.equipSlot ?? currentSlot, !!this.sim.selectedUtility);
      if (slot) this.equip(slot);
      if (action === 'utility') this.cycleUtility();
      const grenade = grenadeForControl(action);
      if (grenade) this.selectUtility(grenade);
    }
  }
  selectUtility(kind: UtilityKind) {
    if (this.replayView || this.paused || !this.sim.actors[0].alive || this.loadingMap) return;
    this.pendingInspect = undefined;
    this.sim.command(0, {fireHeld: false, secondaryHeld: false, equipSlot: undefined});
    this.sim.selectUtility(kind);
    if (this.sim.selectedUtility) {this.viewAnimation?.cancel(); this.audio.cancelAction(0); this.kick = 0;}
    this.report(); this.renderer.domElement.focus({preventScroll: true});
  }
  private cycleUtility() {
    const kind = nextUtility(this.sim.utilityInventory(), this.sim.selectedUtility);
    if (kind) this.selectUtility(kind);
  }
  throwUtility(lob = false) {
    const kind = this.sim.selectedUtility;
    if (!kind || this.paused || this.replayView || !this.sim.playable) return;
    this.sim.queueUtilityThrow(0, lob ? 0 : 1);
    this.report(); this.renderer.domElement.focus({preventScroll: true});
  }
  pickup() {
    const item=this.sim.nearestItemPickup();if(!item)return;
    this.pickupDrawing='equipment' in item;this.sim.command(0,{pickupPressed:true});
    this.renderer.domElement.focus({preventScroll:true});
  }
  inspect() {const actor = this.sim.actors[0];
    if (!actor.alive) return;
    if (this.sim.selectedUtility) {
      if(this.utilityRenderer.inspect(this.sim.time))this.startUtilitySound(0,this.sim.selectedUtility,'inspect',this.sim.time);
      return;
    }
    const slot = actor.command.equipSlot, loadout = this.sim.loadout;
    const queued = slot === 1 ? loadout.primary : slot === 2 ? loadout.sidearm : slot === 3 ? 'knife' : slot === 4 ? 'zeus' : undefined;
    if (queued && queued !== actor.weapon.id) {this.pendingInspect = queued; return;}
    if (!actor.weapon.reloadUntil && !actor.command.fireHeld) {
    if (this.loadedViewEquipment !== actor.weapon.id || this.renderedEquipment !== actor.weapon.id) {this.pendingInspect = actor.weapon.id; return;}
    if(this.viewAnimation?.playInspect())this.audio.playAction(0,this.sim.actors[0].weapon.id,'inspect',this.sim.time,{local:true,volume:this.settings.volume*.5});
  }}
  secondary() {if (this.sim.selectedUtility) this.throwUtility(true); else this.sim.command(0, {secondaryPressed: true});}

  private processEvents(events: DuelEvent[]) {
    if (!events.length) return;
    const shots = new Map<number, Extract<DuelEvent, {kind: 'fire'}>>();
    const endpoints = new Map<number, Vec[]>();
    const endpoint=(shotId:number,point:Vec)=>{
      const points=endpoints.get(shotId)??[];points.push(point);endpoints.set(shotId,points);
    };
    const player = this.sim.snapshot()[0];
    for (const event of events) {
      if (event.kind === 'utility') {
        if (event.action === 'throw' && event.actorId === 0) this.utilityRenderer.throw(event.utility, event.tick * STEP, event.strength,event.throwStartedAt);
        if (event.action === 'throw'&&event.throwStartedAt!==undefined)
          this.startUtilitySound(event.actorId,event.utility,utilityThrowAction(event.strength??1),event.throwStartedAt);
        if (event.action === 'throw' && event.actorId > 0) this.animators.get(event.actorId)?.playAction(
          event.utility === 'molotov' ? 'utility-molotov' : 'utility', utilityThrowAction(event.strength ?? 1),
          {crouched: (this.sim.actors[event.actorId].duckAmount ?? 0) > .5, startedAt: event.tick * STEP});
        if (event.action === 'throw' && event.actorId > 0) this.utilityThrownAt.set(event.actorId, event.tick * STEP);
        if (event.action === 'decoy' && event.equipment) this.audio.play(event.equipment,
          this.settings.volume * .65, this.soundLocation(event.point));
        else if (event.sound || event.action === 'throw'&&event.throwStartedAt===undefined) this.audio.playUtility(event.utility, event.action,
          this.settings.volume * .65, this.soundLocation(event.point), event.sound);
        continue;
      }
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
      }else if (event.kind === 'pickup' || event.kind === 'utility-pickup') {
        const model = this.dropModels.get(event.dropId);
        if (model) this.scene.remove(model);
        this.dropModels.delete(event.dropId);
      } else if (event.kind === 'fire') {
        shots.set(event.shotId, event);
        this.animators.get(event.actorId)?.playAction(event.equipment,event.alternate?'fire-alt':'fire',
          {side:this.sim.actors[event.actorId].weapon.ammo%2?'right':'left',lastShot:this.sim.actors[event.actorId].weapon.ammo===0});
        if (event.actorId === 0) {
          if (event.accuracy) this.lastShot = {weapon: event.equipment, state: event.accuracy};
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
          const native = this.sim.arena.native?.floorSurfaceAt?.(point.x, point.z, point.y + .2, .5);
          const material = native ? surfaceFootstepMaterial(native.surface)
            : support?.material === 'wood' || support?.kind === 'crate' ? 'wood'
              : support?.material === 'metal' || support?.material === 'grate' || support?.kind === 'cargo' ? 'metal' : 'concrete';
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
        if(!event.utility)endpoint(event.shotId,event.point);
        // Local hit points lie inside the first-person camera's body envelope.
        // Damage arcs provide feedback without near-camera impact spheres.
        if (event.victim !== 0 && !event.utility) {
          const source=shots.get(event.shotId)?.origin??this.sim.actors[event.shooter]?.position;
          const direction=event.direction??(source?{x:event.point.x-source.x,y:event.point.y-source.y,z:event.point.z-source.z}:undefined);
          if(direction)this.characterHits.emit({point:event.point,direction,headshot:event.group==='head',helmet:!!event.helmet,lethal:event.lethal});
        }
        if(event.lethal)this.killFeed.push({shooter:event.shooter,victim:event.victim,shotId:event.shotId,
          equipment:shots.get(event.shotId)?.equipment??this.sim.actors[event.shooter].weapon.id,utility:event.utility,headshot:!event.utility&&event.group==='head'},this.animationClock);
        if(event.lethal)this.animationTimes.delete(event.victim);
        if (event.lethal && !this.deaths.has(event.victim)) this.deaths.set(event.victim, this.animationClock);
        if (event.lethal && event.victim > 0) {
          if(this.sim.arena.native?.sweepSphere)this.animators.get(event.victim)?.setDeathWorld({floor:-1000,boxes:[],
            sweepSphere:this.sim.arena.native.sweepSphere.bind(this.sim.arena.native),
            corpseGeometry:this.sim.arena.native.corpseGeometry?.bind(this.sim.arena.native)});
          const held = this.heldWeapons.get(event.victim);
          if (held) held.visible = false;
        }
        if (event.shooter === 0 && event.victim !== 0) {
          this.xpDamage.set(event.victim, (this.xpDamage.get(event.victim) ?? 0) + event.healthDamage);
          if(!event.utility)this.audio.playHit(event.group === 'head', event.group==='head'?!!event.helmet:!!event.armored,
            false,this.settings.volume,undefined,event.lethal);
          this.damage += event.healthDamage;
          if (event.lethal) this.kills++;
          this.caption = event.utility ? `${utilityNames[event.utility]} HIT` : event.group === 'head' ? 'HEADSHOT' : 'BODY HIT';
          this.captionUntil = this.animationClock + .65;
        } else if (event.victim === 0) {
          const source = this.sim.actors[event.shooter]?.position;
          if (source) this.damageFeedback.hit(player.position, source, event.healthDamage, this.animationClock);
          if(!event.utility)this.audio.playHit(event.group === 'head', event.group==='head'?!!event.helmet:!!event.armored,
            true,this.settings.volume,undefined,event.lethal);
          this.caption = `HIT -${Math.round(event.healthDamage)}`;
          this.captionUntil = this.animationClock + .65;
        }
        if(!event.utility&&event.shooter!==0&&event.victim!==0)this.audio.playHit(event.group==='head',event.group==='head'?!!event.helmet:!!event.armored,
          false,this.settings.volume,this.soundLocation(event.point),event.lethal,'onlooker');
      } else if (event.kind === 'round') {
        this.roundFlow.finish();
        if (this.xpAttempt) this.progression?.completeDuel(this.xpAttempt, {
          completion: 'completed', outcome: event.outcome, activeSeconds:this.sim.time, review: this.sim.coach.review(),
          opponents: this.sim.actors.slice(1).map(actor => ({id: String(actor.id), healthDamage: this.xpDamage.get(actor.id) ?? 0, killed: !actor.alive})),
        }, this.xpSetup(), String(this.xpRevision));
        this.xpAttempt = null;
        if (!this.scenario || this.scenario.kind === 'duel-map') {
          const date = new Date().toISOString(), review = this.sim.coach.review();
          this.completedRound = {id: `${this.reviewIdentity}:${date}`, setupKey: setupKey([this.config, this.sim.loadout]), review};
          this.history.unshift({date, outcome: event.outcome, review, setupKey: this.completedRound.setupKey});
          this.history = this.history.slice(0, 50);
          try {localStorage.setItem('spraylab.duel.history.v1', JSON.stringify(this.history));} catch { /* Session-only history. */ }
        }
        if(event.outcome==='won')this.sim.enablePostWinPlay();
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
    for(const action of this.utilitySounds.values())action.timeline.cancel();this.utilitySounds.clear();this.audio.cancelUtilityCues();
    this.utilityEffectSounds.clear(); this.audio.setFlashExposure(0);
    this.shotEffects.clear(); this.viewFlashes.clear(); this.shotCounts.clear();
    this.characterHits.clear();this.killFeed.clear();
    this.utilityRenderer.clear(); this.utilityFlash.style.opacity = '0';
    this.utilitySmoke.style.opacity = '0';
  }

  private syncDrops() {
    this.utilityRenderer.syncDrops(this.sim.utilityDrops);
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

  private startUtilitySound(actorId:number,kind:UtilityKind,action:UtilityViewAction,started:number) {
    const key=`${kind}:${action}:${started}`;
    if(this.utilitySounds.get(actorId)?.key===key)return;
    this.audio.cancelUtilityCues(actorId);
    const timeline=new UtilitySoundTimeline();timeline.start(kind,action,started);
    this.utilitySounds.set(actorId,{key,kind,action,started,timeline});
    if(this.settings.volume>0)void this.audio.preloadUtilityCues(nativeUtilityPresentation.utilities[kind].actions[action].events.flatMap(cue=>cue.name?[cue.name]:[])).catch(()=>{});
  }
  private updateUtilitySounds() {
    if(this.paused||this.replayView||this.sim.phase==='ready')return;
    const seen = new Set<number>();
    for (const effect of this.sim.utilities.effects) {
      if ((effect.type !== 'fire' && effect.type !== 'smoke') || this.sim.time < effect.startedAt || this.sim.time >= effect.expiresAt) continue;
      seen.add(effect.id);
      const owner = `effect:${effect.id}`, previous = this.utilityEffectSounds.get(effect.id);
      if (this.settings.volume > 0 && effect.type === 'fire') {
        if (!previous) this.audio.playUtilityCue('utility-fire-ignite', this.settings.volume * .65, this.soundLocation(effect.position), undefined, undefined, {loop: false});
        this.audio.playUtilityCue('utility-fire-loop', this.settings.volume * .65, this.soundLocation(effect.position), owner,
          Math.max(.01, effect.expiresAt - this.sim.time));
      } else this.audio.stopUtilityLoops(owner);
      this.utilityEffectSounds.set(effect.id, {type: effect.type, position: effect.position, expiresAt: effect.expiresAt});
    }
    for (const [id, effect] of this.utilityEffectSounds) if (!seen.has(id)) {
      this.audio.stopUtilityLoops(`effect:${id}`);
      if (this.settings.volume > 0 && this.sim.time >= effect.expiresAt - .05)
        this.audio.playUtilityCue(effect.type === 'fire' ? 'utility-fire-end' : 'utility-smoke-clear', this.settings.volume * .65,
          this.soundLocation(effect.position), undefined, undefined, {loop: false});
      this.utilityEffectSounds.delete(id);
    }
    for(const actor of this.sim.actors) {
      const state=this.sim.utilityPresentation(actor.id),previous=this.utilitySounds.get(actor.id);
      if(!actor.alive){previous?.timeline.cancel();this.utilitySounds.delete(actor.id);this.audio.cancelUtilityCues(actor.id);continue;}
      if(state) {
        if(state.throwStartedAt!==undefined&&this.sim.time>=state.throwStartedAt)
          this.startUtilitySound(actor.id,state.kind,utilityThrowAction(state.strength??1),state.throwStartedAt);
        else if(state.primedAt!==undefined&&this.sim.time>=state.primedAt)
          this.startUtilitySound(actor.id,state.kind,'pullpin',state.primedAt);
        else if(this.sim.time<state.selectedAt+utilityNativeTiming(state.kind).draw)
          this.startUtilitySound(actor.id,state.kind,'draw',state.selectedAt);
        else if(previous?.action!=='inspect'||this.sim.time>=previous.started+nativeUtilityPresentation.utilities[state.kind].actions.inspect.seconds)
          this.startUtilitySound(actor.id,state.kind,'idle',previous?.action==='idle'?previous.started:this.sim.time);
      } else if(previous&&!previous.action.startsWith('throw')) {
        previous.timeline.cancel();this.utilitySounds.delete(actor.id);this.audio.cancelUtilityCues(actor.id);
      }
      const sound=this.utilitySounds.get(actor.id);if(!sound)continue;
      for(const cue of sound.timeline.advance(this.sim.time))if(this.sim.time-cue.at<.15)
        this.audio.playUtilityCue(cue.name,this.settings.volume*.55,actor.id===0?undefined:this.soundLocation(actor.position),actor.id,
          cue.endAt===undefined?undefined:Math.max(.001,cue.endAt-this.sim.time));
    }
  }

  private syncActors(snapshots: DuelActorSnapshot[], dt: number) {
    this.animationClock += dt;
    this.frustum.setFromProjectionMatrix(this.projectionView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    for (const actor of snapshots.slice(1)) {
      const model = this.models.get(actor.id);
      if (!model) continue;
      if (this.actorEquipment.get(actor.id) !== actor.equipment) {
        const cache = this.actorWeaponCache.get(actor.id) ?? new Map<Equipment, THREE.Object3D>();
        let replacement = cache.get(actor.equipment);
        if (!replacement && this.worldWeapons.has(actor.equipment)) {
          replacement = this.attachWorldWeapon(model, actor.equipment);
          if (replacement) cache.set(actor.equipment, replacement);
        }
        if (replacement) {
          const previous = this.heldWeapons.get(actor.id); if (previous) previous.visible = false;
          this.actorWeaponCache.set(actor.id, cache); this.actorEquipment.set(actor.id, actor.equipment);
          this.heldWeapons.set(actor.id, replacement);
          const muzzle = muzzleAnchor(replacement);
          if (muzzle) this.botMuzzles.set(actor.id, muzzle); else this.botMuzzles.delete(actor.id);
          this.animators.get(actor.id)?.addGestureClips(this.gestureClips.get(actor.equipment) ?? []);
        }
      }
      const held = this.heldWeapons.get(actor.id), grenade = this.heldGrenades.get(actor.id);
      if (held) held.visible = actor.alive && !actor.utility && this.sim.time - (this.utilityThrownAt.get(actor.id) ?? -Infinity) >= .4;
      if (grenade) this.utilityRenderer.updateWorldHeld(grenade, actor.utility, actor.alive);
      const utility = this.sim.utilityPresentation(actor.id), previousUtility = this.utilityActorActions.get(actor.id);
      if (utility) {
        const family = utility.kind === 'molotov' ? 'utility-molotov' : 'utility';
        if (utility.primedAt !== undefined && this.sim.time>=utility.primedAt && utility.primedAt !== previousUtility?.primedAt)
          this.animators.get(actor.id)?.playAction(family, 'pullpin', {crouched: actor.duckAmount > .5, startedAt: utility.primedAt});
        else if (utility.selectedAt !== previousUtility?.selectedAt)
          this.animators.get(actor.id)?.playAction(family, 'draw', {crouched: actor.duckAmount > .5, startedAt: utility.selectedAt,
            duration: Math.max(.01, utility.readyAt - utility.selectedAt)});
        this.utilityActorActions.set(actor.id, {selectedAt: utility.selectedAt, primedAt:utility.primedAt!==undefined&&this.sim.time>=utility.primedAt?utility.primedAt:undefined});
      } else this.utilityActorActions.delete(actor.id);
      this.actorBounds.center.set(actor.position.x, actor.feet + 1, actor.position.z);
      if (!actor.alive) this.animators.get(actor.id)?.corpseCenter(this.actorBounds.center);
      model.visible = !this.spawnAuthoring && this.frustum.intersectsSphere(this.actorBounds) &&
        (!actor.alive || !this.covers.visible || !fullyOccluded(this.camera.position, actor, this.sim.arena));
      if (!actor.alive && !this.deaths.has(actor.id)) {
        this.deaths.set(actor.id, this.animationClock); this.animationTimes.delete(actor.id);
        if (this.sim.arena.native) {
          const native=this.sim.arena.native;
          this.animators.get(actor.id)?.setDeathWorld({floor:-1000,boxes:[],sweepSphere:native.sweepSphere?.bind(native),
            corpseGeometry:this.sim.arena.native.corpseGeometry?.bind(native)});
        }
      }
      const deathAge = this.animationClock - (this.deaths.get(actor.id) ?? this.animationClock);
      model.position.set(actor.position.x, actor.alive ? actor.feet : deathFeet(actor, deathAge, this.sim.arena.solids,
        this.sim.actors[actor.id].verticalVelocity, this.sim.arena.native), actor.position.z);
      const presentationTime = this.sim.playable && !this.paused ? Math.max(0, this.sim.time - STEP + this.sim.accumulator) : this.sim.time;
      const bodyYaw = this.sim.actorBodyYaw(actor, presentationTime);
      model.rotation.y = bodyYaw - Math.PI;
      if (model.visible || !actor.alive) {
        const elapsed = this.animationTimes.has(actor.id) ? this.animationClock - this.animationTimes.get(actor.id)! : dt;
        // A sensor/shot query may have rewound this shared rig since its last render.
        if (dt > 0 && !this.sampledPoses.has(actor.id) && this.animationTimes.has(actor.id) && elapsed < 1 / this.metrics.animationRate(this.settings.quality)) continue;
        const weapon=this.sim.actors[actor.id].weapon;
        const poseTime = presentationTime;
        const poseElapsed = actor.alive ? 0 : dt > 0 ? elapsed : 0;
        this.animators.get(actor.id)?.update(this.sim.phase === 'result' && actor.alive
          ? {...actor, velocity: {x: 0, z: 0}} : actor, poseElapsed, actor.alive ? undefined : deathAge,
          {reloadRemaining:Math.max(0,weapon.reloadUntil-this.sim.time),reloadDuration:weapon.reload.phaseDuration||equipmentStats(actor.equipment).reload,
            reloadPhase:weapon.reloadPhase,reloadProgress:weapon.reload.progress,
            deathVelocity:{...actor.velocity,y:actor.verticalVelocity??0}, bodyYaw, poseTime});
        this.animationTimes.set(actor.id, this.animationClock);
        this.sampledPoses.delete(actor.id);
        if (actor.alive) this.poseTimes.set(actor.id, poseTime);
      }
    }
  }

  private clearPlayerCorpse() {
    if (!this.playerCorpse) return;
    this.playerCorpse.animator.dispose(); disposeSkeletons(this.playerCorpse.root);
    this.playerCorpse.root.removeFromParent(); this.playerCorpse = undefined;
  }

  private updatePlayerDeath(player: DuelActorSnapshot, age: number) {
    if (player.alive) {this.clearPlayerCorpse(); return;}
    if (!this.targetScene) return;
    if (!this.playerCorpse) {
      const root = new THREE.Group(), model = cloneSkeleton(this.targetScene);
      model.traverse(node => {if (node.name.startsWith('held_weapon_target')) node.visible = false;});
      root.add(model); root.position.set(player.position.x, player.feet, player.position.z);
      root.rotation.y = player.yaw - Math.PI;
      const animator = new DuelAnimator(model, this.targetClips, 0, player.equipment);
      animator.update({...player, alive: true}, 0, undefined, {bodyYaw: player.yaw, poseTime: this.sim.time});
      const native = this.sim.arena.native;
      animator.setDeathWorld(native ? {floor: -1000, boxes: [], sweepSphere: native.sweepSphere?.bind(native),
        corpseGeometry: native.corpseGeometry?.bind(native)} : {floor: 0, boxes: this.sim.arena.solids.filter(blocksMovement)});
      let nextBodySound = 0;
      animator.onDeathContact = contact => {
        if (this.animationClock >= nextBodySound && ['pelvis', 'spine_2'].includes(contact.body)) {
          nextBodySound = this.animationClock + .6;
          this.audio.playBodyContact(contact.speed, this.settings.volume * .7);
        }
      };
      this.actors.add(root);
      this.playerCorpse = {root, animator, origin: new THREE.Vector3(player.position.x, player.position.y, player.position.z), rotation: this.camera.quaternion.clone(), orbitYaw: player.yaw};
    }
    const corpse = this.playerCorpse;
    corpse.animator.update(player, 0, age, {deathVelocity: {x: player.velocity.x, y: player.verticalVelocity ?? 0, z: player.velocity.z}});
    corpse.root.visible = age > .10;
    if (!corpse.animator.corpseCenter(this.deathFocus)) return;
    this.deathFocus.y += .2;
    const native = this.sim.arena.native;
    const clip = (from: Vec, to: Vec) => {
      const delta = new THREE.Vector3().copy(to).sub(from), arena = this.sim.arena;
      let fraction = 1;
      for (const [axis, min, max] of [['x', arena.minX + .25, arena.maxX - .25], ['z', arena.minZ + .25, arena.maxZ - .25]] as const) {
        if (to[axis] < min && delta[axis] < 0) fraction = Math.min(fraction, (min - from[axis]) / delta[axis]);
        if (to[axis] > max && delta[axis] > 0) fraction = Math.min(fraction, (max - from[axis]) / delta[axis]);
      }
      const bounded = new THREE.Vector3().copy(from).addScaledVector(delta, Math.max(0, fraction));
      if (native?.sweepSphere) return native.sweepSphere(from, bounded, .16).position;
      const direction = bounded.clone().sub(from), length = direction.length();
      const hit = traceSolid(from, direction.normalize(), this.sim.arena, length);
      return hit.distance < length ? new THREE.Vector3().copy(from).addScaledVector(direction, Math.max(0, hit.distance - .2)) : bounded;
    };
    deathCameraGoal(this.deathFocus, corpse.orbitYaw, clip, this.deathCamera);
    if (Math.hypot(this.deathCamera.x - this.deathFocus.x, this.deathCamera.z - this.deathFocus.z) > .1)
      corpse.orbitYaw = Math.atan2(this.deathCamera.x - this.deathFocus.x, this.deathCamera.z - this.deathFocus.z);
    const phase = THREE.MathUtils.clamp(age / .65, 0, 1), blend = phase * phase * (3 - 2 * phase);
    this.camera.position.lerpVectors(corpse.origin, this.deathCamera, blend);
    this.camera.position.copy(clip(this.deathFocus, this.camera.position));
    this.deathLookMatrix.lookAt(this.deathCamera, this.deathFocus, this.camera.up);
    this.deathRotation.setFromRotationMatrix(this.deathLookMatrix);
    this.camera.quaternion.copy(corpse.rotation).slerp(this.deathRotation, blend);
    if (player.deathDirection) {
      const side = player.deathDirection.x * Math.cos(player.yaw) - player.deathDirection.z * Math.sin(player.yaw);
      this.camera.rotateZ(THREE.MathUtils.clamp(side, -1, 1) * .12 * blend);
    }
  }

  private resize() {
    const {width, height} = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width; this.height = height;
    this.renderer.setPixelRatio(renderPixelRatio(width, height, devicePixelRatio || 1, this.settings.quality, this.metrics.adaptive));
    // Preserve CSS's fractional layout size so the reticle and canvas share a center.
    this.renderer.setSize(width, height, false);
    this.camera.aspect = this.settings.aspect === 'native' ? width / height
      : this.settings.aspect.split(':').map(Number).reduce((a, b) => a / b);
    this.sim.playerAspect = this.camera.aspect;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = viewmodelViewport(width, height).aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  private report() {
    if (this.disposed) return;
    const [player, ...bots] = this.sim.renderSnapshot();
    const pickup=this.sim.nearestItemPickup();
    this.onStatus({phase: this.sim.phase, paused: this.paused, outcome: this.sim.phase==='result'?this.sim.outcome:undefined,
      health: player.health, armor: player.armor, ammo: player.ammo, reloading: player.reloading,
      reserve:player.reserve,reloadSilent:player.reloadSilent,recharge:Math.max(0,this.sim.actors[0].weapon.rechargeUntil-this.sim.time),
      enemies: bots.filter(bot => bot.alive).length, seconds: this.sim.completedAt??this.sim.time, kills: this.kills,
      damage: this.damage, input: this.inputName, caption: this.animationClock < this.captionUntil ? this.caption : '',
      shortcutProtected: this.shortcuts.protected, nextRoundIn: this.roundFlow.remaining(this.scenario?.feedbackSeconds?.() ?? this.config.feedbackSeconds),
      equipped: player.equipment, review: this.sim.coach.review(), history: this.history,
      loadout: this.sim.loadout, pickup:pickup&&'equipment' in pickup?pickup.equipment:undefined,
      pickupUtility:pickup&&'utility' in pickup?pickup.utility:undefined,
      interaction:this.sim.nearestDoor()?.open?'Close door':this.sim.nearestDoor()?'Open door':undefined,
      arenaDesign: this.sim.arena.design, loadingMap:this.loadingMap||!this.criticalReady, prefire: this.scenario?.report?.(this.sim), lastShot: this.lastShot,
      preparingNextRound:!!this.nextRoundAbort||this.seamlessHandoff,nextRoundError:this.nextRoundError,postWinPlayable:this.sim.postWinPlayable,
      replayShots: this.sim.replay.shotCount || this.previousRecording?.shots.length || 0,
      replayAvailable: this.sim.replay.frameCount > 1 || !!this.previousRecording?.frames.length, completedRound: this.completedRound,
      killFeed:this.killFeed.entries(this.animationClock),selectedUtility:this.sim.selectedUtility,utilityInventory:this.sim.utilityInventory()});
  }

  private tick(timestamp: number) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(time => this.tick(time));
    const active = this.sim.phase !== 'ready' && !this.paused;
    if(this.criticalReady&&!this.loadingMap&&!this.replayView&&!this.nextRoundError&&(this.prefetchedSeed!==this.seed||timestamp-this.prefetchAt>5000)) {
      this.prefetchedSeed=this.seed;this.prefetchAt=timestamp;this.scenario?.prefetchRound?.(this.seed,
        (scene,signal)=>prepareSceneGpu(this.renderer,scene,this.scene,this.camera,signal,this.settings.quality));
    }
    this.metrics.setVisible(!document.hidden);
    // The retained framebuffer stays visible while the next actors and shaders
    // are prepared. Do not render a partial lineup or advance a half-ready round.
    if(this.loadingMap){this.last=0;return;}
    if (document.hidden || !this.pacer.ready(timestamp, this.replayView ? 60 : active ? this.settings.frameLimit : 15)) {
      if (document.hidden) this.last = timestamp;
      return;
    }
    const cpuStart = performance.now();
    const frameDt = this.last ? (timestamp - this.last) / 1000 : 0;
    const dt = Math.min(frameDt, .25);
    this.last = timestamp;
    if (this.replayView) {
      const replay = this.replayView;
      this.replayScene.show(replay.recording, replay.shot, replay.time, replay.diagnostic);
      this.replayScene.camera(this.camera, replay.shot, replay.overview, replay.diagnostic);
      this.renderer.setViewport(0, 0, this.width, this.height); this.renderer.autoClear = true;
      this.scenario?.updateView?.(this.camera.position);
      this.mapLighting?.beginFrame(this.renderer, this.camera.position);
      this.replayScene.utilityRenderer.renderWorld(this.renderer, this.scene, this.camera);
      this.replayScene.renderUtilityView(this.renderer,this.width,this.height);
      return;
    }
    if (this.sessionStarted && this.roundFlow.advance(dt, this.paused, this.scenario?.feedbackSeconds?.() ?? this.config.feedbackSeconds)) this.restart(true);
    this.sim.advance(dt);
    this.syncEnvironment();this.syncDrops();
    const snapshots = this.sim.renderSnapshot();
    const events=this.sim.drainEvents();
    const player = snapshots[0];
    this.audio.setFlashExposure(this.sim.flashAmount(0));
    const viewWeapon=this.sim.actors[0].weapon;
    if (this.presentingUtility && !this.sim.selectedUtility) this.renderedEquipment = undefined;
    this.presentingUtility = this.sim.selectedUtility;
    if(timestamp-this.shadowAt>=50){this.shadowAt=timestamp;this.actorShadows.update(actorShadows(snapshots,this.sim.arena));}
    if(timestamp-this.radarAt>=100) {this.radarAt=timestamp;this.radar.update(player,this.sim.radar.snapshot(this.sim.time),
      this.sim.time,this.sim.arena,this.config,this.scenario?.radarOverview?.(player.feet)??this.scenario?.scene);}
    if (player.equipment !== this.renderedEquipment) {
      void this.loadViewModel(player.equipment);
      void this.audio.unlock(player.equipment).then(() => {
        if (!this.disposed && !this.sim.selectedUtility && this.sim.actors[0].weapon.id === player.equipment && !this.paused && this.viewAnimation?.activeAction !== 'inspect' && this.pendingInspect !== player.equipment)
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
    // Pause/result snapshots are authoritative, not sub-tick predictions.
    const aimRemainder = this.paused || !this.sim.playable ? 0 : this.sim.accumulator;
    const visualRecoil = viewWeapon.recovery.predict(aimRemainder);
    const punch = this.sim.actors[0].punch.predict(aimRemainder,
      viewWeapon.recovery.angle);
    const view = recoilView(player.yaw - punch.yaw * DEG, player.pitch + punch.pitch * DEG, visualRecoil);
    const deathAge = this.animationClock - (this.deaths.get(0) ?? this.animationClock);
    const death = deathView(deathAge, player.position.y - player.feet,player.deathDirection?
      {direction:player.deathDirection,yaw:player.yaw,headshot:player.deathGroup==='head'}:undefined);
    this.camera.position.set(player.position.x, player.position.y, player.position.z);
    // Keep the world camera at the actor eye. A cosmetic stair lag must not
    // move the crosshair's origin away from the origin used by shot physics.
    const stairLag = this.sim.arena.native ? this.stepView.update(player, active ? dt : 0) - player.position.y : 0;
    if (!player.alive) this.camera.position.y = deathFeet(player, deathAge, this.sim.arena.solids,
      this.sim.actors[0].verticalVelocity, this.sim.arena.native) + death.height;
    this.camera.rotation.set(view.pitch + (player.alive ? 0 : death.pitch), view.yaw, punch.roll * DEG + (player.alive ? 0 : death.roll), 'YXZ');
    this.updatePlayerDeath(player, deathAge);
    const selectedUtility = this.sim.selectedUtility;
    const scoped = this.scope.update(viewWeapon.actions, this.camera, player.alive && !selectedUtility);
    this.camera.updateMatrixWorld();
    this.syncActors(snapshots, this.sim.phase !== 'ready' && !this.paused ? dt : 0);
    this.kick = Math.max(0, this.kick - dt * 8);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.viewRoot.position.set(VIEWMODEL_OFFSET.x,
      VIEWMODEL_OFFSET.y + stairLag * .06 + Math.sin(this.sim.time * 12) * Math.min(speed, 1) * .002 - (player.alive ? 0 : death.weaponDrop * .5), this.kick * .018);
    this.utilityRenderer.updateHeld(selectedUtility, player.alive, this.sim.time, speed, this.sim.utilityPresentation());
    this.viewRoot.visible = !selectedUtility && !this.utilityRenderer.held.visible && !scoped && (player.alive || deathAge < .08);
    const flinch=player.alive&&player.recentHits?.some(hit=>this.sim.time-hit.time<.25)?sampleHitReaction(player.recentHits,this.sim.time):undefined;
    this.viewRoot.rotation.x = this.kick * (player.equipment === 'knife' ? 0 : .035) + view.weaponPitch+(flinch?.spine.rotation.x??0)*.35;
    this.viewRoot.rotation.y = view.weaponYaw;
    this.viewRoot.rotation.z = (flinch?.spine.rotation.z??0)*.4;
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
    this.updateUtilitySounds();
    this.audio.updateActions(this.sim.time);
    this.damageFeedback.update(this.animationClock, player.yaw);
    // Camera and followed aim must use the same presentation time. Reading the
    // last fixed-tick recoil here makes the reticle lag between simulation ticks.
    const recoil = this.settings.follow ? visualRecoil : {yaw: 0, pitch: 0};
    const yaw = player.yaw - (recoil.yaw + punch.yaw) * DEG, pitch = player.pitch + (recoil.pitch + punch.pitch) * DEG;
    const followPoint = this.followPoint.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(10).add(this.camera.position).project(this.camera);
    if (!this.settings.follow) followPoint.set(0, 0, 0);
    this.crosshair.style.visibility = player.alive && !scoped && (selectedUtility||player.equipment==='knife'||gameData.weapons[player.equipment].showCrosshair) ? '' : 'hidden';
    this.crosshair.style.transform = `translate(${followPoint.x * this.width / 2}px, ${-followPoint.y * this.height / 2}px)`;
    this.crosshair.style.setProperty('--motion-gap', this.settings.crosshair.dynamic ? `${speed * 1.2 + this.kick * 4}px` : '0px');
    this.shotEffects.update(this.animationClock); this.viewFlashes.update(this.animationClock);
    this.characterHits.update(this.paused?0:dt);
    this.utilityRenderer.smoke.setQuality(this.settings.quality);
    this.utilityRenderer.update(this.sim.utilities.projectiles, this.sim.utilities.effects, this.sim.time, this.camera);
    this.utilityFlash.style.opacity = String(utilityFlashOpacity(player.alive ? this.sim.flashAmount(0) : 0));
    this.utilitySmoke.style.opacity = String(player.alive ? this.utilityRenderer.interiorSmokeOpacity : 0);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.scenario?.updateView?.(this.camera.position);
    this.mapLighting?.beginFrame(this.renderer, this.camera.position);
    this.renderer.autoClear = true; this.utilityRenderer.renderWorld(this.renderer, this.scene, this.camera);
    this.renderer.autoClear = false; this.renderer.clearDepth();
    const viewport = viewmodelViewport(this.width, this.height);
    this.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.renderer.render(this.viewScene, this.viewCamera);
    const oldResolution = this.metrics.adaptive;
    if (this.metrics.sample(frameDt, performance.now() - cpuStart, this.settings.quality === 'auto', active, this.settings.frameLimit)) {
      this.meter.update(this.metrics, this.renderer.getPixelRatio());
      if (oldResolution !== this.metrics.adaptive) this.resize();
    }
    if (events.some(event => event.kind === 'hit' || event.kind === 'round' || event.kind === 'utility') || timestamp - this.statusAt > 100) {
      this.statusAt = timestamp; this.report();
    }
  }

  dispose() {
    this.clearPlayerCorpse();
    this.mapAbort?.abort();
    this.nextRoundAbort?.abort();
    if (this.xpAttempt) this.progression?.cancelAttempt(this.xpAttempt);
    this.disposed = true; cancelAnimationFrame(this.frame); this.pause(); this.releaseShortcuts(); this.observer.disconnect();
    this.cleanup.forEach(fn => fn()); this.clearEffects(); this.audio.dispose(); this.damageFeedback.dispose();
    this.animators.forEach(animator => animator.dispose()); this.clearViewModels(); this.scope.dispose();
    this.gestureClips.clear();
    this.meter.dispose();
    this.replayScene.dispose();
    for (const source of this.replayAssets.values()) disposeResources([source]); this.replayAssets.clear();
    this.radar.dispose();
    this.actorShadows.dispose();
    this.mapLighting?.dispose();
    this.scenario?.scene.removeFromParent();
    this.shotEffects.dispose(); this.viewFlashes.dispose();
    this.characterHits.dispose();
    this.utilityRenderer.dispose(); this.utilityFlash.remove(); this.utilitySmoke.remove();
    disposeResources([this.scene, this.viewScene, ...this.worldWeapons.values(), ...(this.targetScene && !this.agentInstance ? [this.targetScene] : [])]);
    this.agentRevision++;this.agentInstance?.dispose();this.actorLoader.dispose();
    disposeWarmRenderer(this.renderer); this.renderer.domElement.remove();
  }
}
