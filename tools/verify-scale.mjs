import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AnimationMixer, Box3, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

// Read geometry/animation without decoding images or requiring a browser or GPU.
globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } };
const data = fs.readFileSync('public/revamp/models/target.glb');
const jsonLength = data.readUInt32LE(12);
const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
gltf.buffers[0].uri = `data:application/octet-stream;base64,${data.subarray(28 + jsonLength).toString('base64')}`;
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
delete gltf.materials; delete gltf.textures; delete gltf.images; delete gltf.samplers;
const {scene, animations} = await new GLTFLoader().parseAsync(JSON.stringify(gltf), '');
const loadingHeight = new Box3().setFromObject(scene).getSize(new Vector3()).y;
const clip = animations.find(a => a.name.includes('/world/') && a.name.includes('idle_rifle'));
assert(clip, 'Native rifle idle clip missing');
const mixer = new AnimationMixer(scene); mixer.clipAction(clip).play(); mixer.update(0); scene.updateMatrixWorld(true);
const bounds = new Box3().setFromObject(scene, true);
const height = bounds.getSize(new Vector3()).y;
// Independent Blender evaluation of build 2000908's original SAS world idle.
const nativeHeight = 1.821905848570168;
assert(Math.abs(height - nativeHeight) < .002, `Target scale changed: ${height} m, expected ${nativeHeight} m`);
assert(Math.abs(bounds.min.y) < .005, `Target feet moved from the native ground origin: ${bounds.min.y}`);
console.log(`Scale verified: native idle ${height.toFixed(6)} m (${(height / .0254).toFixed(3)} units), loading bounds ${loadingHeight.toFixed(6)} m; no runtime height normalization.`);
