import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {parseKeyValues} from './cosmetic-keyvalues.mjs';
import {parseKv3} from './kv3.mjs';
import {importInventoryPreview} from './native-inventory-preview.mjs';

// Offline only. This reads installed game archives; it never touches a running game.
const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf/Source2Viewer-CLI.exe');
const blender = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const work = 'research/cosmetic-actors';
const out = 'public/revamp/models';
const run = args => execFileSync(cli, ['-i', vpk, ...args], {encoding: 'utf8', stdio: 'pipe', maxBuffer: 80e6});
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const refresh = process.argv.includes('--refresh');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
for (const dir of [work, out]) fs.mkdirSync(dir, {recursive: true});
for (const [resource, name] of [['scripts/items/items_game.txt', 'items_game.txt'], ['resource/csgo_english.txt', 'csgo_english.txt']]) {
  if (refresh || !fs.existsSync(`${work}/${name}`)) run(['-f', resource, '-o', `${work}/${name}`]);
}
const items = parseKeyValues(fs.readFileSync(`${work}/items_game.txt`, 'utf8')).items_game;
const language = fs.readFileSync(`${work}/csgo_english.txt`);
const tokens = Object.fromEntries(Object.entries(parseKeyValues(language.toString(language[0] === 255 ? 'utf16le' : 'utf8')).lang.Tokens)
  .map(([key, value]) => [key.toLowerCase(), value]));
const label = token => tokens[token.replace(/^#/, '').toLowerCase()] || token;
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
const definitions = [
  ['agent-sas', '5602', null, 4000, 3],
  ['agent-ava', '5308', null, 6500, 5],
  ['agent-ricksaw', '5404', null, 8000, 7],
  ['agent-slingshot', '5207', null, 5000, 4],
  ['agent-darryl', '4726', null, 12000, 10],
  ['agent-dabisi', '4776', null, 10000, 8],
  ['gloves-bloodhound-charred', '5027', '10006', 15000, 10],
  ['gloves-wraps-slaughter', '5032', '10021', 24000, 12],
  ['gloves-driver-crimson', '5031', '10016', 32000, 14],
  ['gloves-sport-superconductor', '5030', '10018', 60000, 22],
  ['gloves-moto-spearmint', '5033', '10026', 45000, 18],
  ['gloves-specialist-kimono', '5034', '10033', 52000, 20],
  ['gloves-hydra-case-hardened', '5035', '10060', 20000, 11],
  ['gloves-brokenfang-jade', '4725', '10085', 28000, 13],
];
const listing = run(['-l', '-e', 'vmdl_c,vmat_c,vtex_c']);
const resources = new Map([...listing.matchAll(/^(\S+) CRC:(\w+) size:(\d+)/gm)]
  .map(([, file, crc, bytes]) => [file, {path: file, crc, bytes: Number(bytes)}]));
const native = (resource, destination) => {
  if (!resources.has(resource)) throw new Error(`Native archive resource is absent: ${resource}`);
  if (refresh || !fs.existsSync(destination)) run(['-f', resource, '-o', destination]);
  return {...resources.get(resource), path: resource, sha256: hash(destination)};
};
const catalogPath = 'src/range/actor-cosmetics-data.json';
const previous = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath)) : {cosmetics: []};
const rows = new Map(previous.cosmetics.map(row => [row.id, row]));
if (!only || only.some(id => id.startsWith('gloves-'))) await importInventoryPreview({id: 'gloves-standard', cli, vpk, work,
  resource: 'panorama/images/econ/weapons/base_weapons/ct_gloves_png.vtex_c'});
