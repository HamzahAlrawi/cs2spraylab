import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const definitions = [
  ['ak47', 'weapon_ak47', 'ak47/weapon_rif_ak47', 'ak47/ak47_01'],
  ['m4a4', 'weapon_m4a1', 'm4a4/weapon_rif_m4a4', 'm4a1/m4a1_01'],
  ['m4a1s', 'weapon_m4a1_silencer', 'm4a1_silencer/weapon_rif_m4a1_silencer', 'm4a1/m4a1_silencer_01'],
  ['galil', 'weapon_galilar', 'galilar/weapon_rif_galilar', 'galilar/galil_01'],
  ['famas', 'weapon_famas', 'famas/weapon_rif_famas', 'famas/famas_01'],
  ['sg553', 'weapon_sg556', 'sg556/weapon_rif_sg556', 'sg556/sg556_01'],
  ['aug', 'weapon_aug', 'aug/weapon_rif_aug', 'aug/aug_01'],
  ['mp9', 'weapon_mp9', 'mp9/weapon_smg_mp9', 'mp9/mp9_01'],
  ['mp7', 'weapon_mp7', 'mp7/weapon_smg_mp7', 'mp7/mp7_01'],
  ['mp5sd', 'weapon_mp5sd', 'mp5sd/weapon_smg_mp5sd', 'mp5/mp5_01'],
  ['mac10', 'weapon_mac10', 'mac10/weapon_smg_mac10', 'mac10/mac10_01'],
  ['ump45', 'weapon_ump45', 'ump45/weapon_smg_ump45', 'ump45/ump45_02'],
  ['p90', 'weapon_p90', 'p90/weapon_smg_p90', 'p90/p90_01'],
  ['bizon', 'weapon_bizon', 'bizon/weapon_smg_bizon', 'bizon/bizon_01'],
  ['m249', 'weapon_m249', 'm249/weapon_mach_m249', 'm249/m249_01'],
  ['negev', 'weapon_negev', 'negev/weapon_mach_negev', 'negev/negev_01'],
  ['cz75a', 'weapon_cz75a', 'cz75a/weapon_pist_cz75a', 'cz75a/cz75_01']
];
const run = (...args) => execFileSync(cli, ['-i', vpk, ...args], { stdio: 'pipe', maxBuffer: 20e6 });
fs.mkdirSync('research/raw-models', { recursive: true });
fs.mkdirSync('public/revamp/audio', { recursive: true });
fs.mkdirSync('src/range', { recursive: true });
run('-f', 'scripts/weapons.vdata_c', '-d', '-o', 'research/weapons.vdata');

