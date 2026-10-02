import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {parseKv3} from './kv3.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataFile = path.join(root, 'src/range/weapon-fx-data.json');
const textureUrl = '/textures/weapon-muzzle-flame.webp';
const textureFile = path.join(root, 'public/revamp', textureUrl);
const particleDirectory = 'particles/weapons/cs_weapon_fx/';
const particle = name => `${particleDirectory}weapon_muzzle_flash_${name}.vpcf`;
const fpParticle = particle('assaultrifle_fp');
const ventParticle = particle('assaultrifle_vent_fp');
const glowParticle = particle('assaultrifle_main_fp');
const flameParticle = particle('assualtrifle_flame');
const nativeTexture = 'materials/effects/muzzleflashx.vtex';
const weaponSource = 'scripts/weapons.vdata_c';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = file => sha256(fs.readFileSync(file));

// These are Equipment aliases, not a selectable-weapon list.
const aliases = {
  ak47: 'ak47', m4a4: 'm4a1', m4a1s: 'm4a1_silencer', galil: 'galilar', famas: 'famas', sg553: 'sg556', aug: 'aug',
  mp9: 'mp9', mp7: 'mp7', mp5sd: 'mp5sd', mac10: 'mac10', ump45: 'ump45', p90: 'p90', bizon: 'bizon',
  m249: 'm249', negev: 'negev', cz75a: 'cz75a', usp: 'usp_silencer', glock: 'glock', hkp2000: 'hkp2000',
  p250: 'p250', deagle: 'deagle', elite: 'elite', fiveseven: 'fiveseven', tec9: 'tec9', revolver: 'revolver',
  awp: 'awp', ssg08: 'ssg08', g3sg1: 'g3sg1', scar20: 'scar20', knife: 'knife',
};

export function weaponFxRow(id, source) {
  assert(source && typeof source === 'object', `Missing native weapon ${id}`);
  const activeMode = id === 'm4a1s' || id === 'usp' ? 1 : 0;
  const modes = Array.isArray(source.m_nTracerFrequency) ? source.m_nTracerFrequency : [source.m_nTracerFrequency];
  const tracerFrequency = modes[Array.isArray(source.m_nTracerFrequency) ? activeMode : 0];
  assert(modes.every(value => Number.isInteger(value) && value >= 0), `${id}: invalid tracer modes`);
  assert(Number.isInteger(tracerFrequency) && tracerFrequency >= 0, `${id}: missing active tracer mode`);
  const silencerType = source.m_eSilencerType;
  assert(['WEAPONSILENCER_NONE', 'WEAPONSILENCER_DETACHABLE', 'WEAPONSILENCER_INTEGRATED'].includes(silencerType), `${id}: unknown silencer type`);
  const silenced = silencerType === 'WEAPONSILENCER_INTEGRATED' || silencerType === 'WEAPONSILENCER_DETACHABLE' && activeMode === 1;
  const muzzleFamily = {
    WEAPONTYPE_RIFLE: silenced ? 'assaultrifle_silenced' : 'assaultrifle_fp',
    WEAPONTYPE_SUBMACHINEGUN: silenced ? 'smg_silenced_fp' : 'smg_fp',
    WEAPONTYPE_MACHINEGUN: 'para_fp',
    WEAPONTYPE_PISTOL: silenced ? 'pistol_silenced' : 'pistol_fp',
    WEAPONTYPE_SNIPER_RIFLE: 'huntingrifle_fp',
  }[source.m_WeaponType];
  const tracerParticle = source.m_szTracerParticle;
  if (tracerParticle !== undefined) assert(typeof tracerParticle === 'string' && tracerParticle.endsWith('.vpcf'), `${id}: invalid tracer particle`);
  return {
    tracerFrequency, silenced, activeMode, tracerFrequencyModes: [...modes], silencerType,
    ...(muzzleFamily ? {muzzleParticle: particle(muzzleFamily), muzzleParticleBasis: 'native-weapon-type-family-candidate'} : {}),
    ...(tracerParticle ? {tracerParticle} : {}),
  };
}

// Native additive DXT1 sprites have opaque black; derive straight alpha for Three.Sprite.
export function additiveToStraightAlpha(pixels) {
  assert(pixels.length % 4 === 0, 'Expected RGBA pixels');
  const output = Buffer.from(pixels);
  for (let i = 0; i < output.length; i += 4) {
    const alpha = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    for (let channel = 0; channel < 3; channel++) output[i + channel] = alpha ? Math.round(pixels[i + channel] * 255 / alpha) : 0;
    output[i + 3] = alpha;
  }
  return output;
}

