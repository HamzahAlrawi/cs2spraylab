import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import {buildCombatEvents, wavInfo} from './import-combat-feedback.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf/Source2Viewer-CLI.exe');
const root = 'research/utility-presentation/sounds', out = 'public/revamp/utility-presentation';
fs.mkdirSync(root, {recursive: true}); fs.mkdirSync(`${out}/audio`, {recursive: true});
const vpk = `${game}/game/csgo/pak01_dir.vpk`, eventSource = 'soundevents/game_sounds_weapons.vsndevts_c';
const run = args => execFileSync(cli, args, {windowsHide: true, maxBuffer: 8e6});
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
run(['-i', vpk, '-f', eventSource, '-d', '-o', `${root}/weapons.vsndevts`]);
const raw = fs.readFileSync(`${root}/weapons.vsndevts`), definitions = parseKv3(raw.toString());
const timing = JSON.parse(fs.readFileSync('src/range/duel/utility-presentation-native.json'));
const sources = Object.fromEntries([...new Set(Object.values(timing.utilities).flatMap(utility => Object.values(utility.actions)
  .flatMap(action => action.events.filter(e => e.type.endsWith('_Sound')).map(e => e.name))))].map(name => [name, name]));
let bytes = 0;
const decoded = new Map(), hashes = {};
const events = buildCombatEvents(definitions, source => {
  if (decoded.has(source)) return decoded.get(source);
  if (decoded.size >= 96) throw new Error('Native presentation sample budget exceeded');
  const id = hash(source).slice(0, 20), compiled = `${root}/${id}.vsnd_c`, output = `${root}/${id}.decoded`;
  run(['-i', vpk, '-f', `${source}_c`, '-o', compiled]);
  hashes[source] = hash(fs.readFileSync(compiled));
  run(['-i', compiled, '-d', '-o', output]);
  const target = `${out}/audio/${id}.wav`;
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', output,
    '-c:a', 'pcm_s16le', target], {windowsHide: true, maxBuffer: 1e6});
  const wav = fs.readFileSync(target); bytes += wav.length;
  if (wav.length > 4e6 || bytes > 32e6) throw new Error('Presentation WAV byte budget exceeded');
  const metadata = {url: `/utility-presentation/audio/${id}.wav`, ...wavInfo(wav)};
  decoded.set(source, metadata); return metadata;
}, {sources, sampleLimit: 1, build: timing.build, eventSource});
fs.writeFileSync(`${out}/sounds.json`, JSON.stringify({events, provenance: {build: timing.build, eventSource,
  eventDefinitionSha256: hash(raw), sampleHashes: hashes, sampleLimit: 1, samples: decoded.size, bytes,
  note: 'Native definitions/tracks and child events retained; one sample per track. Browser mix is approximate. Stop action-owned voices on cancel; IdleLoop is not proof of infinite browser looping.'}}, null, 2) + '\n');
console.log(`${Object.keys(events).length} presentation events, ${decoded.size} WAVs, ${bytes} bytes`);
