import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Document, NodeIO} from '@gltf-transform/core';
import {dedup} from '@gltf-transform/functions';
import {Quaternion, QuaternionKeyframeTrack} from 'three';
import {parseKv3} from './kv3.mjs';

// Offline, static-VPK-only builder. No motion-pack, runtime or manifest writes.
// Run: node tools/build-duel-flinches.mjs [--verify-only]
const repo = fileURLToPath(new URL('../', import.meta.url));
const local = file => path.join(repo, file);
const scratch = 'research/native-flinch-build';
const output = 'public/revamp/models/duel-flinches.glb';
const provenanceFile = 'public/revamp/models/duel-flinches.json';
const inventoryFile = 'research/native-presentation-inventory.json';
const model = 'agents/models/ctm_sas/ctm_sas.vmdl_c';
const skeleton = 'animation/skeletons/characters/worldmodel.vnmskel_c';
const maxBytes = 512 * 1024;
const upperBody = /^(?:spine_|neck_|head_|arm_|clavicle_|hand_)/;
const actions = ['flinch_head', 'flinch_head_right', 'flinch_chest', 'flinch_stomach',
  'flinch_arm_left', 'flinch_arm_right', 'flinch_leg_left', 'flinch_leg_right'];
const io = new NodeIO();
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hashFile = file => sha256(fs.readFileSync(file));
const identity = new Quaternion();
const duration = animation => Math.max(0, ...animation.listChannels().map(channel =>
  Math.max(...channel.getSampler().getInput().getArray())));
const angle = (a, b) => a.clone().normalize().angleTo(b.clone().normalize());
const keep = channel => channel.getTargetPath() === 'rotation'
  && upperBody.test(channel.getTargetNode().getName());
const trackKey = channel => channel.getTargetNode().getName();

function requests(inventory) {
  const catalogue = new Map(inventory.worldClipCatalogue.map(clip => [clip.source, clip]));
  const result = ['rifle', 'pistol'].map(family => ({
    sourceName: `animation/anims/world/${family}/_default_${family}/idle_${family}`,
    name: `native_idle_reference_${family}`, family, reference: true,
  }));
  for (const action of actions) for (const family of ['rifle', 'pistol']) {
    const sourceName = `animation/anims/world/shared/${action}${family === 'pistol' ? '_pistol' : ''}`;
    if (family === 'pistol' && !catalogue.has(`${sourceName}.vnmclip_c`)) continue;
    assert(catalogue.has(`${sourceName}.vnmclip_c`), `Inventory missing ${sourceName}`);
    result.push({sourceName, name: sourceName, family, reference: false});
  }
  return result.map(request => ({...request, source: `${request.sourceName}.vnmclip_c`}));
}

function exactAnimations(root, names) {
  assert.deepEqual(root.listAnimations().map(clip => clip.getName()).sort(), [...names].sort(),
    'Exporter must return exactly the bounded requested world clips');
  return new Map(root.listAnimations().map(clip => [clip.getName(), clip]));
}

