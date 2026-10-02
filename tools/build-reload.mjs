import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {selectViewClips, supportedViewIds} from './native-view-clips.mjs';
import {auditViewActions} from './native-view-clips.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const blender = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const run = args => execFileSync(cli, ['-i', `${game}/game/csgo/pak01_dir.vpk`, ...args], {encoding: 'utf8', stdio: 'pipe', maxBuffer: 50e6});
const listing = run(['-l', '-f', 'animation/anims/viewmodel/', '-e', 'vnmclip_c']);
const files = [...listing.matchAll(/^(\S+\.vnmclip_c) CRC:(\w+) size:(\d+)/gm)];
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
const data = {...JSON.parse(fs.readFileSync('src/range/game-data.json')).weapons,
  ...JSON.parse(fs.readFileSync('src/range/equipment-data.json')).weapons};
data['knife-butterfly'] = {skeleton: 'animation/skeletons/weapons/knife_butterfly.vnmskel'};
const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const ids = requested.length ? requested : Object.keys(data).filter(id => id !== 'knife-butterfly' || fs.existsSync('research/raw-models/knife-butterfly-rigged.glb'));
const legacyRequested = process.argv.includes('--legacy');
for (const id of ids) if (!supportedViewIds.includes(id) || !data[id]) throw new Error(`Missing supported weapon data: ${id}`);
fs.mkdirSync('research/weapon-actions', {recursive: true});
fs.mkdirSync('research/blender-exports', {recursive: true});
const inventoryPath = 'docs/weapon-animation-inventory.json';
const inventory = fs.existsSync(inventoryPath) ? JSON.parse(fs.readFileSync(inventoryPath)) : {schema: 1, weapons: {}};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

for (const id of ids) {
  const assetKey = id + (legacyRequested ? '-legacy' : '');
  const clips = selectViewClips(id, files.map(row => row[1]));
  const source = `research/raw-models/actions-${id}.glb`;
  const specPath = `research/weapon-actions/${assetKey}.json`;
  const bind = `research/raw-models/${id}-rigged.glb`;
  if (!fs.existsSync(bind)) throw new Error(`${id}: missing native bind ${bind}; import it first.`);
  const bindBytes = fs.readFileSync(bind), bindJson = JSON.parse(bindBytes.subarray(20, 20 + bindBytes.readUInt32LE(12)));
  const variant = legacyRequested || !bindJson.meshes.some(mesh => mesh.name?.includes('body_hd')) && bindJson.meshes.some(mesh => mesh.name?.includes('body_legacy')) ? 'legacy' : 'hd';
  if (id === 'knife' && !data[id].skeleton.includes('knife_default_ct')) throw new Error('Import the default CT knife before rebuilding view-knife.');
  const spec = {id, assetKey, variant, build, source, bind, skeleton: data[id].skeleton, clips,
    actionAudit: auditViewActions(id, files.map(row => row[1]), clips),
    nativeFiles: Object.fromEntries(Object.entries(clips).map(([label, file]) => {
      const row = files.find(row => row[1] === file);
      return [label, {path: file, crc: row[2], bytes: Number(row[3])}];
    })), pickup: clips.pickup ? 'native' : 'reuse-native-draw',
    output: `research/blender-exports/view-${assetKey}.glb`};
  const signature = JSON.stringify({build, clips});
  const modernSpec = `research/weapon-actions/${id}.json`;
  const previous = fs.existsSync(modernSpec) ? JSON.parse(fs.readFileSync(modernSpec)) : null;
  if (!process.argv.includes('--reuse-source') || !fs.existsSync(source) || previous?.signature !== signature) {
    console.log(`Extracting first-person arms + secondary skeletons: ${id}`);
    run(['-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', source, '-d', '--gltf_export_format', 'glb',
      '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations', '--gltf_compose_additive',
      '--gltf_animation_list', Object.values(clips).map(file => path.posix.basename(file, '.vnmclip_c')).join(',')]);
  }
  Object.assign(spec, {signature, sourceSha256: hash(source), bindSha256: hash(bind)});
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
  if (process.argv.includes('--extract-only')) continue;
  execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', 'art/build_reload.py', '--', specPath],
    {stdio: 'inherit', maxBuffer: 30e6});
  const output = `public/revamp/models/view-${assetKey}.glb`;
  if (process.argv.includes('--no-optimize')) fs.copyFileSync(spec.output, output);
  else execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize', spec.output, output,
    '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify-error', '0.0002', '--instance', 'false'],
  {stdio: 'pipe', maxBuffer: 10e6});
  inventory.schema = 2;
  inventory.weapons[assetKey] = {...JSON.parse(fs.readFileSync(`research/weapon-actions/${assetKey}-export.json`)),
    bytes: fs.statSync(output).size, sha256: hash(output)};
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  console.log(`EXPORTED ${assetKey}: ${Object.keys(clips).join(', ')}; pickup ${spec.pickup}; ${(fs.statSync(output).size / 1048576).toFixed(2)} MiB`);
}
