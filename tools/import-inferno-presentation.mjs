import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';

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
  const sequence = fs.existsSync(mksPath) ? fs.readFileSync(mksPath, 'utf8').split(/sequence(?:-a)? 0\r?\n/)[1]?.split(/sequence(?:-a)? \d/)[0] : undefined;
  const nativeFrames = sequence ? sequence.split(/\r?\n/).filter(line => line.startsWith('frame ')).map(line => line.split(' ')[1]) : [`${basename}.png`];
  if (!nativeFrames.length || nativeFrames.length > 256) throw new Error(`Unexpected frame inventory: ${kind}`);
  const indices = Array.from({length: Math.min(24, nativeFrames.length)}, (_, i) => Math.floor(i * nativeFrames.length / Math.min(24, nativeFrames.length)));
  const size = kind === 'embers' ? 64 : 160, columns = 4, rows = Math.ceil(indices.length / columns);
  const renderer = resource.definition.m_Renderers.find(r => r._class === 'C_OP_RenderSprites');
  const gradient = renderer.m_vecTexturesInput?.find(input => input.m_Gradient)?.m_Gradient.m_Stops;
  const composites = [];
  for (const [frame, index] of indices.entries()) {
    let image = sharp(`${folder}/${nativeFrames[index]}`).resize(size, size, {fit: 'fill'}).ensureAlpha();
    if (gradient) {
      const pixels = await image.raw().toBuffer();
      for (let at = 0; at < pixels.length; at += 4) {
        const heat = pixels[at] / 255;
        const next = Math.max(1, gradient.findIndex(stop => stop.m_flPosition >= heat));
        const a = gradient[next - 1], b = gradient[next] ?? gradient.at(-1);
        const t = Math.max(0, Math.min(1, (heat - a.m_flPosition) / Math.max(.000001, b.m_flPosition - a.m_flPosition)));
        for (let c = 0; c < 3; c++) pixels[at + c] = Math.round((a.m_Color[c] + (b.m_Color[c] - a.m_Color[c]) * t) * .5 + pixels[at + c] * .5);
      }
      image = sharp(pixels, {raw: {width: size, height: size, channels: 4}});
    }
    composites.push({input: await image.png().toBuffer(), left: frame % columns * size, top: Math.floor(frame / columns) * size});
  }
  const bytes = await sharp({create: {width: columns * size, height: rows * size, channels: 4, background: '#00000000'}})
    .composite(composites).webp({lossless: true}).toBuffer();
  const filename = `inferno-${kind}.webp`; fs.writeFileSync(`${output}/${filename}`, bytes);
  assets[kind] = {particle, particleSha256: resource.compiledSha256, texture: `${texture}_c`,
    textureSha256: hash(fs.readFileSync(`${folder}/source.vtex_c`)), url: `/utility-presentation/${filename}`,
    sha256: hash(bytes), bytes: bytes.length, nativeFrames: nativeFrames.length, frameIndices: indices,
    columns, rows, frames: indices.length, gradient: gradient ?? null, size};
}
fs.writeFileSync('src/range/duel/inferno-presentation-native.json', JSON.stringify({build,
  archiveDirectorySha256: audit.archiveDirectorySha256, viewerSha256: hash(fs.readFileSync(cli)),
  source: 'Installed groundfire snapshot child graph, not the legacy burning-character component.', assets,
  limitations: ['Bounded resampled sequence-zero atlases. Gradient is baked from heat with authored 0.5 mixing.',
    'Source 2 motion-vector interpolation, snapshot emission, decals, volumetric lighting and water-silt selection are not ported.',
    'Placement, dimensions and cycling are browser presentation adaptations, not measured gameplay constants.']}, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, {frames: asset.frames, bytes: asset.bytes}])));