export function validateClip(animation, expected) {
  assert.equal(animation.getName(), expected.name);
  const channels = animation.listChannels();
  assert(channels.length > 0, `Empty clip ${expected.name}`);
  const seen = new Set();
  let nonIdentitySamples = 0, maxMotionRadians = 0, samples = 0;
  for (const channel of channels) {
    assert(keep(channel), `Forbidden track ${trackKey(channel)}.${channel.getTargetPath()}`);
    assert(!seen.has(trackKey(channel)), 'Duplicate bone rotation track');
    seen.add(trackKey(channel));
    const sampler = channel.getSampler();
    assert.equal(sampler.getInterpolation(), 'LINEAR');
    const input = sampler.getInput(), out = sampler.getOutput();
    assert.equal(input.getType(), 'SCALAR');
    assert.equal(out.getType(), 'VEC4');
    assert.equal(input.getCount(), out.getCount());
    const times = input.getArray(), values = out.getArray();
    assert(times.length > 0);
    assert.equal(times[0], 0, 'Track must begin at impact time zero');
    for (let i = 0; i < times.length; i++) {
      assert(Number.isFinite(times[i]) && times[i] >= 0);
      if (i) assert(times[i] > times[i - 1], 'Key times must strictly increase');
      const valuesAtKey = values.subarray(i * 4, i * 4 + 4);
      assert(valuesAtKey.every(Number.isFinite), 'Non-finite quaternion');
      const q = new Quaternion().fromArray(valuesAtKey);
      assert(Math.abs(q.length() - 1) < 0.0001, 'Non-unit/zero quaternion');
      if (angle(q, identity) > 0.0001) nonIdentitySamples++;
      maxMotionRadians = Math.max(maxMotionRadians, angle(q, new Quaternion().fromArray(values)));
      samples++;
    }
  }
  for (const bone of ['spine_0', 'spine_1', 'spine_2', 'spine_3', 'neck_0', 'head_0',
    'clavicle_L', 'clavicle_R', 'arm_upper_L', 'arm_upper_R', 'arm_lower_L', 'arm_lower_R', 'hand_L', 'hand_R'])
    assert(seen.has(bone), `Missing expected upper-body rotation ${bone}`);
  assert(nonIdentitySamples > 0, `Identity-only absolute clip ${expected.name}`);
  if (!expected.reference) {
    assert(maxMotionRadians > 0.001, `No retained upper-body flinch motion: ${expected.name}`);
    const extras = animation.getExtras();
    assert.equal(extras.additive, true);
    assert.equal(extras.additive_composed, true);
    assert.equal(extras.additive_base, 'bindpose');
  }
  const seconds = duration(animation);
  assert(seconds > 0 && Number.isFinite(seconds));
  assert(Math.abs(seconds - expected.sourceSeconds) < 0.0001,
    `${expected.name}: retained ${seconds}s != native ${expected.sourceSeconds}s`);
  return {rotationTracks: channels.length, samples, nonIdentitySamples, maxMotionRadians, seconds};
}

export function validatePack(document, expected) {
  const root = document.getRoot();
  exactAnimations(root, expected.map(clip => clip.name));
  for (const list of ['listMeshes', 'listMaterials', 'listTextures', 'listSkins', 'listCameras'])
    assert.equal(root[list]().length, 0, `Unexpected ${list}`);
  const names = root.listNodes().map(node => node.getName());
  assert.equal(new Set(names).size, names.length, 'Ambiguous bone names');
  for (const node of root.listNodes()) {
    assert(!node.getMesh() && !node.getSkin() && !node.getCamera());
    assert([...node.getTranslation(), ...node.getRotation(), ...node.getScale()].every(Number.isFinite));
  }
  return expected.map(clip => ({name: clip.name,
    ...validateClip(root.listAnimations().find(animation => animation.getName() === clip.name), clip)}));
}

function compareComposition(composed, delta) {
  const extras = delta.getExtras();
  assert.equal(extras.additive, true);
  assert.equal(extras.additive_composed, false);
  assert.equal(extras.additive_base, 'bindpose');
  const deltaChannels = new Map(delta.listChannels().filter(keep).map(channel => [trackKey(channel), channel]));
  let maxErrorRadians = 0, checkedSamples = 0;
  for (const channel of composed.listChannels().filter(keep)) {
    const raw = deltaChannels.get(trackKey(channel));
    assert(raw, `Missing delta control ${trackKey(channel)}`);
    const interpolant = c => new QuaternionKeyframeTrack('rotation',
      c.getSampler().getInput().getArray(), c.getSampler().getOutput().getArray()).createInterpolant();
    const absoluteAt = interpolant(channel), deltaAt = interpolant(raw);
    const bind = new Quaternion().fromArray(channel.getTargetNode().getRotation());
    const times = new Set([...channel.getSampler().getInput().getArray(), ...raw.getSampler().getInput().getArray()]);
    for (const time of times) {
      const expected = bind.clone().multiply(new Quaternion().fromArray(deltaAt.evaluate(time)));
      const actual = new Quaternion().fromArray(absoluteAt.evaluate(time));
      maxErrorRadians = Math.max(maxErrorRadians, angle(expected, actual));
      checkedSamples++;
    }
  }
  assert(maxErrorRadians < 0.0001, `Bind * delta composition mismatch: ${maxErrorRadians} radians`);
  return {name: composed.getName(), checkedSamples, maxErrorRadians};
}

