import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const root = 'research/utility-active-resources';
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const run = args => execFileSync(cli, args, {encoding: 'utf8', windowsHide: true, maxBuffer: 80e6});
const archive = name => `${game}/game/${name}/pak01_dir.vpk`;
const viewerSha256 = sha256(fs.readFileSync(cli));
const listing = run(['-i', archive('csgo'), '-l']);
const entries = [...listing.matchAll(/^(\S+) CRC:(\w+) size:(\d+)/gm)];
const previous = process.argv.includes('--reuse-extracted') && fs.existsSync(`${root}/audit.json`)
  ? JSON.parse(fs.readFileSync(`${root}/audit.json`)) : undefined;
const selected = entries.filter(([, name]) =>
  /^particles\/explosions_fx\/explosion_(smokegrenade|flashbang)/.test(name) ||
  /^particles\/inferno_fx\/(molotov_groundfire|incendiary_groundfire|molotov_fire01|incendiary_fire01)/.test(name) ||
  /^particles\/weapons\/cs_weapon_fx\/weapon_molotov_(held|thrown)/.test(name) ||
  name === 'scripts/weapons.vdata_c' ||
  /^weapons\/models\/grenade\/[^/]+\/weapon_[^/]+\.vmdl_c$/.test(name) ||
  /(?:smokegrenade.*vsnap_c|smoke.*\.vfx_c)$/.test(name) ||
  /^particles\/explosions_fx\/explosion_child_smoke_(pointcloud|adaptive)\.vpcf_c$/.test(name) ||
  /^particles\/inferno_fx\/fire_(core|edge)\.vsnap_c$/.test(name) ||
  /^materials\/particle\/particle_smokegrenade1?\.vmat_c$/.test(name) ||
  /^particles\/explosions_fx\/explosion_(basic|hegrenade(?:_brief|_smoke_core|_flash_ana)?)\.vpcf_c$/.test(name));
