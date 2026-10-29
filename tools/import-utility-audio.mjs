import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {parseKv3} from './kv3.mjs';
import {buildCombatEvents, wavInfo, SAMPLE_LIMIT} from './import-combat-feedback.mjs';
import presentation from '../src/range/duel/utility-presentation-native.json' with {type:'json'};
import {nativeSoundPlayback, wavSignal} from './utility-audio-metadata.mjs';

export const EVENT_SOURCE = 'soundevents/game_sounds_weapons.vsndevts_c';
export const BOUNDS = Object.freeze({maxSamples: 160, maxFileBytes: 4 * 1024 * 1024, maxTotalBytes: 80 * 1024 * 1024, downloads: 0});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const families = {he: 'HEGrenade', flash: 'Flashbang', smoke: 'SmokeGrenade', molotov: 'Molotov', incendiary: 'IncGrenade', decoy: 'Decoy'};
export const utilityEventSources = Object.freeze({
  ...Object.fromEntries([...new Set(Object.values(presentation.utilities).flatMap(utility=>Object.values(utility.actions)
    .flatMap(action=>action.events.filter(event=>event.type.endsWith('_Sound')&&event.name).map(event=>event.name))))]
    .map(name=>[`utility-cue-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,name])),
  ...Object.fromEntries(Object.entries(families).flatMap(([kind, family]) => [
    [`utility-${kind}-draw`, `${family}.Draw`],
    [`utility-${kind}-throw`, `${family}.Throw`],
    [`utility-${kind}-bounce`, `${kind === 'decoy' ? 'Flashbang' : family}.Bounce`],
    ...(kind === 'molotov' ? [] : [[`utility-${kind}-pin`, `${family}.PullPin`]]),
  ])),
  'utility-he-detonate': 'BaseGrenade.Explode',
  'utility-flash-detonate': 'Flashbang.Explode',
  'utility-smoke-detonate': 'BaseSmokeEffect.Sound',
  'utility-molotov-detonate': 'Molotov.Start',
  'utility-incendiary-detonate': 'IncGrenade.Start',
  'utility-decoy-detonate': 'Weapon_AK47.Single',
  'utility-decoy-decoy': 'Weapon_AK47.Single',
  'utility-decoy-end': 'BaseGrenade.Explode',
  'utility-extinguish': 'Molotov.Extinguish',
  'utility-fire-ignite': 'Inferno.Fire.Ignite',
  'utility-fire-loop': 'Inferno.Loop',
  'utility-fire-end': 'Inferno.FadeOut',
  'utility-molotov-idle': 'Molotov.IdleLoop',
  'utility-molotov-failed': 'Molotov.StartFailed',
  'utility-incendiary-failed': 'IncGrenade.StartFailed',
  'utility-smoke-clear': 'SmokeGrenade.Clear',
});
const selectionNotes = {
  'utility-decoy-bounce': 'Trainer selection: shared flashbang bounce; no dedicated decoy bounce event in this bank.',
  'utility-decoy-detonate': 'Trainer selection: representative native AK-47 report, not a measured decoy activation sound.',
  'utility-decoy-decoy': 'Trainer selection: representative native AK-47 report; weapon-dependent decoy behavior is not reproduced.',
  'utility-decoy-end': 'Trainer selection: shared native grenade explosion, not a measured decoy end mix.',
};

export function buildUtilityEvents(definitions, decode, options = {}) {
  // The HE bank includes one legacy child. Adapt its sample field for the
  // shared track builder, but keep its original definition in the manifest.
  const adapted = {...definitions};
  const legacy = definitions['BaseExplosionEffect.Sound'];
  if (legacy?.type === 'src1_3d') adapted['BaseExplosionEffect.Sound'] = {
    ...legacy, type: 'csgo_mega', vsnd_files_track_01: legacy.vsnd_files,
  };
  const events = buildCombatEvents(adapted, decode, {...options, eventSource: EVENT_SOURCE, sources: utilityEventSources});
  function restore(event) {
    event.nativeDefinition = definitions[event.source];
    if (event.nativeDefinition.type === 'src1_3d') event.playbackNote =
      'Legacy src1_3d sample played once with default gain/pitch; Source 1 spatial mixing is not reproduced.';
    event.dependencies.forEach(restore);
    for (const track of event.tracks) if (options.playbackMetadata)
      track.samplePlayback = track.sampleSources.map(source => options.playbackMetadata(source));
  }
  for (const [key, event] of Object.entries(events)) {
    restore(event);
    if (selectionNotes[key]) event.selectionNote = selectionNotes[key];
  }
  return events;
}

export function mergeUtilityManifest(manifest, events, provenance) {
  if (Object.keys(events).some(key => !Object.hasOwn(utilityEventSources, key))) throw new Error('Refusing non-utility manifest edits');
  return {...manifest, events: {...manifest.events, ...events}, utilityAudio: provenance};
}

export function importUtilityAudio({root = process.cwd(), game = process.env.CS2_PATH ||
  'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive',
  cli = process.env.SOURCE2VIEWER || path.join(root, '.local-tools/vrf-20.1/Source2Viewer-CLI.exe'),
  ffmpeg = process.env.FFMPEG || 'ffmpeg', sampleLimit = SAMPLE_LIMIT, publishPresentation = false} = {}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > SAMPLE_LIMIT) throw new Error('Sample limit must be 1..3');
  const vpk = path.join(game, 'game/csgo/pak01_dir.vpk'), coreVpk = path.join(game, 'game/core/pak01_dir.vpk');
  const steamPath = path.join(game, 'game/csgo/steam.inf');
  const steamBytes = fs.readFileSync(steamPath), steam = Object.fromEntries(steamBytes.toString('utf8').trim().split(/\r?\n/)
    .map(line => {const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];}));
  const build = steam.ClientVersion;
  if (!/^\d+$/.test(build ?? '')) throw new Error('Missing installed Steam ClientVersion');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'spraylab-utility-'));
  let extractedBytes = 0;
  const sourceHashes = {}, sourceArchives = {}, decoded = new Map(), playback = new Map(), outputs = new Map();
  const run = args => execFileSync(cli, args, {stdio: 'pipe', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  function readBounded(file) {
    const size = fs.statSync(file).size;
    if (size > BOUNDS.maxFileBytes || extractedBytes + size > BOUNDS.maxTotalBytes) throw new Error('Utility extraction byte budget exceeded');
    extractedBytes += size; return fs.readFileSync(file);
  }
  function extract(source, id) {
    const compiled = path.join(temporary, `${id}_c`), output = path.join(temporary, `${id}.decoded`);
    const core = source === 'sounds/common/explosions/explo_gas_can_01.vsnd_c';
    run(['-i', core ? coreVpk : vpk, '-f', source, '-o', compiled]);
    sourceArchives[source] = `game/${core ? 'core' : 'csgo'}/pak01_dir.vpk`;
    if (!fs.existsSync(compiled)) throw new Error(`Native utility resource not extracted: ${source}`);
    sourceHashes[source] = sha256(readBounded(compiled));
    run(['-i', compiled, '-d', '-o', output]);
    return {output, compiled, bytes: readBounded(output)};
  }
  try {
    const {bytes: eventBytes} = extract(EVENT_SOURCE, 'weapons.vsndevts');
    const definitions = parseKv3(eventBytes.toString('utf8'));
    const events = buildUtilityEvents(definitions, source => {
      if (decoded.has(source)) return decoded.get(source);
      if (decoded.size >= BOUNDS.maxSamples) throw new Error('Utility extraction sample budget exceeded');
      const id = `utility-${sha256(source).slice(0, 16)}`, {output, compiled, bytes} = extract(`${source}_c`, `${id}.vsnd`);
      let wav = bytes;
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        const converted = path.join(temporary, `${id}.wav`);
        execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', output, '-c:a', 'pcm_s16le', converted],
          {stdio: 'pipe', windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024});
        wav = readBounded(converted);
      }
      const metadata = {url: `/audio/native/${id}.wav`, sourceSha256: sourceHashes[`${source}_c`], ...wavInfo(wav)};
      const summary = run(['-i', compiled, '-b', 'DATA']).toString('utf8');
      playback.set(source, {...nativeSoundPlayback(summary), signal: wavSignal(wav), dataSummarySha256: sha256(summary)});
      decoded.set(source, metadata); outputs.set(`${id}.wav`, wav);
      return metadata;
    }, {sampleLimit, build, playbackMetadata: source => playback.get(source)});
    if (!fs.readFileSync(steamPath).equals(steamBytes)) throw new Error('Steam build changed during extraction; retry');
    const provenance = {build, steam, steamInfSha256: sha256(steamBytes), eventSource: EVENT_SOURCE,
      eventSourceSha256: sourceHashes[EVENT_SOURCE], eventDefinitionSha256: sha256(eventBytes), sourceHashes, sourceArchives,
      source2ViewerSha256: sha256(fs.readFileSync(cli)), sampleLimit, uniqueSamples: decoded.size,
      presentationTimingBuild: presentation.build,
      presentationTimingNote: 'Cue-name inventory only; older animation timings are not certified current by this sound import.',
      bounds: BOUNDS, extractedBytes, outputBytes: [...outputs.values()].reduce((sum, wav) => sum + wav.length, 0),
      composition: 'Bounded native samples per track, enabled child events kept independent. Native definitions retained; browser mixing, legacy defaults and decoy selections are approximations, not exact CS2 playback.',
      selectionNotes, importer: 'tools/import-utility-audio.mjs'};
    const manifestPath = path.join(root, 'public/revamp/audio/events.json');
    // Merge only at commit time to preserve other importers' current additions.
    const merged = mergeUtilityManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), events, provenance);
    const nativeDir = path.join(root, 'public/revamp/audio/native');
    fs.mkdirSync(nativeDir, {recursive: true});
    for (const [name, wav] of outputs) fs.writeFileSync(path.join(nativeDir, name), wav);
    fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n');
    if (publishPresentation) {
      const reference = Object.fromEntries(Object.entries(events).filter(([key]) => key.startsWith('utility-cue-'))
        .map(([, event]) => [event.source, event]));
      const directory = path.join(root, 'public/revamp/utility-presentation');
      fs.mkdirSync(directory, {recursive: true});
      fs.writeFileSync(path.join(directory, 'sounds.json'), JSON.stringify({events: reference, provenance: {
        ...provenance, note: 'Reference bank shares /audio/native WAVs and source provenance with runtime. No duplicate transcode or stale timing-build label.'}}, null, 2) + '\n');
    }
    console.log(`Utility audio: ${Object.keys(events).length} events, ${decoded.size} WAVs, ${provenance.outputBytes} bytes, build ${build}, no downloads.`);
    return merged;
  } finally {
    const resolved = fs.realpathSync(temporary), tempRoot = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('spraylab-utility-'))
      throw new Error('Refusing cleanup outside the utility temporary directory');
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {importUtilityAudio();} catch (error) {console.error(error); process.exitCode = 1;}
}
