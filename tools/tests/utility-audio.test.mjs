import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseKv3} from '../kv3.mjs';
import {wavInfo} from '../import-combat-feedback.mjs';
import {BOUNDS, EVENT_SOURCE, buildUtilityEvents, mergeUtilityManifest, utilityEventSources} from '../import-utility-audio.mjs';

const manifestPath = new URL('../../public/revamp/audio/events.json', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const decode = source => ({url: `/audio/native/test-${source.split('/').at(-1)}.wav`, sourceSha256: 'fixture'});
function fixture() {
  const definitions = Object.fromEntries(Object.values(utilityEventSources).map(source => [source,
    {type: 'csgo_mega', volume: .6, pitch: 1.1, vsnd_files_track_01: ['sounds/fixture/one.vsnd']} ]));
  definitions['BaseGrenade.Explode'].enable_child_events = true;
  definitions['BaseGrenade.Explode'].soundevent_01 = ['BaseExplosionEffect.Sound'];
  definitions['BaseExplosionEffect.Sound'] = {type: 'src1_3d', vsnd_files: ['sounds/fixture/legacy.vsnd']};
  return definitions;
}

test('uses structured KV3 definitions and keeps original legacy child provenance', () => {
  const definitions = fixture();
  definitions['Flashbang.Explode'] = parseKv3(`{ type = "csgo_mega" volume = 0.4 pitch = 1
    distance_volume_mapping_curve = [[0, 1, 0, 0], [2000, 0, 0, 0]]
    vsnd_files_track_01 = ["sounds/fixture/flash.vsnd"] }`);
  const before = structuredClone(definitions), events = buildUtilityEvents(definitions, decode, {build: '123'});
  assert.deepEqual(definitions, before);
  assert.deepEqual(events['utility-he-detonate'].dependencies[0].nativeDefinition, definitions['BaseExplosionEffect.Sound']);
  assert.match(events['utility-he-detonate'].dependencies[0].playbackNote, /Legacy/);
  assert.equal(events['utility-flash-detonate'].volume, .4);
  assert.deepEqual(events['utility-flash-detonate'].distanceCurve, [[0, 1], [2000, 0]]);
  assert.match(events['utility-decoy-decoy'].selectionNote, /representative/);
  for (const [key, source] of Object.entries(utilityEventSources)) {
    assert.equal(events[key].source, source);
    assert.equal(events[key].eventSource, EVENT_SOURCE);
    assert.equal(events[key].build, '123');
    assert.deepEqual(events[key].nativeDefinition, definitions[source]);
  }
});

test('bounds each track to 1..3 distinct samples, including enabled children', () => {
  const definitions = fixture();
  const files = ['one', 'one', 'two', 'three', 'four'].map(name => `sounds/fixture/${name}.vsnd`);
  definitions['BaseGrenade.Explode'].vsnd_files_track_01 = files;
  definitions['BaseExplosionEffect.Sound'].vsnd_files = files;
  for (const sampleLimit of [1, 2, 3]) {
    const event = buildUtilityEvents(definitions, decode, {sampleLimit})['utility-he-detonate'];
    assert.deepEqual(event.sampleSources, [...new Set(files)].slice(0, sampleLimit));
    assert.equal(event.dependencies[0].samples.length, sampleLimit);
  }
  for (const sampleLimit of [0, 4, NaN, 1.5]) {
    let calls = 0;
    assert.throws(() => buildUtilityEvents(definitions, () => {calls++;}, {sampleLimit}), /1\.\.3/);
    assert.equal(calls, 0);
  }
});

test('rejects missing events, unsafe sample paths, cycles and unsupported legacy types', () => {
  const definitions = fixture();
  delete definitions['Flashbang.Explode'];
  assert.throws(() => buildUtilityEvents(definitions, decode), /Missing native event/);
  const unsafe = fixture(); unsafe['HEGrenade.Throw'].vsnd_files_track_01 = ['sounds/../escape.vsnd'];
  assert.throws(() => buildUtilityEvents(unsafe, decode), /Unsafe native sample/);
  const cycle = fixture(); cycle['BaseGrenade.Explode'].soundevent_01 = ['BaseGrenade.Explode'];
  assert.throws(() => buildUtilityEvents(cycle, decode), /Cyclic/);
  const unsupported = fixture(); unsupported['BaseExplosionEffect.Sound'].type = 'unknown';
  assert.throws(() => buildUtilityEvents(unsupported, decode), /Unsupported/);
});

test('only merges utility-owned keys/provenance without changing combat, footsteps, timelines or future fields', () => {
  const original = {build: 'older', installedBuild: 'older-installed', events: {
    ak47: {samples: ['gun.wav']}, 'combat-fall': {nativeDefinition: {original: true}},
    'utility-he-detonate': {old: true}, 'utility-future': {keep: true}},
  timelines: {ak47: {reload: {cues: [1]}}}, combatFeedback: {hash: 'combat'},
  footsteps: {hash: 'steps'}, nativeStep: {foot: 'right'}, audit: {missing: []}, future: [1, 2]};
  const before = structuredClone(original), events = buildUtilityEvents(fixture(), decode), provenance = {build: 'new'};
  const merged = mergeUtilityManifest(original, events, provenance);
  assert.deepEqual(original, before);
  for (const [key, value] of Object.entries(before)) if (key !== 'events') assert.deepEqual(merged[key], value);
  for (const key of ['ak47', 'combat-fall', 'utility-future']) assert.deepEqual(merged.events[key], before.events[key]);
  assert.deepEqual(merged.utilityAudio, provenance);
  for (const key of ['ak47', 'combat-fall', 'utility-arbitrary'])
    assert.throws(() => mergeUtilityManifest(original, {[key]: {}}, {}), /non-utility/);
});

test('ships every utility WAV with bounded native tracks, build and verifiable source/output provenance', () => {
  const provenance = manifest.utilityAudio, urls = new Set();
  assert.ok(provenance, 'Run the targeted utility importer to publish assets');
  assert.equal(provenance.importer, 'tools/import-utility-audio.mjs');
  assert.match(provenance.build, /^\d+$/);
  assert.equal(provenance.build, provenance.steam.ClientVersion);
  assert.equal(provenance.eventSource, EVENT_SOURCE);
  assert.deepEqual(provenance.bounds, BOUNDS);
  assert.equal(provenance.eventSourceSha256, provenance.sourceHashes[EVENT_SOURCE]);
  assert.equal(provenance.sourceArchives[EVENT_SOURCE], 'game/csgo/pak01_dir.vpk');
  assert.equal(provenance.sourceArchives['sounds/common/explosions/explo_gas_can_01.vsnd_c'], 'game/core/pak01_dir.vpk');
  for (const hash of [provenance.steamInfSha256, provenance.eventDefinitionSha256,
    provenance.source2ViewerSha256, ...Object.values(provenance.sourceHashes)]) assert.match(hash, /^[a-f0-9]{64}$/);
  let total = 0;
  function verify(event) {
    assert.equal(event.build, provenance.build);
    assert.equal(event.eventSource, EVENT_SOURCE);
    assert.ok(event.nativeDefinition);
    for (const track of event.tracks) {
      assert.ok(track.samples.length >= 1 && track.samples.length <= provenance.sampleLimit);
      assert.equal(track.samples.length, track.sampleSources.length);
      assert.equal(track.samples.length, track.sampleMetadata.length);
      const nativeFiles = event.nativeDefinition[track.track] ?? event.nativeDefinition.vsnd_files;
      assert.deepEqual(track.sampleSources, [...new Set(nativeFiles)].slice(0, provenance.sampleLimit));
      for (let i = 0; i < track.samples.length; i++) {
        const url = track.samples[i];
        assert.match(url, /^\/audio\/native\/utility-[a-f0-9]{16}\.wav$/);
        const bytes = fs.readFileSync(new URL(`../../public/revamp${url}`, import.meta.url));
        assert.ok(bytes.length <= BOUNDS.maxFileBytes);
        const {sourceSha256, ...expected} = track.sampleMetadata[i];
        assert.deepEqual(wavInfo(bytes), expected);
        assert.equal(sourceSha256, provenance.sourceHashes[`${track.sampleSources[i]}_c`]);
        if (!urls.has(url)) total += bytes.length;
        urls.add(url);
      }
    }
    event.dependencies.forEach(verify);
  }
  for (const [key, source] of Object.entries(utilityEventSources)) {
    assert.equal(manifest.events[key].source, source); verify(manifest.events[key]);
  }
  assert.equal(urls.size, provenance.uniqueSamples);
  assert.ok(urls.size <= BOUNDS.maxSamples);
  assert.equal(total, provenance.outputBytes);
  assert.ok(total <= BOUNDS.maxTotalBytes && provenance.extractedBytes <= BOUNDS.maxTotalBytes);
});
