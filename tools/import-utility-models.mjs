import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Matrix4, Quaternion, Vector3} from 'three';
import {parseKv3} from './kv3.mjs';
import {NodeIO} from '@gltf-transform/core';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const blender = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const run = args => execFileSync(cli, ['-i', `${game}/game/csgo/pak01_dir.vpk`, ...args],
  {encoding: 'utf8', windowsHide: true, maxBuffer: 60e6});
const listing = run(['-l', '-f', 'animation/anims/viewmodel/grenade/', '-e', 'vnmclip_c']);
const files = [...listing.matchAll(/^(\S+\.vnmclip_c) CRC:(\w+) size:(\d+)/gm)];
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
const data = parseKv3(fs.readFileSync('research/weapons.vdata', 'utf8'));
const definitions = {he: ['hegrenade', 'hegrenade'], flash: ['flashbang', 'flashbang'],
  smoke: ['smokegrenade', 'smoke'], molotov: ['molotov', 'molotov'],
  incendiary: ['incgrenade', 'incendiary'], decoy: ['decoy', 'grenade']};
const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const kinds = requested.length ? requested : Object.keys(definitions);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = file => {const b = fs.readFileSync(file); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));};
const optimize = (source, target, size) => execFileSync(process.execPath,
  ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize', source, target, '--compress', 'false',
    '--texture-compress', 'webp', '--texture-size', String(size), '--simplify', 'false', '--instance', 'false'],
  {windowsHide: true, stdio: 'pipe', maxBuffer: 10e6});
for (const dir of ['research/raw-models', 'research/weapon-actions', 'research/blender-exports', 'public/revamp/models'])
  fs.mkdirSync(dir, {recursive: true});
const manifestPath = 'src/range/duel/utility-models.json';
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : {schema: 1, models: {}};
for (const kind of kinds) {
  if (!definitions[kind]) throw new Error(`Unknown utility: ${kind}`);
  const [weapon, suffix] = definitions[kind], native = data[`weapon_${weapon}`], id = `utility-${kind}`;
  const find = stem => {
    const matches = files.filter(row => row[1].endsWith(`/${stem}_${suffix}.vnmclip_c`));
    if (matches.length !== 1) throw new Error(`${kind}: missing/ambiguous native ${stem}`);
    return matches[0];
  };
  const rows = Object.fromEntries(Object.entries({idle: 'idle', draw: 'draw', inspect: 'lookat01',
    pullpin: 'pullpin', 'hold-high': 'throwcharge_high', 'hold-mid': 'throwcharge_mid', 'hold-low': 'throwcharge_low',
    'throw-high': 'throw_overhand', 'throw-low': 'throw_underhand'}).map(([label, stem]) => [label, find(stem)]));
  const clips = Object.fromEntries(Object.entries(rows).map(([label, row]) => [label, row[1]]));
  const source = `research/raw-models/actions-${id}.glb`, bind = `research/raw-models/${id}-rigged.glb`;
  const specPath = `research/weapon-actions/${id}.json`;
  const signature = JSON.stringify({build, clips, model: native.m_szWorldModel});
  const previous = fs.existsSync(specPath) ? JSON.parse(fs.readFileSync(specPath)) : null;
  if (!process.argv.includes('--reuse-source') || previous?.signature !== signature || !fs.existsSync(source)) {
    console.log(`Extracting ${kind}: native model, textures, arms and nine view actions`);
    run(['-f', `${native.m_szWorldModel}_c`, '-o', bind, '-d', '--gltf_export_format', 'glb',
      '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations', '--gltf_animation_list', '__bind_pose_only__']);
    run(['-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', source, '-d', '--gltf_export_format', 'glb',
      '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations', '--gltf_compose_additive',
      '--gltf_animation_list', Object.values(clips).map(file => path.posix.basename(file, '.vnmclip_c')).join(',')]);
  }
  // Blender truncates action IDs at 63 bytes, aliasing all three throwcharge clips.
  // Rename animations structurally before import; the source resources stay audited below.
  const actionAliases = Object.fromEntries(Object.keys(clips).map(label => [label, `${id}_${label}`]));
  const io = new NodeIO(), assembly = await io.read(source);
  for (const [label, resource] of Object.entries(clips)) {
    const animation = assembly.getRoot().listAnimations().find(a => a.getName() === resource.replace(/\.vnmclip_c$/, ''));
    if (!animation) throw new Error(`${kind}: missing authored animation ${resource}`);
    animation.setName(actionAliases[label]);
  }
  const shortSource = `research/raw-models/actions-${id}-aliased.glb`;
  await io.write(shortSource, assembly);
  const spec = {id, assetKey: id, variant: 'native', build, source: shortSource, bind, skeleton: native.m_szAnimSkeleton, actionAliases,
    clips, signature, nativeFiles: Object.fromEntries(Object.entries(rows).map(([label, row]) =>
      [label, {path: row[1], crc: row[2], bytes: Number(row[3])}])),
    pickup: 'reuse-native-draw', sourceSha256: hash(shortSource), nativeSourceSha256: hash(source), bindSha256: hash(bind),
    output: `research/blender-exports/view-${id}.glb`};
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
  if (process.argv.includes('--extract-only')) continue;
  if (!process.argv.includes('--world-only')) execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', 'art/build_reload.py', '--', specPath],
    {windowsHide: true, stdio: 'pipe', maxBuffer: 30e6});
  execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', 'art/build_utility_world.py', '--', specPath],
    {windowsHide: true, stdio: 'pipe', maxBuffer: 30e6});
  const view = `public/revamp/models/view-${id}.glb`, world = `public/revamp/models/${id}.glb`;
  const projectile = `public/revamp/models/${id}-projectile.glb`;
  if (!process.argv.includes('--world-only')) optimize(spec.output, view, 1024);
  optimize(`research/blender-exports/${id}-world.glb`, world, 512);
  optimize(`research/blender-exports/${id}-projectile.glb`, projectile, 512);
  const doc = json(bind);
  const matrix = at => {
    const node = doc.nodes[at], local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]), new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const parent = doc.nodes.findIndex(candidate => candidate.children?.includes(at));
    return parent < 0 ? local : matrix(parent).multiply(local);
  };
  const root = doc.nodes.findIndex(node => node.name === 'weapon');
  if (root < 0) throw new Error(`${kind}: no native weapon anchor`);
  const hand = doc.nodes.findIndex(node => node.name === 'ag1_hand_r');
  if (hand < 0) throw new Error(`${kind}: no native right-hand grip anchor`);
  const inventory = JSON.parse(fs.readFileSync(`research/weapon-actions/${id}-export.json`));
  manifest.models[kind] = {build, model: native.m_szWorldModel, skeleton: spec.skeleton,
    inverseBind: matrix(root).invert().toArray(), sourceSha256: spec.bindSha256,
    handInverseBind: matrix(hand).invert().toArray(), nativeArmsSha256: spec.nativeSourceSha256, assemblySourceSha256: spec.sourceSha256,
    world: {url: `/models/${id}.glb`, sha256: hash(world), bytes: fs.statSync(world).size},
    projectile: {url: `/models/${id}-projectile.glb`, sha256: hash(projectile), bytes: fs.statSync(projectile).size},
    view: {url: `/models/view-${id}.glb`, sha256: hash(view), bytes: fs.statSync(view).size},
    clips: inventory.clips, limitations: inventory.limitations};
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`EXPORTED ${kind}: view ${(fs.statSync(view).size / 1048576).toFixed(2)} MiB, world ${(fs.statSync(world).size / 1024).toFixed(0)} KiB`);
}
