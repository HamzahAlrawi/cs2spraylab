import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4, Quaternion, Vector3} from 'three';
import {parseKv3} from './kv3.mjs';

// Offline Bullet baking only. Never connects to Blender's interactive session.
const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, 'research/death-motion');
const output = path.join(root, 'research/death-motion-baked.json');
const names = ['death_fall_a', 'death_fall_b', 'death_fall_c',
  'death_crouch_fall_a', 'death_crouch_fall_b', 'death_crouch_fall_c'];
const prefix = 'animation/anims/world/shared/';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function forwardKinematics(skeleton, pose) {
  const worlds = new Map();
  for (const bone of skeleton) {
    const local = new Matrix4().compose(new Vector3(...pose.get(bone.name).position),
      new Quaternion(...pose.get(bone.name).quaternion), new Vector3(1, 1, 1));
    worlds.set(bone.name, bone.parent ? worlds.get(bone.parent).clone().multiply(local) : local);
  }
  return worlds;
}

export function validateDeathMotion(data) {
  if (data.schema !== 1 || data.fps !== 30 || data.duration !== 1.4 || data.clips?.length !== 6)
    throw new Error('Expected schema 1, 30 Hz, six replacement clips.');
  const boneNames = new Set();
  for (const bone of data.skeleton ?? []) {
    if (!bone.name || boneNames.has(bone.name) || (bone.parent && !boneNames.has(bone.parent)))
      throw new Error('Skeleton must have unique names and parent-first order.');
    boneNames.add(bone.name);
  }
  if (!boneNames.has('root_motion') || !boneNames.has('pelvis') || !boneNames.has('head_0'))
    throw new Error('Missing required native skeleton bones.');
  const seen = new Set(), summaries = [];
  for (const clip of data.clips) {
    const key = clip.name.slice(prefix.length);
    if (!clip.name.startsWith(prefix) || !names.includes(key) || seen.has(key))
      throw new Error(`Unexpected/duplicate replacement name: ${clip.name}`);
    seen.add(key);
    if (Math.abs(clip.duration - 1.4) > 1e-6) throw new Error(`${key}: duration must be 1.4 s`);
    const frames = 43, channels = new Map();
    let maxDegrees = 0, maxLengthError = 0, maxQuatError = 0;
    for (const track of clip.channels) {
      const size = track.path === 'rotation' ? 4 : track.path === 'translation' ? 3 : 0;
      if (!boneNames.has(track.bone) || !size || track.times.length !== frames || track.values.length !== frames)
        throw new Error(`${key}/${track.bone}: invalid path or sample count`);
      const channelKey = `${track.bone}/${track.path}`;
      if (channels.has(channelKey)) throw new Error(`${key}: duplicate ${channelKey}`);
      channels.set(channelKey, track);
      for (let frame = 0; frame < frames; frame++) {
        if (!Number.isFinite(track.times[frame]) || Math.abs(track.times[frame] - frame / 30) > 1e-7 ||
          track.values[frame].length !== size || !track.values[frame].every(Number.isFinite))
          throw new Error(`${key}/${channelKey}: invalid finite, evenly spaced sample ${frame}`);
        if (size === 4) {
          maxQuatError = Math.max(maxQuatError, Math.abs(Math.hypot(...track.values[frame]) - 1));
          if (frame) maxDegrees = Math.max(maxDegrees,
            new Quaternion(...track.values[frame - 1]).normalize().angleTo(new Quaternion(...track.values[frame]).normalize()) * 180 / Math.PI);
        } else if (track.bone !== 'pelvis') {
          maxLengthError = Math.max(maxLengthError,
            new Vector3(...track.values[frame]).distanceTo(new Vector3(...track.values[0])));
        }
      }
    }
    const initial = new Map(data.startPoses[clip.stance].map(b => [b.name, b]));
    if (initial.size !== boneNames.size) throw new Error(`${key}: incomplete native start pose`);
    for (const name of boneNames) {
      const value = initial.get(name);
      if (value?.position?.length !== 3 || value?.quaternion?.length !== 4 ||
        ![...value.position, ...value.quaternion].every(Number.isFinite) ||
        Math.abs(Math.hypot(...value.quaternion) - 1) > 1e-5)
        throw new Error(`${key}: invalid native start pose for ${name}`);
    }
    const initialWorlds = forwardKinematics(data.skeleton, initial);
    const startHead = initialWorlds.get('head_0').elements[13];
    let maxHead = -Infinity, lowSince = null, endHead = 0, endHip = 0, maxStartError = 0;
    let maxPelvisSpeed = 0, previousPelvis;
    for (let frame = 0; frame < frames; frame++) {
      const pose = new Map();
      for (const bone of data.skeleton) {
        const p = channels.get(`${bone.name}/translation`), q = channels.get(`${bone.name}/rotation`);
        if (!p || !q) throw new Error(`${key}: missing complete tracks for ${bone.name}`);
        const position = p.values[frame], quaternion = q.values[frame];
        if (bone.name === 'root_motion' && position.some(v => Math.abs(v) > 1e-7))
          throw new Error(`${key}: root_motion must not translate`);
        if (!frame) {
          maxStartError = Math.max(maxStartError, new Vector3(...position).distanceTo(new Vector3(...initial.get(bone.name).position)),
            new Quaternion(...quaternion).normalize().angleTo(new Quaternion(...initial.get(bone.name).quaternion).normalize()));
        }
        pose.set(bone.name, {position, quaternion});
      }
      const worlds = forwardKinematics(data.skeleton, pose);
      endHead = worlds.get('head_0').elements[13]; endHip = worlds.get('pelvis').elements[13];
      maxHead = Math.max(maxHead, endHead);
      const pelvis = new Vector3().setFromMatrixPosition(worlds.get('pelvis'));
      if (previousPelvis) maxPelvisSpeed = Math.max(maxPelvisSpeed, pelvis.distanceTo(previousPelvis) * 30);
      previousPelvis = pelvis;
      if (endHead < .48 && endHip < .42) lowSince ??= frame / 30;
      else lowSince = null;
    }
    const headRise = maxHead - startHead;
    const physical = clip.physics;
    if (physical?.engine !== 'Blender Bullet' || physical.bodies !== 15 || physical.joints !== 14 ||
      ![physical.groundedAt, physical.maxAnchorSeparation, physical.minFloorClearance,
        startHead, headRise, maxPelvisSpeed, endHead, endHip].every(Number.isFinite))
      throw new Error(`${key}: missing/nonfinite Bullet or pose validation measurements`);
    if (maxDegrees > 55 || maxQuatError > 1e-5 || maxLengthError > .001 || maxStartError > 1e-5)
      throw new Error(`${key}: flip/stretch/normalization/start-pose failure ${JSON.stringify({maxDegrees, maxLengthError, maxQuatError, maxStartError})}`);
    if (headRise > .15 || lowSince === null || lowSince > 1.2 || physical.groundedAt < 0 || physical.groundedAt > 1.2 ||
      physical.maxAnchorSeparation < 0 || physical.maxAnchorSeparation > .065 || physical.minFloorClearance < -.055)
      throw new Error(`${key}: rise/grounding/contact failure ${JSON.stringify({headRise, lowSince, physical})}`);
    if (maxPelvisSpeed > 8 || endHead < .04 || endHip < .04)
      throw new Error(`${key}: implausible pelvis speed or floor penetration`);
    summaries.push({name: key, samples: frames, channels: channels.size,
      startHeadHeight: startHead, maxHeadRise: headRise, groundedAt: physical.groundedAt,
      continuouslyLowFrom: lowSince, endHeadHeight: endHead, endPelvisHeight: endHip,
      maxRotationDegreesPerFrame: maxDegrees, maxLocalTranslationDrift: maxLengthError,
      maxQuaternionNormError: maxQuatError, maxStartPoseError: maxStartError,
      maxPelvisSpeed, maxAnchorSeparation: physical.maxAnchorSeparation,
      minFloorClearance: physical.minFloorClearance});
  }
  return summaries;
}

