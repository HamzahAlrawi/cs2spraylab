import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {convertMotion} from './native-motion-conversion.mjs';
import {validateDeathMotion} from './build-death-motion.mjs';

const source = path.resolve('research/raw-models/target-duel-native.glb');
const output = path.resolve('public/revamp/models/duel-motion.glb');
const unoptimized = path.resolve('research/duel-motion-unoptimized.glb');
const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const deathClips = ['death_chest_a', 'death_chest_b', 'death_gut_a'];
if (!fs.existsSync('.local-tools/datamodel.py')) throw new Error(
  'Install Blender Source Tools datamodel.py in .local-tools first; see docs/gameplay-session-audit.md.');
if (process.argv.includes('--refresh')) {
  const clips = ['idle_rifle', 'idle_crouch_rifle', 'planted_e2w_rifle', 'planted_w2e_rifle',
    'idle_pistol', 'idle_crouch_pistol',
    ...['run', 'walk', 'crouch'].flatMap(gait => ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].flatMap(direction => ['rifle', 'pistol'].map(family => `${gait}_${direction}_${family}`))),
    ...['usp', 'glock', 'hkp', 'p250', 'deagle', 'elite', 'fiveseven', 'tec9', 'cz75a', 'revolver'].flatMap(id => [`idle_${id}`, `idle_crouch_${id}`]),
    'inair_stand_rifle', 'inair_crouch_stand_rifle', 'jump_crouch_stand_rifle',
    'jump_stand_rifle', 'jump_e_rifle', 'jump_w_rifle', 'jump_n_rifle', 'jump_s_rifle',
    'inair_stand_pistol', 'inair_crouch_stand_pistol', 'jump_crouch_stand_pistol',
    'jump_stand_pistol', 'jump_e_pistol', 'jump_w_pistol', 'jump_n_pistol', 'jump_s_pistol'];
  execFileSync(path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe'), ['-i', `${game}/game/csgo/pak01_dir.vpk`,
    '-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', source, '-d', '--gltf_export_format', 'glb',
    '--gltf_export_animations', '--gltf_compose_additive', '--gltf_animation_list', clips.join(',')], {stdio: 'pipe', maxBuffer: 20e6});
}
if (!fs.existsSync(source)) throw new Error('Export target-duel-native.glb from the installed game first.');
const io = new NodeIO();
const document = await io.read(source);
const root = document.getRoot();
for (const clip of root.listAnimations()) if (!clip.getName().includes('/world/')) clip.dispose();
const python = process.env.BLENDER_PYTHON || 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe';
const readMotion = file => JSON.parse(execFileSync(python, ['tools/read-native-motion.py', file], {encoding: 'utf8', maxBuffer: 20e6})).map(convertMotion);
// Regression fixture: the same run clip exported independently as DMX and glTF.
// Reject an axis/scale mismatch before shipping any newly converted animation.
const reference = root.listAnimations().find(animation => animation.getName().endsWith('/run_e_rifle'));
if (!fs.existsSync('research/duel-animation-audit/run_e_rifle.dmx') || process.argv.includes('--refresh')) {
  fs.mkdirSync('research/duel-animation-audit', {recursive: true});
  execFileSync(path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe'), ['-i', `${game}/game/csgo/pak01_dir.vpk`,
    '-f', 'animation/anims/world/rifle/_default_rifle/run_e_rifle.vnmclip_c', '-d',
    '-o', 'research/duel-animation-audit/run_e_rifle.vnmclip'], {stdio: 'pipe', maxBuffer: 20e6});
}
const referenceChannels = readMotion('research/duel-animation-audit/run_e_rifle.dmx');
for (const name of ['root_motion', 'pelvis', 'spine_0', 'head_0']) for (const path of ['rotation', 'translation']) {
  const expected = reference.listChannels().find(channel => channel.getTargetNode().getName() === name && channel.getTargetPath() === path)
    .getSampler().getOutput().getArray().slice(0, path === 'rotation' ? 4 : 3);
  const actual = referenceChannels.find(channel => channel.bone === name && channel.path === path).values[0];
  const error = path === 'rotation' ? 1 - Math.abs(actual.reduce((sum, value, i) => sum + value * expected[i], 0))
    : Math.hypot(...actual.map((value, i) => value - expected[i]));
  if (error > .0001) throw new Error(`DMX/glTF reference mismatch: ${name} ${path}, error ${error}`);
}
for (const name of deathClips) {
  const file = `research/${name}.dmx`;
  if (!fs.existsSync(file) || process.argv.includes('--refresh')) execFileSync(path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe'),
    ['-i', `${game}/game/csgo/pak01_dir.vpk`, '-f', `animation/anims/world/shared/${name}.vnmclip_c`, '-d',
      '-o', `research/${name}.vnmclip`], {stdio: 'pipe', maxBuffer: 20e6});
  const animation = document.createAnimation(`animation/anims/world/shared/${name}`);
  for (const channel of readMotion(file)) {
    const node = root.listNodes().find(node => node.getName() === channel.bone);
    if (!node) continue;
    const input = document.createAccessor().setType('SCALAR').setArray(new Float32Array(channel.times)).setBuffer(root.listBuffers()[0]);
    const output = document.createAccessor().setType(channel.path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(new Float32Array(channel.values.flat())).setBuffer(root.listBuffers()[0]);
    const sampler = document.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath(channel.path).setSampler(sampler));
  }
}
for (const node of root.listNodes()) node.setMesh(null).setCamera(null);
for (const mesh of root.listMeshes()) mesh.dispose();
for (const texture of root.listTextures()) texture.dispose();
for (const material of root.listMaterials()) material.dispose();
for (const skin of root.listSkins()) skin.dispose();
for (const clip of [...deathClips, 'run_ne_rifle', 'inair_crouch_stand_rifle', 'jump_crouch_stand_rifle']) {
  if (!root.listAnimations().some(animation => animation.getName().endsWith(`/${clip}`)))
    throw new Error(`Missing ${clip}; rebuild with --refresh.`);
}
const bakedFile = path.resolve('research/death-motion-baked.json');
if (!fs.existsSync(bakedFile) || process.argv.includes('--refresh')) {
  // Give the offline baker the refreshed native idle poses before appending
  // its constrained replacements; the public model contains the skin rig.
  await io.write(output, document);
  execFileSync(process.execPath, ['tools/build-death-motion.mjs'], {stdio: 'pipe', windowsHide: true, maxBuffer: 30e6});
}
const baked = JSON.parse(fs.readFileSync(bakedFile, 'utf8'));
validateDeathMotion(baked);
for (const clip of baked.clips) {
  const animation = document.createAnimation(clip.name);
  for (const channel of clip.channels) {
    const node = root.listNodes().find(node => node.getName() === channel.bone);
    if (!node) continue;
    const input = document.createAccessor().setType('SCALAR').setArray(new Float32Array(channel.times)).setBuffer(root.listBuffers()[0]);
    const data = document.createAccessor().setType(channel.path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(new Float32Array(channel.values.flat())).setBuffer(root.listBuffers()[0]);
    const sampler = document.createAnimationSampler().setInput(input).setOutput(data).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath(channel.path).setSampler(sampler));
  }
}
await io.write(unoptimized, document);
execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize',
  unoptimized, output, '--compress', 'false'], {stdio: 'pipe'});
console.log(`${root.listAnimations().length} clips, ${(fs.statSync(output).size / 1048576).toFixed(2)} MiB: ${output}`);
