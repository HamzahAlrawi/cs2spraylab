import {expect, it, vi} from 'vitest';
import {AnimationClip, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, ShaderMaterial, Vector3, Vector4, VectorKeyframeTrack, type WebGLRenderer} from 'three';
import {PlaybackScene} from './playback-scene';
import {CombatReplay} from './combat-replay';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import type {UtilityEffect, UtilityProjectile} from './utilities';
import {utilityKinds} from './utility-loadout';

function recording() {
  const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 1, testArena());
  const replay = new CombatReplay(1), actors = sim.snapshot();
  replay.world(0, sim.arena); replay.frame(0, 0, actors);
  replay.frame(4, 1, actors.map(actor => ({...actor, position: {...actor.position, x: actor.position.x + 5},
    yaw: actor.yaw + .5, view: {yaw: actor.yaw + .5, pitch: .2, roll: .05, fov: 55}})));
  return replay.export();
}

it('reuses independent actor rigs and recorded cover while scrubbing movement and camera', () => {
  const source = recording(), unchanged = structuredClone(source), scene = new PlaybackScene();
  const update = vi.fn(), dispose = vi.fn(), factory = vi.fn(() => ({root: new Group(), update, dispose}));
  scene.setActorFactory(factory); scene.show(source, undefined, 0);
  const world = scene.world.children[0], initial = scene.actors.children[0].position.x;
  const camera = new PerspectiveCamera(); scene.camera(camera, undefined, false);
  const before = camera.position.clone();
  scene.show(source, undefined, .5); scene.camera(camera, undefined, false);
  expect(scene.world.children[0]).toBe(world); expect(scene.hasWorld).toBe(true);
  expect(factory).toHaveBeenCalledTimes(2); expect(update).toHaveBeenCalledTimes(4);
  expect(scene.actors.children[0].position.x).toBeCloseTo(initial + 2.5);
  expect(camera.position.x).toBeCloseTo(before.x + 2.5);
  expect(scene.actors.children[0].visible).toBe(false);
  scene.show(source, undefined, 1); scene.camera(camera, undefined, false);
  expect(camera.fov).toBe(55); expect(camera.rotation.z).toBeCloseTo(.05);
  scene.show(source, undefined, 0); scene.camera(camera, undefined, true);
  expect(scene.actors.children[0].visible).toBe(true);
  expect(source).toEqual(unchanged);
  scene.clear(); expect(dispose).toHaveBeenCalledTimes(2); expect(scene.world.children).toHaveLength(0);
  scene.dispose();
});

it('rebuilds held equipment only when the recorded equipment changes, including when scrubbing back', () => {
  const source = recording(), scene = new PlaybackScene(), dispose = vi.fn();
  source.frames[1].actors[1].equipment = 'knife';
  const factory = vi.fn(() => ({root: new Group(), update: vi.fn(), dispose}));
  scene.setActorFactory(factory); scene.show(source, undefined, 0); scene.show(source, undefined, .5);
  expect(factory).toHaveBeenCalledTimes(2);
  scene.show(source, undefined, 1); expect(factory).toHaveBeenCalledTimes(3); expect(dispose).toHaveBeenCalledTimes(1);
  scene.show(source, undefined, 0); expect(factory).toHaveBeenCalledTimes(4); expect(dispose).toHaveBeenCalledTimes(2);
  scene.dispose(); expect(dispose).toHaveBeenCalledTimes(4);
});

function utilityPlayback() {
  const source = recording(), scene = new PlaybackScene();
  vi.spyOn(scene, 'prepareUtilities').mockResolvedValue();
  for (const kind of utilityKinds) {
    const model = new Group(); model.add(new Mesh(new BoxGeometry(.06, .12, .06), new MeshStandardMaterial()));
    scene.utilityRenderer.installWorld(kind, model, model.clone(true));
    const arms = new Group(), body = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    body.userData.native_view_weapon = `utility-${kind}`; arms.add(body);
    scene.utilityRenderer.installView(kind, arms, ['idle', 'draw', 'pullpin', 'hold-high', 'hold-mid', 'hold-low', 'throw-high', 'throw-low']
      .map(name => new AnimationClip(name, 1, [])));
  }
  return {scene, source, camera: new PerspectiveCamera()};
}
const cloud = (patch: Partial<UtilityEffect> = {}): UtilityEffect => ({id: 20, actorId: 0, side: 'player', kind: 'smoke', type: 'smoke',
  position: {x: 0, y: 1.6256, z: 0}, radius: 20, startedAt: 0, expiresAt: 20, cells: [{x: 0, y: 1.6256, z: 0}], holes: [], ...patch});
