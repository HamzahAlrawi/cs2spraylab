import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

function writeSoundMetadata(manifest) {
  const keys = Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json','utf8')).weapons).concat('knife');
  const weapons = Object.fromEntries(keys.map(key => {
    const event = manifest.events[key];
    if (!event?.distanceCurve?.length) throw new Error(`Missing native audio distance curve: ${key}`);
    return [key,{source:event.source,volume:event.volume,distanceCurve:event.distanceCurve}];
  }));
  fs.writeFileSync('src/range/sound-events-data.json',JSON.stringify({build:manifest.build,weapons},null,2)+'\n');
}
if (process.argv.includes('--metadata-only')) {
  writeSoundMetadata(JSON.parse(fs.readFileSync('public/revamp/audio/events.json','utf8')));
  process.exit(0);
}

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const run = (...args) => execFileSync(cli, ['-i', `${game}/game/csgo/pak01_dir.vpk`, ...args], {stdio: 'pipe', maxBuffer: 20e6});
fs.mkdirSync('research/audio-events', {recursive: true});
fs.mkdirSync('research/audio-events/samples', {recursive: true});
fs.mkdirSync('public/revamp/audio/native', {recursive: true});
const sources = {};
for (const name of ['footsteps', 'player', 'weapons']) {
  const file = `research/audio-events/${name}.vsndevts`;
  run('-f', `soundevents/game_sounds_${name}.vsndevts_c`, '-d', '-o', file);
  Object.assign(sources, parseKv3(fs.readFileSync(file, 'utf8')));
}
const events = {};
const add = (key, name, limit = 4) => {
  const source = sources[name];
  if (!source) throw new Error(`Missing sound event ${name}`);
  const tracks = source.vsnd_files_track_01;
  const files = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean).slice(0, limit);
  if (!files.length) throw new Error(`No samples for ${name}`);
  events[key] = {source: name, volume: source.volume ?? 1, pitch: source.pitch ?? 1,
    distanceCurve: source.distance_volume_mapping_curve?.map(row => row.slice(0, 2)),
    samples: files.map((file, i) => {
      const output = `native/${key}-${i}.wav`;
      const staging = `research/audio-events/samples/${key}-${i}.audio`;
      run('-f', `${file}_c`, '-d', '-o', staging);
      const bytes = fs.readFileSync(staging);
      if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') fs.copyFileSync(staging, `public/revamp/audio/${output}`);
      else execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', staging,
        '-c:a', 'pcm_s16le', `public/revamp/audio/${output}`], {stdio: 'pipe'});
      return `/audio/${output}`;
    })};
};
for (const [key, name] of Object.entries({concrete: 'Concrete', wood: 'Wood', metal: 'SolidMetal'})) {
  add(`step-${key}`, `CT_${name}.StepLeft`);
  add(`land-${key}`, `Land_${name}.StepLeft`, 2);
}
for (const [key, name] of Object.entries({
  'hit-body': 'Player.DamageBody.AttackerFeedback', 'hit-head': 'Player.DamageHeadShot.AttackerFeedback',
  'hit-armor': 'Player.DamageBodyArmor.AttackerFeedback', 'hit-helmet': 'Player.DamageHeadShotArmor.AttackerFeedback',
  'hurt-body': 'Player.DamageBody.Victim', 'hurt-armor': 'Player.DamageBodyArmor.Victim',
  'hurt-head': 'Player.DamageHeadShot.Victim', 'hurt-helmet': 'Player.DamageHeadShotArmor.Victim', death: 'Player.Death',
})) add(key, name, 3);
const weapons = {ak47: 'AK47', m4a4: 'M4A4', m4a1s: 'M4A1', galil: 'GalilAR', famas: 'FAMAS',
  sg553: 'sg556', aug: 'AUG', mp9: 'MP9', mp7: 'MP7', mp5sd: 'MP5', mac10: 'MAC10', ump45: 'UMP45',
  p90: 'P90', bizon: 'bizon', m249: 'M249', negev: 'Negev', cz75a: 'CZ75A', usp: 'USP',
  glock: 'Glock', hkp2000: 'hkp2000', p250: 'P250', deagle: 'DEagle', elite: 'ELITE', fiveseven: 'FiveSeven',
  tec9: 'tec9', revolver: 'Revolver', awp: 'AWP', ssg08: 'SSG08', g3sg1: 'G3SG1', scar20: 'SCAR20'};
for (const [id, name] of Object.entries(weapons)) {
  add(id, `Weapon_${name}.${id === 'm4a1s' ? 'Silenced' : id === 'usp' ? 'SilencedShot' : 'Single'}`);
  // Clip event names differ from the firing-event names for these native models.
  const actionName = id === 'm4a4' ? 'M4A1' : id === 'cz75a' ? 'CZ' : name;
  for (const [kind, suffix] of [['reload', ['m249', 'negev'].includes(id) ? 'Coverup' : 'Clipout'], ['draw', 'Draw']]) {
    const key = Object.keys(sources).find(key => key.toLowerCase() === `Weapon_${actionName}.${suffix}`.toLowerCase());
    if (key) add(`${id}-${kind}`, key, 1);
  }
}
add('knife', 'Weapon_Knife.Slash', 2);
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
fs.writeFileSync('public/revamp/audio/events.json', JSON.stringify({build, events}, null, 2));
writeSoundMetadata({build,events});
console.log(`Exported ${Object.keys(events).length} native sound events from CS2 ${build}.`);
