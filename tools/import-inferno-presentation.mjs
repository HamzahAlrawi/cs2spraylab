import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {tintInfernoPixels} from './inferno-color.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`, root = 'research/inferno-presentation';
const output = 'public/revamp/utility-presentation';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const audit = JSON.parse(fs.readFileSync('research/utility-active-resources/audit.json'));
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)?.[1];
if (!build || !audit.build.includes(`ClientVersion=${build}`) || audit.archiveDirectorySha256 !== hash(fs.readFileSync(vpk)))
  throw new Error('Rerun the active resource audit for the installed build.');
const definitions = {
  center: ['molotov_groundfire_main_center', 'materials/particle/fire_small_sim/fire_small_sim_a.vtex'],
  edge: ['molotov_groundfire_main_fancy', 'materials/particle/fire_small_sim/fire_small_sim_b.vtex'],
  ground: ['molotov_groundfire_snapshot_child_base', 'materials/particle/fire_onsurface/fire_onsurface.vtex'],
  incendiary: ['incendiary_groundfire_main_center', 'materials/particle/fire_small_sim/fire_small_sim_a_v02.vtex'],
  embers: ['molotov_groundfire_outline_embers', 'materials/particle/impact/fleks_glow.vtex'],
};
const assets = {};
fs.mkdirSync(output, {recursive: true});
for (const [kind, [stem, texture]] of Object.entries(definitions)) {
  const particle = `particles/inferno_fx/${stem}.vpcf_c`, resource = audit.resources[particle];
  if (!resource?.references.includes(texture)) throw new Error(`Missing authored texture link: ${particle}`);
  const folder = `${root}/${kind}`; fs.mkdirSync(folder, {recursive: true});
  const run = args => execFileSync(cli, ['-i', vpk, ...args], {windowsHide: true, stdio: 'pipe', maxBuffer: 20e6});
  run(['-f', `${texture}_c`, '-o', `${folder}/source.vtex_c`]);
  run(['-f', `${texture}_c`, '-d', '-o', `${folder}/texture.png`]);
  const basename = path.basename(texture, '.vtex'), mksPath = `${folder}/${basename}.mks`;
  const sequences = fs.existsSync(mksPath) ? [...fs.readFileSync(mksPath, 'utf8').matchAll(/sequence(?:-a)? (\d+)\r?\n([\s\S]*?)(?=sequence(?:-a)? \d+\r?\n|$)/g)]
    .slice(0, 8).map(match => ({nativeSequence: Number(match[1]),
      files: match[2].split(/\r?\n/).filter(line => line.startsWith('frame ')).map(line => line.split(' ')[1])}))
    : [{nativeSequence: 0, files: [`${basename}.png`]}];
  const nativeFrames = [], frameSequences = [];
  for (const sequence of sequences) {
    if (!sequence.files.length || sequence.files.length > 256) throw new Error(`Unexpected frame inventory: ${kind}`);
    const indices = Array.from({length: Math.min(24, sequence.files.length)}, (_, i) => Math.floor(i * sequence.files.length / Math.min(24, sequence.files.length)));
    frameSequences.push({nativeSequence: sequence.nativeSequence, start: nativeFrames.length, count: indices.length, nativeFrames: sequence.files.length, frameIndices: indices});
    nativeFrames.push(...indices.map(i => sequence.files[i]));
  }
  const size = kind === 'embers' ? 64 : 160, columns = 8, rows = Math.ceil(nativeFrames.length / columns);
  const renderer = resource.definition.m_Renderers.find(r => r._class === 'C_OP_RenderSprites');
  const gradientLayer = renderer.m_vecTexturesInput?.find(input => input.m_Gradient);
  const gradient = gradientLayer?.m_Gradient.m_Stops;
  const gradientBlend = gradientLayer?.m_flTextureBlend?.m_flLiteralValue ?? 1;
  const composites = [];
  for (const [frame, filename] of nativeFrames.entries()) {
    let image = sharp(`${folder}/${filename}`).resize(size, size, {fit: 'fill'}).ensureAlpha();
    if (gradient) {
      const pixels = tintInfernoPixels(await image.raw().toBuffer(), gradient, gradientBlend);
      image = sharp(pixels, {raw: {width: size, height: size, channels: 4}});
    }
    composites.push({input: await image.png().toBuffer(), left: frame % columns * size, top: Math.floor(frame / columns) * size});
  }
  const bytes = await sharp({create: {width: columns * size, height: rows * size, channels: 4, background: '#00000000'}})
    .composite(composites).webp({quality: 90, alphaQuality: 100, effort: 6}).toBuffer();
  const filename = `inferno-${kind}-${hash(bytes).slice(0, 12)}.webp`; fs.writeFileSync(`${output}/${filename}`, bytes);
  for (const old of fs.readdirSync(output)) if (old !== filename && new RegExp(`^inferno-${kind}(?:-[a-f0-9]{12})?\\.webp$`).test(old))
    fs.unlinkSync(path.join(output, old));
  assets[kind] = {particle, particleSha256: resource.compiledSha256, texture: `${texture}_c`,
    textureSha256: hash(fs.readFileSync(`${folder}/source.vtex_c`)), url: `/utility-presentation/${filename}`,
    sha256: hash(bytes), bytes: bytes.length, sequences: frameSequences,
    columns, rows, frames: nativeFrames.length, gradient: gradient ?? null, gradientBlend, size,
    compression: {format: 'webp', quality: 90, alphaQuality: 100},
    presentation: {blend: renderer.m_nOutputBlendMode ?? 'default', overbright: renderer.m_flOverbrightFactor?.m_flLiteralValue ?? 1,
      alphaScale: renderer.m_flAlphaScale?.m_flLiteralValue ?? renderer.m_flAlphaScale ?? 1, orientation: renderer.m_nOrientationType ?? 'screen-aligned',
      lifetime: resource.definition.m_Initializers.find(x => x._class === 'C_INIT_InitFloat' && x.m_nOutputField === 1)?.m_InputValue
        ? (() => {const input = resource.definition.m_Initializers.find(x => x._class === 'C_INIT_InitFloat' && x.m_nOutputField === 1).m_InputValue;
          return [input.m_flRandomMin, input.m_flRandomMax];})() : [1, 2],
      operators: resource.definition.m_Operators.filter(x => /FadeIn$|FadeOut$|FadeAndKill|InterpolateRadius/.test(x._class))}};
}
fs.writeFileSync('src/range/duel/inferno-presentation-native.json', JSON.stringify({build,
  archiveDirectorySha256: audit.archiveDirectorySha256, viewerSha256: hash(fs.readFileSync(cli)),
  source: 'Installed groundfire snapshot child graph, not the legacy burning-character component.', assets,
  limitations: ['Up to eight native sequences per layer, at most 24 resampled frames per sequence. Luminance/multiply gradient bake follows the VRF spritecard interpretation, not a native shader replay.',
    'Source 2 motion-vector interpolation, snapshot emission, decals, volumetric lighting and water-silt selection are not ported.',
    'Snapshot emission density, placement, dimensions and lifetime scaling remain browser adaptations, not measured gameplay constants.']}, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, {frames: asset.frames, bytes: asset.bytes}])));
