import fs from 'node:fs';
import assert from 'node:assert/strict';
import {AnimationMixer, Vector3, Triangle, SkinnedMesh, Mesh} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.ProgressEvent ??= class {constructor(type, init) {Object.assign(this, init);}};
const ids = process.argv.slice(2).length ? process.argv.slice(2) :
  [...Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json')).weapons), 'usp'];
for (const id of ids) {
  const data = fs.readFileSync(`public/revamp/models/view-${id}.glb`), length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length));
  json.buffers[0].uri = `data:application/octet-stream;base64,${data.subarray(28 + length).toString('base64')}`;
  for (const m of json.meshes) for (const p of m.primitives) delete p.material;
  delete json.materials; delete json.textures; delete json.images;
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  const {scene, animations} = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  assert(animations.some(a => a.name === 'reload') && animations.some(a => a.name === 'idle'), `${id}: missing clips`);
  const mixer = new AnimationMixer(scene), idle = mixer.clipAction(animations.find(a => a.name === 'idle'));
  idle.play(); mixer.update(0); scene.updateMatrixWorld(true);
  const weapons = [];
  scene.traverse(o => {if (o instanceof SkinnedMesh) o.skeleton.update();
    if (o instanceof Mesh && /weapons.*weapon_/i.test(o.name)) weapons.push(o);});
  assert(weapons.length, `${id}: missing rigged weapon`);
  const triangle = new Triangle(), nearest = new Vector3(), point = new Vector3();
  const grips = ['L', 'R'].map(side => {
    const probes = ['finger_middle_1', 'finger_index_1', 'finger_thumb_2'].map(name => {
      const bone = scene.getObjectByName(`${name}_${side}`); assert(bone, `${id}: missing ${name}_${side}`);
      return bone.getWorldPosition(new Vector3());
    });
    let gap = Infinity;
    for (const mesh of weapons) {
      const index = mesh.geometry.index;
      const points = Array.from({length: mesh.geometry.attributes.position.count}, (_, i) => mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
      for (let i = 0; i < (index?.count ?? points.length); i += 3) {
        triangle.set(...[0, 1, 2].map(j => points[index ? index.getX(i + j) : i + j]));
        for (const p of probes) {triangle.closestPointToPoint(p, nearest); gap = Math.min(gap, nearest.distanceTo(p));}
      }
    }
    return gap;
  });
  assert(Math.max(...grips) < .045, `${id}: detached idle grip ${grips}`);
  const hand = scene.getObjectByName('hand_L'), before = hand.getWorldPosition(new Vector3());
  idle.stop(); const reload = mixer.clipAction(animations.find(a => a.name === 'reload')); reload.play();
  mixer.update(reload.getClip().duration * .45); scene.updateMatrixWorld(true);
  const travel = hand.getWorldPosition(point).distanceTo(before);
  assert(travel > .05, `${id}: reload hand did not move`);
  console.log(`${id}: native clips, idle grips ${grips.map(g => (g * 100).toFixed(2)).join('/')} cm, reload hand travel ${(travel * 100).toFixed(1)} cm`);
}
