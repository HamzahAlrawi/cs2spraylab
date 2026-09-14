import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Settings, MeasuredProfile, Weapon, gameData } from './config';
import { DEG, direction, Simulation, Shot, Vec, VERTICAL_FOV, TARGET_Z } from './simulation';
import { RangeAudio } from './audio';
import { requestRawLock } from './input';
import { VIEWMODEL_FOV, VIEWMODEL_OFFSET, viewmodelViewport } from './viewmodel';
import { GUIDE_COLORS, SprayDemonstration } from './spray-demonstration';
import {type Equipment, type Slot} from './equipment';
import {DrillScenery} from './drill-scene';
import {HEAD_HEIGHT, type DrillMetrics} from './drills';

export type RangeStatus = {
  weapon: Weapon;
  active: boolean; firing: boolean; shots: number; hits: number; heads: number; remaining: number;
  reload: number; speed: number; distance: number;
  input: string; audio: string; assets: string; fps: number;
  equipped: Equipment; slot: Slot; equipReady: boolean; magazine: number;
  drill?: {round:number; completed:number; passed:number; scenario:string; covered:boolean; side:number; phase:'prepare'|'exposed'|'feedback'|'reposition'; accurate:boolean; error:number; last?:DrillMetrics};
};
const vector = (v: Vec) => new THREE.Vector3(v.x, v.y, v.z);
const material = (color: string, roughness = .8) => new THREE.MeshStandardMaterial({ color, roughness });
export class RangeEngine {
  sim: Simulation;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, .025, 250);
  viewScene = new THREE.Scene();
  viewCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, .01, 10);
  viewViewport = viewmodelViewport(1, 1);
  demonstration = new SprayDemonstration();
  mouseDemonstration = new SprayDemonstration('mouse');
  drillScenery = new DrillScenery(); drillRevision = -1;
  weaponRoot = new THREE.Group();
  targets = [new THREE.Group(), new THREE.Group()];
  targetModels: THREE.Object3D[] = [];
  mixers: THREE.AnimationMixer[] = [];
  targetActions: THREE.AnimationAction[][] = [];
  animationState = -1;
  solids: THREE.Object3D[] = [];
  impacts = new THREE.Group();
  ray = new THREE.Raycaster();
  audio = new RangeAudio();
  observer: ResizeObserver;
  disposed = false; frame = 0; previous = 0; elapsed = 0; statusTime = 0;
  inputStatus = 'Ready'; assetStatus = 'Loading models'; loadedTarget = false;
  crosshair: HTMLElement; hitmarker: HTMLElement;
  cues = [document.createElement('div'), document.createElement('div')];
  hitCaption = document.createElement('div');
  cleanup: (() => void)[] = [];
  clearInput?: () => void;
  modelCache = new Map<Equipment, THREE.Object3D>();
  loading = new Map<Equipment, Promise<THREE.Object3D>>();
  revision = 0; kick = 0; hitTime = 0;
  markerGeometry = new THREE.SphereGeometry(.018, 6, 4);
  missMaterial = new THREE.MeshBasicMaterial({ color: '#ff6259' });
  hitMaterial = new THREE.MeshBasicMaterial({ color: '#ffca50' });
  bodyMaterial = new THREE.MeshBasicMaterial({ color: '#51edee' });
  targetAsset?: THREE.Object3D;
  muzzle = new THREE.PointLight('#ffd781', 0, 1.6, 2);
  environment?: THREE.WebGLRenderTarget;
  constructor(public host: HTMLElement, public onStatus: (s: RangeStatus) => void, settings: Settings, crosshair: HTMLElement, hitmarker: HTMLElement, public onError: (s: string) => void) {
    this.crosshair = crosshair; this.hitmarker = hitmarker;
    this.cues.forEach((cue, i) => { cue.className = `aim-cue ${i ? 'next' : 'now'}`; cue.style.color = i ? GUIDE_COLORS.next : GUIDE_COLORS.now; cue.innerHTML = `<i></i><span>${i ? 'NEXT' : 'NOW'}</span>`; host.append(cue); });
    this.hitCaption.className = 'hit-caption'; host.append(this.hitCaption);
    this.sim = new Simulation(settings);
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality !== 'low', powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive practice range');
    this.renderer.domElement.setAttribute('tabindex', '0');
    this.renderer.domElement.dataset.range = 'true';
    host.prepend(this.renderer.domElement);
    this.buildScene();
    this.updateDemonstration();
    this.sim.onShot = s => this.shot(s);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.bindInput(); this.resize();
    void this.loadTarget(); void this.setWeapon(settings.weapon);
    this.frame = requestAnimationFrame(t => this.tick(t));
  }
  private box(size: number[], pos: number[], mat: THREE.Material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), mat);
    mesh.position.set(...pos as [number, number, number]); mesh.receiveShadow = true;
    this.scene.add(mesh); if (solid) this.solids.push(mesh); return mesh;
  }
  private label(text: string, width: number, height: number, color = '#eeeeda', background = '') {
    const c = document.createElement('canvas'); c.width = 1024; c.height = Math.max(64, Math.round(1024 * height / width));
    const ctx = c.getContext('2d')!;
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let font = Math.floor(c.height * .65); ctx.font = `bold ${font}px Arial`;
    while (ctx.measureText(text).width > c.width * .92) ctx.font = `bold ${--font}px Arial`;
    ctx.fillText(text, c.width / 2, c.height / 2);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 }));
  }
  buildScene() {
    this.scene.background = new THREE.Color('#c7d1d1');
    this.scene.fog = new THREE.Fog('#c7d1d1', 100, 230);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.viewScene.environment = this.environment.texture;
    this.scene.environmentIntensity = .3; this.viewScene.environmentIntensity = .32;
    room.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#f1f6fa', '#626850', 1.35));
    const sun = new THREE.DirectionalLight('#fff4df', 2.2); sun.position.set(-15, 24, TARGET_Z + 18);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -35; sun.shadow.normalBias = .025;
    sun.target.position.set(0, 0, TARGET_Z + 3); this.scene.add(sun, sun.target);
    this.viewScene.add(new THREE.HemisphereLight('#ffffff', '#696b64', .7));
    const key = new THREE.DirectionalLight('#fff4dd', 1.4); key.position.set(-2, 4, 2); this.viewScene.add(key);
    this.viewScene.add(this.weaponRoot);
    this.muzzle.position.set(.2, -.1, -.9); this.viewScene.add(this.muzzle);
    const surface = (name: string, repeatX: number, repeatY: number, color: string) => {
      const m = material(color);
      for (const [slot, suffix] of [['map', ''], ['normalMap', '-normal']] as const) {
        const texture = new THREE.TextureLoader().load(`/textures/${name}${suffix}.webp`, undefined, undefined, () => {});
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeatX, repeatY);
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        if (slot === 'map') texture.colorSpace = THREE.SRGBColorSpace;
        m[slot] = texture;
      }
      m.normalScale.set(.4, .4); return m;
    };
    const concrete = surface('wall', 31.5, 1.5, '#8d9993'); const dark = material('#444d4b'); const steel = material('#4e6766', .48);
    this.box([24, .2, 126], [0, -.1, -52], surface('floor', 12, 63, '#8a9389'));
    this.box([.5, 5, 126], [-12, 2.5, -52], concrete);
    this.box([.5, 5, 126], [12, 2.5, -52], concrete);
    this.box([24, 12, .5], [0, 6, -115], dark);
    this.box([24, 4, .5], [0, 2, 10], concrete);
    for (const x of [-11.7, 11.7]) {
      this.box([.03, 1.15, 124], [x, .58, -52], material('#3c7474'), false);
      this.box([.05, .045, 124], [x, 1.22, -52], material('#e3be65'), false);
    }
    for (const z of [5, 0, -5]) {
      this.box([24, .22, .3], [0, 4.9, z], steel, false);
      const roof = this.box([24, .08, 1], [0, 5.1, z + 1], material('#69756e'), false); roof.castShadow = true;
    }
    for (const x of [-9.5, 9.5]) {
      this.box([1.5, .9, 2.4], [x, .45, 3], material('#4b6461'), false);
      this.box([1.6, .12, 2.5], [x, .95, 3], material('#a6a795'), false);
    }
    for (let z = 5; z >= -110; z -= 5) {
      const stripe = this.box([23, .004, .025], [0, .008, z], material('#d0d4cd'), false);
      stripe.receiveShadow = false;
      for (const x of [-11.7, 11.7]) this.box([.12, 5, .18], [x, 2.5, z], steel, false);
      if (z > TARGET_Z && z < 0 && z % 10 === 0) {
        const number = this.label(`${z - TARGET_Z} M`, 2.3, .57, '#d5dfd9'); number.position.set(-11.72, 1.8, z); number.rotation.y = Math.PI / 2; this.scene.add(number);
      }
    }
    for (const x of [-6, 0, 6]) {
      this.box([.035, .008, 122], [x, .011, -52], material('#c6d0c4'), false);
      this.box([.12, .008, 2], [x - 2, .012, 1], material('#d0c46e'), false);
    }
    const sign = this.label('SPRAYLAB / RANGE 01', 9, .7, '#e1e8e2'); sign.position.set(0, 5.3, -102.77); this.scene.add(sign);
    void new GLTFLoader().loadAsync('/models/range-kit.glb').then(({ scene }) => {
      if (this.disposed) { this.disposeObject(scene); return; }
      scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(scene);
    }).catch(() => {});
    // Target backplates give useful impact feedback even at 100 m.
    this.box([16, 4.2, .25], [0, 2.1, TARGET_Z - 1.6], material('#536765'));
    this.scene.add(this.demonstration.mesh, this.mouseDemonstration.mesh);
    this.scene.add(this.drillScenery.group); this.solids.push(...this.drillScenery.solids);
    for (const x of [-8, 8]) this.box([.18, 4.5, .4], [x, 2.25, TARGET_Z - 1.6], steel);
    this.targets.forEach((target, i) => {
      const tag = this.label(i ? 'B' : 'A', .32, .16, '#ffffff'); tag.position.set(0, 2.05, 0); tag.name = 'lane-tag'; target.add(tag);
      const marker = new THREE.Mesh(new THREE.RingGeometry(.4, .44, 48), new THREE.MeshBasicMaterial({ color: GUIDE_COLORS.now, side: THREE.DoubleSide, transparent: true, opacity: .8 }));
      marker.name = 'active-lane'; marker.rotation.x = -Math.PI / 2; marker.position.y = .015; target.add(marker);
      this.scene.add(target);
    });
    this.scene.add(this.impacts);
    this.syncTargets();
  }
  syncTargets() {
    if (this.drillRevision !== this.sim.drillRevision) {
      this.drillRevision = this.sim.drillRevision; this.drillScenery.setScenario(this.sim.drill?.scenario); this.clearImpacts();
    }
    this.targets.forEach((target, i) => {
      target.visible = i === 0 || this.sim.settings.mode === 'transfer';
      target.position.copy(vector(this.sim.targetPosition(i)));
      target.updateMatrixWorld(true);
    });
  }
  async loadTarget() {
    try {
      const { scene, animations } = await new GLTFLoader().loadAsync('/models/target.glb');
      if (this.disposed) { this.disposeObject(scene); return; }
      this.targetAsset = scene;
      // Native GLB coordinates are already metres. A loading-pose bounding box
      // includes extended limbs and must not be used to resize the standing player.
      scene.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = true; o.receiveShadow = true; o.userData.skipScoring = /held_weapon|weapons[\\/]/i.test(o.name);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          // Source character shaders reuse the metalness input as a cloth mask.
          if (m instanceof THREE.MeshStandardMaterial && /ctm_sas|glove/.test(m.name) && !/lenses/.test(m.name)) {
            m.metalness = 0; m.roughness = .8;
            m.roughnessMap = null; m.metalnessMap = null;
          }
        }
      });
      this.targets.forEach(target => {
        const model = cloneSkeleton(scene); target.add(model); this.targetModels.push(model);
        const mixer = new THREE.AnimationMixer(model); this.mixers.push(mixer);
        this.targetActions.push(['idle_rifle', 'run_e_rifle', 'run_w_rifle'].flatMap(name => {
          const clip = animations.find(a => a.name.includes('/world/') && a.name.includes(name));
          return clip ? [mixer.clipAction(clip)] : [];
        }));
      });
      this.loadedTarget = true; this.updateAssetStatus();
    } catch { if (!this.disposed) { this.assetStatus = 'Target asset missing'; this.onError('The player model could not load. Restore the local game assets with npm run assets:build.'); } }
  }
  updateAssetStatus() {
    if (this.loadedTarget && this.modelCache.has(this.sim.equipped)) this.assetStatus = 'Models ready';
  }
  async equip(slot: Slot) {
    if (this.sim.active) this.renderer.domElement.focus({preventScroll:true});
    if (!this.sim.equip(slot)) return;
    this.updateDemonstration();
    void this.audio.unlock(this.sim.equipped);
    await this.setWeapon(this.sim.equipped);
  }
  async setWeapon(id: Equipment) {
    const revision = ++this.revision;
    this.assetStatus = 'Loading weapon';
    this.weaponRoot.clear();
    try {
      let model = this.modelCache.get(id);
      if (!model) {
        if (!this.loading.has(id)) {
          const pending = new GLTFLoader().loadAsync(`/models/view-${id}.glb`).then(({ scene: model }) => {
            if (this.disposed) { this.disposeObject(model); return model; }
            const wrapper = new THREE.Group();
            model.rotation.y = Math.PI;
            model.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.envMapIntensity = .3;
                // The imported roughness map already contains the native surface values.
                if (m.roughnessMap) m.roughness = 1;
                if (/sleeve|glove|bare_arm/.test(m.name)) { m.metalness = 0; m.roughness = .9; m.roughnessMap = null; m.metalnessMap = null; }
              }
            } });
            wrapper.add(model);
            this.modelCache.set(id, wrapper);
            return wrapper;
          }).finally(() => { this.loading.delete(id); });
          this.loading.set(id, pending);
        }
        model = await this.loading.get(id)!;
      }
      if (this.disposed) return;
      if (revision !== this.revision) { this.trimModelCache(); return; }
      this.modelCache.delete(id); this.modelCache.set(id, model);
      this.weaponRoot.add(model);
      this.weaponRoot.position.set(0, 0, 0);
      this.weaponRoot.rotation.set(0, 0, 0);
      this.trimModelCache();
      this.updateAssetStatus();
    } catch {
      if (!this.disposed && revision === this.revision) {
        this.assetStatus = 'Weapon asset missing';
        this.onError('The weapon model could not load. Check the local asset export.');
      }
    }
  }
  trimModelCache() {
    // Embedded glove textures are duplicated per GLB; keep only three GPU assemblies.
    for (const [id, model] of this.modelCache) {
      if (this.modelCache.size <= 3) break;
      if (id === this.sim.equipped) continue;
      this.modelCache.delete(id); this.disposeObject(model);
    }
  }
  configure(settings: Settings, measured?: MeasuredProfile) {
    const changedWeapon = settings.weapon !== this.sim.settings.weapon;
    const resetKeys: (keyof Settings)[] = ['weapon', 'mode', 'moving', 'targetSpeed', 'burst', 'peekScenario', 'drillPace'];
    if (!resetKeys.some(key => settings[key] !== this.sim.settings[key]) && measured === this.sim.measured) {
      const changedInversion = settings.invertY !== this.sim.settings.invertY;
      this.sim.settings = settings;
      if (changedInversion) this.updateDemonstration();
      this.demonstration.mesh.visible = settings.showImpactPattern && !this.sim.drill && this.sim.slot===1;
      this.mouseDemonstration.mesh.visible = settings.showMousePath && !this.sim.drill && this.sim.slot===1;
      this.renderer.shadowMap.enabled = settings.quality !== 'low'; this.resize(); return;
    }
    this.clearInput?.(); this.sim.configure(settings, measured);
    if (changedWeapon) this.sim.slot = 1;
    this.updateDemonstration();
    this.clearImpacts(); this.syncTargets(); this.resize();
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    if (changedWeapon) void this.setWeapon(settings.weapon);
  }
  updateDemonstration() {
    this.demonstration.mesh.visible = this.sim.settings.showImpactPattern && !this.sim.drill && this.sim.slot===1;
    this.mouseDemonstration.mesh.visible = this.sim.settings.showMousePath && !this.sim.drill && this.sim.slot===1;
    this.demonstration.setPattern(this.sim.settings.weapon, this.sim.pattern, gameData.weapons[this.sim.settings.weapon].cycle, this.elapsed);
    this.mouseDemonstration.setPattern(this.sim.settings.weapon, this.sim.pattern, gameData.weapons[this.sim.settings.weapon].cycle, this.elapsed, this.sim.settings.invertY);
  }
  clearImpacts() {
    this.impacts.clear();
    this.targets.forEach(t => t.children.filter(c => c.userData.impact).forEach(c => t.remove(c)));
  }
  castTargets(origin: Vec, dir: Vec) {
    this.syncTargets(); this.ray.set(vector(origin), vector(dir));
    const obstacle = this.ray.intersectObjects(this.visibleSolids(), false)[0];
    return this.ray.intersectObjects(this.targetModels.filter(m => m.parent?.visible), true)
      .filter(hit => !hit.object.userData.skipScoring && (!obstacle || hit.distance < obstacle.distance));
  }
  visibleSolids() {
    return this.solids.filter(o=>{ for(let node:THREE.Object3D|null=o;node;node=node.parent) if(!node.visible) return false; return true; });
  }
  shot(shot: Shot) {
    const targetHit = this.castTargets(shot.origin, shot.direction)[0];
    this.ray.set(vector(shot.origin), vector(shot.direction));
    const wallHit = this.ray.intersectObjects(this.visibleSolids(), false)[0];
    const physicalHit = targetHit && (!shot.melee || targetHit.distance<=48*.0254) && (!wallHit || targetHit.distance < wallHit.distance) ? targetHit : undefined;
    const expectedTarget = this.targets[this.sim.targetForShot(shot.index)];
    const hit = physicalHit && expectedTarget.getObjectById(physicalHit.object.id) ? physicalHit : undefined;
    if (shot.melee) {
      this.kick=1; this.audio.play('knife',this.sim.settings.volume);
      this.hitCaption.textContent=hit?'KNIFE HIT':'';this.hitTime=hit ? .45 : 0;
      this.hitmarker.style.color=this.hitCaption.style.color='#51edee';
      return;
    }
    const impact = physicalHit || wallHit;
    const target = expectedTarget;
    const t = (target.position.z - shot.origin.z) / shot.direction.z;
    this.sim.samples.push({ x: t > 0 ? shot.origin.x + shot.direction.x * t - target.position.x : 100,
      y: t > 0 ? shot.origin.y + shot.direction.y * t - target.position.y - HEAD_HEIGHT : 100, hit: !!hit, head: !!hit && hit.point.y > target.position.y+1.52,
      bullet: this.sim.drill ? this.sim.drill.shots+1 : shot.index + 1 });
    const head = !!hit && hit.point.y > target.position.y+1.52;
    this.hitTime = .45;
    this.hitmarker.style.color = head ? '#ffdc59' : hit ? '#51edee' : '#ff7469';
    this.hitCaption.textContent = head ? 'HEADSHOT' : hit ? 'BODY HIT' : physicalHit ? 'WRONG TARGET' : 'MISS';
    this.hitCaption.style.color = this.hitmarker.style.color;
    if (hit) {
      this.sim.hits++;
      if (head) this.sim.heads++;
    }
    if (impact) {
      const mark = new THREE.Mesh(this.markerGeometry, head ? this.hitMaterial : hit ? this.bodyMaterial : this.missMaterial);
      mark.position.copy(impact.point).addScaledVector(vector(shot.direction), -.012);
      mark.scale.setScalar(Math.max(1, impact.distance / 18));
      if (physicalHit) {
        const target = this.targets.find(t => t.getObjectById(physicalHit.object.id));
        if (target) { target.worldToLocal(mark.position); mark.userData.impact = true; target.add(mark); }
      } else this.impacts.add(mark);
      while (this.impacts.children.length > 200) this.impacts.remove(this.impacts.children[0]);
      this.targets.forEach(t => { const marks = t.children.filter(c => c.userData.impact); if (marks.length > 60) t.remove(marks[0]); });
    }
    this.kick = 1;
    this.audio.play(this.sim.equipped, this.sim.settings.volume);
  }
  async enter() {
    this.sim.active = true;
    this.renderer.domElement.focus({ preventScroll: true });
    void this.audio.unlock(this.sim.equipped);
    const mode = await requestRawLock(this.renderer.domElement);
    if (this.disposed) return;
    this.inputStatus = mode === 'raw' ? 'Raw mouse' : mode === 'standard' ? 'Standard mouse' : 'Drag aim';
  }
  pause() {
    this.clearInput?.();
    this.sim.cancel();
    this.hitTime = 0;
    this.hitmarker.style.opacity = this.hitCaption.style.opacity = '0';
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }
  bindInput() {
    const canvas = this.renderer.domElement;
    const listen = (target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, options); this.cleanup.push(() => target.removeEventListener(type, fn, options));
    };
    let pointer: number | null = null, lastX = 0, lastY = 0;
    const capture = (id: number) => { try { canvas.setPointerCapture(id); } catch { /* Some embedded engines reject pointer capture. */ } };
    listen(canvas, 'pointerdown', ((e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      if (!this.loadedTarget || !this.modelCache.has(this.sim.equipped)) return;
      e.preventDefault();
      void this.audio.unlock(this.sim.equipped);
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        this.inputStatus = 'Touch'; this.sim.active = true;
        pointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
        capture(e.pointerId); this.sim.start(true);
      } else if (!this.sim.active) void this.enter();
      else {
        pointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
        if (!document.pointerLockElement) capture(e.pointerId);
        this.sim.start();
      }
    }) as EventListener);
    listen(document, 'pointermove', ((e: PointerEvent) => {
      if (!this.sim.active) return;
      if (document.pointerLockElement === canvas && e.pointerType === 'mouse') this.sim.aim(e.movementX, e.movementY);
      else if (e.pointerId === pointer) {
        this.sim.aim(e.clientX - lastX, e.clientY - lastY, e.pointerType !== 'mouse');
        lastX = e.clientX; lastY = e.clientY;
      }
    }) as EventListener);
    listen(document, 'pointerup', ((e: PointerEvent) => {
      if (e.button !== 0) return;
      if (pointer === e.pointerId) pointer = null;
      this.sim.release(e.pointerType);
    }) as EventListener);
    listen(canvas, 'pointercancel', (() => { pointer = null; this.pause(); }) as EventListener);
    listen(canvas, 'contextmenu', e => e.preventDefault());
    listen(document, 'pointerlockchange', (() => {
      if (document.pointerLockElement !== canvas && this.inputStatus !== 'Touch' && this.inputStatus !== 'Drag aim') this.pause();
    }) as EventListener);
    listen(document, 'pointerlockerror', (() => { this.inputStatus = 'Drag aim'; }) as EventListener);
    const keys = new Set<string>();
    const update = () => {
      this.sim.input = { forward: +keys.has('KeyW') - +keys.has('KeyS'), side: +keys.has('KeyD') - +keys.has('KeyA'), walk: keys.has('ShiftLeft') || keys.has('ShiftRight'), crouch: keys.has('ControlLeft') || keys.has('KeyC'), jump: keys.has('Space') };
    };
    this.clearInput = () => { keys.clear(); pointer = null; update(); };
    listen(window, 'keydown', ((e: KeyboardEvent) => {
      if (!this.sim.active || (e.target instanceof HTMLElement && e.target.matches('input,select,textarea,button'))) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'KeyC', 'Space'].includes(e.code)) { e.preventDefault(); keys.add(e.code); update(); }
      if (!e.repeat && ['Digit1','Digit2','Digit3'].includes(e.code)) { e.preventDefault(); void this.equip(+e.code.slice(-1) as Slot); }
      if (!e.repeat && e.code === 'KeyQ') { e.preventDefault(); void this.equip(this.sim.previousSlot); }
      if (!e.repeat && e.code === 'KeyR') { if(this.sim.slot===2) this.sim.reload(); else {this.sim.reset();this.clearImpacts();} }
      if (e.code === 'Escape') this.pause();
    }) as EventListener);
    listen(window, 'keyup', ((e: KeyboardEvent) => { keys.delete(e.code); update(); }) as EventListener);
    const blur = () => { keys.clear(); pointer = null; this.pause(); };
    listen(window, 'blur', blur);
    listen(document, 'visibilitychange', () => { if (document.hidden) blur(); });
    listen(canvas, 'webglcontextlost', e => { e.preventDefault(); this.pause(); this.onError('Graphics context lost. Restart the range to recover.'); });
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    const cap = this.sim.settings.quality === 'high' ? 2 : this.sim.settings.quality === 'low' ? 1 : width < 700 ? 1.25 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(width, height);
    const aspect = this.sim.settings.aspect === 'native' ? width / height : this.sim.settings.aspect.split(':').map(Number).reduce((a, b) => a / b);
    this.camera.aspect = aspect;
    this.viewViewport = viewmodelViewport(width, height);
    this.viewCamera.aspect = this.viewViewport.aspect;
    this.camera.updateProjectionMatrix(); this.viewCamera.updateProjectionMatrix();
  }
  tick(timestamp: number) {
    if (this.disposed) return;
    const dt = this.previous ? Math.min((timestamp - this.previous) / 1000, .25) : 0;
    this.previous = timestamp; this.elapsed += dt;
    this.sim.advance(dt); this.syncTargets();
    const activeLane = this.sim.firing ? this.sim.targetForShot() : 0;
    this.targets.forEach((t, i) => {
      const marker = t.getObjectByName('active-lane') as THREE.Mesh;
      marker.visible = !this.sim.drill;
      (marker.material as THREE.MeshBasicMaterial).color.set(i === activeLane ? GUIDE_COLORS.now : GUIDE_COLORS.next);
      t.getObjectByName('lane-tag')!.visible = this.sim.settings.mode === 'transfer';
    });
    const animation = Math.abs(this.sim.targetVelocity) < .1 ? 0 : this.sim.targetVelocity > 0 ? 1 : 2;
    if (animation !== this.animationState && this.loadedTarget) {
      this.animationState = animation;
      this.targetActions.forEach(actions => { actions.forEach(a => a.stop()); actions[animation]?.reset().play(); });
    }
    this.mixers.forEach(m => m.update(this.sim.active ? dt : 0));
    this.camera.position.copy(vector(this.sim.position));
    this.camera.rotation.set(this.sim.pitch, this.sim.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    this.kick = Math.max(0, this.kick - dt * 10);
    this.muzzle.intensity = ['m4a1s','usp','knife'].includes(this.sim.equipped) ? 0 : this.kick > .65 ? 2 : 0;
    this.hitTime = Math.max(0, this.hitTime - dt);
    this.hitmarker.style.opacity = this.hitTime > 0 ? '1' : '0';
    this.hitCaption.style.opacity = this.hitTime > 0 ? '1' : '0';
    const moving = Math.hypot(this.sim.velocity.x, this.sim.velocity.z);
    const drawing = Math.max(0,this.sim.equipReadyAt-this.sim.time);
    const reloading = this.sim.pistolReloadAt>0;
    this.weaponRoot.position.set(VIEWMODEL_OFFSET.x, VIEWMODEL_OFFSET.y + Math.sin(this.elapsed * 12) * Math.min(moving, 1) * .002 - drawing*.25 - (reloading ? .12 : 0), this.kick * .015);
    this.weaponRoot.rotation.x = this.kick * (this.sim.slot===3 ? -.6 : .02) - drawing*.3;
    this.weaponRoot.rotation.z = this.sim.slot===3 ? this.kick*-.45 : reloading ? -.25 : 0;
    const r = this.sim.settings.follow ? this.sim.recoil : { yaw: 0, pitch: 0 };
    const point = new THREE.Vector3(-Math.tan(-this.sim.yaw + r.yaw * DEG), 0, -1);
    // Project the recoil-only direction with the same camera, excluding random spread.
    const yaw = this.sim.yaw - r.yaw * DEG, pitch = this.sim.pitch + r.pitch * DEG;
    point.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(10).add(this.camera.position).project(this.camera);
    this.crosshair.style.transform = `translate(${point.x * this.host.clientWidth / 2}px, ${-point.y * this.host.clientHeight / 2}px)`;
    this.crosshair.style.setProperty('--motion-gap', this.sim.settings.crosshair.dynamic ? `${moving * 1.2 + this.kick * 4}px` : '0px');
    const targetPosition = this.targets[activeLane].position;
    const dx = targetPosition.x - this.sim.position.x, dz = targetPosition.z - this.sim.position.z;
    const distance = Math.hypot(dx, dz);
    this.cues.forEach((cue, i) => {
      const index = (this.sim.firing ? this.sim.shots : 0) + i;
      const visible = this.sim.slot===1 && ['guided', 'transfer'].includes(this.sim.settings.mode) && index < this.sim.burstSize;
      const target = this.sim.targetPosition(this.sim.targetForShot(index));
      const dx = target.x - this.sim.position.x, dz = target.z - this.sim.position.z;
      const p = this.sim.pattern[Math.min(index, this.sim.pattern.length - 1)];
      const aim = direction(Math.atan2(-dx, -dz) + p.yaw * DEG, Math.atan2(1.63 - this.sim.position.y, Math.hypot(dx, dz)) - p.pitch * DEG);
      const point = vector(aim).multiplyScalar(10).add(this.camera.position).project(this.camera);
      cue.hidden = !visible || point.z > 1 || Math.abs(point.x) > .95 || Math.abs(point.y) > .88;
      cue.style.left = `${(point.x + 1) * 50}%`; cue.style.top = `${(1 - point.y) * 50}%`;
      cue.querySelector('span')!.textContent = `${i ? 'NEXT' : 'NOW'} ${index + 1}${this.sim.settings.mode === 'transfer' ? this.sim.targetForShot(index) ? ' / B' : ' / A' : ''}`;
    });
    this.demonstration.update(this.elapsed);
    this.mouseDemonstration.update(this.elapsed);
    this.renderer.setViewport(0, 0, this.host.clientWidth, this.host.clientHeight);
    this.renderer.autoClear = true; this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false; this.renderer.clearDepth();
    const v = this.viewViewport; this.renderer.setViewport(v.x, v.y, v.width, v.height);
    this.renderer.render(this.viewScene, this.viewCamera);
    if (this.elapsed - this.statusTime > .1) {
      this.statusTime = this.elapsed;
      const drill=this.sim.drill;
      this.onStatus({ weapon: this.sim.settings.weapon, equipped:this.sim.equipped,slot:this.sim.slot,equipReady:this.sim.time>=this.sim.equipReadyAt,
        magazine:this.sim.slot===1?this.sim.burstSize:this.sim.stats.magazine,
        active: this.sim.active, firing: this.sim.firing, shots: drill?.shots ?? this.sim.shots, hits: drill?.hits ?? this.sim.hits, heads: drill?.heads ?? this.sim.heads,
        remaining: this.sim.slot===2 ? this.sim.pistolAmmo : this.sim.slot===3 ? 0 : this.sim.firing ? this.sim.burstSize - this.sim.shots : this.sim.burstSize, reload: Math.max(0,this.sim.pistolReloadAt-this.sim.time),
        ...(drill ? {drill:{round:this.sim.drillRound,completed:this.sim.drillCompleted,passed:this.sim.drillPassed,scenario:drill.scenario.name,covered:drill.scenario.covered,side:drill.scenario.side,
          phase:drill.finished?(this.sim.repositionFrom?'reposition':'feedback'):drill.visible?'exposed':'prepare',accurate:drill.accurate,error:drill.error,last:this.sim.drillResult}} : {}),
        speed: moving / .0254, distance, input: this.inputStatus, audio: this.audio.status, assets: this.assetStatus, fps: dt ? Math.round(1 / dt) : 0 });
    }
    this.frame = requestAnimationFrame(t => this.tick(t));
  }
  disposeObject(root: THREE.Object3D) {
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Line)) return;
      o.geometry.dispose();
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const val of Object.values(mat)) if (val instanceof THREE.Texture) val.dispose();
        mat.dispose();
      }
    });
  }
  dispose() {
    this.disposed = true; this.pause(); cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.cleanup.forEach(fn => fn()); this.audio.dispose();
    this.demonstration.dispose();
    this.mouseDemonstration.dispose();
    this.drillScenery.dispose();
    this.disposeObject(this.scene); this.modelCache.forEach(m => this.disposeObject(m));
    this.markerGeometry.dispose(); this.missMaterial.dispose(); this.hitMaterial.dispose(); this.bodyMaterial.dispose();
    this.cues.forEach(c => c.remove()); this.hitCaption.remove();
    this.environment?.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
