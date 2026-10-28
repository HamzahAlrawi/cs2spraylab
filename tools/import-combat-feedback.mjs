import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {parseKv3} from './kv3.mjs';

export const EVENT_SOURCE = 'soundevents/game_sounds_player.vsndevts_c';
export const CONTACT_EVENT_SOURCE='soundevents/game_sounds_physics.vsndevts_c';
export const contactEventSources=Object.freeze(Object.fromEntries(['ct','t'].flatMap(team=>['hard','soft'].map(kind=>
  [`combat-contact-${team}-${kind}`,`${team.toUpperCase()}.Impact${kind==='hard'?'Hard':'Soft'}`]))));
export const SAMPLE_LIMIT = 3;
const MAX_SAMPLES = 96, MAX_FILE_BYTES = 4 * 1024 * 1024, MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];

export const combatEventSources = Object.freeze(Object.fromEntries([
  ...['hit', 'kill'].flatMap(kind => Object.entries({body: 'Body', armor: 'BodyArmor', head: 'HeadShot', helmet: 'HeadShotArmor'})
    .flatMap(([part, suffix]) => Object.entries({attacker: 'AttackerFeedback', victim: 'Victim', onlooker: 'Onlooker'})
      .map(([audience, native]) => [`combat-${kind}-${part}-${audience}`, `Player.${kind === 'hit' ? 'Damage' : 'Death'}${suffix}.${native}`]))),
  ['combat-fall', 'Player.DamageFall'],
]));

export function wavInfo(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid or truncated RIFF/WAVE');
  let format, dataBytes = 0, end = 12;
  while (end + 8 <= bytes.length) {
    const tag = bytes.toString('ascii', end, end + 4), length = bytes.readUInt32LE(end + 4), start = end + 8;
    if (start + length > bytes.length) throw new Error('Truncated WAV chunk');
    if (tag === 'fmt ') {
      if (length < 16) throw new Error('Invalid WAV format chunk');
      format = {format: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14)};
    }
    if (tag === 'data') dataBytes += length;
    end = start + length + (length % 2);
  }
  if (end !== bytes.length || !format || ![1, 3].includes(format.format) || ![1, 2].includes(format.channels) ||
    format.sampleRate < 8000 || format.sampleRate > 192000 || ![8, 16, 24, 32, 64].includes(format.bitsPerSample) ||
    format.blockAlign !== format.channels * format.bitsPerSample / 8 ||
    format.byteRate !== format.sampleRate * format.blockAlign || !dataBytes || dataBytes % format.blockAlign)
    throw new Error('Invalid or unsupported WAV audio format');
  return {...format, dataBytes, duration: dataBytes / format.byteRate, sha256: sha256(bytes)};
}

// Keep primary tracks and native child events separate. In particular, a
// zero-volume primary does not mute independently authored flesh/dink children.
export function buildCombatEvents(definitions, decode, {sampleLimit = SAMPLE_LIMIT, build, eventSource = EVENT_SOURCE,sources=combatEventSources} = {}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > SAMPLE_LIMIT) throw new Error('Sample limit must be 1..3');
  const names = new Map(Object.keys(definitions).map(name => [name.toLowerCase(), name]));
  function event(requested, ancestry = []) {
    const source = names.get(requested.toLowerCase());
    if (!source) throw new Error(`Missing native event: ${requested}`);
    if (ancestry.includes(source)) throw new Error(`Cyclic child event: ${[...ancestry, source].join(' -> ')}`);
    const definition = definitions[source];
    if (definition.type !== 'csgo_mega') throw new Error(`Unsupported native event type: ${source}/${definition.type}`);
    const tracks = Object.keys(definition).filter(key => /^vsnd_files_track_\d+$/.test(key)).sort().map(track => {
      const sampleSources = [...new Set(list(definition[track]).filter(Boolean))].slice(0, sampleLimit);
      for (const file of sampleSources) if (typeof file !== 'string' || !/^sounds\/[a-z0-9_./-]+\.vsnd$/i.test(file) ||
        file.split('/').includes('..')) throw new Error(`Unsafe native sample path: ${file}`);
      const decoded = sampleSources.map(decode);
      return {track, samples: decoded.map(sample => sample.url), sampleSources, sampleMetadata: decoded.map(({url, ...metadata}) => metadata)};
    });
    const dependencies = [];
    if (definition.enable_child_events === true) {
      for (const slot of Object.keys(definition).filter(key => /^soundevent_\d+$/.test(key)).sort()) {
        for (const child of list(definition[slot]).filter(Boolean))
          dependencies.push({slot, ...event(child, [...ancestry, source])});
      }
    }
    if (!tracks.some(track => track.samples.length) && !dependencies.length) throw new Error(`No native audio for ${source}`);
    const primary = tracks.find(track => track.track === 'vsnd_files_track_01');
    return {source, build, eventSource, volume: definition.volume ?? 1, pitch: definition.pitch ?? 1,
      delay: definition.delay ?? 0, distanceCurve: definition.distance_volume_mapping_curve?.map(row => row.slice(0, 2)) ?? [],
      ...(definition.use_impact_speed_input_volume_mapping_curve?{impactSpeedCurve:definition.impact_speed_input_volume_mapping_curve?.map(row=>row.slice(0,2))}:{}),
      samples: primary?.samples ?? [], sampleSources: primary?.sampleSources ?? [], tracks, dependencies,
      nativeDefinition: definition};
  }
  return Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, event(source)]));
}