const grenade = (patch: Partial<UtilityProjectile> = {}): UtilityProjectile => ({id: 1, actorId: 0, side: 'player', kind: 'he',
  position: {x: 1, y: 2, z: -3}, velocity: {x: 0, y: 0, z: 0}, radius: .05, thrownAt: 0, resting: false, bounces: 0, ...patch});
const instance = (scene: PlaybackScene, name: string) => scene.utilityRenderer.group.getObjectByName(name) as InstancedMesh;

it('renders all six native projectile assemblies, smoke, fire, holes, bursts and decoys in ordinary playback', () => {
  const {scene, source, camera} = utilityPlayback(), replay = new CombatReplay(1);
  replay.utility(0, 0, utilityKinds.map((kind, id) => grenade({kind, id})), [cloud(),
    cloud({id: 21, type: 'fire', kind: 'molotov', cells: [{x: 8, y: 0, z: -5}]}),
    cloud({id: 22, type: 'burst', kind: 'he', expiresAt: .25}), cloud({id: 23, type: 'decoy', kind: 'decoy'})]);
  replay.utility(128, 1, [], []); source.utilities = replay.export().utilities;
  const before = structuredClone(source);
  scene.show(source, undefined, .1); scene.camera(camera, undefined, false);
  expect(scene.diagnostics.group.visible).toBe(false);
  for (const kind of utilityKinds) expect(instance(scene, `utility-projectiles-${kind}`).count).toBe(kind === 'decoy' ? 2 : 1);
  expect(scene.utilityRenderer.smoke.count).toBeGreaterThan(0);
  expect(instance(scene, 'utility-fire').count).toBe(1); expect(instance(scene, 'utility-burst').count).toBe(0);
  expect(instance(scene, 'utility-he-burst').count).toBe(1);
  const projectile = instance(scene, 'utility-projectiles-he'), matrix = new Matrix4(); projectile.getMatrixAt(0, matrix);
  expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([1, 2, -3]);
  const retained = scene.utilityRenderer.smoke;
  scene.show(source, undefined, 1); scene.camera(camera, undefined, false);
  expect(scene.utilityRenderer.smoke.count).toBe(0); expect(instance(scene, 'utility-he-burst').count).toBe(0);
  scene.show(source, undefined, .1); scene.camera(camera, undefined, false);
  expect(instance(scene, 'utility-he-burst').count).toBe(1); expect(scene.utilityRenderer.smoke).toBe(retained);
  const pausedMatrix = [...projectile.instanceMatrix.array];
  scene.show(source, undefined, .1); scene.camera(camera, undefined, false);
  expect([...projectile.instanceMatrix.array]).toEqual(pausedMatrix); expect(source).toEqual(before);
  scene.dispose();
});