function validateWeaponContract(weapons) {
  assert.deepEqual(Object.keys(weapons).sort(), Object.keys(aliases).sort(), 'Equipment coverage changed');
  for (const [id, row] of Object.entries(weapons)) {
    assert(Number.isInteger(row.tracerFrequency) && row.tracerFrequency >= 0, `${id}: invalid frequency`);
    assert.equal(typeof row.silenced, 'boolean', `${id}: invalid silenced flag`);
    const mode = id === 'm4a1s' || id === 'usp' ? 1 : 0;
    assert.equal(row.activeMode, mode, `${id}: wrong active mode`);
    assert.equal(row.tracerFrequency, row.tracerFrequencyModes[row.tracerFrequencyModes.length > 1 ? mode : 0]);
    assert.equal(row.silenced, ['m4a1s', 'usp', 'mp5sd'].includes(id), `${id}: unexpected silencer state`);
    if (row.tracerParticle) assert.match(row.tracerParticleSourceSha256, /^[a-f0-9]{64}$/);
    if (row.muzzleParticle) assert.match(row.muzzleParticleSourceSha256, /^[a-f0-9]{64}$/);
    assert.match(row.sourceSha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(weapons.m4a1s.tracerFrequencyModes, [3, 0]);
  assert.deepEqual(weapons.usp.tracerFrequencyModes, [1, 0]);
  assert.equal(weapons.m4a1s.tracerFrequency, 0);
  assert.equal(weapons.usp.tracerFrequency, 0);
  assert.equal(weapons.mp5sd.tracerFrequency, 0);
  assert.equal(weapons.knife.tracerFrequency, 0);
}

async function textureStats(input) {
  const {data, info} = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  let transparent = 0, translucent = 0, visible = 0, min = 255, max = 0;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    min = Math.min(min, alpha); max = Math.max(max, alpha);
    transparent += +(alpha === 0); translucent += +(alpha > 0 && alpha < 255); visible += +(alpha > 0);
  }
  assert(transparent > 0 && translucent > 0 && visible > 0 && max > 0, 'Flame must have transparent background, soft edges and visible pixels');
  for (const index of [0, info.width - 1, (info.height - 1) * info.width, info.width * info.height - 1]) {
    assert.equal(data[index * 4 + 3], 0, 'Flame corners must be transparent');
  }
  return {width: info.width, height: info.height, channels: info.channels, alphaMin: min, alphaMax: max,
    transparentPixels: transparent, translucentPixels: translucent, visiblePixels: visible};
}

export async function verifyWeaponFx() {
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(data.muzzleTexture, textureUrl);
  validateWeaponContract(data.weapons);
  assert.equal(fileHash(textureFile), data.muzzleTextureMetadata.sha256, 'Texture SHA mismatch');
  assert.deepEqual(await textureStats(textureFile), data.muzzleTextureMetadata.pixels, 'Texture pixel metadata mismatch');
  const equipment = JSON.parse(fs.readFileSync(path.join(root, 'src/range/game-data.json'), 'utf8')).weapons;
  assert.deepEqual(Object.keys(data.weapons).sort(), [...Object.keys(equipment), 'knife'].sort(), 'Equipment JSON coverage mismatch');
  for (const row of Object.values(data.weapons)) for (const kind of ['muzzle', 'tracer']) {
    if (row[`${kind}Particle`]) assert.equal(row[`${kind}ParticleSourceSha256`], data.particles[row[`${kind}Particle`]].sourceSha256);
  }
  assert(data.particles[fpParticle].children.includes(ventParticle));
  assert(data.particles[ventParticle].renderers.some(renderer => renderer.textures.includes(nativeTexture)));
  assert(data.particles[glowParticle].renderers.every(renderer => !renderer.textures.includes(nativeTexture)));
  console.log(`Verified ${Object.keys(data.weapons).length} Equipment rows, suppressed modes and ${textureUrl} alpha/SHA.`);
}

export async function importWeaponFx() {
  const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
  const cli = process.env.SOURCE2VIEWER_CLI || path.join(root, '.local-tools/vrf/Source2Viewer-CLI.exe');
  const vpk = path.join(game, 'game/csgo/pak01_dir.vpk');
  assert(fs.existsSync(cli), `Source2Viewer CLI not found: ${cli}`);
  assert(fs.existsSync(vpk), `CS2 VPK not found: ${vpk}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spraylab-weapon-fx-'));
  const run = (...args) => execFileSync(cli, ['-i', vpk, ...args], {encoding: 'utf8', stdio: 'pipe', maxBuffer: 20e6});
  const resources = new Map();
  const extract = resource => {
    if (resources.has(resource)) return resources.get(resource);
    assert(/^(scripts|particles|materials)\/[a-zA-Z0-9_./-]+$/.test(resource) && !resource.includes('..'), `Unsafe resource ${resource}`);
    const compiledResource = resource.endsWith('_c') ? resource : `${resource}_c`;
    const folder = path.join(work, String(resources.size));
    fs.mkdirSync(folder);
    const compiled = path.join(folder, path.posix.basename(compiledResource));
    const decompiled = path.join(folder, path.posix.basename(compiledResource).replace(/_c$/, ''));
    run('-f', compiledResource, '-o', compiled);
    assert(fs.existsSync(compiled), `Missing ${compiledResource}`);
    run('-f', compiledResource, '-d', '--texture_decode_flags', 'Auto', '-o', decompiled);
    assert(fs.existsSync(decompiled), `Cannot decompile ${compiledResource}`);
    const result = {folder, compiled, decompiled, sourceSha256: fileHash(compiled), sha256: fileHash(decompiled)};
    resources.set(resource, result);
    return result;
  };
  try {
    const source = extract(weaponSource), native = parseKv3(fs.readFileSync(source.decompiled, 'utf8'));
    const weapons = Object.fromEntries(Object.entries(aliases).map(([id, alias]) => [id, {
      ...weaponFxRow(id, native[`weapon_${alias}`]), nativeKey: `weapon_${alias}`, sourceSha256: source.sourceSha256,
    }]));
    const particles = {};
    const queue = [fpParticle, glowParticle, flameParticle, particle('assaultrifle'),
      ...Object.values(weapons).flatMap(row => [row.muzzleParticle, row.tracerParticle]).filter(Boolean)];
    for (const resource of queue) {
      if (particles[resource]) continue;
      const extracted = extract(resource), definition = parseKv3(fs.readFileSync(extracted.decompiled, 'utf8'));
      const children = (definition.m_Children ?? []).map(child => child.m_ChildRef);
      assert(children.every(child => typeof child === 'string' && child.endsWith('.vpcf')), `Invalid children for ${resource}`);
      const renderers = (definition.m_Renderers ?? []).map(renderer => ({
        type: renderer._class, textures: (renderer.m_vecTexturesInput ?? []).map(input => input.m_hTexture).filter(Boolean),
        ...(renderer.m_nOutputBlendMode ? {blendMode: renderer.m_nOutputBlendMode} : {}),
        ...(renderer.m_vecTexturesInput?.some(input => input.m_Gradient) ? {
          colorGradients: renderer.m_vecTexturesInput.filter(input => input.m_Gradient).map(input => input.m_Gradient.m_Stops),
        } : {}),
      }));
      particles[resource] = {source: `${resource}_c`, sourceSha256: extracted.sourceSha256, sha256: extracted.sha256, children, renderers};
      queue.push(...children);
      if (Object.keys(particles).length % 8 === 0) console.log(`Parsed ${Object.keys(particles).length} native particle definitions.`);
    }
    for (const row of Object.values(weapons)) for (const kind of ['muzzle', 'tracer']) {
      if (row[`${kind}Particle`]) row[`${kind}ParticleSourceSha256`] = particles[row[`${kind}Particle`]].sourceSha256;
    }
    validateWeaponContract(weapons);
    assert(particles[ventParticle].renderers.some(renderer => renderer.textures.includes(nativeTexture)), 'Native flame texture reference changed');
    const texture = extract(nativeTexture);
    const png = path.join(texture.folder, 'muzzleflashx.png');
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    assert.equal(decoded.info.width, 128); assert.equal(decoded.info.height, 128);
    for (let i = 3; i < decoded.data.length; i += 4) assert.equal(decoded.data[i], 255, 'Native additive alpha layout changed');
    const webp = await sharp(additiveToStraightAlpha(decoded.data), {raw: decoded.info}).webp({lossless: true, effort: 6}).toBuffer();
    const pixels = await textureStats(webp);
    const vent = parseKv3(fs.readFileSync(resources.get(ventParticle).decompiled, 'utf8'));
    const radius = vent.m_Initializers.find(initializer => initializer._class === 'C_INIT_CreationNoise');
    const lifetime = vent.m_Initializers.find(initializer => initializer._class === 'C_INIT_InitFloat' && initializer.m_nOutputField === 1)?.m_InputValue;
    assert(radius && lifetime, 'Native size/lifetime initializers changed');
    const build = fs.readFileSync(path.join(game, 'game/csgo/steam.inf'), 'utf8').match(/^ClientVersion=(\d+)/m)?.[1];
    assert(build, 'Missing CS2 ClientVersion');
    const output = {schema: 1, build, source: weaponSource, sourceSha256: source.sourceSha256, sha256: source.sha256,
      muzzleTexture: textureUrl, muzzleTextureMetadata: {
        source: `${nativeTexture}_c`, sourceSha256: texture.sourceSha256, decodedPngSha256: fileHash(png), sha256: sha256(webp),
        particle: ventParticle, pixels, atlas: false, colorSpace: 'srgb', alphaMode: 'straight',
        alphaConversion: 'alpha=max(R,G,B); straightRGB=round(RGB*255/alpha); black=transparent',
        decoding: 'Source2Viewer -d --texture_decode_flags Auto; Sharp lossless WebP; no resize',
        nativeRadiusUnitsApprox: [radius.m_flOutputMin, radius.m_flOutputMax],
        nativeDiameterUnitsApprox: [radius.m_flOutputMin * 2, radius.m_flOutputMax * 2],
        nativeLifetimeSeconds: [lifetime.m_flRandomMin, lifetime.m_flRandomMax],
        scaleNote: 'Native particle radius, not a measured FP screen size. Caller may use its own 0.06m presentation scale.',
      }, weapons, particles: Object.fromEntries(Object.entries(particles).sort(([a], [b]) => a.localeCompare(b)))};
    fs.mkdirSync(path.dirname(textureFile), {recursive: true});
    fs.writeFileSync(textureFile, webp);
    fs.writeFileSync(dataFile, JSON.stringify(output, null, 2) + '\n');
    console.log(`Imported ${Object.keys(weapons).length} Equipment rows, ${Object.keys(particles).length} particles, ${webp.length} texture bytes.`);
    await verifyWeaponFx();
    return output;
  } finally {
    const target = path.resolve(work), tempRoot = path.resolve(os.tmpdir());
    assert(target.startsWith(tempRoot + path.sep) && /^spraylab-weapon-fx-[a-zA-Z0-9]+$/.test(path.basename(target)), 'Unsafe temporary cleanup');
    fs.rmSync(target, {recursive: true, force: true});
  }
}

export function selfTestWeaponFx() {
  const native = parseKv3('{ m_nTracerFrequency = [3, 0] m_eSilencerType = "WEAPONSILENCER_DETACHABLE" m_WeaponType = "WEAPONTYPE_RIFLE" }');
  assert.equal(weaponFxRow('m4a1s', native).tracerFrequency, 0);
  assert.equal(weaponFxRow('m4a1s', native).silenced, true);
  assert.equal(weaponFxRow('ak47', {...native, m_eSilencerType: 'WEAPONSILENCER_NONE'}).tracerFrequency, 3);
  assert.equal(weaponFxRow('usp', {...native, m_nTracerFrequency: [1, 0]}).tracerFrequency, 0);
  assert.equal(weaponFxRow('mp5sd', {...native, m_nTracerFrequency: 0, m_eSilencerType: 'WEAPONSILENCER_INTEGRATED'}).silenced, true);
  assert.throws(() => weaponFxRow('usp', {...native, m_nTracerFrequency: [1]}));
  assert.throws(() => weaponFxRow('ak47', {...native, m_nTracerFrequency: -1}));
  assert.throws(() => weaponFxRow('ak47', {...native, m_eSilencerType: 'UNKNOWN'}));
  assert.deepEqual([...additiveToStraightAlpha(Buffer.from([0, 0, 0, 255, 128, 64, 32, 255, 255, 128, 0, 255]))],
    [0, 0, 0, 0, 255, 128, 64, 128, 255, 128, 0, 255]);
  assert.throws(() => additiveToStraightAlpha(Buffer.from([0, 0, 0])));
  console.log('Weapon FX self-tests passed: active modes, silencer states, invalid data and alpha conversion.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length <= 1 && args.every(arg => ['--verify', '--self-test'].includes(arg)), 'Usage: node tools/import-weapon-fx.mjs [--verify|--self-test]');
  if (args.includes('--self-test')) selfTestWeaponFx();
  else if (args.includes('--verify')) await verifyWeaponFx();
  else await importWeaponFx();
}
