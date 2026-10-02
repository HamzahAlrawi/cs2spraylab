import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AnimationMixer, LoopOnce, Matrix4, PropertyBinding} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {firearmViewIds, requiredViewActions, selectViewClips} from '../../tools/native-view-clips.mjs';

globalThis.ProgressEvent ??= class {constructor(type, init) {Object.assign(this, init);}};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = JSON.parse(fs.readFileSync('docs/weapon-animation-inventory.json')).weapons;
const firearmIds = Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json')).weapons);
const legacy = [...new Set(JSON.parse(fs.readFileSync('src/range/cosmetics-data.json')).cosmetics
  .map(item => item.assetKey).filter(key => key?.endsWith('-legacy')))];
const matrixError = (a, b) => Math.max(...a.elements.map((value, i) => Math.abs(value - b.elements[i])));

function readGlb(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii',0,4), 'glTF', file);
  assert.equal(bytes.readUInt32LE(8), bytes.length, file);
  const length = bytes.readUInt32LE(12);
  return {bytes, json:JSON.parse(bytes.subarray(20,20 + length)), bin:bytes.subarray(28 + length)};
}

async function loadSkeleton(file) {
  const {json, bin} = readGlb(file);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  // Keep skeletons/animation tracks; GPU textures and geometry are tested separately.
  for (const node of json.nodes) delete node.mesh;
  for (const key of ['meshes','materials','images','textures']) delete json[key];
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(key => key !== 'EXT_texture_webp');
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}

function sample(root, mixer, clip, time) {
  mixer.stopAllAction();
  const action = mixer.clipAction(clip).reset().setLoop(LoopOnce,1);
  action.clampWhenFinished = true; action.play(); mixer.update(time);
  root.updateMatrixWorld(true);
}

test('the exporter covers exactly the available firearms', () => {
  assert.deepEqual([...firearmViewIds].sort(), [...firearmIds].sort());
  const files = [...new Set(Object.values(inventory).flatMap(entry => entry.actionAudit?.available ?? []))];
  for (const id of firearmIds) {
    const clips = selectViewClips(id,files);
    for (const name of requiredViewActions(id)) assert.ok(clips[name], `${id}/${name}`);
    assert.ok(Object.values(clips).every(file => file.startsWith('animation/anims/viewmodel/')));
  }
  assert.throws(() => selectViewClips('unknown', files), /Unsupported/);
  const ak = selectViewClips('ak47',files);
  assert.throws(() => selectViewClips('ak47',files.filter(file => file !== ak.fire)), /expected one/);
  assert.throws(() => selectViewClips('ak47',[...files,ak.fire]), /expected one/);
  const worldOnly = files.map(file => file.replace('/viewmodel/','/world/'));
  assert.throws(() => selectViewClips('ak47',worldOnly), /expected one/);
  assert.equal(selectViewClips('m4a1s',files).fire,'animation/anims/viewmodel/rifle/_default_rifle/shoot1_rifle.vnmclip_c');
  assert.equal(selectViewClips('usp',files).fire,'animation/anims/viewmodel/pistol/_default_pistol/shoot1_pistol.vnmclip_c');
  for (const id of ['tec9','negev']) assert.equal(selectViewClips(id,files)['idle-empty'],undefined);
});

test('all selected fire variants are independently referenced by the static native graph audit', () => {
  const audit = JSON.parse(fs.readFileSync('docs/native-fire-animation-audit.json'));
  assert.deepEqual(Object.keys(audit.weapons).sort(),[...firearmIds].sort());
  assert.equal(audit.assemblyCount,firearmIds.length + legacy.length);
  assert.equal(audit.sourceClipCount,Object.keys(audit.native).length);
  for (const [id, weapon] of Object.entries(audit.weapons)) {
    for (const [name, file] of Object.entries(weapon.clips)) {
      const native = audit.native[file], provenance = inventory[id].clips[name];
      assert.ok(native && provenance,`${id}/${name}`);
      assert.equal(provenance.path,file);
      assert.equal(provenance.crc,native.crc);
      assert.equal(provenance.bytes,native.bytes);
      assert.equal(native.additive,false,`${id}/${name}: unexpected delta-only firing clip`);
      assert.equal(native.skeleton,'animation/skeletons/characters/viewmodel.vnmskel');
      assert.ok(native.secondary.includes(inventory[id].skeleton));
      assert.ok(Math.abs(provenance.seconds - native.seconds) < 1e-4,`${id}/${name}: native duration`);
    }
  }
});

