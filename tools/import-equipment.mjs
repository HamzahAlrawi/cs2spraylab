import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const run = (...args) => execFileSync(cli, ['-i', `${game}/game/csgo/pak01_dir.vpk`, ...args], {stdio: 'pipe', maxBuffer: 20e6});
fs.mkdirSync('research/raw-models', {recursive: true});
fs.mkdirSync('public/revamp/audio', {recursive: true});
run('-f', 'scripts/weapons.vdata_c', '-d', '-o', 'research/equipment-weapons.vdata');
const raw = fs.readFileSync('research/equipment-weapons.vdata', 'utf8');
const source = parseKv3(raw);
const fields = {magazine: 'm_iMaxClip1', cycle: 'm_flCycleTime', speed: 'm_flMaxSpeed', deploy: 'm_flDeployDuration', reload: 'm_flDisallowAttackAfterReloadStartDuration', stand: 'm_flInaccuracyStand', crouch: 'm_flInaccuracyCrouch', move: 'm_flInaccuracyMove', spread: 'm_flSpread', fire: 'm_flInaccuracyFire', recovery: 'm_flRecoveryTimeStand', recoilSeed: 'm_nRecoilSeed', recoilAngle: 'm_flRecoilAngle', recoilVariance: 'm_flRecoilAngleVariance', recoilMagnitude: 'm_flRecoilMagnitude', recoilMagnitudeVariance: 'm_flRecoilMagnitudeVariance'};
const output = {build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1], source: 'scripts/weapons.vdata_c', sha256: crypto.createHash('sha256').update(raw).digest('hex'), weapons: {}};
for (const [id, key, sound] of [['usp', 'weapon_usp_silencer', 'usp/usp_01'], ['knife', 'weapon_knife', 'knife/knife_slash1']]) {
  const data = source[key];
  const stats = Object.fromEntries(Object.entries(fields).map(([name, field]) => {
    const v = Array.isArray(data[field]) ? data[field][id === 'usp' ? 1 : 0] : data[field];
    if (!Number.isFinite(v)) throw new Error(`Missing ${key}.${field}`);
    return [name, v];
  }));
  Object.assign(stats, {fullAuto: data.m_bIsFullAuto, worldModel: id === 'knife' ? 'weapons/models/knife/knife_butterfly/weapon_knife_butterfly.vmdl' : data.m_szWorldModel, skeleton: id === 'knife' ? 'animation/skeletons/weapons/knife_butterfly.vnmskel' : data.m_szAnimSkeleton});
  output.weapons[id] = stats;
  console.log(id, JSON.stringify(stats));
  if (process.argv.includes('--data-only')) continue;
  for (const rigged of [false, true]) {
    const file = `research/raw-models/${id}${rigged ? '-rigged' : ''}.glb`;
    if (!fs.existsSync(file)) run('-f', `${stats.worldModel}_c`, '-o', file, '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt', ...(rigged ? ['--gltf_export_animations', '--gltf_animation_list', '__bind_pose_only__'] : []));
  }
  run('-f', `sounds/weapons/${sound}.vsnd_c`, '-o', `public/revamp/audio/${id}.wav`, '-d');
}
fs.writeFileSync('src/range/equipment-data.json', JSON.stringify(output, null, 2) + '\n');
if (!process.argv.includes('--data-only')) run('-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', 'research/raw-models/equipment-arms.glb', '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations', '--gltf_compose_additive', '--gltf_animation_list', 'idle_pistol,idle1_butterfly');
