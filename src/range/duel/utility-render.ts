import * as THREE from 'three';
import {UNIT, type Vec} from '../actor-physics';
import {UTILITY_RULES, type UtilityEffect, type UtilityProjectile} from './utilities';
import {utilityKinds, type UtilityKind} from './utility-loadout';
import models from './utility-models.json';
import {loadCombatModel} from '../combat-model-delivery';
import {disposeResources} from './render-resources';
import {VIEWMODEL_OFFSET} from '../viewmodel';
import {UtilityView, type UtilityPresentation} from './utility-view';
import {applyGloves, type ActorCosmeticProfile} from '../actor-cosmetics';
import particles from './utility-particles-native.json';
import {SmokeRenderer} from './smoke-render';
import {InfernoRenderer} from './inferno-render';

export const UTILITY_PRESENTATION_BOUNDS = Object.freeze({drops: 64, effects: 64});
export type UtilityDropPresentation = Readonly<{id: number; utility: UtilityKind; position: Readonly<Vec>; picked?: boolean;
  droppedAt?: number; owner?: unknown}>;
const vertexShader = `
attribute float instanceOpacity;
attribute float instanceFrame;
varying vec2 vUv;
varying float vOpacity;
varying float vFrame;
void main() {
  vUv = uv; vOpacity = instanceOpacity; vFrame = instanceFrame;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const fragmentShader = `