async function main() {
  if (process.argv.includes('--validate-only')) {
    console.log(JSON.stringify(validateDeathMotion(JSON.parse(fs.readFileSync(output, 'utf8'))), null, 2));
    return;
  }
  const blender = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
  const cli = path.resolve(root, process.env.SOURCE2VIEWER || '.local-tools/vrf/Source2Viewer-CLI.exe');
  const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
  const vpk = `${game}/game/csgo/pak01_dir.vpk`;
  for (const file of [blender, cli, vpk]) if (!fs.existsSync(file)) throw new Error(`Missing offline dependency: ${file}`);
  fs.mkdirSync(work, {recursive: true});
  const source = 'agents/models/ctm_sas/ctm_sas.vmdl_c';
  const raw = execFileSync(cli, ['-i', vpk, '-f', source, '-b', 'PHYS'],
    {encoding: 'utf8', windowsHide: true, maxBuffer: 20e6});
  const header = raw.indexOf('<!-- kv3');
  if (header < 0) throw new Error('Source 2 Viewer did not return static PHYS metadata.');
  const physics = parseKv3(raw.slice(header));
  if (physics.m_parts.length !== 15 || physics.m_joints.length !== 14)
    throw new Error('Native reference must contain 15 bodies / 14 joints.');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const modelPath = path.join(root, 'public/revamp/models/target.glb');
  const motionPath = path.join(root, 'public/revamp/models/duel-motion.glb');
  const modelDocument = await io.read(modelPath);
  const model = modelDocument.getRoot(), motion = (await io.read(motionPath)).getRoot();
  const jointNodes = new Set(model.listSkins().flatMap(s => s.listJoints()));
  const skeleton = [], visit = n => {
    if (jointNodes.has(n)) {
      if (n.getParentNode() && !jointNodes.has(n.getParentNode()) &&
        n.getParentNode().getWorldMatrix().some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-6))
        throw new Error(`Nonidentity external bone parent: ${n.getName()}`);
      skeleton.push({name: n.getName(), parent: jointNodes.has(n.getParentNode()) ? n.getParentNode().getName() : null,
        position: n.getTranslation(), quaternion: n.getRotation()});
    }
    n.listChildren().forEach(visit);
  };
  model.listScenes()[0].listChildren().forEach(visit);
  const startPoses = {};
  for (const [stance, name] of [['standing', 'idle_rifle'], ['crouching', 'idle_crouch_rifle']]) {
    const clip = motion.listAnimations().find(a => a.getName().endsWith(`/${name}`));
    if (!clip) throw new Error(`Missing native starting pose ${name}`);
    startPoses[stance] = skeleton.map(b => {
      const value = {name: b.name, position: [...b.position], quaternion: [...b.quaternion]};
      for (const c of clip.listChannels().filter(c => c.getTargetNode().getName() === b.name)) {
        const size = c.getTargetPath() === 'rotation' ? 4 : 3;
        const a = Array.from(c.getSampler().getOutput().getArray().slice(0, size));
        if (c.getTargetPath() === 'translation') value.position = a;
        if (c.getTargetPath() === 'rotation') value.quaternion = new Quaternion(...a).normalize().toArray();
        if (c.getTargetPath() === 'scale' && a.some(v => Math.abs(v - 1) > 1e-5))
          throw new Error(`${name}: scaled native bones are not supported`);
      }
      return value;
    });
  }
  const candidate = path.join(work, 'candidate.json');
  const spec = {schema: 1, fps: 30, duration: 1.4, skeleton, startPoses, physics, output: candidate,
    work, preview: false,
    provenance: {model: source, vpk, modelSha256: hash(modelPath), motionSha256: hash(motionPath),
      physicsDumpSha256: crypto.createHash('sha256').update(raw).digest('hex'),
      gameBuild: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8'),
      approximation: 'Offline Blender Bullet falls; not Source 2 ragdoll parity; native idle poses only, unsafe death prefixes excluded.'}};
  const specPath = path.join(work, 'input.json');
  fs.writeFileSync(specPath, JSON.stringify(spec));
  console.log('Baking six isolated Blender Bullet falls...');
  try {
    const log = execFileSync(blender, ['--background', '--factory-startup', '--threads', '2',
      '--python-exit-code', '1', '--python', path.join(root, 'art/build_death_motion.py'), '--', specPath],
    {cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 30e6, timeout: 300000});
    fs.writeFileSync(path.join(work, 'blender.log'), log);
    console.log(log.split('\n').filter(line => line.startsWith('BAKED ')).join('\n'));
  } catch (error) {
    fs.writeFileSync(path.join(work, 'blender.log'), String(error.stdout || '') + String(error.stderr || ''));
    throw new Error(`Blender bake failed; see research/death-motion/blender.log\n${String(error.stdout || '').slice(-6000)}`);
  }
  const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  data.validation = validateDeathMotion(data);
  fs.writeFileSync(candidate, JSON.stringify(data));
  fs.renameSync(candidate, output);
  fs.writeFileSync(path.join(work, 'validation.json'), JSON.stringify(data.validation, null, 2) + '\n');
  console.log(JSON.stringify(data.validation, null, 2));
  console.log(`Validated ${(fs.statSync(output).size / 1048576).toFixed(2)} MiB: ${output}`);
  if (process.argv.includes('--preview')) {
    const nodes = new Map(model.listNodes().map(node => [node.getName(), node]));
    // A disposable skinned preview, never a rewrite of either source GLB.
    model.listAnimations().forEach(animation => animation.dispose());
    model.listNodes().filter(node => node.getMesh() && !node.getSkin()).forEach(node => node.dispose());
    const buffer = model.listBuffers()[0];
    for (const clip of data.clips) {
      const animation = modelDocument.createAnimation(clip.name.split('/').at(-1));
      const times = modelDocument.createAccessor().setType('SCALAR').setBuffer(buffer)
        .setArray(new Float32Array(clip.channels[0].times));
      for (const track of clip.channels) {
        const values = modelDocument.createAccessor().setType(track.path === 'rotation' ? 'VEC4' : 'VEC3')
          .setBuffer(buffer).setArray(new Float32Array(track.values.flat()));
        const sampler = modelDocument.createAnimationSampler().setInput(times).setOutput(values).setInterpolation('LINEAR');
        animation.addSampler(sampler).addChannel(modelDocument.createAnimationChannel()
          .setTargetNode(nodes.get(track.bone)).setTargetPath(track.path).setSampler(sampler));
      }
    }
    const previewAsset = path.join(work, 'preview.glb');
    await io.write(previewAsset, modelDocument);
    const previewSpec = path.join(work, 'preview-input.json');
    fs.writeFileSync(previewSpec, JSON.stringify({...spec, previewOnly: true, previewAsset}));
    const previewLog = execFileSync(blender, ['--background', '--factory-startup', '--threads', '2',
      '--python-exit-code', '1', '--python', path.join(root, 'art/build_death_motion.py'), '--', previewSpec],
    {cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 30e6, timeout: 300000});
    fs.writeFileSync(path.join(work, 'preview.log'), previewLog);
    console.log(`Rendered skinned previews: ${work}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename)
  main().catch(error => {console.error(error); process.exitCode = 1;});
