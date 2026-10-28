import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const commit = '44fb66eab70fb3b1b7112ed3c30cc68fb977dd26';
const base = `https://raw.githubusercontent.com/lengran/OpenPrefirePrac/${commit}/`;
const files = ['a_long', 'a_short', 'b_tunnel', 'ct_push_lower', 'ct_push_mid', 'mid_to_b'];
const fetchText = async path => {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
};
const profiles = {};
for (const file of files) {
  const text = await fetchText(`maps/de_dust2/${file}.txt`);
  const lines = text.trim().split(/\r?\n/).map(line => line.trim());
  const [activeBots, spawnRatio] = lines[1].split(/\s+/).map(Number);
  const player = lines[2].split(/\s+/).map(Number);
  const angles = [], guide = [];
  for (const line of lines.slice(3)) {
    const tokens = line.split(/\s+/);
    if (tokens.length >= 7) {
      const numbers = tokens.slice(0, 6).map(Number);
      if (!numbers.every(Number.isFinite) || !['True', 'False'].includes(tokens[6])) throw new Error(`Invalid angle: ${file}`);
      angles.push({position: numbers.slice(0, 3), rotation: numbers.slice(3, 6), crouched: tokens[6] === 'True'});
    } else if (tokens.length === 3) {
      const point = tokens.map(Number);
      if (!point.every(Number.isFinite)) throw new Error(`Invalid guide: ${file}`);
      guide.push(point);
    }
  }
  profiles[file] = {file: `maps/de_dust2/${file}.txt`, sha256: createHash('sha256').update(text).digest('hex'),
    activeBots, spawnRatio, spawn: player.slice(0, 3), rotation: player.slice(3, 6), angles, guide};
}
const licenseNotice = await fetchText('LICENSE');
const dataset = {source: 'https://github.com/lengran/OpenPrefirePrac', commit, license: 'MIT', licenseNotice, profiles};
await fs.writeFile(new URL('./openprefire-dust2.json', import.meta.url), JSON.stringify(dataset, null, 2) + '\n');
await fs.writeFile(new URL('./OpenPrefirePrac.LICENSE.txt', import.meta.url), licenseNotice);
console.log(`Imported ${Object.values(profiles).reduce((sum, profile) => sum + profile.angles.length, 0)} static practice positions at ${commit}.`);
