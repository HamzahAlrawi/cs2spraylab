import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {Box3, Group, SkinnedMesh, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {parseKv3} from './kv3.mjs';

// Offline trainer QA: native mesh/clip sampling, never a game process or input.
globalThis.ProgressEvent ??= class {constructor(type, init) {Object.assign(this, init);}};
async function load(name) {
  const bytes = fs.readFileSync(`public/revamp/models/${name}.glb`), length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material;
  delete json.materials; delete json.textures; delete json.images;
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}

const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {DuelAnimator} = await vite.ssrLoadModule('/src/range/duel/animation.ts');
  const {actorHeadPoint, traceActor} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const {NativeActorHitboxes, nativeActorCapsules} = await vite.ssrLoadModule('/src/range/duel/actor-hitboxes.ts');
  const {advanceActor, idleInput, STEP} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const target = await load('target'), motion = await load('duel-motion');
  const native = parseKv3(fs.readFileSync('research/target-source.vmdl', 'utf8'));
  const hitboxes = native.rootNode.children.find(node => node._class === 'HitboxSetList').children[0].children;
  const nativeHead = hitboxes.find(box => box.parent_bone === 'head_0');
  const group = id => id === 1 ? 'head' : id === 3 ? 'stomach' : id === 4 || id === 5 ? 'arm' : id === 6 || id === 7 ? 'leg' : 'chest';
  assert.deepEqual(nativeActorCapsules, hitboxes.map(box => ({bone: box.parent_bone.replace(/_([lr])$/, (_, side) => `_${side.toUpperCase()}`),
    radius: box.radius, point0: box.point0, point1: box.point1, group: group(box.group_id), ...(box.group_id === 8 ? {neck: true} : {})})), 'Runtime capsule data must match extracted model');
  const root = new Group(), model = clone(target.scene); root.add(model);
  const animator = new DuelAnimator(model, motion.animations, 0, 'ak47');
  root.updateMatrixWorld(true); const physical = new NativeActorHitboxes(model);
  const samples = [], vertex = new Vector3();
  const headMeshes = [];
  model.traverse(mesh => {
    if (!(mesh instanceof SkinnedMesh)) return;
    const head = mesh.skeleton.bones.findIndex(bone => bone.name === 'head_0');
    const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
    const selected = [];
    for (let i = 0; i < indices.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++) if (indices.getComponent(i, j) === head) weight += weights.getComponent(i, j);
      if (weight > .75) selected.push(i);
    }
    if (selected.length) headMeshes.push({mesh, selected});
  });
  const profiles = [
    {name: 'idle', speed: 0, forward: false, airborne: false},
    {name: 'walk-strafe', speed: 136, forward: false, airborne: false},
    {name: 'run-strafe', speed: 225, forward: false, airborne: false},
    {name: 'run-forward', speed: 225, forward: true, airborne: false},
    {name: 'jump', speed: 225, forward: true, airborne: true},
  ];
  for (const duck of [0, .25, .5, .75, 1]) for (const yaw of [0, .8, Math.PI / 2, Math.PI])
    for (const pitch of [0, -.6, .6]) for (const profile of profiles) for (let frame = 0; frame < 30; frame++) {
      const feet = {x: 0, y: profile.airborne ? .7 : 0, z: -15};
      const a = {id: 1, generation: 1, side: 'enemy', position: {...feet, y: feet.y + 64 * .0254}, feet: feet.y,
        velocity: profile.forward ? {x: -Math.sin(yaw) * profile.speed * .0254, z: -Math.cos(yaw) * profile.speed * .0254}
          : {x: Math.cos(yaw) * profile.speed * .0254, z: -Math.sin(yaw) * profile.speed * .0254},
        yaw, pitch, crouched: duck > .5, duckAmount: duck, grounded: !profile.airborne,
        health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false};
      root.position.set(feet.x, feet.y, feet.z); root.rotation.y = yaw - Math.PI;
      animator.update(a, 1 / 60); root.updateMatrixWorld(true);
      const head = model.getObjectByName('head_0').getWorldPosition(new Vector3());
      const bounds = new Box3();
      for (const {mesh, selected} of headMeshes) {
        mesh.skeleton.update();
        for (const i of selected) bounds.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld));
      }
      const visibleCenter = bounds.getCenter(new Vector3()), anchor = new Vector3().copy(actorHeadPoint(feet, duck, yaw));
      const bone = model.getObjectByName('head_0'), point0 = new Vector3(...nativeHead.point0).multiplyScalar(.0254).applyMatrix4(bone.matrixWorld),
        point1 = new Vector3(...nativeHead.point1).multiplyScalar(.0254).applyMatrix4(bone.matrixWorld), capsuleCenter = point0.clone().add(point1).multiplyScalar(.5);
      const origin = new Vector3(0, 64 * .0254, 0), direction = visibleCenter.clone().sub(origin).normalize();
      const hit = traceActor(origin, direction, feet, duck, Infinity, yaw);
      const nativeHit = traceActor(origin, direction, feet, duck, Infinity, yaw, physical.capture());
      const nativeHeadHit = traceActor(origin, direction, feet, duck, Infinity, yaw, {capsules: physical.pose.capsules.filter(capsule => capsule.group === 'head')});
      samples.push({duck, yaw, pitch, profile: profile.name, frame, hit: hit.group ?? 'miss',
        nativeHit: nativeHit.group ?? 'miss',
        nativeHeadHit: nativeHeadHit.group ?? 'miss',
        headBoneError: head.distanceTo(anchor), visibleHeadError: visibleCenter.distanceTo(anchor),
        nativeCenterError: visibleCenter.distanceTo(capsuleCenter), nativeHead: [point0.toArray(), point1.toArray(), nativeHead.radius * .0254],
        head: head.toArray(), visibleCenter: visibleCenter.toArray(), bounds: [bounds.min.toArray(), bounds.max.toArray()]});
    }
  const byProfile = {};
  for (const s of samples) {
    const key = `${s.profile}/pitch=${s.pitch}`;
    const group = byProfile[key] ??= {cases: 0, centerMisses: 0, nativeCenterMisses: 0, maxBoneError: 0, maxVisibleCenterError: 0, maxNativeCenterError: 0};
    group.cases++; if (s.hit !== 'head') group.centerMisses++;
    if (s.nativeHit !== 'head') group.nativeCenterMisses++;
    group.maxBoneError = Math.max(group.maxBoneError, s.headBoneError);
    group.maxVisibleCenterError = Math.max(group.maxVisibleCenterError, s.visibleHeadError);
    group.maxNativeCenterError = Math.max(group.maxNativeCenterError, s.nativeCenterError);
  }
  const visualSync = [];
  for (const profile of ['duck-transition', 'quick-pitch-change', 'jump-duck']) {
    const exactRoot = new Group(), renderedRoot = new Group(), exactModel = clone(target.scene), renderedModel = clone(target.scene);
    exactRoot.add(exactModel); renderedRoot.add(renderedModel);
    const exact = new DuelAnimator(exactModel, motion.animations, 0, 'ak47'), rendered = new DuelAnimator(renderedModel, motion.animations, 0, 'ak47');
    const exactCapsules = new NativeActorHitboxes(exactModel), renderedCapsules = new NativeActorHitboxes(renderedModel);
    let kinematics = {position: {x: 0, y: 64 * .0254, z: -15}, velocity: {x: 0, z: 0}, yaw: .8, feet: 0,
      verticalVelocity: 0, eyeHeight: 64 * .0254, jumpHeld: false, grounded: true};
    let last = -1, maxGap = 0, worst;
    for (let frame = 0; frame < 128; frame++) {
      const time = frame * STEP, input = {...idleInput(), crouch: profile !== 'quick-pitch-change' && time >= .1 && time < .65,
        jump: profile === 'jump-duck' && frame === 13};
      kinematics = advanceActor(kinematics, input, 225 * .0254, STEP);
      const pitch = profile === 'quick-pitch-change' ? .6 * Math.max(0, Math.min(1, (time - .1) / .05)) : 0;
      const a = {...kinematics, id: 1, generation: 1, side: 'enemy', yaw: .8, pitch,
        crouched: (kinematics.duckAmount ?? 0) > .5, health: 100, armor: 100, helmet: true,
        alive: true, equipment: 'ak47', ammo: 30, reloading: false};
      for (const root of [exactRoot, renderedRoot]) {
        root.position.set(a.position.x, a.feet, a.position.z); root.rotation.y = a.yaw - Math.PI;
      }
      exact.update(a, STEP); exactRoot.updateMatrixWorld(true);
      if (last < 0 || time - last >= 1 / 30) {rendered.update(a, last < 0 ? STEP : time - last); last = time;}
      renderedRoot.updateMatrixWorld(true); exactCapsules.capture(); renderedCapsules.capture();
      const gap = new Vector3().copy(exactCapsules.headPoint()).distanceTo(new Vector3().copy(renderedCapsules.headPoint()));
      if (gap > maxGap) {maxGap = gap; worst = {time, duck: a.duckAmount, pitch, grounded: a.grounded, gap};}
    }
    visualSync.push({profile, animationRate: 30, maxHeadGap: maxGap, worst}); exact.dispose(); rendered.dispose();
  }
  const report = {cases: samples.length, byProfile,
    visualSync,
    worst: samples.toSorted((a, b) => b.visibleHeadError - a.visibleHeadError).slice(0, 15),
    limits: 'Mesh bounds exclude head vertices with <=75% head-bone weight; analytic zones are not native animated hitboxes.'};
  if (process.env.ACTOR_POSE_REPORT) fs.writeFileSync(process.env.ACTOR_POSE_REPORT, JSON.stringify({...report, samples}, null, 2));
  if (process.argv.includes('--assert')) assert.equal(samples.filter(sample => sample.nativeHeadHit !== 'head').length, 0, 'Visible head centers must intersect native animated head capsule');
  console.log(JSON.stringify(report, null, 2)); animator.dispose();
} finally {await vite.close();}
