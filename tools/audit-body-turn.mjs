import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createServer} from 'vite';
import {Group, Matrix4, Quaternion, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

// Offline native rig audit only. Assets stay local; no game process is accessed.
globalThis.ProgressEvent ??= class {constructor(type, init) {Object.assign(this, init);}};
const hashes = {};
async function load(name) {
  const bytes = fs.readFileSync(`public/revamp/models/${name}.glb`), length = bytes.readUInt32LE(12);
  hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material;
  delete json.materials; delete json.textures; delete json.images;
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
try {
  const {DuelAnimator, nativeGestureClips} = await vite.ssrLoadModule('/src/range/duel/animation.ts');
  const {NativeActorHitboxes} = await vite.ssrLoadModule('/src/range/duel/actor-hitboxes.ts');
  const target = await load('target'), motion = await load('duel-motion');
  const mounts = JSON.parse(fs.readFileSync('src/range/weapon-mounts.json', 'utf8'));
  let frames = 0, maxAimRadians = 0, maxGripDelta = 0, maxFootDelta = 0, maxDuplicateRadians = 0, maxHitPoseDelta = 0;
  for (const equipment of ['ak47', 'm4a1s', 'usp']) {
    const gun = equipment === 'm4a1s' ? undefined : await load(equipment), gestures = nativeGestureClips(await load(`duel-gestures/${equipment}`));
    const make = () => {
      const root = new Group(), model = clone(target.scene); root.add(model); let held = model.getObjectByName('held_weapon_target001') ?? model.getObjectByName('held_weapon_target.001');
      if (gun) {
        held.visible = false; held = clone(gun.scene);
        new Matrix4().fromArray(mounts.mounts[equipment].inverseBind).decompose(held.position, held.quaternion, held.scale);
        model.getObjectByName('wpn').add(held);
      }
      const animator = new DuelAnimator(model, motion.animations, .25, equipment); animator.addGestureClips(gestures);
      return {root, model, held, animator};
    };
    const base = make(), aimed = make();
    const hitboxes = new NativeActorHitboxes(aimed.model);
    const actor = {id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 1.6256, z: 0}, feet: 0,
      velocity: {x: 0, z: 0}, yaw: .4, pitch: 0, crouched: false, duckAmount: 0, grounded: true,
      health: 100, armor: 100, helmet: true, alive: true, equipment, ammo: 30, reloading: false};
    for (const residual of [-.7, -.35, .35, .7]) for (const duck of [0, 1]) for (let direction = 0; direction < 8; direction++) {
      for (let n = 0; n < 32; n++) {
        const bodyYaw = .4, angle = direction * Math.PI / 4;
        actor.velocity = {x: Math.sin(angle) * (duck ? 1.85 : 5.46), z: -Math.cos(angle) * (duck ? 1.85 : 5.46)};
        actor.duckAmount = duck; actor.crouched = duck > 0; actor.pitch = Math.sin(n / 31 * Math.PI * 2) * .5;
        for (const pair of [base, aimed]) pair.root.rotation.y = bodyYaw - Math.PI;
        base.animator.update({...actor, yaw: bodyYaw}, 1 / 60, undefined, {bodyYaw});
        aimed.animator.update({...actor, yaw: bodyYaw + residual}, 1 / 60, undefined, {bodyYaw});
        base.root.updateMatrixWorld(true); aimed.root.updateMatrixWorld(true);
        const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), residual);
        for (const name of ['head_0', 'hand_R', 'hand_L']) {
          const expected = base.model.getObjectByName(name).getWorldQuaternion(new Quaternion()).premultiply(yaw).normalize();
          maxAimRadians = Math.max(maxAimRadians, expected.angleTo(aimed.model.getObjectByName(name).getWorldQuaternion(new Quaternion()).normalize()));
        }
        for (const name of ['ankle_L', 'ankle_R', 'ball_L', 'ball_R']) maxFootDelta = Math.max(maxFootDelta,
          base.model.getObjectByName(name).getWorldPosition(new Vector3()).distanceTo(aimed.model.getObjectByName(name).getWorldPosition(new Vector3())));
        const grip = pair => new Matrix4().copy(pair.model.getObjectByName('hand_R').matrixWorld).invert().multiply(pair.held.matrixWorld);
        const a = grip(base), b = grip(aimed); maxGripDelta = Math.max(maxGripDelta, ...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
        const before = aimed.model.getObjectByName('head_0').getWorldQuaternion(new Quaternion()).normalize();
        const visibleHitPose = structuredClone(hitboxes.capture());
        aimed.animator.update({...actor, yaw: bodyYaw + residual}, 0, undefined, {bodyYaw});
        aimed.root.updateMatrixWorld(true);
        maxDuplicateRadians = Math.max(maxDuplicateRadians, before.angleTo(aimed.model.getObjectByName('head_0').getWorldQuaternion(new Quaternion()).normalize()));
        hitboxes.capture().capsules.forEach((capsule, i) => {
          for (const point of ['point0', 'point1']) maxHitPoseDelta = Math.max(maxHitPoseDelta,
            new Vector3().copy(capsule[point]).distanceTo(visibleHitPose.capsules[i][point]));
        });
        frames++;
      }
    }
    base.animator.dispose(); aimed.animator.dispose();
  }
  const report = {schema: 1, evidence: 'Offline native rig pose evaluation, not manually captured CS2 trajectories or native graph parity',
    hashes, frames, maxAimDegrees: maxAimRadians * 180 / Math.PI, maxGripDelta, maxFootDelta, maxDuplicateRadians, maxHitPoseDelta,
    tolerances: {aimRadians: 1e-6, gripMatrixDelta: 1e-5, footMetres: 1e-7}};
  if (process.env.BODY_TURN_REPORT) fs.writeFileSync(process.env.BODY_TURN_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert.ok(maxAimRadians < 1e-6, 'Aim residual contribution differs');
  assert.ok(maxGripDelta < 1e-5, 'Mounted hand relationship differs');
  assert.ok(maxFootDelta < 1e-7, 'Aim layer changed feet');
  assert.ok(maxDuplicateRadians < 1e-6, 'Duplicate shot query changed pose');
  assert.ok(maxHitPoseDelta < 1e-7, 'Duplicate shot query changed hit capsules');
} finally {await vite.close();}
