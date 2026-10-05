import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import sharp from 'sharp';

// World models/inventory images only. Shared first-person clip tooling is owned
// by the animation worker, and is deliberately not touched by this importer.
const ids = ['nova', 'xm1014', 'mag7', 'sawedoff', 'zeus'];
const data = JSON.parse(fs.readFileSync('src/range/game-data.json', 'utf8'));
const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = process.env.SOURCE2VIEWER_CLI || path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync('research/combat-assets', {recursive: true});
fs.mkdirSync('public/revamp/models', {recursive: true});
const inventory = {build: data.build, source: 'Installed static VPK; native HD meshes and authored inventory images', weapons: {}};
for (const id of ids) {
  const input = `research/raw-models/${id}.glb`, trimmed = `research/combat-assets/${id}.glb`;
  const output = `public/revamp/models/${id}.glb`;
  const document = await io.read(input);
  const legacy = document.getRoot().listNodes().filter(node => node.getName().includes('body_legacy'));
  for (const node of legacy) node.dispose();
  await document.transform(prune());
  await io.write(trimmed, document);
  execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize', trimmed, output,
    '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify-error', '0.0002', '--instance', 'false'], {stdio: 'pipe'});
  const legacyDocument = await io.read(input);
  const legacyMeshes = legacyDocument.getRoot().listNodes().filter(node => node.getMesh() && node.getName().includes('body_legacy'));
  let legacyOutput;
  if (legacyMeshes.length) {
    for (const node of legacyDocument.getRoot().listNodes())
      if (node.getMesh() && !node.getName().includes('body_legacy')) node.dispose();
    await legacyDocument.transform(prune());
    const legacyTrimmed = `research/combat-assets/${id}-legacy.glb`;
    legacyOutput = `public/revamp/models/${id}-legacy.glb`;
    await io.write(legacyTrimmed, legacyDocument);
    execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize', legacyTrimmed, legacyOutput,
      '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify-error', '0.0002', '--instance', 'false'], {stdio: 'pipe'});
  }
  const nativeKey = id === 'zeus' ? 'taser' : id;
  const resource = `panorama/images/econ/weapons/base_weapons/weapon_${nativeKey}_png.vtex_c`;
  const image = `research/combat-assets/${id}.png`, preview = `public/revamp/models/${id}.png`;
  execFileSync(cli, ['-i', vpk, '-f', resource, '-d', '-o', image], {stdio: 'pipe'});
  if (!fs.existsSync(image)) throw new Error(`Native preview missing: ${resource}`);
  await sharp(image).resize(480, 240, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toFile(preview);
  const exported = await io.read(output);
  if (!exported.getRoot().listMeshes().length) throw new Error(`Empty asset: ${id}`);
  inventory.weapons[id] = {worldSource: `${data.weapons[id].worldModel}_c`, sourceGlbSha256: hash(input),
    worldSha256: hash(output), worldBytes: fs.statSync(output).size, previewSource: resource, previewSha256: hash(preview),
    removedLegacyNodes: legacy.length, meshes: exported.getRoot().listMeshes().length,
    ...(legacyOutput ? {legacyWorldSha256:hash(legacyOutput),legacyWorldBytes:fs.statSync(legacyOutput).size} : {}),
    viewStatus: 'Animation worker integration required; no viewclip files modified'};
  console.log(`EXPORTED ${id}: native HD world model + inventory preview`);
}
fs.writeFileSync('docs/combat-asset-inventory.json', JSON.stringify(inventory, null, 2) + '\n');
