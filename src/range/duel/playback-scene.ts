import * as THREE from 'three';
import {recordingActors, recordingFrame, recordingWorld, type CombatRecording, type ReplayActor, type ReplayShot, type ReplayWorld} from './combat-replay';
import {ReplayScene} from './replay-scene';
import {addArenaCover, type CoverMaterials} from './arena-props';
import {batchStaticMeshes} from './render-resources';
import {scopeVerticalFov} from '../weapon-actions';
import {UtilityRenderer, utilityFlashOpacity} from './utility-render';
import {replayUtilityPose, replayUtilityThrow, sampleReplayUtilities, type ReplayUtilityPose} from './utility-replay';
import {VIEWMODEL_FOV, viewmodelViewport} from '../viewmodel';
import type {UtilityKind} from './utility-loadout';

export type ReplayVisual = {root: THREE.Group; update: (actor: ReplayActor, time: number, deathAge?: number) => void; dispose: () => void;
  utilityMount?: THREE.Object3D; weapons?: THREE.Object3D[];
  updateUtility?: (pose: ReplayUtilityPose | undefined, time: number) => void};
type ActorFactory = (actor: ReplayActor, recording: CombatRecording) => ReplayVisual | undefined;
const vector = (v: {x: number; y: number; z: number}) => new THREE.Vector3(v.x, v.y, v.z);

function disposeWorld(root: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); root.clear();
}