for (const [id, itemId, kitId, price, unlockLevel] of definitions) {
  if (only && !only.includes(id)) continue;
  const item = items.items[itemId];
  if (!item?.model_player) throw new Error(`Missing native item ${itemId}`);
  const equipment = kitId ? 'gloves' : 'agent';
  const source = `${item.model_player}_c`;
  const sourceFile = `${work}/${id}.vmdl_c`;
  const provenance = {model: native(source, sourceFile)};
  const raw = `${work}/${id}-native.glb`;
  const signature = `${build}:${source}`;
  const stamp = `${work}/${id}-source.json`;
  if (refresh || !fs.existsSync(raw) || !fs.existsSync(stamp) || JSON.parse(fs.readFileSync(stamp)).signature !== signature) {
    run(['-f', source, '-o', raw, '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt',
      '--gltf_export_animations', '--gltf_compose_additive', '--gltf_animation_list', kitId ? '__bind_pose_only__' : 'idle_rifle,run_e_rifle,run_w_rifle']);
    fs.writeFileSync(stamp, JSON.stringify({signature}));
  }
  const textures = [];
  const kit = kitId ? items.paint_kits[kitId] : undefined;
  if (kit) {
    const materialFile = `${work}/${id}.vmat_c`;
    const finishSource = resources.has(`${kit.vmt_path}_c`) ? `${kit.vmt_path}_c` : `gloves/paints/${kit.name}.vmat_c`;
    provenance.finish = native(finishSource, materialFile);
    const block = execFileSync(cli, ['-i', materialFile, '-b', 'DATA'], {encoding: 'utf8', maxBuffer: 10e6});
    const material = parseKv3(block.slice(block.indexOf('<!-- kv3')));
    for (const param of material.m_textureParams || []) {
      if (!['g_tColor', 'g_tNormal', 'g_tPattern', 'g_tLayerMask', 'g_tSurface'].includes(param.m_name)) continue;
      const resource = `${param.m_pValue.replace(/_c$/, '')}_c`;
      const file = `${work}/${id}-${param.m_name}.png`;
      const packed = `${work}/${id}-${param.m_name}.vtex_c`;
      const info = native(resource, packed);
      if (refresh || !fs.existsSync(file)) run(['-f', resource, '-d', '-o', file]);
      textures.push({name: param.m_name, file, ...info});
    }
    // Approximate the native layer palette and fixed UV pattern offline. This
    // is deliberately not Valve's wear/detail/roughness material compositor.
    const size = 1024;
    const palette = Object.fromEntries(material.m_vectorParams.map(p => [p.m_name, p.m_value]));
    const scalar = Object.fromEntries(material.m_floatParams.map(p => [p.m_name, p.m_flValue]));
    const pixels = async name => {
      const texture = textures.find(t => t.name === name);
      return texture ? sharp(texture.file).resize(size, size).ensureAlpha().raw().toBuffer() : null;
    };
    const mask = await pixels('g_tLayerMask'), pattern = await pixels('g_tPattern'), surface = await pixels('g_tSurface');
    const direct = await pixels('g_tColor');
    if (!mask && !direct) throw new Error(`${id}: native layer mask or color is missing`);
    const colors = Array.from({length: 8}, (_, i) => palette[`g_vColorTint${i + 1}`] || [.18, .18, .18]);
    const indices = palette.g_vPatternPaletteIndices || [1, 2, 3, 4];
    const scale = scalar.g_fPatternTexCoordScale || 1;
    const rgba = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const weights = mask ? [mask[offset] / 255, mask[offset + 1] / 255, mask[offset + 2] / 255] : [0, 0, 0];
      weights.push(Math.max(0, 1 - weights[0] - weights[1] - weights[2]));
      const uv = (Math.floor((y * scale) % size) * size + Math.floor((x * scale) % size)) * 4;
      const patternWeights = pattern ? [pattern[uv] / 255, pattern[uv + 1] / 255, pattern[uv + 2] / 255] : [0, 0, 0];
      patternWeights.push(Math.max(0, 1 - patternWeights[0] - patternWeights[1] - patternWeights[2]));
      const ao = surface ? .6 + .4 * surface[offset] / 255 : 1;
      for (let channel = 0; channel < 3; channel++) {
        const base = direct ? direct[offset + channel] / 255 : weights.reduce((sum, weight, i) => sum + weight * colors[i][channel], 0);
        const patterned = patternWeights.reduce((sum, weight, i) => sum + weight * colors[Math.max(0, Math.min(7, indices[i] - 1))][channel], 0);
        rgba[offset + channel] = Math.round(255 * ao * (pattern ? base * (1 - weights[2] * .75) + patterned * weights[2] * .75 : base));
      }
      rgba[offset + 3] = 255;
    }
    const file = `${work}/${id}-approx-albedo.png`;
    await sharp(rgba, {raw: {width: size, height: size, channels: 4}}).png().toFile(file);
    textures.push({name: 'approxAlbedo', file, sha256: hash(file)});
  }
  const spec = {id, equipment, build, raw, textures, output: `${out}/${id}.glb`, preview: `${out}/${id}.png`,
    reference: 'research/raw-models/target-native.glb', source};
  const specPath = `${work}/${id}.json`;
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  if (process.argv.includes('--extract-only')) continue;
  console.log(`Building native actor ${id}`);
  execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', 'art/build_cosmetic_actors.py', '--', specPath],
    {stdio: 'pipe', maxBuffer: 30e6});
  const optimized = `${work}/${id}-optimized.glb`;
  execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize', spec.output, optimized,
    '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false', '--instance', 'false'],
    {stdio: 'pipe', maxBuffer: 10e6});
  fs.copyFileSync(optimized, spec.output);
  const audit = JSON.parse(fs.readFileSync(`${work}/${id}-export.json`));
  const row = {id, label: kit ? `${label(item.item_name)} | ${label(kit.description_tag)}` : label(item.item_name),
    equipment, category: equipment, price, unlockLevel, imageUrl: `/models/${id}.png`, assetKey: id,
    modelUrl: `/models/${id}.glb`, itemId, ...(kitId ? {kitId} : {}), source, native: {...provenance, textures},
    sourceSha256: provenance.model.sha256, rawSha256: hash(raw), assetSha256: hash(spec.output),
    imageSha256: hash(spec.preview), bytes: fs.statSync(spec.output).size, geometry: audit,
    rendering: kit ? 'native glove geometry and finish textures; simplified fixed-finish PBR, no randomized wear/seed or Source 2 material compositor' :
      'native agent geometry/materials, shared native humanoid bones; no held weapon; shared duel motion clips'};
  if (kit) Object.assign(row, await importInventoryPreview({id, cli, vpk, work,
    resource: `panorama/images/econ/default_generated/${item.name}_${kit.name}_light_png.vtex_c`}));
  rows.set(id, row);
  fs.writeFileSync(catalogPath, JSON.stringify({schema: 1, build, itemsSha256: hash(`${work}/items_game.txt`), cosmetics: [...rows.values()]}, null, 2) + '\n');
  console.log(`EXPORTED ${id}: ${(row.bytes / 1048576).toFixed(2)} MiB, ${audit.vertices} vertices`);
}
