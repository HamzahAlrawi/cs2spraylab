import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';
import * as THREE from 'three';

// Static native-map/body audit, independent of the game process and GPU load.
const bytes = fs.readFileSync('public/revamp/models/target.glb');
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const jointIds = new Set(gltf.skins.flatMap(skin => skin.joints));
function rig(position) {
  const nodes = gltf.nodes.map((n, i) => {
    const node = jointIds.has(i) ? new THREE.Bone() : new THREE.Group(); node.name = n.name ?? '';
    if (n.translation) node.position.fromArray(n.translation);
    if (n.rotation) node.quaternion.fromArray(n.rotation);
    if (n.scale) node.scale.fromArray(n.scale);
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(node.position, node.quaternion, node.scale);
    return node;
  });
  gltf.nodes.forEach((n, i) => n.children?.forEach(child => nodes[i].add(nodes[child])));
  const model = new THREE.Group(); model.position.copy(position);
  for (const id of gltf.scenes[gltf.scene ?? 0].nodes) model.add(nodes[id]);
  model.updateMatrixWorld(true); return model;
}
const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {settleNativePosition} = await vite.ssrLoadModule('/src/range/prefire/map.ts');
  const {RigidDeath} = await vite.ssrLoadModule('/src/range/duel/rigid-death.ts');
  const buffer = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json')),
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const results = [];
  for (const source of [[1250, 1000, 0], [-1400, 2190, 1], [180, 2180, -125]]) {
    const position = settleNativePosition(collision, source), model = rig(position);
    const center = model.getObjectByName('pelvis').getWorldPosition(new THREE.Vector3());
    let start = performance.now(); const geometry = collision.corpseGeometry(center, 8), copyMs = performance.now() - start;
    start = performance.now(); assert.equal(collision.corpseGeometry(center, 8), geometry); const cachedMs = performance.now() - start;
    start = performance.now();
    const death = new RigidDeath(model, {floor: -1000, corpseGeometry: collision.corpseGeometry.bind(collision)},
      {x: 0, y: 0, z: 0}, {direction: {x: 0, y: 0, z: 1}, headshot: true});
    const setupMs = performance.now() - start, steps = [];
    try {
      for (let frame = 1; frame <= 240; frame++) {
        start = performance.now(); death.update(frame / 60); steps.push(performance.now() - start);
      }
      const head = model.getObjectByName('head_0').getWorldPosition(new THREE.Vector3());
      assert.ok(head.toArray().every(Number.isFinite));
      assert.ok(head.y > position.y - .3 && head.y < position.y + 1, `Native floor mismatch ${source}: ${head.y} vs ${position.y}`);
      const sorted = steps.toSorted((a, b) => a - b);
      results.push({source, triangles: geometry.indices.length / 3, copyMs, cachedMs, setupMs,
        frameMedianMs: sorted[120], frameP95Ms: sorted[228], frameMaxMs: sorted.at(-1), headAboveSpawnFloor: head.y - position.y});
    } finally {death.dispose();}
  }
  console.log(JSON.stringify({note: 'CPU-only full-source map, not FPS or a low-end device guarantee', results}, null, 2));
} finally {collision?.dispose(); await vite.close();}