uniform sampler2D atlas;
uniform vec2 grid;
uniform float frames;
uniform int mode;
uniform vec3 tint;
uniform float overbright;
varying vec2 vUv;
varying float vOpacity;
varying float vFrame;
vec4 frame(float f) {
  float n = mod(f, frames);
  vec2 cell = vec2(mod(n, grid.x), grid.y - 1.0 - floor(n / grid.x));
  return texture2D(atlas, (cell + clamp(vUv, 0.003, 0.997)) / grid);
}
void main() {
  vec4 texel = mix(frame(floor(vFrame)), frame(floor(vFrame) + 1.0), fract(vFrame));
  float alpha = texel.a * vOpacity;
  vec3 color = texel.rgb;
  if (mode == 2) {alpha *= max(texel.r, max(texel.g, texel.b)); color = vec3(0.89,0.96,1.0);}
  if (mode == 3) color = vec3(texel.a) * tint * overbright;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color,alpha);
}`;

function billboards(capacity: number, kind: 'flash' | 'he') {
  const asset = particles.assets[kind];
  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const frame = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  frame.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('instanceFrame', frame);
  opacity.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('instanceOpacity', opacity);
  // A transparent one-pixel fallback avoids a bright rectangle before the native atlas arrives.
  const fallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); fallback.needsUpdate = true;
  const material = new THREE.ShaderMaterial({uniforms: {atlas: {value: fallback}, grid: {value: new THREE.Vector2(asset.columns, asset.rows)},
    frames: {value: asset.frames}, mode: {value: kind === 'flash' ? 2 : 3},
    tint: {value: new THREE.Vector3(...particles.nativeParameters.he.color as [number, number, number]).divideScalar(255)},
    overbright: {value: kind === 'he' ? particles.nativeParameters.he.overbright : 1}}, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    blending: kind === 'flash' ? THREE.AdditiveBlending : THREE.NormalBlending});
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
  mesh.raycast = () => {}; mesh.renderOrder = kind === 'flash' ? 4 : 2;
  return {mesh, opacity, frame, fallback};
}

export function utilityFlashOpacity(amount: number) {
  return Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
}

/** Cosmetic world-space snapshots only. All GPU buffers and scratch transforms are retained. */
export class UtilityRenderer {
  readonly group = new THREE.Group();
  readonly held = new THREE.Group();
  interiorSmokeOpacity = 0;
  private readonly projectiles = new Map<UtilityKind, THREE.InstancedMesh[]>();
  private readonly worlds = new Map<UtilityKind, {scene: THREE.Group; projectile: THREE.Group}>();
  private readonly views = new Map<UtilityKind, UtilityView>();
  private readonly pending = new Map<UtilityKind, Promise<void>>();
  private readonly worldHeld = new Map<THREE.Group, Map<UtilityKind, THREE.Object3D>>();
  private readonly drops = new Map<number, {kind: UtilityKind; model: THREE.Object3D}>();
  private dropSnapshot: readonly UtilityDropPresentation[] = [];
  private readonly dropSeen = new Set<number>();
  private particleJob?: Promise<void>;
  private readonly particleTextures = new Set<THREE.Texture>();
  private currentView?: UtilityKind;
  readonly smoke = new SmokeRenderer();
  readonly inferno = new InfernoRenderer();
  private readonly flash = billboards(UTILITY_RULES.maxEffects, 'flash');
  private readonly he = billboards(UTILITY_RULES.maxEffects, 'he');
  private readonly burstPools = [this.flash, this.he];
  private readonly burst = this.flash.mesh;
  private readonly dummy = new THREE.Object3D();
  private disposed = false;

  constructor(parent: THREE.Object3D, view: THREE.Object3D) {
    this.group.name = 'utility-effects'; this.held.name = 'held-utility';
    this.burst.name = 'utility-burst'; this.burst.count = 0; this.burst.frustumCulled = false;
    this.he.mesh.name = 'utility-he-burst';
    this.burst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.burst.raycast = () => {};
    this.group.add(this.inferno.group, this.burst, this.he.mesh);
    this.held.position.set(VIEWMODEL_OFFSET.x, VIEWMODEL_OFFSET.y, 0); this.held.visible = false;
    parent.add(this.group); view.add(this.held);
  }

  async prepare(kinds: readonly UtilityKind[] = utilityKinds) {
    await Promise.all([this.prepareParticles(), ...kinds.map(kind => {
      let job = this.pending.get(kind);
      if (!job) {
        const asset = models.models[kind];
        job = Promise.allSettled([loadCombatModel(asset.world.url), loadCombatModel(asset.projectile.url), loadCombatModel(asset.view.url)])
          .then(results => {
            const assets = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
            const failed = results.find(result => result.status === 'rejected');
            if (this.disposed || failed) {
              disposeResources(assets.map(asset => asset.scene));
              if (failed?.status === 'rejected') throw failed.reason;
              return;
            }
            const [world, projectile, view] = assets;
            this.installWorld(kind, world.scene, projectile.scene); this.installView(kind, view.scene, view.animations);
          }).catch(error => {this.pending.delete(kind); throw error;});
        this.pending.set(kind, job);
      }
      return job;
    })]);
  }

  /** Preparation only; the HE core is embedded and failed atlases remain transparent. */
  async prepareParticles() {
    if (this.disposed) return;
    this.particleJob ??= Promise.all([this.inferno.prepare(), ...(['flash', 'he'] as const).map(async kind => {
      let texture: THREE.Texture;
      try {texture = await new THREE.TextureLoader().loadAsync(particles.assets[kind].url);} catch {return;}
      if (this.disposed) {texture.dispose(); return;}
      texture.colorSpace = THREE.NoColorSpace; texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      this.particleTextures.add(texture);
      const pool = kind === 'flash' ? this.flash : this.he;
      pool.mesh.material.uniforms.atlas.value = texture;
    })]).then(() => {});
    await this.particleJob;
  }

  /** Asset ownership transfers here. Static world geometry is shared by all bot grips. */
  installWorld(kind: UtilityKind, scene: THREE.Group, projectile: THREE.Group) {
    this.worlds.set(kind, {scene, projectile}); projectile.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(projectile).getCenter(new THREE.Vector3()), parts: THREE.InstancedMesh[] = [];
    projectile.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).translate(-center.x, -center.y, -center.z);
      const mesh = new THREE.InstancedMesh(geometry, object.material, UTILITY_RULES.maxProjectiles);
      mesh.name = `utility-projectiles-${kind}${parts.length ? `-${parts.length}` : ''}`;
      mesh.count = 0; mesh.frustumCulled = false; mesh.raycast = () => {};
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parts.push(mesh); this.group.add(mesh);
    });
    this.projectiles.set(kind, parts);
    for (const [root, copies] of this.worldHeld) this.attachHeld(root, copies, kind);
    this.syncDrops(this.dropSnapshot);
  }

  installView(kind: UtilityKind, scene: THREE.Group, clips: THREE.AnimationClip[]) {
    const view = new UtilityView(scene, clips, kind); scene.visible = false;
    this.views.set(kind, view); this.held.add(scene);
  }

  async setGloves(profile: ActorCosmeticProfile | undefined) {
    await Promise.all([...this.views.values()].map(view => applyGloves(view.scene, profile)));
  }

  updateHeld(kind: UtilityKind | undefined, alive: boolean, time: number, speed = 0, state?: UtilityPresentation) {
    if (kind !== undefined && kind !== this.currentView) {
      if (this.currentView) this.views.get(this.currentView)?.cancel();
      this.currentView = kind; this.views.get(kind)?.cancel();
    }
    const view = this.currentView ? this.views.get(this.currentView) : undefined;
    const visible = alive && !!view?.update(kind ? state ?? {kind, selectedAt: 0, readyAt: 0} : undefined, time);
    for (const [id, model] of this.views) model.scene.visible = visible && id === this.currentView;
    this.held.visible = visible;
    this.held.position.y = VIEWMODEL_OFFSET.y + Math.sin(time * 12) * Math.min(1, speed) * .002;
  }

  inspect(time: number) {return this.currentView ? this.views.get(this.currentView)?.inspect(time) ?? false : false;}
  throw(kind: UtilityKind, time: number, strength = 1, startedAt?: number) {
    this.currentView = kind; this.views.get(kind)?.throw(time, strength, startedAt);
  }
  cancelHeld() {for (const view of this.views.values()) view.cancel(); this.currentView = undefined; this.held.visible = false;}

  private attachHeld(root: THREE.Group, copies: Map<UtilityKind, THREE.Object3D>, kind: UtilityKind) {
    if (copies.has(kind)) return;
    const source = this.worlds.get(kind)?.scene; if (!source) return;
    const model = source.clone(true); model.name = `held-native-${kind}`; model.visible = false;
    const mount = new THREE.Group(); mount.name = `utility-mount-${kind}`;
    new THREE.Matrix4().fromArray(models.models[kind].handInverseBind).decompose(mount.position, mount.quaternion, mount.scale);
    mount.add(model); root.add(mount); copies.set(kind, model);
  }
  createWorldHeld(mount: THREE.Object3D) {
    const root = new THREE.Group(), copies = new Map<UtilityKind, THREE.Object3D>();
    root.name = 'held-world-utility'; root.visible = false; mount.add(root); this.worldHeld.set(root, copies);
    for (const kind of this.worlds.keys()) this.attachHeld(root, copies, kind);
    return root;
  }

  updateWorldHeld(root: THREE.Group, kind: UtilityKind | undefined, alive: boolean) {
    root.visible = !!kind && alive;
    for (const [id, model] of this.worldHeld.get(root) ?? []) model.visible = alive && id === kind;
  }

  releaseWorldHeld(root: THREE.Group) {root.removeFromParent(); root.clear(); this.worldHeld.delete(root);}

  /** Snapshot reconciliation only. Native static templates retain sole GPU ownership. */
  syncDrops(dropped: readonly UtilityDropPresentation[]) {
    if (this.disposed) return;
    this.dropSnapshot = dropped; this.dropSeen.clear();
    for (const drop of dropped) {
      if (this.dropSeen.size >= UTILITY_PRESENTATION_BOUNDS.drops) break;
      if (drop.picked || !Number.isSafeInteger(drop.id) || !utilityKinds.includes(drop.utility) ||
        ![drop.position.x, drop.position.y, drop.position.z].every(Number.isFinite)) continue;
      const source = this.worlds.get(drop.utility)?.scene; if (!source || this.dropSeen.has(drop.id)) continue;
      this.dropSeen.add(drop.id);
      let item = this.drops.get(drop.id);
      if (item && item.kind !== drop.utility) {item.model.removeFromParent(); this.drops.delete(drop.id); item = undefined;}
      if (!item) {
        const model = source.clone(true); model.name = `utility-drop-${drop.id}`;
        model.scale.multiplyScalar(particles.nativeParameters.droppedModelScale[drop.utility] ?? 1);
        model.rotation.set(Math.PI / 2, drop.id * 2.39996, 0);
        // Center visually on the supplied loot point, without altering the stored physical point.
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
        const root = new THREE.Group(); root.name = model.name;
        model.position.set(-center.x, -bounds.min.y, -center.z); root.add(model); this.group.add(root);
        item = {kind: drop.utility, model: root}; this.drops.set(drop.id, item);
      }
      item.model.position.copy(drop.position);
    }
    for (const [id, item] of this.drops) if (!this.dropSeen.has(id)) {item.model.removeFromParent(); this.drops.delete(id);}
  }

  update(projectiles: readonly UtilityProjectile[], effects: readonly UtilityEffect[], time: number, camera: THREE.Camera) {
    if (this.disposed) return;
    for (const parts of this.projectiles.values()) for (const mesh of parts) mesh.count = 0;
    this.dummy.quaternion.identity(); this.dummy.scale.set(1, 1, 1);
    for (const projectile of projectiles) {
      const parts = this.projectiles.get(projectile.kind);
      if (!parts?.length || parts[0].count >= UTILITY_RULES.maxProjectiles) continue;
      this.dummy.position.copy(projectile.position);
      this.dummy.rotation.set(projectile.resting ? Math.PI / 2 : time * 7 + projectile.id, projectile.resting ? projectile.id : time * 4, 0); this.dummy.updateMatrix();
      for (const mesh of parts) mesh.setMatrixAt(mesh.count++, this.dummy.matrix);
    }
    this.smoke.update(effects, time);
    this.inferno.update(effects, time, camera);
    this.burst.count = this.he.mesh.count = 0; this.interiorSmokeOpacity = 0;
    for (let effectIndex = 0; effectIndex < Math.min(effects.length, UTILITY_PRESENTATION_BOUNDS.effects); effectIndex++) {
      const effect = effects[effectIndex];
      const age = time - effect.startedAt, remaining = effect.expiresAt - time;
      if (age < 0 || remaining <= 0) continue;
      if (effect.type === 'decoy') {
        const parts = this.projectiles.get('decoy');
        if (parts?.length && parts[0].count < UTILITY_RULES.maxProjectiles) {
          this.dummy.position.set(effect.position.x, effect.position.y + .03, effect.position.z);
          this.dummy.quaternion.identity(); this.dummy.scale.setScalar(1); this.dummy.updateMatrix();
          for (const mesh of parts) mesh.setMatrixAt(mesh.count++, this.dummy.matrix);
        }
      }
      else if (effect.type === 'burst' && (effect.kind === 'flash' || effect.kind === 'he')) {
        const native = particles.nativeParameters[effect.kind], pool = effect.kind === 'flash' ? this.flash : this.he;
        if (age >= native.lifetimeSeconds || pool.mesh.count >= UTILITY_RULES.maxEffects) continue;
        const progress = age / native.lifetimeSeconds, he = particles.nativeParameters.he;
        // HE samples the authored radius range at its midpoint; this is not a particle interpreter.
        const radius = effect.kind === 'flash' ? particles.nativeParameters.flash.radiusSourceUnits :
          (he.radiusMin + he.radiusMax) / 2 * (he.startScale + (he.endScale - he.startScale) * progress) * he.radiusScale;
        const size = radius * 2 * UNIT;
        this.dummy.position.copy(effect.position); this.dummy.quaternion.copy(camera.quaternion); this.dummy.scale.setScalar(size);
        pool.opacity.setX(pool.mesh.count, Math.pow(1 - progress, 2)); pool.frame.setX(pool.mesh.count, 0);
        this.dummy.updateMatrix(); pool.mesh.setMatrixAt(pool.mesh.count++, this.dummy.matrix);
      }
    }
    for (const parts of this.projectiles.values()) for (const mesh of parts) if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    for (const pool of this.burstPools) if (pool.mesh.count) {
      pool.mesh.instanceMatrix.needsUpdate = true; pool.opacity.needsUpdate = pool.frame.needsUpdate = true;
    }
  }

  renderWorld(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.smoke.render(renderer, scene, camera);
  }

  clear() {
    this.dropSnapshot = []; this.dropSeen.clear();
    for (const item of this.drops.values()) item.model.removeFromParent(); this.drops.clear();
    for (const parts of this.projectiles.values()) for (const mesh of parts) mesh.count = 0;
    this.smoke.clear(); this.inferno.clear(); this.burst.count = this.he.mesh.count = 0; this.cancelHeld();
    this.interiorSmokeOpacity = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clear(); this.group.removeFromParent(); this.held.removeFromParent();
    for (const root of this.worldHeld.keys()) root.removeFromParent(); this.worldHeld.clear();
    for (const view of this.views.values()) view.dispose();
    disposeResources([...this.views.values()].map(view => view.scene).concat([...this.worlds.values()].flatMap(model => [model.scene, model.projectile])));
    this.views.clear(); this.worlds.clear(); this.pending.clear();
    for (const parts of this.projectiles.values()) for (const mesh of parts) {mesh.geometry.dispose(); mesh.dispose();}
    this.projectiles.clear();
    this.smoke.dispose();
    this.inferno.dispose();
    for (const pool of [this.flash, this.he]) pool.fallback.dispose();
    for (const texture of this.particleTextures) texture.dispose(); this.particleTextures.clear();
    for (const mesh of [this.burst, this.he.mesh]) {mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose();}
    this.group.clear(); this.held.clear();
  }
}