it('samples flash and smoke overlays, suppresses them in overview/diagnostics, and restores holes on backward seeks', () => {
  const {scene, source, camera} = utilityPlayback(), replay = new CombatReplay(1);
  const player = source.frames[0].actors[0]; player.flashAmount = .8;
  source.frames[1].actors[0].flashAmount = .2;
  const smoke = cloud({position: {...player.position}, cells: Array.from({length: 9}, (_, i) => ({...player.position, x: player.position.x + i * .8}))});
  replay.utility(0, 0, [], [smoke]);
  replay.utility(64, .5, [], [{...smoke, holes: [{from: {...player.position}, to: {...source.frames[1].actors[0].position}, radius: 10, startedAt: .5, expiresAt: .8}]}]);
  source.utilities = replay.export().utilities;
  scene.show(source, undefined, .25); scene.camera(camera, undefined, false);
  const overlay = (scene as unknown as {overlay: Mesh}).overlay;
  const uniforms = (overlay.material as ShaderMaterial).uniforms;
  expect(uniforms.flash.value).toBeCloseTo(.65); expect(uniforms.smoke.value).toBe(0);
  expect(scene.utilityRenderer.smoke.count).toBe(1);
  scene.show(source, undefined, .6); scene.camera(camera, undefined, false); expect(uniforms.smoke.value).toBe(0);
  scene.show(source, undefined, .25); scene.camera(camera, undefined, false); expect(scene.utilityRenderer.smoke.count).toBe(1);
  scene.camera(camera, undefined, true); expect(overlay.visible).toBe(false); expect(scene.utilityRenderer.held.visible).toBe(false);
  scene.camera(camera, undefined, false, true); expect(overlay.visible).toBe(false);
  scene.clear(); expect(uniforms.flash.value).toBe(0); expect(uniforms.smoke.value).toBe(0);
  scene.dispose();
});

it('attaches native held grenades to replay hands, hides only visible firearms, and resamples throw poses on seeks', () => {
  const {scene, source, camera} = utilityPlayback(), replay = new CombatReplay(1), updateUtility = vi.fn();
  source.frames[0].actors[0].utility = 'he';
  source.frames[0].actors[0].utilityState = {kind: 'he', selectedAt: 0, readyAt: .35, primedAt: .1, strength: 0};
  replay.utilityEvent({kind: 'utility', tick: 64, actorId: 0, utility: 'he', action: 'throw', point: {x: 0, y: 1, z: 0}, strength: 0});
  source.utilities = replay.export().utilities;
  // Force a discrete release frame without interpolating the held state out early.
  source.frames[1].time = .5;
  scene.setActorFactory(() => {
    const root = new Group(), hand = new Group(), weapon = new Group(), hidden = new Group(); hand.name = 'hand_R';
    weapon.name = 'rifle'; hidden.name = 'hidden-native-rifle'; hidden.visible = false;
    root.add(hand, weapon, hidden);
    return {root, utilityMount: hand, weapons: [weapon, hidden], update: vi.fn(), updateUtility, dispose: vi.fn()};
  });
  scene.show(source, undefined, .2); scene.camera(camera, undefined, false);
  expect(scene.actors.children[0].getObjectByName('held-native-he')?.visible).toBe(true);
  expect(scene.actors.children[0].getObjectByName('rifle')?.visible).toBe(false);
  expect(scene.utilityRenderer.held.visible).toBe(true);
  expect(updateUtility).toHaveBeenCalledWith(expect.objectContaining({action: 'pullpin', startedAt: .1}), .2);
  source.frames[1].time = .7;
  scene.show(source, undefined, .6); scene.camera(camera, undefined, false);
  expect(scene.actors.children[0].getObjectByName('held-native-he')?.visible).toBe(false);
  source.frames[1].time = .5;
  scene.show(source, undefined, .6); scene.camera(camera, undefined, false);
  expect(scene.actors.children[0].getObjectByName('held-native-he')?.visible).toBe(false);
  expect(updateUtility).toHaveBeenCalledWith(expect.objectContaining({action: 'throw-low', startedAt: expect.closeTo(.4,7)}), .6);
  const viewWeapon = scene.utilityRenderer.held.children[0].children[0]; expect(viewWeapon.visible).toBe(false);
  scene.show(source, undefined, 1.5); scene.camera(camera, undefined, false);
  expect(scene.actors.children[0].getObjectByName('rifle')?.visible).toBe(true);
  expect(scene.actors.children[0].getObjectByName('hidden-native-rifle')?.visible).toBe(false);
  scene.show(source, undefined, .2); scene.camera(camera, undefined, false); expect(viewWeapon.visible).toBe(true);
  const held = scene.actors.children[0].getObjectByName('held-world-utility')!;
  scene.clear(); expect(held.parent).toBeNull();
  scene.dispose();
});

