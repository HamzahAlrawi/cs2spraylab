import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const archive = `${game}/game/csgo/pak01_dir.vpk`;
const sources = [
  ['game', 'scripts/surfaceproperties_game.txt', 'research/ballistic-surface-game.txt'],
  ['physics', 'surfaceproperties/surfaceproperties.vsurf_c', 'research/ballistic-surface-properties.vsurf'],
];
const native = {}, sourceHashes = {};
for (const [kind, source, output] of sources) {
  execFileSync(cli, ['-i', archive, '-f', source, ...(kind === 'physics' ? ['-d'] : []), '-o', output], {stdio: 'pipe'});
  const raw = fs.readFileSync(output, 'utf8');
  sourceHashes[source] = crypto.createHash('sha256').update(raw).digest('hex');
  native[kind] = new Map(parseKv3(raw).SurfacePropertiesList.map(surface => [surface.surfacePropertyName.toLowerCase(), surface]));
}
function properties(name, seen = new Set()) {
  name = name.toLowerCase();
  assert(!seen.has(name), `Surface inheritance cycle: ${name}`); seen.add(name);
  const base = native.physics.get(name)?.base;
  const parent = base ? properties(base, seen) : name === 'default' ? {} : properties('default', seen);
  return {...parent, ...native.game.get(name)};
}
const aliases = {concrete: 'concrete', metal: 'metal', wood: 'Wood', plastic: 'plastic',
  glass: 'glass', grate: 'metalgrate', water: 'water', flesh: 'flesh'};
const materials = Object.fromEntries(Object.entries(aliases).map(([material, surfaceName]) => {
  const surface = properties(surfaceName);
  assert(Number.isFinite(surface.bulletPenetrationDistanceModifier), `Missing native distance modifier: ${surfaceName}`);
  return [material, {surfaceName, gameMaterial: surface.gamematerial,
    distanceModifier: surface.bulletPenetrationDistanceModifier,
    damageModifier: surface.bulletPenetrationDamageModifier}];
}));
const fixture = {build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1],
  sourceHashes, scope: 'Extracted surface properties with physics/base inheritance. Runtime loss branches audited separately.', materials};
const destination = 'src/range/duel/native-surface-fixture.json';
if (process.argv.includes('--write')) fs.writeFileSync(destination, JSON.stringify(fixture, null, 2) + '\n');
else assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), fixture, 'Native surface fixture changed');
console.log(`${Object.keys(materials).length} surface aliases verified against installed build ${fixture.build}`);
