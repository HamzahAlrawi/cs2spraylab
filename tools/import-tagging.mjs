import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const file = 'research/tagging-weapons.vdata';
fs.mkdirSync('research', {recursive: true});
execFileSync(path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe'),
  ['-i', `${game}/game/csgo/pak01_dir.vpk`, '-f', 'scripts/weapons.vdata_c', '-d', '-o', file],
  {stdio: 'pipe', maxBuffer: 20e6});
const raw = fs.readFileSync(file, 'utf8'), source = parseKv3(raw);
const aliases = {m4a4: 'm4a1', m4a1s: 'm4a1_silencer', galil: 'galilar', sg553: 'sg556', usp: 'usp_silencer'};
const existing = {...JSON.parse(fs.readFileSync('src/range/game-data.json', 'utf8')).weapons,
  ...JSON.parse(fs.readFileSync('src/range/equipment-data.json', 'utf8')).weapons};
const weapons = Object.fromEntries(Object.keys(existing).map(id => {
  const entry = source[`weapon_${aliases[id] ?? id}`];
  const fields = {large: entry?.m_flFlinchVelocityModifierLarge, small: entry?.m_flFlinchVelocityModifierSmall,
    speed: entry?.m_flMaxSpeed[id === 'usp' || id === 'm4a1s' ? 1 : 0]};
  if (!Object.values(fields).every(v => Number.isFinite(v) && v >= 0)) throw new Error(`Missing tagging data: ${id}`);
  if (fields.speed !== existing[id].speed) throw new Error(`Movement data changed for ${id}; audit before importing tagging`);
  return [id, fields];
}));
const output = {build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1],
  source: 'scripts/weapons.vdata_c', sha256: crypto.createHash('sha256').update(raw).digest('hex'), weapons};
fs.writeFileSync('src/range/tagging-data.json', JSON.stringify(output, null, 2) + '\n');
console.log(`Imported tagging for ${Object.keys(weapons).length} weapons, build ${output.build}`);