it('renders a separate native arm pass and full-viewport overlay, restores renderer state and disposes once', () => {
  const {scene, source, camera} = utilityPlayback();
  source.frames[0].actors[0].utility = 'he'; source.frames[0].actors[0].flashAmount = .7;
  scene.show(source, undefined, .1); scene.camera(camera, undefined, false);
  const viewport = new Vector4(3, 4, 800, 600), calls: unknown[] = [];
  const renderer = {autoClear: true, getViewport: (target: Vector4) => target.copy(viewport), clearDepth: vi.fn(),
    setViewport: vi.fn(), render: vi.fn((...args: unknown[]) => calls.push(args))} as unknown as WebGLRenderer;
  scene.renderUtilityView(renderer, 390, 844);
  expect(renderer.render).toHaveBeenCalledTimes(2); expect(renderer.setViewport).toHaveBeenCalledWith(0, 0, 390, 844);
  expect(renderer.setViewport).toHaveBeenLastCalledWith(viewport); expect(renderer.autoClear).toBe(true);
  const geometry = instance(scene, 'utility-fire').geometry, dispose = vi.fn(); geometry.addEventListener('dispose', dispose);
  scene.dispose(); scene.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
});

it('reconstructs idle native arm tracks identically on pause and after seeking away and back', () => {
  const source = recording(), scene = new PlaybackScene(), camera = new PerspectiveCamera();
  vi.spyOn(scene, 'prepareUtilities').mockResolvedValue();
  const arms = new Group(), tracked = new Group(); tracked.name = 'tracked'; arms.add(tracked);
  scene.utilityRenderer.installView('he', arms, ['draw', 'idle'].map(name => new AnimationClip(name, 1, [
    new VectorKeyframeTrack('tracked.position', [0, 1], name === 'draw' ? [1, 0, 0, 2, 0, 0] : [5, 0, 0, 5, 0, 0])])));
  for (const frame of source.frames) {frame.actors[0].utility = 'he'; frame.actors[0].utilityState = {kind: 'he', selectedAt: 0, readyAt: .35};}
  const show = (time: number) => {scene.show(source, undefined, time); scene.camera(camera, undefined, false); return tracked.position.x;};
  expect(show(.2)).toBeCloseTo(1.2);
  expect(show(2)).toBeCloseTo(5); expect(show(2)).toBeCloseTo(5);
  expect(show(.2)).toBeCloseTo(1.2); expect(show(2)).toBeCloseTo(5);
  scene.dispose();
});

it('renders optional grenade loot with native models and removes/restores it on pickup seeks', () => {
  const {scene, source, camera} = utilityPlayback(), replay = new CombatReplay(1);
  const drop = {id: 5, utility: 'he' as const, position: {x: 7, y: 2, z: -4}, picked: false};
  replay.utility(0, 0, [], [], true, [drop]); replay.utility(128, 1, [], [], true, [{...drop, picked: true}]);
  source.utilities = replay.export().utilities;
  scene.show(source, undefined, 0); scene.camera(camera, undefined, false);
  expect(scene.utilityRenderer.group.getObjectByName('utility-drop-5')?.position.toArray()).toEqual([7, 2, -4]);
  scene.show(source, undefined, 1); scene.camera(camera, undefined, false);
  expect(scene.utilityRenderer.group.getObjectByName('utility-drop-5')).toBeUndefined();
  scene.show(source, undefined, 0); scene.camera(camera, undefined, false);
  expect(scene.utilityRenderer.group.getObjectByName('utility-drop-5')).toBeDefined(); scene.dispose();
});

it('restores renderer state even when the native arm render throws', () => {
  const {scene, source, camera} = utilityPlayback(); source.frames[0].actors[0].utility = 'he';
  scene.show(source, undefined, .1); scene.camera(camera, undefined, false);
  const viewport = new Vector4(0, 0, 800, 600);
  const renderer = {autoClear: true, getViewport: (target: Vector4) => target.copy(viewport), clearDepth: vi.fn(),
    setViewport: vi.fn(), render: () => {throw new Error('test render failure');}} as unknown as WebGLRenderer;
  expect(() => scene.renderUtilityView(renderer, 800, 600)).toThrow('test render failure');
  expect(renderer.autoClear).toBe(true); expect(renderer.setViewport).toHaveBeenLastCalledWith(viewport); scene.dispose();
});