const resources = {};
for (const [, name, crc, bytes] of selected) {
  const target = `${root}/${name}`;
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const old = previous?.resources[name];
  if (previous?.viewerSha256 === viewerSha256 && old?.crc === crc && fs.existsSync(target) && sha256(fs.readFileSync(target)) === old.compiledSha256 &&
    (!name.endsWith('.vmdl_c') || old.attachments)) {resources[name] = old; continue;}
  run(['-i', archive('csgo'), '-f', name, '-o', target]);
  const data = fs.readFileSync(target);
  const text = run(['-i', target, '-b', 'DATA']);
  fs.writeFileSync(`${target}.txt`, text);
  const refs = run(['-i', target, '-b', 'RERL']);
  const resource = {archive: 'csgo', crc, bytes: Number(bytes), compiledSha256: sha256(data),
    decodedSha256: sha256(text), references: [...new Set([...refs.matchAll(/m_pResourceName = "([^"]+)"/g)].map(m => m[1]))]};
  if (name.endsWith('.vpcf_c') || name.endsWith('.vdata_c')) {
    const start = text.indexOf('<!-- kv3');
    resource.definition = parseKv3(text.slice(start));
  } else if (name.endsWith('.vmdl_c')) {
    const mesh = run(['-i', target, '-b', 'MDAT']);
    fs.writeFileSync(`${target}.MDAT.txt`, mesh);
    const start = mesh.indexOf('<!-- kv3');
    resource.attachments = start >= 0 ? parseKv3(mesh.slice(start)).m_attachments ?? [] : [];
    resource.meshDataSha256 = sha256(mesh);
  } else if (name.endsWith('.vmat_c')) {
    const start = text.indexOf('<!-- kv3');
    resource.definition = parseKv3(text.slice(start));
  }
  resources[name] = resource;
}
const report = {schema: 1, build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').trim(),
  viewer: run(['--version']).trim(), viewerSha256,
  archiveDirectorySha256: sha256(fs.readFileSync(archive('csgo'))),
  selection: 'Installed csgo pak01 resources, not proof of runtime selection. No process or binary inspection.', resources};
const shaderArchive = `${game}/game/csgo/shaders_pc_dir.vpk`;
report.shaders = {};
for (const [, name, crc, bytes] of [...run(['-i', shaderArchive, '-l']).matchAll(/^(\S+) CRC:(\w+) size:(\d+)/gm)]
  .filter(([, name]) => /\/smoke_volume.*\.vcs$/.test(name))) {
  const target = `${root}/${name}`;
  fs.mkdirSync(path.dirname(target), {recursive: true});
  run(['-i', shaderArchive, '-f', name, '-o', target]);
  let inspection;
  try {inspection = run(['-i', target]);} catch (error) {inspection = `${error.stdout ?? ''}${error.stderr ?? ''}`;}
  fs.writeFileSync(`${target}.txt`, inspection);
  const metadata = run(['-i', target, '-b', 'DATA']);
  fs.writeFileSync(`${target}.DATA.txt`, metadata);
  report.shaders[name] = {archive: 'csgo/shaders_pc', crc, bytes: Number(bytes),
    compiledSha256: sha256(fs.readFileSync(target)), metadataSha256: sha256(metadata),
    bindingAndComboNames: [...new Set([...metadata.matchAll(/m_szName = "([^"]+)"/g)].map(m => m[1]))],
    inspection: inspection.trim()};
}
// Runtime-selection evidence belongs to the separate native-code audit, not this resource inventory.
fs.writeFileSync(`${root}/audit.json`, JSON.stringify(report, null, 2) + '\n');
const schema = resources['scripts/weapons.vdata_c'].definition;
const compact = value => JSON.parse(JSON.stringify(value, (key, v) => {
  if (v && typeof v === 'object' && /^(PF_|PVEC_)/.test(v.m_nType ?? '')) {
    const keys = ['m_nType', 'm_nMapType', 'm_flLiteralValue', 'm_vLiteralValue', 'm_LiteralColor',
      'm_nControlPoint', 'm_nVectorComponent', 'm_nScalarAttribute', 'm_nVectorAttribute', 'm_nOutputField',
      'm_flInput0', 'm_flInput1', 'm_flOutput0', 'm_flOutput1', 'm_flMultFactor', 'm_flRandomMin', 'm_flRandomMax',
      'm_Curve', 'm_Gradient'];
    return Object.fromEntries(keys.filter(k => k in v).map(k => [k, v[k]]));
  }
  return v;
}));
const summary = {...report, resources: Object.fromEntries(Object.entries(resources).map(([name, r]) => {
  const {definition, ...identity} = r;
  const parameters = definition && Object.fromEntries(['m_nMaxParticles', 'm_hSnapshot', 'm_nSnapshotControlPoint',
    'm_flConstantRadius', 'm_flConstantLifespan', 'm_ConstantColor', 'm_Children', 'm_PreEmissionOperators',
    'm_Emitters', 'm_Initializers', 'm_Operators', 'm_Renderers', 'm_shaderName', 'm_textureParams']
    .filter(k => k in definition).map(k => [k, definition[k]]));
  return [name, {...identity, parameters: compact(parameters ?? {})}];
})), weaponSchema: Object.fromEntries(['hegrenade', 'flashbang', 'smokegrenade', 'molotov', 'incgrenade', 'decoy']
  .map(n => [`weapon_${n}`, Object.fromEntries(Object.entries(schema[`weapon_${n}`])
    .filter(([k]) => /m_szWorldModel|m_flDroppedModelScale|m_vSmokeColor|Particle|Effect/.test(k)))]))};
summary.parameterSummary = 'Selected fields; PF/PVEC descriptors omit auxiliary defaults. Full decoded blocks remain in research with hashes above.';
fs.writeFileSync('docs/utility-active-resource-audit-2026-10-26.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`Audited ${selected.length} resources: ${root}/audit.json`);
