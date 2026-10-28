import * as THREE from 'three';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {UtilityRenderer, utilityFlashOpacity, UTILITY_PRESENTATION_BOUNDS} from './utility-render';
import {UTILITY_RULES, type UtilityEffect, type UtilityProjectile} from './utilities';
import {utilityKinds} from './utility-loadout';
import particles from './utility-particles-native.json';
import audit from '../../../docs/utility-active-resource-audit-2026-10-26.json';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const renderers: UtilityRenderer[] = [];
afterEach(() => {for (const renderer of renderers) renderer.dispose(); renderers.length = 0;});
const setup = () => {
  const world = new THREE.Group(), view = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  const renderer = new UtilityRenderer(world, view); renderers.push(renderer);
  for (const kind of utilityKinds) {
    const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry(.06, .12, .06), new THREE.MeshStandardMaterial()));
    renderer.installWorld(kind, model, model.clone(true));
    const arms = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.06, .12, .06), new THREE.MeshStandardMaterial());
    body.userData.native_view_weapon = `utility-${kind}`; arms.add(body);
    renderer.installView(kind, arms, ['idle', 'draw', 'inspect', 'pullpin', 'hold-high', 'hold-mid', 'hold-low', 'throw-high', 'throw-low']
      .map(name => new THREE.AnimationClip(name, 1, [])));
  }
  return {renderer, world, view, camera};
};
const effect = (patch: Partial<UtilityEffect> = {}): UtilityEffect => ({id: 1, actorId: 0, side: 'player', kind: 'smoke',
  type: 'smoke', position: {x: 2, y: 1, z: -4}, radius: 4.2, startedAt: 0, expiresAt: 20,
  cells: [{x: 2, y: 1, z: -4}, {x: 2.8, y: 1, z: -4}], holes: [], ...patch});
const projectile = (patch: Partial<UtilityProjectile> = {}): UtilityProjectile => ({id: 1, actorId: 0, side: 'player', kind: 'he',
  position: {x: 1, y: 2, z: -3}, velocity: {x: 0, y: 0, z: 0}, radius: .05, thrownAt: 0, resting: false, bounces: 0, ...patch});
const instance = (root: THREE.Group, name: string) => root.getObjectByName(name) as THREE.InstancedMesh;