/** Playback owns cloned rigs and recorded cover, never live simulation actors. */
export class PlaybackScene {
  readonly group = new THREE.Group();
  readonly actors = new THREE.Group();
  readonly world = new THREE.Group();
  readonly diagnostics = new ReplayScene();
  readonly viewScene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, .01, 10);
  readonly utilityRenderer = new UtilityRenderer(this.group, this.viewScene);
  utilityError?: string;
  private heldUtilities = new Map<number, THREE.Group>();
  private weaponVisibility = new Map<number, Map<THREE.Object3D, boolean>>();
  private utilityJobs = new Map<UtilityKind, Promise<void>>();
  private time = 0;
  private diagnostic = false;
  private firstPerson = false;
  private disposed = false;
  private overlayGeometry = new THREE.PlaneGeometry(2, 2);
  private overlayMaterial = new THREE.ShaderMaterial({transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {smoke: {value: 0}, flash: {value: 0}},
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float smoke; uniform float flash; void main() { float a = flash + smoke * (1.0-flash); gl_FragColor = vec4(mix(vec3(0.5,0.53,0.53), vec3(1.0), flash / max(a,0.00001)), a); }'});
  private overlay = new THREE.Mesh(this.overlayGeometry, this.overlayMaterial);
  private traceGeometry = new THREE.BufferGeometry();
  private tracePositions = new THREE.Float32BufferAttribute(new Float32Array(128 * 6), 3);
  private traceColors = new THREE.Float32BufferAttribute(new Float32Array(128 * 6), 3);
  private traceMaterial = new THREE.LineBasicMaterial({vertexColors: true, transparent: true, opacity: .8});
  private traces = new THREE.LineSegments(this.traceGeometry, this.traceMaterial);
  private visuals = new Map<number, ReplayVisual>();
  private visualKeys = new Map<number, string>();
  private source?: CombatRecording;
  private worldSource?: ReplayWorld;
  private diagnosticShot?: ReplayShot;
  private factory?: ActorFactory;
  private sampled: ReplayActor[] = [];
  constructor() {
    this.traceGeometry.setAttribute('position', this.tracePositions); this.traceGeometry.setAttribute('color', this.traceColors); this.traceGeometry.setDrawRange(0, 0);
    this.traces.frustumCulled = false;
    this.overlay.name = 'replay-utility-overlay'; this.overlay.frustumCulled = false; this.overlay.renderOrder = 10000; this.overlay.visible = false;
    this.viewScene.add(new THREE.HemisphereLight('#ffffff', '#66675b', 1.4));
    const light = new THREE.DirectionalLight('#fff2dd', 2); light.position.set(-2, 4, 2); this.viewScene.add(light);
    this.group.add(this.world, this.actors, this.traces, this.diagnostics.group);
    this.group.add(this.overlay);
  }
  get hasWorld() {return !!this.worldSource && !this.worldSource.native;}
  setActorFactory(factory: ActorFactory) {this.factory = factory; this.clearActors();}
  private removeActor(id: number) {
    const held = this.heldUtilities.get(id); if (held) this.utilityRenderer.releaseWorldHeld(held);
    this.heldUtilities.delete(id);
    this.weaponVisibility.delete(id);
    const visual = this.visuals.get(id); visual?.dispose(); visual?.root.removeFromParent();
    this.visuals.delete(id); this.visualKeys.delete(id);
  }
  private clearActors() {for (const id of this.visuals.keys()) this.removeActor(id); this.actors.clear();}
  clear() {
    this.clearActors(); disposeWorld(this.world); this.diagnostics.clear();
    this.source = undefined; this.worldSource = undefined; this.diagnosticShot = undefined; this.sampled = [];
    this.traceGeometry.setDrawRange(0, 0);
    this.utilityRenderer.clear(); this.overlay.visible = false; this.firstPerson = false;
    this.overlayMaterial.uniforms.flash.value = this.overlayMaterial.uniforms.smoke.value = 0;
  }
  /** Optional eager preload. show() also lazily starts this without blocking playback. */
  async prepareUtilities(recording: CombatRecording) {
    if (this.disposed) return;
    const kinds = new Set<UtilityKind>();
    for (const effect of recording.utilities?.effects ?? []) kinds.add(effect.kind);
    for (const frame of recording.utilities?.frames ?? []) for (const p of frame.projectiles) kinds.add(p.kind);
    for (const frame of recording.utilities?.frames ?? []) for (const drop of frame.drops ?? []) kinds.add(drop.utility);
    for (const event of recording.utilities?.events ?? []) kinds.add(event.kind);
    for (const frame of recording.frames) for (const actor of frame.actors) {
      if (actor.utility) kinds.add(actor.utility);
      if (actor.utilityState) kinds.add(actor.utilityState.kind);
    }
    await Promise.all([...kinds].map(kind => {
      let job = this.utilityJobs.get(kind);
      if (!job) {
        job = this.utilityRenderer.prepare([kind]).catch(error => {
          this.utilityJobs.delete(kind); this.utilityError = 'Grenade replay assets unavailable'; throw error;
        });
        this.utilityJobs.set(kind, job);
      }
      return job;
    }));
  }
  show(recording: CombatRecording, shot: ReplayShot | undefined, time: number, diagnostic = false) {
    if (this.disposed) return;
    if (this.source !== recording) {this.clear(); this.source = recording; void this.prepareUtilities(recording).catch(() => {});}
    this.time = diagnostic && shot ? shot.time : time; this.diagnostic = diagnostic;
    time = this.time;
    const world = recordingWorld(recording, time);
    if (world !== this.worldSource) {
      disposeWorld(this.world); this.worldSource = world;
      if (world && !world.native) {
        const colors = {concrete: '#697a77', cargo: '#465f64', crate: '#967b59', barrier: '#b3ad91', cap: '#a8b7b1',
          trim: '#354e52', hazard: '#ddbf70', crateEdge: '#654e38', glass: '#88b9bb', water: '#3d767a'};
        const materials = {} as CoverMaterials;
        for (const key of Object.keys(colors) as (keyof typeof colors)[]) materials[key] = new THREE.MeshStandardMaterial({color: colors[key], roughness: .8});
        for (const solid of world.solids) if (solid.active !== false) addArenaCover(solid, this.world, materials);
        const {minX, maxX, minZ, maxZ} = world.bounds;
        const floor = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, .2, maxZ - minZ), new THREE.MeshStandardMaterial({color: '#a5aea3', roughness: .9}));
        floor.position.set((minX + maxX) / 2, -.1, (minZ + maxZ) / 2); this.world.add(floor);
        batchStaticMeshes(this.world);
        const used = new Set<THREE.Material>(); this.world.traverse(node => {if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) used.add(material);});
        Object.values(materials).forEach(material => {if (material && !used.has(material)) material.dispose();});
      }
    }
    const frameTime = recordingFrame(recording, time)?.time ?? -Infinity;
    this.sampled = recordingActors(recording, time).map(actor => {
      const thrown = replayUtilityThrow(recording.utilities, actor.id, time);
      // A release can fall between pose samples. Never keep a second grenade in the palm.
      return thrown && thrown.time >= frameTime && (actor.utilityState?.selectedAt ?? -Infinity) <= thrown.time
        ? {...actor, utility: undefined, utilityState: undefined} : actor;
    });
    const visibleIds = new Set(this.sampled.map(actor => actor.id));
    for (const id of this.visuals.keys()) if (!visibleIds.has(id)) {
      this.removeActor(id);
    }
    for (const actor of this.sampled) {
      let visual = this.visuals.get(actor.id);
      const key = `${actor.generation}:${actor.equipment}`;
      if (visual && this.visualKeys.get(actor.id) !== key) {
        this.removeActor(actor.id); visual = undefined;
      }
      if (!visual) {
        visual = this.factory?.(actor, recording);
        if (!visual) continue;
        this.visuals.set(actor.id, visual); this.visualKeys.set(actor.id, key); this.actors.add(visual.root);
        const mount = visual.utilityMount ?? visual.root.getObjectByName('hand_R');
        if (mount) this.heldUtilities.set(actor.id, this.utilityRenderer.createWorldHeld(mount));
        const weapons = visual.weapons ?? visual.root.getObjectsByProperty('name', 'wpn').flatMap(node => node.children)
          .concat(visual.root.getObjectsByProperty('name', 'held_weapon_target001'), visual.root.getObjectsByProperty('name', 'held_weapon_target.001'));
        this.weaponVisibility.set(actor.id, new Map(weapons.map(weapon => [weapon, weapon.visible])));
      }
      visual.root.position.set(actor.position.x, actor.feet, actor.position.z);
      visual.root.rotation.y = (actor.bodyYaw ?? actor.yaw) - Math.PI;
      const deathTime = !actor.alive ? recording.frames.find(frame => frame.actors.some(item => item.id === actor.id && item.generation === actor.generation && !item.alive))?.time : undefined;
      const thrown = replayUtilityThrow(recording.utilities, actor.id, time);
      const utilityPose=actor.alive?replayUtilityPose(actor.utilityState,thrown,time):undefined;
      visual.updateUtility?.(utilityPose?{...utilityPose,crouched:actor.duckAmount>.5}:undefined,time);
      visual.update(actor, time, deathTime === undefined ? undefined : Math.max(0, time - deathTime));
      const held = this.heldUtilities.get(actor.id);
      if (held) this.utilityRenderer.updateWorldHeld(held, actor.utilityState?.kind ?? actor.utility, actor.alive);
      const hideWeapon = actor.alive && (!!actor.utility || !!actor.utilityState || !!thrown && time - thrown.time < .4);
      for (const [weapon, visible] of this.weaponVisibility.get(actor.id) ?? []) weapon.visible = visible && !hideWeapon;
    }
    this.diagnostics.group.visible = diagnostic;
    this.traces.visible = !diagnostic;
    let segments = 0;
    for (const event of recording.shots) if (event.time <= time && event.time > time - .12) {
      const color = new THREE.Color(event.shooter === 0 ? '#fff0c9' : '#ff9d8c');
      const stop = event.contacts.map(contact => vector(event.origin).distanceTo(vector(contact.point))).sort((a, b) => a - b)[0] ?? Math.min(45, event.range);
      for (const direction of event.pellets ?? [event.direction]) {
        if (segments >= 128) break;
        const from = event.origin, at = segments++ * 2;
        this.tracePositions.setXYZ(at, from.x, from.y, from.z);
        this.tracePositions.setXYZ(at + 1, from.x + direction.x * stop, from.y + direction.y * stop, from.z + direction.z * stop);
        this.traceColors.setXYZ(at, color.r, color.g, color.b); this.traceColors.setXYZ(at + 1, color.r, color.g, color.b);
      }
    }
    this.traceGeometry.setDrawRange(0, segments * 2); this.tracePositions.needsUpdate = this.traceColors.needsUpdate = true;
    if (diagnostic && shot !== this.diagnosticShot) {
      this.diagnostics.clear(); if (shot) this.diagnostics.show(recording, shot, shot.time);
      this.diagnosticShot = shot;
    }
  }
  camera(camera: THREE.PerspectiveCamera, shot: ReplayShot | undefined, overview: boolean, diagnostic = false) {
    for (const [id, visual] of this.visuals) visual.root.visible = overview || id !== 0;
    const player = this.sampled.find(actor => actor.id === 0);
    const fov = !overview && !diagnostic && !player?.utility && !player?.utilityState ? player?.view?.fov ?? scopeVerticalFov(90) : scopeVerticalFov(90);
    if (camera.fov !== fov) {camera.fov = fov; camera.updateProjectionMatrix();}
    if (diagnostic && shot) {this.diagnostics.camera(camera, shot, overview); this.updateUtilities(camera, false); return;}
    if (player) {
      const origin = vector(player.position);
      if (overview) {
        const nearest = this.sampled.filter(actor => actor.id !== 0 && actor.alive)
          .sort((a, b) => origin.distanceToSquared(vector(a.position)) - origin.distanceToSquared(vector(b.position)))[0];
        const end = nearest ? vector(nearest.position) : origin.clone().add(new THREE.Vector3(0, 0, -5));
        const center = origin.clone().add(end).multiplyScalar(.5), span = Math.min(20, Math.max(7, origin.distanceTo(end)));
        camera.position.copy(center).add(new THREE.Vector3(span * .5, span * .7, span * .5)); camera.lookAt(center);
      } else {
        camera.position.copy(origin);
        camera.rotation.set(player.view?.pitch ?? player.pitch, player.view?.yaw ?? player.yaw, player.view?.roll ?? 0, 'YXZ');
      }
    }
    camera.updateMatrixWorld();
    this.updateUtilities(camera, !overview && !diagnostic);
  }
  private updateUtilities(camera: THREE.PerspectiveCamera, firstPerson: boolean) {
    this.firstPerson = firstPerson && !this.diagnostic;
    const state = sampleReplayUtilities(this.source?.utilities, this.time);
    this.utilityRenderer.update(state.projectiles, state.effects, this.time, camera);
    this.utilityRenderer.syncDrops(state.drops ?? []);
    const player = this.sampled.find(actor => actor.id === 0), alive = this.firstPerson && !!player?.alive;
    const thrown = replayUtilityThrow(this.source?.utilities, 0, this.time);
    // Reset and resample the authored action at absolute time, including on backward seeks.
    this.utilityRenderer.cancelHeld();
    if (!player?.utilityState && !player?.utility && thrown) this.utilityRenderer.throw(thrown.kind, thrown.time, thrown.strength, thrown.throwStartedAt);
    this.utilityRenderer.updateHeld(player?.utilityState?.kind ?? player?.utility, alive, this.time,
      player ? Math.hypot(player.velocity.x, player.velocity.z) : 0, player?.utilityState);
    if (player?.utility || player?.utilityState) {
      // UtilityView's live draw-to-idle crossfade retains prior-action history. A second
      // cancelled absolute sample removes that history for paused/backward playback.
      this.utilityRenderer.cancelHeld();
      this.utilityRenderer.updateHeld(player.utilityState?.kind ?? player.utility, alive, this.time,
        Math.hypot(player.velocity.x, player.velocity.z), player.utilityState);
    }
    this.overlayMaterial.uniforms.flash.value = alive ? utilityFlashOpacity(player?.flashAmount ?? 0) : 0;
    this.overlayMaterial.uniforms.smoke.value = alive ? this.utilityRenderer.interiorSmokeOpacity : 0;
    this.overlay.visible = this.overlayMaterial.uniforms.flash.value > 0 || this.overlayMaterial.uniforms.smoke.value > 0;
    (this.utilityRenderer.held.visible ? this.overlayScene : this.group).add(this.overlay);
  }
  /** Call after the world render. Composites native first-person arms beneath flash/smoke. */
  renderUtilityView(renderer: THREE.WebGLRenderer, width: number, height: number) {
    if (this.disposed || !this.firstPerson || !this.utilityRenderer.held.visible) return;
    const viewport = viewmodelViewport(width, height), autoClear = renderer.autoClear;
    const oldViewport = renderer.getViewport(new THREE.Vector4());
    this.viewCamera.aspect = viewport.aspect; this.viewCamera.updateProjectionMatrix();
    try {
      renderer.autoClear = false; renderer.clearDepth();
      renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
      renderer.render(this.viewScene, this.viewCamera);
      if (this.overlay.visible) {renderer.setViewport(0, 0, width, height); renderer.render(this.overlayScene, this.viewCamera);}
    } finally {
      renderer.autoClear = autoClear; renderer.setViewport(oldViewport);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.clear(); this.disposed = true; this.utilityRenderer.dispose(); this.utilityJobs.clear(); this.diagnostics.dispose();
    this.overlayGeometry.dispose(); this.overlayMaterial.dispose(); this.viewScene.clear(); this.overlayScene.clear();
    this.traceGeometry.dispose(); this.traceMaterial.dispose(); this.group.removeFromParent();
  }
}