for (const key of [...firearmIds,...legacy]) test(`${key}: native firing provenance and attachment parity`, async () => {
  const id = key.replace(/-legacy$/,''), entry = inventory[key];
  assert.ok(entry,`${key}: missing audit`);
  const file = `public/revamp/models/view-${key}.glb`;
  const {json, bytes} = readGlb(file);
  assert.equal(hash(bytes),entry.sha256,`${key}: stale GLB audit`);
  assert.ok(json.skins?.length);
  assert.ok(!json.images?.some(image => image.uri));
  const assembly = json.nodes.find(node => node.extras?.native_view_weapon === id)?.extras;
  assert.equal(assembly?.native_view_variant,key.endsWith('-legacy') ? 'legacy' : 'hd');
  for (const name of requiredViewActions(id)) assert.ok(json.animations.some(clip => clip.name === name),`${key}/${name}`);
  const fires = Object.entries(entry.clips).filter(([name]) => name.startsWith('fire'));
  assert.ok(fires.length);
  for (const [name, provenance] of fires) {
    assert.ok(provenance.path.startsWith('animation/anims/viewmodel/'));
    assert.ok(provenance.seconds > 0 && provenance.samples > 1);
    assert.ok(provenance.maxPartMatrixError <= 1e-4);
    assert.ok(provenance.maxMountMatrixError <= 1e-4);
    assert.equal(provenance.quaternionContinuity,true);
    const clip = json.animations.find(clip => clip.name === name);
    assert.ok(clip);
    const names = clip.channels.map(channel => json.nodes[channel.target.node]?.name ?? '');
    assert.ok(names.some(name => name === 'hand_R'));
    assert.ok(names.some(name => name === 'weapon'));
    const seconds = Math.max(...clip.samplers.map(sampler => json.accessors[sampler.input].max[0]));
    assert.ok(Math.abs(seconds - provenance.seconds) < 1e-4,`${key}/${name}: duration changed`);
  }

  const specFile = `research/weapon-actions/${key}.json`;
  if (!fs.existsSync(specFile)) return;
  const spec = JSON.parse(fs.readFileSync(specFile));
  if (!fs.existsSync(spec.source)) return;
  assert.equal(hash(fs.readFileSync(spec.source)),entry.sourceSha256);
  assert.equal(hash(fs.readFileSync(spec.bind)),entry.bindSha256);
  const source = await loadSkeleton(spec.source), output = await loadSkeleton(file);
  const sourceMixer = new AnimationMixer(source.scene), outputMixer = new AnimationMixer(output.scene);
  source.scene.updateMatrixWorld(true);
  const secondary = source.scene.getObjectByName(PropertyBinding.sanitizeNodeName(spec.skeleton));
  assert.ok(secondary,`${key}: source secondary skeleton`);
  const sourceWeapon = secondary.getObjectByName('weapon');
  assert.ok(sourceWeapon);
  const nativeRootInverse = sourceWeapon.matrixWorld.clone().invert();
  const wpn = source.scene.getObjectByName('wpn');
  assert.ok(wpn);
  let maxArmError = 0, maxWeaponError = 0, maxTravel = 0;
  for (const [name, provenance] of fires) {
    const native = source.animations.find(clip => clip.name === provenance.path.replace(/\.vnmclip_c$/,''));
    const baked = output.animations.find(clip => clip.name === name);
    assert.ok(native && baked,`${key}/${name}: exact native clip`);
    let before;
    for (const fraction of [0,.05,.1,.2,.35,.5,.75,.95,1]) {
      sample(source.scene,sourceMixer,native,native.duration * fraction);
      sample(output.scene,outputMixer,baked,baked.duration * fraction);
      for (const boneName of ['hand_L','hand_R','wpn']) {
        const authored = source.scene.getObjectByName(boneName), actual = output.scene.getObjectByName(boneName);
        assert.ok(authored && actual,`${key}: ${boneName}`);
        maxArmError = Math.max(maxArmError,matrixError(authored.matrixWorld,actual.matrixWorld));
      }
      const hand = output.scene.getObjectByName('hand_R').matrixWorld.clone();
      before ??= hand;
      maxTravel = Math.max(maxTravel,matrixError(hand,before));
      secondary.traverse(bone => {
        if (!bone.isBone) return;
        const actual = output.scene.getObjectByName(bone.name);
        if (!actual) return;
        const expected = new Matrix4().multiplyMatrices(wpn.matrixWorld,nativeRootInverse).multiply(bone.matrixWorld);
        maxWeaponError = Math.max(maxWeaponError,matrixError(actual.matrixWorld,expected));
      });
    }
  }
  sourceMixer.stopAllAction(); sourceMixer.uncacheRoot(source.scene);
  outputMixer.stopAllAction(); outputMixer.uncacheRoot(output.scene);
  assert.ok(maxTravel > 1e-4,`${key}: blank native fire`);
  assert.ok(maxArmError < .002,`${key}: arm parity ${maxArmError}`);
  assert.ok(maxWeaponError < .002,`${key}: weapon parity ${maxWeaponError}`);
  console.log(`${key}: arms=${maxArmError.toExponential(2)}, weapon=${maxWeaponError.toExponential(2)}, motion=${maxTravel.toExponential(2)}`);
});