describe('bounded utility presentation', () => {
  it('keeps projectiles at kernel world positions independently of camera motion', () => {
    const {renderer, camera} = setup(), shot = projectile();
    renderer.update([shot], [], .1, camera);
    const mesh = instance(renderer.group, 'utility-projectiles-he'), matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    expect(mesh.count).toBe(1); mesh.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
    expect(position.toArray()).toEqual([1, 2, -3]);
    const buffer = mesh.instanceMatrix.array;
    camera.position.set(-12, 7, 8); camera.rotation.y = 1;
    renderer.update([shot], [], .2, camera); mesh.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
    expect(position.toArray()).toEqual([1, 2, -3]);
    expect(mesh.instanceMatrix.array).toBe(buffer);
    expect(shot.position).toEqual({x: 1, y: 2, z: -3});
  });

  it('uses retained instanced billboards and clears expired clouds without spawning meshes', () => {
    const {renderer, camera} = setup(), cloud = effect();
    const smoke = instance(renderer.group, 'utility-smoke'), children = renderer.group.children.length;
    const opacity = smoke.geometry.getAttribute('instanceOpacity');
    renderer.update([], [cloud], .5, camera);
    expect(smoke.count).toBeGreaterThan(0);
    const partial = opacity.getX(0);
    renderer.update([], [cloud], 1.5, camera);
    expect(opacity.getX(0)).toBeGreaterThan(partial);
    expect(smoke.geometry.getAttribute('instanceOpacity')).toBe(opacity);
    expect(renderer.group.children).toHaveLength(children);
    renderer.update([], [cloud], 20, camera);
    expect(smoke.count).toBe(0);
  });

  it('occludes the interior, respects cleared holes, and does not white-flash from smoke', () => {
    const {renderer, camera} = setup(), cloud = effect(); camera.position.copy(cloud.position);
    renderer.update([], [cloud], 2, camera);
    expect(renderer.interiorSmokeOpacity).toBeCloseTo(.985);
    const cleared = {...cloud, holes: [{from: {x: 2, y: 1, z: -8}, to: {x: 2, y: 1, z: 0}, radius: 1, startedAt: 1, expiresAt: 3}]};
    renderer.update([], [cleared], 2, camera);
    expect(renderer.interiorSmokeOpacity).toBe(0);
    expect(instance(renderer.group, 'utility-burst').count).toBe(0);
  });

  it('renders ground fire only at supplied cells and retains a deployed decoy', () => {
    const {renderer, camera} = setup();
    const fire = effect({type: 'fire', kind: 'molotov', cells: [{x: 4, y: 2, z: -5}, {x: 6, y: 2, z: -5}]});
    renderer.update([], [fire, effect({type: 'decoy', kind: 'decoy'})], 2, camera);
    const mesh = instance(renderer.group, 'utility-fire'), matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    expect(mesh.count).toBe(2); mesh.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
    expect(position.x).toBe(4); expect(position.z).toBe(-5); expect(position.y).toBeGreaterThan(2);
    expect(instance(renderer.group, 'utility-projectiles-decoy').count).toBe(1);
  });

  it('bounds over-capacity snapshots and shows short-lived HE flashes', () => {
    const {renderer, camera} = setup();
    renderer.update(Array.from({length: UTILITY_RULES.maxProjectiles + 10}, () => projectile()), [effect({type: 'burst', kind: 'he', expiresAt: .25})], .1, camera);
    expect(instance(renderer.group, 'utility-projectiles-he').count).toBe(UTILITY_RULES.maxProjectiles);
    expect(instance(renderer.group, 'utility-burst').count).toBe(0);
    expect(instance(renderer.group, 'utility-he-burst').count).toBe(1);
    renderer.update([], [], .3, camera); expect(instance(renderer.group, 'utility-he-burst').count).toBe(0);
  });

  it('switches distinct native assemblies, hides them for guns/death, and disposes once', () => {
    const {renderer, world, view} = setup();
    expect(world.children).toContain(renderer.group); expect(view.children).toContain(renderer.held);
    const he = renderer.held.children[0] as THREE.Group, molotov = renderer.held.children[3] as THREE.Group;
    const geometry = (he.children[0] as THREE.Mesh).geometry;
    renderer.updateHeld('he', true, 0); expect(renderer.held.visible).toBe(true);
    expect(he.visible).toBe(true);
    renderer.updateHeld('molotov', true, 1); expect(he.visible).toBe(false); expect(molotov.visible).toBe(true);
    expect(molotov.scale.y).toBe(1);
    renderer.updateHeld(undefined, true, 2); expect(renderer.held.visible).toBe(false);
    renderer.updateHeld('he', false, 2); expect(renderer.held.visible).toBe(false);
    const disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    renderer.dispose(); renderer.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
    expect(world.children).not.toContain(renderer.group); expect(view.children).not.toContain(renderer.held);
  });

  it('shares bot-held geometry and releases it without disposing other actors resources', () => {
    const {renderer} = setup(), hand = new THREE.Group();
    const first = renderer.createWorldHeld(hand), second = renderer.createWorldHeld(hand);
    const mesh = (root: THREE.Group) => root.getObjectByName('held-native-he')!.children[0] as THREE.Mesh;
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    renderer.updateWorldHeld(first, 'he', true); expect(first.visible).toBe(true);
    renderer.updateWorldHeld(first, undefined, true); expect(first.visible).toBe(false);
    renderer.releaseWorldHeld(first); expect(first.parent).toBeNull();
    expect(second.parent).toBe(hand);
    renderer.dispose(); expect(second.parent).toBeNull();
  });

  it('does not substitute primitives while native assets are unavailable', () => {
    const renderer = new UtilityRenderer(new THREE.Group(), new THREE.Group()); renderers.push(renderer);
    renderer.updateHeld('he', true, 1);
    expect(renderer.held.visible).toBe(false); expect(renderer.held.children).toHaveLength(0);
  });

  it('retains only arms after release and restores the grenade on a subsequent equip', () => {
    const {renderer} = setup();
    renderer.updateHeld('he', true, 0); renderer.throw('he', 1);
    renderer.updateHeld(undefined, true, 1.2);
    expect(renderer.held.visible).toBe(true);
    expect((renderer.held.children[0] as THREE.Group).children[0].visible).toBe(false);
    renderer.updateHeld(undefined, true, 2); expect(renderer.held.visible).toBe(false);
    renderer.updateHeld('he', true, 2.1); expect((renderer.held.children[0] as THREE.Group).children[0].visible).toBe(true);
  });

  it('clamps flash exposure and clears it exactly as the simulation decay reaches zero', () => {
    expect(utilityFlashOpacity(1)).toBe(1); expect(utilityFlashOpacity(.3)).toBe(.3);
    expect(utilityFlashOpacity(0)).toBe(0); expect(utilityFlashOpacity(9)).toBe(1);
    expect(utilityFlashOpacity(-1)).toBe(0); expect(utilityFlashOpacity(NaN)).toBe(0);
  });
  it('renders only reachable smoke cells, never a spherical fallback or behind-wall interior overlay', () => {
    const {renderer, camera} = setup();
    const cloud = effect({position: {x: 0, y: 0, z: 0}, cells: [{x: 0, y: 0, z: 0}, {x: .8, y: 0, z: 0}]});
    camera.position.set(-.8, 0, 0); renderer.update([], [cloud], 2, camera);
    expect(renderer.interiorSmokeOpacity).toBe(0);
    const mesh = instance(renderer.group, 'utility-smoke'), matrix = new THREE.Matrix4();
    expect(mesh.count).toBe(2); mesh.getMatrixAt(1, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBeCloseTo(.8);
    camera.position.set(0, 0, 0); renderer.update([], [cloud], 2, camera); expect(renderer.interiorSmokeOpacity).toBe(.985);
    renderer.update([], [{...cloud, cells: []}], 2, camera);
    expect(mesh.count).toBe(0); expect(renderer.interiorSmokeOpacity).toBe(0);
    const cells = Array.from({length: 729}, (_, i) => ({x: (i % 9 - 4) * .8,
      y: (Math.floor(i / 9) % 9 - 4) * .8, z: (Math.floor(i / 81) - 4) * .8}))
      .filter(cell => Math.hypot(cell.x, cell.y, cell.z) <= 4)
      .map(cell => ({x: cell.x + 2, y: cell.y + 1, z: cell.z - 4}));
    renderer.update([], Array.from({length: 64}, (_, id) => effect({id, cells})), 2, camera);
    expect(mesh.count).toBe(UTILITY_PRESENTATION_BOUNDS.smokePuffs);
  });
  it('reconciles bounded native loot clones without mutating positions or disposing shared GPU resources', () => {
    const {renderer} = setup();
    const drop = {id: 11, utility: 'he' as const, position: {x: 1, y: 2, z: 3}, picked: false};
    renderer.syncDrops([drop]); const root = renderer.group.getObjectByName('utility-drop-11')!;
    expect(root.position.toArray()).toEqual([1, 2, 3]);
    const meshes: THREE.Mesh[] = []; root.traverse(o => {if (o instanceof THREE.Mesh) meshes.push(o);});
    const geometry = meshes[0].geometry, disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    renderer.syncDrops([drop]); expect(renderer.group.getObjectByName('utility-drop-11')).toBe(root);
    renderer.syncDrops([{...drop, picked: true}]); expect(root.parent).toBeNull(); expect(disposed).not.toHaveBeenCalled();
    renderer.syncDrops(Array.from({length: 100}, (_, id) => ({...drop, id})));
    expect(renderer.group.children.filter(o => o.name.startsWith('utility-drop-'))).toHaveLength(64);
    renderer.syncDrops([]); expect(renderer.group.children.some(o => o.name.startsWith('utility-drop-'))).toBe(false);
    renderer.syncDrops([drop]); renderer.clear(); expect(renderer.group.getObjectByName('utility-drop-11')).toBeUndefined();
    expect(drop.position).toEqual({x: 1, y: 2, z: 3}); renderer.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
    renderer.syncDrops([drop]); expect(renderer.group.children).toHaveLength(0);
  });
  it('uses native frame attributes, anchored flames and a fading billboard burst rather than a sphere', () => {
    const {renderer, camera} = setup();
    const fire = effect({type: 'fire', kind: 'molotov', cells: [{x: 4, y: 0, z: -5}]});
    renderer.update([], [fire, effect({type: 'burst', kind: 'flash', expiresAt: .25})], .1, camera);
    const mesh = instance(renderer.group, 'utility-fire'), frame = mesh.geometry.getAttribute('instanceFrame').getX(0);
    const burst = instance(renderer.group, 'utility-burst'), alpha = burst.geometry.getAttribute('instanceOpacity').getX(0);
    expect(burst.geometry.type).toBe('PlaneGeometry'); expect(alpha).toBeGreaterThan(0);
    renderer.update([], [fire, effect({type: 'burst', kind: 'flash', expiresAt: .25})], .2, camera);
    expect(mesh.geometry.getAttribute('instanceFrame').getX(0)).not.toBe(frame);
    expect(burst.geometry.getAttribute('instanceOpacity').getX(0)).toBeLessThan(alpha);
  });
  it('loads each native atlas once and disposes completed and late textures exactly once', async () => {
    const textures = Array.from({length: 4}, () => new THREE.Texture()), disposals = textures.map(texture => {
      const dispose = vi.fn(); texture.addEventListener('dispose', dispose); return dispose;
    });
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync');
    try {
      textures.forEach(texture => loader.mockResolvedValueOnce(texture));
      const {renderer} = setup(); await renderer.prepareParticles(); await renderer.prepareParticles();
      expect(loader).toHaveBeenCalledTimes(4);
      const names = ['utility-smoke', 'utility-fire', 'utility-burst', 'utility-he-burst'];
      Object.values(particles.assets).forEach((asset, index) => {
        // In particular the embedded HE URI must reach TextureLoader without a public-path prefix.
        expect(loader).toHaveBeenNthCalledWith(index + 1, asset.url);
        const material = instance(renderer.group, names[index]).material as THREE.ShaderMaterial;
        expect(material.uniforms.atlas.value).toBe(textures[index]);
        expect(textures[index].colorSpace).toBe(THREE.NoColorSpace);
        expect(textures[index].generateMipmaps).toBe(false);
      });
      expect(particles.assets.he.url).toMatch(/^data:image\/webp;base64,/);
      renderer.dispose(); renderer.dispose();
      disposals.forEach(disposed => expect(disposed).toHaveBeenCalledTimes(1));
      const late = new UtilityRenderer(new THREE.Group(), new THREE.Group()); renderers.push(late);
      // Resolve all four jobs independently after destruction.
      const resolves: ((texture: THREE.Texture) => void)[] = [];
      loader.mockImplementation(() => new Promise(resolve => {resolves.push(resolve);}));
      const job = late.prepareParticles(); late.dispose();
      const lateTextures = resolves.map(() => new THREE.Texture()), disposed = vi.fn();
      lateTextures.forEach(texture => texture.addEventListener('dispose', disposed));
      resolves.forEach((resolve, i) => resolve(lateTextures[i])); await job;
      expect(disposed).toHaveBeenCalledTimes(4);
    } finally {loader.mockRestore();}
  });
  it('keeps failed atlases transparent without preventing the embedded HE core from loading', async () => {
    const {renderer} = setup(), heTexture = new THREE.Texture();
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async url => {
      if (url === particles.assets.he.url) return heTexture;
      throw new Error('Unavailable atlas');
    });
    try {
      await renderer.prepareParticles();
      for (const name of ['utility-smoke', 'utility-fire', 'utility-burst']) {
        const material = instance(renderer.group, name).material as THREE.ShaderMaterial;
        expect(Array.from((material.uniforms.atlas.value as THREE.DataTexture).image.data)).toEqual([0, 0, 0, 0]);
      }
      expect((instance(renderer.group, 'utility-he-burst').material as THREE.ShaderMaterial).uniforms.atlas.value).toBe(heTexture);
    } finally {loader.mockRestore();}
  });
  it('keeps flash radius fixed and HE in a separate native-texture core pool', () => {
    const {renderer, camera} = setup(), matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
    const flash = effect({type: 'burst', kind: 'flash', expiresAt: 10});
    const he = effect({type: 'burst', kind: 'he', expiresAt: 10});
    const flashMesh = instance(renderer.group, 'utility-burst'), heMesh = instance(renderer.group, 'utility-he-burst');
    renderer.update([], [flash, he], .05, camera);
    expect(flashMesh.count).toBe(1); expect(heMesh.count).toBe(1);
    flashMesh.getMatrixAt(0, matrix); scale.setFromMatrixScale(matrix);
    expect(scale.x).toBeCloseTo(256 * 2 * .0254);
    const flashSize = scale.x;
    renderer.update([], [flash, he], .2, camera); flashMesh.getMatrixAt(0, matrix); scale.setFromMatrixScale(matrix);
    expect(scale.x).toBeCloseTo(flashSize);
    heMesh.getMatrixAt(0, matrix); scale.setFromMatrixScale(matrix);
    expect(scale.x).toBeCloseTo(2.5 * (10 + 5 * .2 / .25) * 6 * 2 * .0254);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([2, 1, -4]);
    const material = heMesh.material as THREE.ShaderMaterial;
    expect(material.uniforms.mode.value).toBe(3);
    expect(material.uniforms.tint.value.toArray()).toEqual([254 / 255, 158 / 255, 94 / 255]);
    renderer.update([], [flash, he], .25, camera);
    expect(flashMesh.count).toBe(0); expect(heMesh.count).toBe(0);
    expect(material.fragmentShader).not.toContain('color *= vec3(1.5,0.88,0.42)');
  });
  it('applies only supplied dropped-model presentation scales, without scaling flying geometry', () => {
    const {renderer, camera} = setup();
    renderer.syncDrops([{id: 1, utility: 'smoke', position: {x: 1, y: 2, z: 3}},
      {id: 2, utility: 'molotov', position: {x: 3, y: 2, z: 1}}]);
    const drop = renderer.group.getObjectByName('utility-drop-1')!;
    expect(drop.children[0].scale.toArray()).toEqual([1.7, 1.7, 1.7]);
    expect(new THREE.Box3().setFromObject(drop).min.y).toBeCloseTo(2);
    expect(renderer.group.getObjectByName('utility-drop-2')!.children[0].scale.x).toBe(1);
    renderer.update([projectile()], [], .1, camera);
    const matrix = new THREE.Matrix4(); instance(renderer.group, 'utility-projectiles-he').getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(1);
  });
  it('applies all six audited loot scales without changing held templates or compounding on reconciliation', () => {
    const {renderer} = setup(), held = renderer.createWorldHeld(new THREE.Group());
    const drops = utilityKinds.map((utility, id) => ({id, utility, position: {x: id, y: 2, z: -3}}));
    renderer.syncDrops(drops); renderer.syncDrops(drops);
    for (const {id, utility} of drops) {
      const drop = renderer.group.getObjectByName(`utility-drop-${id}`)!;
      const expected = particles.nativeParameters.droppedModelScale[utility] ?? 1;
      expect(drop.children[0].scale.toArray()).toEqual([expected, expected, expected]);
      expect(drop.position.toArray()).toEqual([id, 2, -3]);
      expect(new THREE.Box3().setFromObject(drop).min.y).toBeCloseTo(2);
      expect(held.getObjectByName(`held-native-${utility}`)!.scale.toArray()).toEqual([1, 1, 1]);
    }
  });
});

