import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`, root = 'research/utility-presentation/particles';
const out = 'public/revamp/utility-presentation';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const manifestPath = 'src/range/duel/utility-particles-native.json';
const provenanceOnly = process.argv.includes('--provenance-only');
const previous = provenanceOnly ? JSON.parse(fs.readFileSync(manifestPath)) : undefined;
const auditPath = 'research/utility-active-resources/audit.json';
if (!fs.existsSync(auditPath)) throw new Error('Run tools/audit-utility-active-resources.mjs before importing particles');
const audit = JSON.parse(fs.readFileSync(auditPath));
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)?.[1];
if (!build || !audit.build.includes(`ClientVersion=${build}`) || audit.archiveDirectorySha256 !== hash(fs.readFileSync(vpk)) ||
  audit.viewerSha256 !== hash(fs.readFileSync(cli))) throw new Error('Audit/install/tool mismatch; rerun tools/audit-utility-active-resources.mjs');
const sources = {smoke: ['particles/explosions_fx/explosion_smokegrenade_s1_child_smoke03e.vpcf_c',
  'materials/particle/vistasmokev1/vistasmokev1_emods.vtex_c', 'vistasmokev1_emods', 3, 192],
fire: ['particles/inferno_fx/molotov_groundfire_main.vpcf_c',
  'materials/particle/fire_burning_character/fire_burning_character.vtex_c', 'fire_burning_character', 4, 192],
flash: ['particles/explosions_fx/explosion_flashbang.vpcf_c',
  'materials/particle/particle_flares/aircraft_blue.vtex_c', 'aircraft_blue', 1, 256],
he: ['particles/explosions_fx/explosion_hegrenade.vpcf_c',
  'materials/particle/particle_flares/particle_flare_001.vtex_c', 'particle_flare_001', 1, 128]};
fs.mkdirSync(root, {recursive: true}); fs.mkdirSync(out, {recursive: true});
const assets = {};
for (const [kind, [particle, texture, stem, columns, size]] of Object.entries(sources)) {
  const run = args => execFileSync(cli, ['-i', vpk, ...args], {windowsHide: true, maxBuffer: 8e6});
  run(['-f', particle, '-o', `${root}/${kind}.vpcf_c`]);
  run(['-f', particle, '-d', '-o', `${root}/${kind}.vpcf`]);
  const definition = fs.readFileSync(`${root}/${kind}.vpcf`);
  if (!definition.toString().includes(texture.replace(/_c$/, ''))) throw new Error('Particle/texture mismatch');
  const core = kind === 'flash' || kind === 'he';
  const textureArchive = core ? `${game}/game/core/pak01_dir.vpk` : vpk;
  execFileSync(cli, ['-i', textureArchive, '-f', texture, '-o', `${root}/${kind}.vtex_c`], {windowsHide: true});
  const identity = {particleCompiledSha256: hash(fs.readFileSync(`${root}/${kind}.vpcf_c`)),
    particleDefinitionSha256: hash(definition), textureSha256: hash(fs.readFileSync(`${root}/${kind}.vtex_c`))};
  if (audit.resources[particle]?.compiledSha256 !== identity.particleCompiledSha256)
    throw new Error(`${kind}: rerun audit-utility-active-resources.mjs for this install`);
  if (provenanceOnly) {
    const old = previous.assets[kind];
    if (!old || old.columns !== columns || old.cellSize !== size) throw new Error(`${kind}: full atlas import required`);
    const bytes = old.url.startsWith('data:') ? Buffer.from(old.url.split(',')[1], 'base64') : fs.readFileSync(`public/revamp${old.url}`);
    if (old.textureSha256 !== identity.textureSha256 || hash(bytes) !== old.sha256)
      throw new Error(`${kind}: existing atlas/source hash mismatch; full reimport required`);
    assets[kind] = {...old, ...identity, renderers: parseKv3(definition.toString()).m_Renderers};
    continue;
  }
  // A dedicated decode directory prevents an unrelated/stale .mks from choosing the frames.
  const decode = `${root}/${kind}-${identity.textureSha256.slice(0, 16)}-decode`;
  fs.mkdirSync(decode, {recursive: true});
  execFileSync(cli, ['-i', textureArchive, '-f', texture, '-d', '-o', `${decode}/${kind}.png`],
    {windowsHide: true, maxBuffer: 8e6});
  const mks = `${decode}/${stem}.mks`;
  const files = fs.existsSync(mks) ? fs.readFileSync(mks, 'utf8').split(/sequence(?:-a)? 0\r?\n/)[1].split(/sequence(?:-a)? \d/)[0]
    .split(/\r?\n/).filter(line => line.startsWith('frame ')).map(line => line.split(' ')[1]) : [`${stem}.png`];
  if (!files.length || files.length > 32) throw new Error('Unexpected native frame budget');
  const rows = Math.ceil(files.length / columns), composites = [];
  for (let i = 0; i < files.length; i++) {
    let image = sharp(`${decode}/${files[i]}`).resize(size, size, {fit: 'fill'}).ensureAlpha();
    if (kind === 'smoke') {
      // Native SPRITECARD_TEXTURE_CHANNEL_MIX_A supplies opacity, not the ember-like RGB emods.
      const alpha = await image.extractChannel(3).raw().toBuffer();
      const rgba = Buffer.alloc(size * size * 4, 255);
      for (let p = 0; p < alpha.length; p++) rgba[p * 4 + 3] = alpha[p];
      image = sharp(rgba, {raw: {width: size, height: size, channels: 4}});
    }
    composites.push({input: await image.png().toBuffer(), left: i % columns * size, top: Math.floor(i / columns) * size});
  }
  const atlas = await sharp({create: {width: columns * size, height: rows * size, channels: 4, background: '#00000000'}})
    .composite(composites).webp({lossless: true}).toBuffer();
  const filename=kind==='he'?`he-core-${hash(atlas).slice(0,12)}.webp`:`${kind}.webp`;
  fs.writeFileSync(`${out}/${filename}`,atlas);
  const def = parseKv3(definition.toString());
  assets[kind] = {particle, ...identity, texture, textureArchive: core ? 'core' : 'csgo',
    textureSha256: hash(fs.readFileSync(`${root}/${kind}.vtex_c`)), sequence: 0, nativeFrames: files,
    columns, rows, frames: files.length, cellSize: size,
    url: `/utility-presentation/${filename}`,
    sha256: hash(atlas), bytes: atlas.length,
    renderers: def.m_Renderers, channel: kind === 'smoke' ? 'A' : kind === 'he' ? 'A_RGBALPHA' : 'RGBA'};
}
const roles = {smoke: 'legacy-s1-terminal-child-not-cs2-volume', fire: 'single-legacy-component-not-complete-groundfire',
  flash: 'authored-flashbang-world-flare-not-player-exposure-or-he', he: 'default-basic-child-core-only-not-full-explosion'};
for (const [kind, asset] of Object.entries(assets)) asset.sourceRole = roles[kind];
const flashDefinition = audit.resources[sources.flash[0]].definition;
const lifespan = flashDefinition.m_Initializers.find(op => op._class === 'C_INIT_InitFloat' && op.m_nOutputField === 1)?.m_InputValue;
if (lifespan?.m_nType !== 'PF_TYPE_LITERAL' ||
  ![lifespan.m_flLiteralValue, flashDefinition.m_flConstantRadius].every(value => Number.isFinite(value) && value > 0))
  throw new Error('Flash parameters require manual review');
const weapons = audit.resources['scripts/weapons.vdata_c'].definition;
const names = {he: 'hegrenade', flash: 'flashbang', smoke: 'smokegrenade', molotov: 'molotov', incendiary: 'incgrenade', decoy: 'decoy'};
const heDefinition = audit.resources[sources.he[0]].definition;
const heRadius = heDefinition.m_Initializers.find(op => op._class === 'C_INIT_InitFloat' && !('m_nOutputField' in op))?.m_InputValue;
const heScale = heDefinition.m_Operators.find(op => op._class === 'C_OP_InterpolateRadius');
const heLife = heDefinition.m_Initializers.find(op => op._class === 'C_INIT_InitFloat' && op.m_nOutputField === 1)?.m_InputValue;
const heRenderer = heDefinition.m_Renderers.find(op => op._class === 'C_OP_RenderSprites' && !op.m_bOnlyRenderInEffectsBloomPass);
if (heRadius?.m_nType !== 'PF_TYPE_RANDOM_UNIFORM' || heLife?.m_nType !== 'PF_TYPE_LITERAL' ||
  heRenderer?.m_flRadiusScale?.m_nType !== 'PF_TYPE_LITERAL' || heRenderer?.m_flOverbrightFactor?.m_nType !== 'PF_TYPE_LITERAL' ||
  ![heRadius.m_flRandomMin, heRadius.m_flRandomMax, heLife.m_flLiteralValue, heScale?.m_flStartScale,
    heScale?.m_flEndScale, heRenderer.m_flRadiusScale.m_flLiteralValue, heRenderer.m_flOverbrightFactor.m_flLiteralValue]
    .every(value => Number.isFinite(value) && value > 0)) throw new Error('HE parameters require manual review');
const heRoot = 'particles/explosions_fx/explosion_basic.vpcf_c';
if (!audit.resources[heRoot]?.definition.m_Children?.some(child => `${child.m_ChildRef}_c` === sources.he[0]))
  throw new Error('HE default child graph changed; manual review required');
const nativeParameters = {flash: {radiusSourceUnits: flashDefinition.m_flConstantRadius, lifetimeSeconds: lifespan.m_flLiteralValue},
  he: {root: heRoot, color: heDefinition.m_ConstantColor.slice(0, 3),
    lifetimeSeconds: heLife.m_flLiteralValue,
    radiusMin: heRadius.m_flRandomMin, radiusMax: heRadius.m_flRandomMax, startScale: heScale.m_flStartScale,
    endScale: heScale.m_flEndScale, radiusScale: heRenderer.m_flRadiusScale.m_flLiteralValue,
    overbright: heRenderer.m_flOverbrightFactor.m_flLiteralValue},
  droppedModelScale: Object.fromEntries(Object.entries(names).map(([kind, name]) => [kind, weapons[`weapon_${name}`].m_flDroppedModelScale ?? null]))};
if (Object.values(nativeParameters.droppedModelScale).some(value => value !== null && (!Number.isFinite(value) || value <= 0)))
  throw new Error('Dropped model scales require manual review');
fs.writeFileSync(manifestPath, JSON.stringify({schema: 2, build,
  audit: {report: 'docs/utility-active-resource-audit-2026-10-26.json', viewer: audit.viewer.split('\n')[0].trim(),
    viewerSha256: audit.viewerSha256, archiveDirectorySha256: audit.archiveDirectorySha256,
    runtimeSelection: 'Not established by resource presence; native gameplay selection is outside this static resource audit.'},
  nativeParameters, assets,
  limitations: ['Native sequence-zero frames resampled to bounded browser atlases, not a Source 2 particle interpreter.',
    'Smoke uses a legacy S1 terminal-child opacity atlas, not active CS2 volumetric smoke. No fallback-selection evidence was found.',
    'Fire uses one legacy flame atlas, not the snapshot-driven groundfire child graph, motion vectors or color lookup gradients.',
    'Frame cycling, placement, lighting and emission are presentation approximations; fire size and cycle speed are not native measurements.',
    'Flash depth testing is retained because native VisibilityInputs is not implemented; fade curve and color composition remain approximations.',
    'HE uses only the default explosion_basic -> explosion_hegrenade core, not smoke/debris/distortion children, bloom-only rendering or near/dirt/snow/water selection. Radius midpoint and interpolation/fade are bounded browser approximations.',
    'Missing dropped-model scale (Molotov) stays null; browser unit scale is a fallback, not a measured native default.']}, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(assets).map(([kind, a]) => [kind, {frames: a.frames, bytes: a.bytes}])));