async function verifyOnly() {
  const report = JSON.parse(fs.readFileSync(local(provenanceFile), 'utf8'));
  assert.equal(hashFile(local(output)), report.asset.sha256, 'Asset hash mismatch');
  assert.equal(fs.statSync(local(output)).size, report.asset.bytes);
  assert(fs.statSync(local(output)).size + fs.statSync(local(provenanceFile)).size <= maxBytes, '512 KiB combined budget exceeded');
  const expected = requests(JSON.parse(fs.readFileSync(local(inventoryFile), 'utf8')));
  assert.deepEqual(report.clips.map(clip => clip.name), expected.map(clip => clip.name));
  const validation = validatePack(await io.read(local(output)), report.clips);
  console.log(JSON.stringify({asset: output, bytes: report.asset.bytes,
    provenanceBytes: fs.statSync(local(provenanceFile)).size, clips: validation}, null, 2));
}

async function build() {
  const inventory = JSON.parse(fs.readFileSync(local(inventoryFile), 'utf8'));
  const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
  const vpk = path.join(game, 'game/csgo/pak01_dir.vpk');
  const steamInf = path.join(game, 'game/csgo/steam.inf');
  const installed = fs.readFileSync(steamInf, 'utf8');
  assert(/^ClientVersion=2000935\r?$/m.test(installed), 'Requires installed static build 2000935');
  assert.equal(installed.trim(), inventory.installed.trim(), 'Installed build differs from inventory');
  const cli = local('.local-tools/vrf/Source2Viewer-CLI.exe');
  const requested = requests(inventory);
  fs.mkdirSync(local(scratch), {recursive: true});
  const invocations = [];
  function run(args, label) {
    const processResult = spawnSync(cli, args, {cwd: repo, encoding: 'utf8', windowsHide: true,
      stdio: 'pipe', maxBuffer: 32 * 1024 * 1024});
    const result = processResult.stdout || '', stderr = processResult.stderr || '';
    fs.writeFileSync(local(`${scratch}/${label}.txt`), result);
    fs.writeFileSync(local(`${scratch}/${label}.stderr.txt`), stderr);
    assert(!processResult.error, processResult.error?.message);
    assert.equal(processResult.status, 0, `Source2Viewer failed (${label}): ${stderr}`);
    invocations.push({label, args, stdoutSha256: sha256(result), stderrSha256: sha256(stderr),
      warningCount: (result + stderr).split(/\r?\n/).filter(line => /Exception:|Warning:/i.test(line)).length,
      warnings: [...new Set((result + '\n' + stderr).split(/\r?\n/).filter(line => /Exception:|Warning:/i.test(line)))]});
    return result;
  }
  const version = run(['--version'], 'version').trim();
  const help = run(['--help'], 'help');
  assert(help.includes('Compose additive animations over the bind pose'));
  const rawDir = `${scratch}/sources`;
  const sources = [model, skeleton, ...requested.map(clip => clip.source)];
  for (const source of sources) fs.rmSync(local(`${rawDir}/${source}`), {force: true});
  run(['-i', vpk, '-f', sources.join(','), '-o', local(rawDir)], 'extract-static-sources');
  for (const source of sources) assert(fs.existsSync(local(`${rawDir}/${source}`)), `Missing static source ${source}`);
  for (const request of requested) {
    const dump = run(['-i', local(`${rawDir}/${request.source}`), '-b', 'DATA'], path.basename(request.source));
    assert(dump.includes('<!-- kv3'), `Missing DATA for ${request.source}`);
    const data = parseKv3(dump.slice(dump.indexOf('<!-- kv3')).replace(/#\[[\s\S]*?\]/g, '[]'));
    assert(Number.isFinite(data.m_flDuration) && data.m_flDuration > 0 && data.m_flDuration < 2);
    assert(Number.isInteger(data.m_nNumFrames) && data.m_nNumFrames >= 2);
    assert.equal(data.m_bIsAdditive, !request.reference);
    const prior = inventory.selectedClipMetadata.find(clip => clip.source === request.source);
    if (prior) {
      assert.equal(data.m_flDuration, prior.seconds);
      assert.equal(data.m_nNumFrames, prior.frames);
      assert.equal(data.m_bIsAdditive, prior.additive);
    }
    Object.assign(request, {sourceSeconds: data.m_flDuration, sourceFrames: data.m_nNumFrames,
      sourceAdditive: data.m_bIsAdditive, sourceSha256: hashFile(local(`${rawDir}/${request.source}`)),
      dataDumpSha256: sha256(dump)});
  }
  const exportArgs = ['-i', vpk, '-f', model, '-d', '--gltf_export_format', 'glb', '--gltf_export_animations'];
  const composedFile = `${scratch}/composed.glb`, deltaFile = `${scratch}/delta.glb`;
  for (const file of [composedFile, deltaFile]) fs.rmSync(local(file), {force: true});
  run([...exportArgs, '-o', local(composedFile), '--gltf_compose_additive', '--gltf_animation_list',
    requested.map(clip => clip.sourceName).join(',')], 'export-composed');
  const flinches = requested.filter(clip => !clip.reference);
  run([...exportArgs, '-o', local(deltaFile), '--gltf_animation_list',
    flinches.map(clip => clip.sourceName).join(',')], 'export-delta-control');
  const sourceDocument = await io.read(local(composedFile));
  const sourceRoot = sourceDocument.getRoot();
  const sourceClips = exactAnimations(sourceRoot, requested.map(clip => clip.sourceName));
  const deltaClips = exactAnimations((await io.read(local(deltaFile))).getRoot(), flinches.map(clip => clip.sourceName));
  const compositionChecks = flinches.map(clip => compareComposition(sourceClips.get(clip.sourceName), deltaClips.get(clip.sourceName)));
  const document = new Document(), buffer = document.createBuffer(), scene = document.createScene('native-flinch-skeleton');
  document.getRoot().setDefaultScene(scene);
  const nodes = new Map();
  function copyNode(source) {
    if (nodes.has(source)) return nodes.get(source);
    const node = document.createNode(source.getName()).setTranslation(source.getTranslation())
      .setRotation(source.getRotation()).setScale(source.getScale());
    nodes.set(source, node);
    if (source.getParentNode()) copyNode(source.getParentNode()).addChild(node);
    else scene.addChild(node);
    return node;
  }
  const clips = [];
  for (const request of requested) {
    const source = sourceClips.get(request.sourceName);
    const exporterSeconds = duration(source);
    if (!request.reference) assert(Math.abs(exporterSeconds - request.sourceSeconds) < 0.0001);
    const animation = document.createAnimation(request.name).setExtras({...source.getExtras(),
      nativeSource: request.source, rotationSpace: 'absolute-local',
      ...(!request.reference ? {idleReference: `native_idle_reference_${request.family}`} : {})});
    for (const channel of source.listChannels().filter(keep)) {
      const sampler = channel.getSampler();
      let times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
      // The exporter collapses a static idle to t=0; hold that exact pose for its authored duration.
      if (request.reference && exporterSeconds === 0) {
        assert.equal(times.length, 1);
        times = new Float32Array([0, request.sourceSeconds]);
        values = new Float32Array([...values, ...values]);
      }
      const input = document.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
      const out = document.createAccessor().setType('VEC4').setArray(new Float32Array(values)).setBuffer(buffer);
      const copiedSampler = document.createAnimationSampler().setInput(input).setOutput(out)
        .setInterpolation(sampler.getInterpolation());
      animation.addSampler(copiedSampler).addChannel(document.createAnimationChannel().setSampler(copiedSampler)
        .setTargetPath('rotation').setTargetNode(copyNode(channel.getTargetNode())));
    }
    clips.push({...request, exporterSeconds, exporterExtras: source.getExtras(),
      idleReference: request.reference ? null : `native_idle_reference_${request.family}`,
      ...validateClip(animation, request)});
  }
  await document.transform(dedup());
  validatePack(document, clips);
  const bytes = await io.writeBinary(document);
  validatePack(await io.readBinary(bytes), clips);
  assert.equal(fs.readFileSync(steamInf, 'utf8'), installed, 'Installed build changed during export');
  const report = {
    schema: 1, asset: {file: output, bytes: bytes.byteLength, sha256: sha256(bytes), budgetBytes: maxBytes},
    installedBuild: 2000935, installed, installedFile: steamInf, installedSha256: hashFile(steamInf),
    source: {vpk, vpkDirectorySha256: hashFile(vpk), model, modelSha256: hashFile(local(`${rawDir}/${model}`)),
      skeleton, skeletonSha256: hashFile(local(`${rawDir}/${skeleton}`)),
      inventory: inventoryFile, inventorySha256: hashFile(local(inventoryFile)),
      composedExportSha256: hashFile(local(composedFile)), deltaControlExportSha256: hashFile(local(deltaFile))},
    tool: {file: '.local-tools/vrf/Source2Viewer-CLI.exe', version, sha256: hashFile(cli),
      builder: 'tools/build-duel-flinches.mjs', builderSha256: hashFile(fileURLToPath(import.meta.url)),
      node: process.version, invocations},
    interpretation: {
      storage: 'Native absolute local rotations; additive deltas composed by Source2Viewer over the model bind pose. Not composed over idle.',
      verification: 'All retained flinch tracks compared against bind rotation * independently exported native delta at the union of key times; normalized quaternion angular tolerance 0.0001 radians.',
      reference: 'Corresponding rifle/pistol idle rotations come from the same model/export. Static t=0 exporter references are held unchanged to their native DATA durations.',
      integrationWarning: 'Idle references are NOT the exporter composition baseline. Direct idle-relative conversion also includes bind-to-idle posture difference. Runtime owner must account for this; this builder does not rebase or synthesize flinch motion.',
      sampling: 'Native seconds and LINEAR quaternion tracks retained. Runtime owner samples at elapsed impact time; no graph blending, timing warping or runtime changes here.',
      removed: 'No meshes, materials, textures, skins, cameras, translation/scale tracks, root/pelvis/leg tracks, fingers, weapon anchors or attachments. Static ancestor transforms only preserve the skeleton hierarchy.',
      limitations: 'Static resource/export verification only, not observed in-game behavior or execution of the Source 2 animation graph. Exporter traversal warnings are preserved in tool.invocations.',
    },
    clips, compositionChecks,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  assert(bytes.byteLength + Buffer.byteLength(json) <= maxBytes,
    `Asset + provenance exceed 512 KiB (${bytes.byteLength + Buffer.byteLength(json)} bytes); report before increasing budget`);
  fs.mkdirSync(path.dirname(local(output)), {recursive: true});
  fs.writeFileSync(local(output), bytes);
  fs.writeFileSync(local(provenanceFile), json);
  console.log(`${clips.length} clips, ${bytes.byteLength} GLB bytes + ${Buffer.byteLength(json)} provenance bytes; bind-pose composition verified.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.slice(2).every(arg => arg === '--verify-only'), 'Only --verify-only is supported');
  if (process.argv.includes('--verify-only')) await verifyOnly();
  else await build();
}