describe('static presentation evidence', () => {
  it('verifies every shipped atlas and links particle hashes to the independent resource audit', () => {
    for (const asset of Object.values(particles.assets)) {
      const bytes = asset.url.startsWith('data:') ? Buffer.from(asset.url.split(',')[1], 'base64') : readFileSync(`public/revamp${asset.url}`);
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      const source = audit.resources[asset.particle as keyof typeof audit.resources];
      expect(source.compiledSha256).toBe(asset.particleCompiledSha256);
    }
    expect(particles.assets.he.texture).not.toBe(particles.assets.flash.texture);
    expect(particles.nativeParameters.droppedModelScale.molotov).toBeNull();
    expect(particles.assets.smoke.sourceRole).toContain('legacy-s1');
    expect(particles.assets.fire.sourceRole).toContain('single-legacy-component');
  });
  it('derives flash, HE and dropped scales from the audited resources rather than unrelated flare defaults', () => {
    expect(particles.audit.archiveDirectorySha256).toBe(audit.archiveDirectorySha256);
    expect(particles.audit.viewerSha256).toBe(audit.viewerSha256);
    const flash = audit.resources['particles/explosions_fx/explosion_flashbang.vpcf_c'].parameters;
    const he = audit.resources['particles/explosions_fx/explosion_hegrenade.vpcf_c'].parameters;
    const life = (parameters: {m_Initializers: unknown[]}) =>
      (parameters.m_Initializers as {m_nOutputField?: number; m_InputValue?: {m_flLiteralValue?: number}}[])
        .find(op => op.m_nOutputField === 1)!.m_InputValue!.m_flLiteralValue;
    expect(particles.nativeParameters.flash).toEqual({radiusSourceUnits: flash.m_flConstantRadius, lifetimeSeconds: life(flash)});
    const radius = he.m_Initializers.find(op => op._class === 'C_INIT_InitFloat' && !('m_nOutputField' in op))!.m_InputValue!;
    const scale = he.m_Operators.find(op => op._class === 'C_OP_InterpolateRadius')!;
    expect(particles.nativeParameters.he).toEqual({root: 'particles/explosions_fx/explosion_basic.vpcf_c',
      color: he.m_ConstantColor.slice(0, 3), lifetimeSeconds: life(he), radiusMin: radius.m_flRandomMin,
      radiusMax: radius.m_flRandomMax, startScale: scale.m_flStartScale, endScale: scale.m_flEndScale,
      radiusScale: he.m_Renderers[0].m_flRadiusScale.m_flLiteralValue,
      overbright: he.m_Renderers[0].m_flOverbrightFactor.m_flLiteralValue});
    expect(audit.resources['particles/explosions_fx/explosion_basic.vpcf_c'].parameters.m_Children)
      .toContainEqual({m_ChildRef: particles.assets.he.particle.replace(/_c$/, '')});
    const names = {he: 'weapon_hegrenade', flash: 'weapon_flashbang', smoke: 'weapon_smokegrenade',
      molotov: 'weapon_molotov', incendiary: 'weapon_incgrenade', decoy: 'weapon_decoy'} as const;
    for (const kind of utilityKinds) {
      const weapon = audit.weaponSchema[names[kind]];
      expect(particles.nativeParameters.droppedModelScale[kind]).toBe('m_flDroppedModelScale' in weapon ? weapon.m_flDroppedModelScale : null);
    }
  });
});