// Parse the decompiler's KV3 text as a nested structure, including typed values.
const raw = fs.readFileSync('research/weapons.vdata', 'utf8');
const text = raw.replace(/<!--[^]*?-->/g, '');
const tokens = text.match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?|[\w.]+|[{}\[\]=,:]/gi).filter(t => !t.startsWith('//'));
let cursor = 0;
function value() {
  const token = tokens[cursor++];
  if (token === '{') {
    const object = {};
    while (tokens[cursor] !== '}') {
      if (cursor >= tokens.length) throw new Error('Unclosed KV3 object');
      const key = tokens[cursor++].replace(/^"|"$/g, '');
      if (tokens[cursor++] !== '=') throw new Error(`Missing = at ${key}`);
      object[key] = value();
      if (tokens[cursor] === ',') cursor++;
    }
    cursor++;
    return object;
  }
  if (token === '[') {
    const array = [];
    while (tokens[cursor] !== ']') {
      array.push(value());
      if (tokens[cursor] === ',') cursor++;
    }
    cursor++;
    return array;
  }
  if (tokens[cursor] === ':') { cursor++; return value(); }
  if (token.startsWith('"')) return JSON.parse(token);
  if (token === 'true' || token === 'false') return token === 'true';
  if (token === 'null') return null;
  if (Number.isFinite(Number(token))) return Number(token);
  return token;
}
const data = value();
const fields = {
  magazine: 'm_iMaxClip1', cycle: 'm_flCycleTime', speed: 'm_flMaxSpeed',
  spread: 'm_flSpread', stand: 'm_flInaccuracyStand', crouch: 'm_flInaccuracyCrouch', move: 'm_flInaccuracyMove',
  fire: 'm_flInaccuracyFire', recovery: 'm_flRecoveryTimeStand', recoveryFinal: 'm_flRecoveryTimeStandFinal',
  recoveryCrouch: 'm_flRecoveryTimeCrouch', recoilSeed: 'm_nRecoilSeed',
  recoveryCrouchFinal: 'm_flRecoveryTimeCrouchFinal', recoveryStart: 'm_nRecoveryTransitionStartBullet', recoveryEnd: 'm_nRecoveryTransitionEndBullet',
  jump: 'm_flInaccuracyJump', jumpInitial: 'm_flInaccuracyJumpInitial', land: 'm_flInaccuracyLand',
  recoilAngle: 'm_flRecoilAngle', recoilVariance: 'm_flRecoilAngleVariance',
  recoilMagnitude: 'm_flRecoilMagnitude', recoilMagnitudeVariance: 'm_flRecoilMagnitudeVariance',
  damage: 'm_nDamage', rangeModifier: 'm_flRangeModifier', range: 'm_flRange', armorRatio: 'm_flArmorRatio', headshotMultiplier: 'm_flHeadshotMultiplier', reload: 'm_flDisallowAttackAfterReloadStartDuration'
};
const output = { build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1], source: 'scripts/weapons.vdata_c', sha256: crypto.createHash('sha256').update(raw).digest('hex'), weapons: {} };
for (const [id, key, model, sound] of definitions) {
  const source = data[key];
  if (!source) throw new Error(`Missing weapon ${key}`);
  output.weapons[id] = Object.fromEntries(Object.entries(fields).map(([name, field]) => {
    let v = source[field];
    if (Array.isArray(v)) v = v[id === 'm4a1s' ? 1 : 0];
    if (!Number.isFinite(v)) throw new Error(`${key}.${field} is not numeric`);
    return [name, v];
  }));
  Object.assign(output.weapons[id], { fullAuto: source.m_bIsFullAuto, worldModel: source.m_szWorldModel, skeleton: source.m_szAnimSkeleton, fireModes: source.m_flInaccuracyFire });
  console.log(id, output.weapons[id].magazine, output.weapons[id].cycle, 'seed', output.weapons[id].recoilSeed);
  if (!process.argv.includes('--data-only')) {
    if (!fs.existsSync(`research/raw-models/${id}.glb`)) run('-f', `${source.m_szWorldModel}_c`, '-o', `research/raw-models/${id}.glb`, '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt');
    // Even without clips, animation export preserves the weapon's bind skeleton.
    if (!fs.existsSync(`research/raw-models/${id}-rigged.glb`)) run('-f', `${source.m_szWorldModel}_c`, '-o', `research/raw-models/${id}-rigged.glb`, '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations', '--gltf_animation_list', '__bind_pose_only__');
    if (!fs.existsSync(`public/revamp/audio/${id}.wav`)) run('-f', `sounds/weapons/${sound}.vsnd_c`, '-o', `public/revamp/audio/${id}.wav`, '-d');
    console.log(`Exported ${id} model and sound`);
  }
}
fs.writeFileSync('src/range/game-data.json', JSON.stringify(output, null, 2) + '\n');
if (!process.argv.includes('--data-only')) {
  run('-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', 'research/raw-models/target-native.glb', '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations', '--gltf_compose_additive', '--gltf_animation_list', 'idle_rifle,run_e_rifle,run_w_rifle');
  run('-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', 'research/raw-models/view-arms.glb', '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations', '--gltf_compose_additive', '--gltf_animation_list', 'idle_ak,idle_m4a4,idle_rifle,idle_galilar,idle_famas,idle_sg556,idle_aug,idle_mp9,idle_mp7,idle_mp5sd,idle_mac10,idle_ump45,idle_p90,idle_bizon,idle1_m249,idle_negev,idle_cz75a');
  run('-f', 'materials/concrete/hr_c/hr_concrete_wall_001.vmat_c', '-o', 'research/wall.vmat', '-d');
  run('-f', 'materials/concrete/hr_c/hr_concrete_floor_001.vmat_c', '-o', 'research/floor.vmat', '-d');
}
