import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {prune, resample, dedup} from '@gltf-transform/functions';
import {convertMotion} from './native-motion-conversion.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const source = 'research/raw-models/utility-world-actions.glb';
const requests = [];
for (const family of ['rifle', 'pistol']) requests.push({family, label: 'flashed', clip: 'flashed'},
  {family, label: 'flashed_crouch', clip: 'flashed_crouch'});
for (const [family, suffix] of [['utility', 'grenade'], ['utility-molotov', 'molotov']]) {
  for (const [label, stem] of [['idle', 'idle'], ['idle_crouch', 'idle_crouch'], ['draw', 'draw'], ['draw_crouch', 'draw_crouch'],
    ['pullpin', 'pullpin'], ['pullpin_crouch', 'pullpin_crouch']]) requests.push({family, label, clip: `${stem}_${suffix}`});
  // Molotov uses the shared grenade throw after its authored lighting pose.
  for (const [label, clip] of [['throw-high', 'throw_overhand_grenade'], ['throw-low', 'throw_underhand_grenade'],
    ['throw-high_crouch', 'crouch_throw_far_grenade'], ['throw-low_crouch', 'crouch_throw_near_grenade']]) requests.push({family, label, clip});
}
if (!process.argv.includes('--reuse-source') || !fs.existsSync(source)) execFileSync(path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe'),
  ['-i', `${game}/game/csgo/pak01_dir.vpk`, '-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', source, '-d',
    '--gltf_export_format', 'glb', '--gltf_export_animations', '--gltf_compose_additive',
    '--gltf_animation_list', [...new Set(requests.map(r => r.clip))].join(',')], {windowsHide: true, stdio: 'pipe', maxBuffer: 40e6});
const io = new NodeIO(), doc = await io.read(source), root = doc.getRoot();
const sources = [...root.listAnimations()];
const resources = [...new Set(requests.map(request => {
  const native = sources.find(clip => clip.getName().includes('/world/') && clip.getName().endsWith(`/${request.clip}`));
  if (!native) throw new Error(`Native world gesture missing: ${request.clip}`);
  return native.getName() + (request.label.startsWith('idle') ? '.vnmclip+non_additive.vnmclip_c' : '.vnmclip_c');
}))];
const audit = 'research/utility-world-audit';
fs.mkdirSync(audit, {recursive: true});
execFileSync(path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe'),
  ['-i', `${game}/game/csgo/pak01_dir.vpk`, '-f', resources.join(','), '-o', audit, '-d'],
  {windowsHide: true, stdio: 'pipe', maxBuffer: 40e6});
const nodes = new Map(root.listNodes().map(node => [node.getName(), node]));
const python = process.env.BLENDER_PYTHON || 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe';
for (const request of requests) {
  const native = sources.find(clip => clip.getName().includes('/world/') && clip.getName().endsWith(`/${request.clip}`));
  if (!native) throw new Error(`Native world gesture missing: ${request.clip}`);
  // RelativeToFrame idles contain delta channels. Their explicitly compiled
  // non-additive variants retain the complete authored hand and finger pose.
  const nativeName = native.getName() + (request.label.startsWith('idle') ? '.vnmclip+non_additive' : '');
  const channels = JSON.parse(execFileSync(python, ['tools/read-native-motion.py', `${audit}/${nativeName}.dmx`],
    {encoding: 'utf8', windowsHide: true, maxBuffer: 20e6})).map(convertMotion);
  const clip = doc.createAnimation(`gesture_${request.label}_${request.family}`);
  clip.setExtras({nativeSource: nativeName, authoredAbsolutePose: true});
  for (const channel of channels) {
    const node = nodes.get(channel.bone);
    if (!node || !channel.times.length || !/^(?:(?:spine_|neck_|head_|clavicle_|arm_|hand_|finger_|thumb_)|wpn(?:Pivot)?$)/.test(channel.bone)) continue;
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(channel.times)).setBuffer(root.listBuffers()[0]);
    const output = doc.createAccessor().setType(channel.path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(new Float32Array(channel.values.flat())).setBuffer(root.listBuffers()[0]);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(channel.path).setSampler(sampler));
  }
}
for (const clip of sources) clip.dispose();
for (const node of root.listNodes()) node.setMesh(null).setCamera(null);
for (const resource of [...root.listMeshes(), ...root.listTextures(), ...root.listMaterials(), ...root.listSkins()]) resource.dispose();
await doc.transform(resample({tolerance: .0001}), dedup(), prune());
await io.write('public/revamp/models/utility-gestures.glb', doc);
console.log(`EXPORTED ${root.listAnimations().length} native grenade world gestures`);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const flashResources = resources.filter(resource => /\/flashed(?:_crouch)?\.vnmclip_c$/.test(resource));
// Record original compiled bytes separately from the decoded animation channels.
const flashSources = flashResources.map(resource => {
  const file = `${audit}/${path.basename(resource)}`;
  execFileSync(path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe'),
    ['-i', `${game}/game/csgo/pak01_dir.vpk`, '-f', resource, '-o', file], {windowsHide: true, stdio: 'pipe'});
  return {resource, sha256: sha(fs.readFileSync(file)), decodedSha256: sha(fs.readFileSync(`${audit}/${resource.replace(/\.vnmclip_c$/, '.dmx')}`))};
});
fs.writeFileSync('src/range/duel/native-flash-animation.json', JSON.stringify({
  build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)?.[1],
  archiveDirectorySha256: sha(fs.readFileSync(`${game}/game/csgo/pak01_dir.vpk`)),
  sources: flashSources, animation: '/models/utility-gestures.glb',
  animationSha256: sha(fs.readFileSync('public/revamp/models/utility-gestures.glb')),
  limitations: 'Native upper-body channels, trainer blending. Exact Source 2 animation graph visibility blend is not ported.'}, null, 2) + '\n');
