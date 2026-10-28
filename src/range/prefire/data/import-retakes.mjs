import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const commit = '2fde4a9cc21e791d6909b98bacc833aa5c54bdad';
const repository = 'https://github.com/B3none/cs2-retakes';
const file = 'RetakesPlugin/map_config/de_dust2.json';
const base = `https://raw.githubusercontent.com/B3none/cs2-retakes/${commit}/`;
async function text(path) {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}
const raw = await text(file), licenseNotice = await text('LICENSE');
const coordinates = value => {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length !== 3 || tokens.some(token => !/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(token))) throw new Error(`Invalid native coordinate: ${value}`);
  const point = tokens.map(token => Number(token.replaceAll(',', '')));
  if (!point.every(Number.isFinite)) throw new Error('Non-finite coordinate');
  return point;
};
const angles = JSON.parse(raw).Spawns.map((spawn, i) => ({index: i + 1, position: coordinates(spawn.Vector),
  rotation: coordinates(spawn.QAngle), team: spawn.Team, site: spawn.Bombsite === 0 ? 'a' : 'b', crouched: false}));
const result = {source: repository, commit, file, sha256: createHash('sha256').update(raw).digest('hex'),
  license: 'GPL-3.0', licenseNotice, context: 'Authored post-plant retake spawns; not match-frequency telemetry.', angles};
await fs.writeFile(new URL('./retakes-dust2.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
await fs.writeFile(new URL('./Retakes.LICENSE.txt', import.meta.url), licenseNotice);
console.log(`Imported ${angles.length} authored retake placements at ${commit}.`);