export function mergeCombatManifest(manifest, events, provenance) {
  if (Object.keys(events).some(key => !Object.hasOwn(combatEventSources, key)&&!Object.hasOwn(contactEventSources,key))) throw new Error('Refusing non-combat manifest edits');
  return {...manifest, events: {...manifest.events, ...events}, combatFeedback: provenance};
}

export function importCombatFeedback({root = process.cwd(), game = process.env.CS2_PATH ||
  'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive',
  cli = process.env.SOURCE2VIEWER || path.join(root, '.local-tools/vrf/Source2Viewer-CLI.exe'),
  ffmpeg = process.env.FFMPEG || 'ffmpeg'} = {}) {
  const vpk = path.join(game, 'game/csgo/pak01_dir.vpk'), steamPath = path.join(game, 'game/csgo/steam.inf');
  const steamBytes = fs.readFileSync(steamPath), steam = Object.fromEntries(steamBytes.toString('utf8').trim().split(/\r?\n/)
    .map(line => {const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];}));
  const build = steam.ClientVersion;
  if (!/^\d+$/.test(build ?? '')) throw new Error('Missing installed Steam ClientVersion');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'spraylab-combat-'));
  let extractedBytes = 0;
  const sourceHashes = {}, decoded = new Map(), outputs = new Map();
  const run = args => execFileSync(cli, args, {stdio: 'pipe', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  function readBounded(file) {
    const size = fs.statSync(file).size;
    if (size > MAX_FILE_BYTES || extractedBytes + size > MAX_TOTAL_BYTES) throw new Error('Combat extraction byte budget exceeded');
    extractedBytes += size; return fs.readFileSync(file);
  }
  function extract(source, id) {
    const compiled = path.join(temporary, `${id}_c`), output = path.join(temporary, `${id}.decoded`);
    run(['-i', vpk, '-f', source, '-o', compiled]);
    sourceHashes[source] = sha256(readBounded(compiled));
    run(['-i', compiled, '-d', '-o', output]);
    return {output, bytes: readBounded(output)};
  }
  try {
    const {bytes: eventBytes} = extract(EVENT_SOURCE, 'player.vsndevts');
    const definitions = parseKv3(eventBytes.toString('utf8'));
    const decode=source => {
      if (decoded.has(source)) return decoded.get(source);
      if (decoded.size >= MAX_SAMPLES) throw new Error('Combat extraction sample budget exceeded');
      const id = `combat-${sha256(source).slice(0, 16)}`, {output, bytes} = extract(`${source}_c`, `${id}.vsnd`);
      let wav = bytes;
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        const converted = path.join(temporary, `${id}.wav`);
        execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', output, '-c:a', 'pcm_s16le', converted],
          {stdio: 'pipe', windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024});
        wav = readBounded(converted);
      }
      const metadata = {url: `/audio/native/${id}.wav`, sourceSha256: sourceHashes[`${source}_c`], ...wavInfo(wav)};
      decoded.set(source, metadata); outputs.set(`${id}.wav`, wav);
      return metadata;
    };
    const events=buildCombatEvents(definitions,decode,{build});
    const {bytes:contactBytes}=extract(CONTACT_EVENT_SOURCE,'physics.vsndevts');
    Object.assign(events,buildCombatEvents(parseKv3(contactBytes.toString('utf8')),decode,
      {build,eventSource:CONTACT_EVENT_SOURCE,sources:contactEventSources}));
    if (!fs.readFileSync(steamPath).equals(steamBytes)) throw new Error('Steam build changed during extraction; retry');
    const provenance = {build, steam, steamInfSha256: sha256(steamBytes), eventSource: EVENT_SOURCE,
      eventSourceSha256: sourceHashes[EVENT_SOURCE], eventDefinitionSha256: sha256(eventBytes), sourceHashes,
      source2ViewerSha256: sha256(fs.readFileSync(cli)), sampleLimit: SAMPLE_LIMIT, uniqueSamples: decoded.size,
      bounds: {maxSamples: MAX_SAMPLES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, downloads: 0},
      composition: 'Primary samples are unmixed native tracks. Play enabled dependencies as separate events using their own volume, pitch and delay; nativeDefinition retains original parameters.',
      importer: 'tools/import-combat-feedback.mjs'};
    const manifestPath = path.join(root, 'public/revamp/audio/events.json');
    // Read at commit time so unrelated additions made during extraction survive.
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const merged = mergeCombatManifest(manifest, events, provenance);
    const nativeDir = path.join(root, 'public/revamp/audio/native');
    fs.mkdirSync(nativeDir, {recursive: true});
    for (const [name, wav] of outputs) fs.writeFileSync(path.join(nativeDir, name), wav);
    fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n');
    console.log(`Combat feedback: ${Object.keys(events).length} events, ${decoded.size} unique WAVs, build ${build}, no downloads.`);
    console.log(JSON.stringify({keys: Object.keys(events), files: [...outputs.keys()].map(name => path.join(nativeDir, name)),
      eventSource: EVENT_SOURCE, eventSourceSha256: provenance.eventSourceSha256}, null, 2));
    return merged;
  } finally {
    const resolved = fs.realpathSync(temporary), tempRoot = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('spraylab-combat-'))
      throw new Error('Refusing cleanup outside the combat temporary directory');
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {importCombatFeedback();} catch (error) {console.error(error); process.exitCode = 1;}
}
