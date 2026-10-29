import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`, root = 'research/he-explosion';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const audit = JSON.parse(fs.readFileSync('research/utility-active-resources/audit.json'));
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)?.[1];
if (!build || !audit.build.includes(`ClientVersion=${build}`) || hash(fs.readFileSync(vpk)) !== audit.archiveDirectorySha256)
  throw Error('Installed build/archive differs from the source audit.');
fs.mkdirSync(root, {recursive: true});
const run = args => execFileSync(cli, args, {windowsHide: true, encoding: 'utf8', maxBuffer: 20e6});
const definitions = {};
for (const layer of ['core', 'ground', 'blasts']) {
  const particle = `particles/explosions_fx/explosion_hegrenade_smoke_${layer}.vpcf_c`;
  const target = `${root}/${layer}.vpcf_c`;
  run(['-i', vpk, '-f', particle, '-o', target]);
  const text = run(['-i', target, '-b', 'DATA']);
  const definition = parseKv3(text.slice(text.indexOf('<!-- kv3')));
  definitions[layer] = {particle, particleSha256: hash(fs.readFileSync(target)), definition};
}
fs.writeFileSync(`${root}/definitions.json`, JSON.stringify(definitions));
if (process.argv.includes('--inspect')) {
  const compact = (key, value) => value && typeof value === 'object' && value.m_nType
    ? {type: value.m_nType, literal: value.m_flLiteralValue ?? value.m_vLiteralValue, min: value.m_flRandomMin, max: value.m_flRandomMax} : value;
  for (const [name, source] of Object.entries(definitions)) console.log(name, JSON.stringify(source, compact));
  process.exit(0);
}
const source = definitions.core.definition.m_Renderers[0].m_vecTexturesInput[0].m_hTexture + '_c';
const textureTarget = `${root}/smoke.vtex_c`;
run(['-i', vpk, '-f', source, '-o', textureTarget]);
run(['-i', vpk, '-f', source, '-d', '-o', `${root}/smoke.png`]);
const stem = path.basename(source, '.vtex_c');
const mks = fs.readFileSync(`${root}/${stem}.mks`, 'utf8');
const sequences = [], frames = [];
for (const match of mks.matchAll(/sequence(?:-a)? (\d+)\r?\n([\s\S]*?)(?=sequence(?:-a)? \d+\r?\n|$)/g)) {
  if (Number(match[1]) > 4) continue;
  const files = match[2].split(/\r?\n/).filter(line => line.startsWith('frame ')).map(line => line.split(' ')[1]);
  if (!files.length || files.length > 256) throw Error('Unexpected smoke sequence');
  const indices = Array.from({length: Math.min(files.length, 24)}, (_, i) => Math.floor(i * files.length / Math.min(files.length, 24)));
  sequences.push({nativeSequence: Number(match[1]), start: frames.length, count: indices.length, nativeFrames: files.length, indices});
  frames.push(...indices.map(i => files[i]));
}
if (!sequences.length) throw Error('Missing native smoke sequences');
const columns = 8, size = 128, rows = Math.ceil(frames.length / columns), parts = [];
for (const [i, frame] of frames.entries()) parts.push({input: await sharp(`${root}/${frame}`).resize(size, size).ensureAlpha().png().toBuffer(),
  left: i % columns * size, top: Math.floor(i / columns) * size});
const bytes = await sharp({create: {width: columns * size, height: rows * size, channels: 4, background: '#00000000'}})
  .composite(parts).webp({quality: 90, alphaQuality: 100, effort: 6}).toBuffer();
const out = 'public/revamp/utility-presentation', filename = `he-smoke-${hash(bytes).slice(0, 12)}.webp`;
fs.mkdirSync(out, {recursive: true}); fs.writeFileSync(`${out}/${filename}`, bytes);
for (const old of fs.readdirSync(out)) if (old !== filename && /^he-smoke-[a-f0-9]{12}\.webp$/.test(old)) fs.unlinkSync(path.join(out, old));
const range = input => {
  if (input?.m_nType === 'PF_TYPE_RANDOM_UNIFORM') return [input.m_flRandomMin, input.m_flRandomMax];
  if (input?.m_nType === 'PF_TYPE_LITERAL') return [input.m_flLiteralValue, input.m_flLiteralValue];
  throw Error('Unexpected native scalar provider');
};
const profiles = {};
for (const layer of ['core', 'ground']) {
  const {particle, particleSha256, definition: d} = definitions[layer];
  const scalar = field => range(d.m_Initializers.find(x => x._class === 'C_INIT_InitFloat' && x.m_nOutputField === field)?.m_InputValue);
  const growth = d.m_Operators.find(x => x._class === 'C_OP_InterpolateRadius');
  const fade = d.m_Operators.find(x => x._class === 'C_OP_FadeOut');
  const motion = d.m_Operators.find(x => x._class === 'C_OP_BasicMovement');
  const offset = d.m_Initializers.find(x => x._class === 'C_INIT_PositionOffset');
  const speed = d.m_Initializers.find(x => x._class === 'C_INIT_CreateWithinSphereTransform');
  const ring = d.m_Initializers.find(x => x._class === 'C_INIT_RingWave');
  const delays = d.m_Emitters.flatMap(e => Array.from({length: e.m_nParticlesToEmit.m_nType === 'PF_TYPE_LITERAL'
    ? e.m_nParticlesToEmit.m_flLiteralValue : e.m_nParticlesToEmit.m_flLOD0}, () => e.m_flStartTime?.m_flLiteralValue ?? 0));
  if (!delays.length || delays.length > d.m_nMaxParticles) throw Error('Unexpected native emission budget');
  profiles[layer] = {particle, particleSha256, delays, lifetime: scalar(1), radiusUnits: scalar(undefined), alpha: scalar(7),
    offsetMin: offset.m_OffsetMin.m_vLiteralValue, offsetMax: offset.m_OffsetMax.m_vLiteralValue,
    speedMin: speed?.m_LocalCoordinateSystemSpeedMin.m_vLiteralValue ?? [0, 0, 0],
    speedMax: speed?.m_LocalCoordinateSystemSpeedMax.m_vLiteralValue ?? [0, 0, 0],
    ringRadius: ring?.m_flInitialRadius.m_flLiteralValue ?? 0,
    ringSpeed: ring ? [ring.m_flInitialSpeedMin.m_flLiteralValue, ring.m_flInitialSpeedMax.m_flLiteralValue] : [0, 0],
    gravity: motion.m_Gravity ?? [0, 0, 0], drag: motion.m_fDrag,
    startScale: growth.m_flStartScale, growthBias: growth.m_flBias, fadeOut: [fade.m_flFadeOutTimeMin, fade.m_flFadeOutTimeMax],
    color: d.m_Renderers[0].m_vecColorScale.m_LiteralColor};
}
const manifest = {build, archiveDirectorySha256: audit.archiveDirectorySha256, viewerSha256: hash(fs.readFileSync(cli)),
  parent: 'particles/explosions_fx/explosion_hegrenade.vpcf_c',
  parentSha256: audit.resources['particles/explosions_fx/explosion_hegrenade.vpcf_c'].compiledSha256,
  asset: {texture: source, textureSha256: hash(fs.readFileSync(textureTarget)), url: `/utility-presentation/${filename}`,
    sha256: hash(bytes), bytes: bytes.length, columns, rows, size, frames: frames.length, sequences}, profiles,
  duration: Math.max(...Object.values(profiles).map(p => Math.max(...p.delays) + p.lifetime[1])),
  limitations: ['Native static particle fields and texture frames; not the complete Source 2 particle renderer.',
    'LOD0 ground count, deterministic native-range samples, adapted drag/lighting/fade and no motion-vector warp or depth feathering.',
    'Blast trails, debris, full dynamic lighting and particle shadows are not represented. This smoke is cosmetic, not smoke-grenade sight density.']};
fs.writeFileSync('src/range/duel/he-explosion-native.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({build, bytes: bytes.length, frames: frames.length, duration: manifest.duration, profiles}));
