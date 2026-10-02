import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {Matrix4, Mesh, SkinnedMesh, Triangle, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class {constructor(type, init) {Object.assign(this, init);}};
async function load(id) {
  const bytes = fs.readFileSync(`public/revamp/models/${id}.glb`), length = bytes.readUInt32LE(12);
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
  const {DuelSimulation} = await vite.ssrLoadModule('/src/range/duel/simulation.ts');
  const mounts = JSON.parse(fs.readFileSync('src/range/weapon-mounts.json')).mounts;
  const {animations} = await load('duel-motion');
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(mounts);
  for (const id of ids) {
    const {scene} = await load('target'), gun = (await load(id)).scene;
    const original = scene.getObjectByName('held_weapon_target001') ?? scene.getObjectByName('held_weapon_target.001');
    assert(original, `${id}: target native weapon missing`); original.visible = false;
    const mount = scene.getObjectByName('wpn'); assert(mount, `${id}: native mount absent`);
    new Matrix4().fromArray(mounts[id].inverseBind).decompose(gun.position, gun.quaternion, gun.scale);
    mount.add(gun);
    const actor = new DuelSimulation().snapshot()[1]; actor.equipment = id;
    const animator = new DuelAnimator(scene, animations), triangle = new Triangle(), nearest = new Vector3();
    const gaps = [];
    for (const [duck, speed] of [[0, 0], [1, 0], [0, 4], [1, 1.5]]) {
      actor.duckAmount = duck; actor.velocity = {x: speed, z: 0};
      animator.update(actor, .2); scene.updateMatrixWorld(true);
      scene.traverse(node => {if (node instanceof SkinnedMesh) node.skeleton.update();});
      const probes = (id === 'elite' ? ['R', 'L'] : ['R']).map(side => ['finger_middle_1', 'finger_index_1', 'finger_thumb_2'].map(name => {
        name = `${name}_${side}`;
        const bone = scene.getObjectByName(name); assert(bone, `${id}: missing ${name}`);
        return bone.getWorldPosition(new Vector3());
      }));
      const distances = probes.map(() => Infinity);
      gun.traverse(mesh => {
        if (!(mesh instanceof Mesh)) return;
        const indices = mesh.geometry.index;
        const points = Array.from({length: mesh.geometry.attributes.position.count}, (_, i) => mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
        for (let i = 0; i < (indices?.count ?? points.length); i += 3) {
          triangle.set(...[0, 1, 2].map(j => points[indices ? indices.getX(i + j) : i + j]));
          for (let side = 0; side < probes.length; side++) for (const p of probes[side]) {
            triangle.closestPointToPoint(p, nearest); distances[side] = Math.min(distances[side], nearest.distanceTo(p));
          }
        }
      });
      gaps.push(...distances);
    }
    assert(gaps.every(gap => Number.isFinite(gap) && gap < .07), `${id}: world grip detached ${gaps.map(gap => (gap * 100).toFixed(2))}cm`);
    console.log(`${id}: standing/crouched/running/crouch-moving ${id === 'elite' ? 'R/L ' : ''}grip gaps ${gaps.map(gap => (gap * 100).toFixed(2)).join('/')}cm`);
    animator.dispose();
  }
} finally {await vite.close();}
