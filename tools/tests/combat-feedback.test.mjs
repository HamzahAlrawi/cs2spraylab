import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseKv3} from '../kv3.mjs';
import {buildCombatEvents, combatEventSources,contactEventSources,CONTACT_EVENT_SOURCE, EVENT_SOURCE, mergeCombatManifest, wavInfo} from '../import-combat-feedback.mjs';

const definitions = parseKv3(fs.readFileSync(new URL('../../research/audio-events/player.vsndevts', import.meta.url), 'utf8'));
const decode = source => ({url: `/audio/native/combat-test-${source.split('/').at(-1)}.wav`, sourceSha256: 'test-source-hash'});
const build = source => buildCombatEvents(source, decode, {build: 'fixture-build'});

test('maps every hit/kill, body/armor/head/helmet, audience and fall to an actual named native event', () => {
  const events = build(definitions);
  const expected = ['combat-fall'];
  for (const kind of ['hit', 'kill']) for (const part of ['body', 'armor', 'head', 'helmet'])
    for (const audience of ['attacker', 'victim', 'onlooker']) expected.push(`combat-${kind}-${part}-${audience}`);
  assert.deepEqual(Object.keys(events).sort(), expected.sort());
  assert.equal(events['combat-kill-body-attacker'].source, 'Player.DeathBody.AttackerFeedback');
  assert.equal(events['combat-kill-helmet-victim'].source, 'Player.DeathHeadShotArmor.Victim');
  assert.equal(events['combat-hit-head-onlooker'].source, 'Player.DamageHeadShot.Onlooker');
  assert.equal(events['combat-fall'].source, 'Player.DamageFall');
  for (const [key, event] of Object.entries(events)) {
    assert.equal(event.source, combatEventSources[key]);
    assert.equal(event.eventSource, EVENT_SOURCE);
    assert.equal(event.build, 'fixture-build');
    assert.deepEqual(event.nativeDefinition, definitions[event.source]);
    assert.notEqual(event.source, 'Player.Death');
  }
});

test('keeps zero-volume lethal helmet primary plus both audible, independently parameterized children', () => {
  const event = build(definitions)['combat-kill-helmet-attacker'];
  assert.equal(event.volume, 0);
  assert.deepEqual(event.sampleSources, ['sounds/player/headshot_armor_01.vsnd']);
  assert.deepEqual(event.dependencies.map(({slot, source, volume, pitch}) => ({slot, source, volume, pitch})), [
    {slot: 'soundevent_01', source: 'Player.DeathHeadShot.AttackerFeedback.Flesh', volume: .3, pitch: 1},
    {slot: 'soundevent_01', source: 'Player.DeathHeadShot.AttackerFeedback.Dink', volume: .6, pitch: 1.1},
  ]);
  assert.deepEqual(event.dependencies[0].sampleSources, ['sounds/player/headshot_armor_flesh.vsnd']);
  assert.deepEqual(event.dependencies[1].sampleSources, ['sounds/player/headshot_armor_e1.vsnd']);
});

test('preserves armor/flesh, victim and onlooker delays and original attenuation curves', () => {
  const events = build(definitions);
  const hit = events['combat-hit-armor-attacker'];
  assert.equal(hit.volume, 1.2);
  assert.equal(hit.pitch, 1.3);
  assert.equal(hit.dependencies[0].source, 'Player.DamageBodyArmor.AttackerFeedbackFlesh');
  assert.equal(hit.dependencies[0].delay, .1);
  assert.equal(events['combat-hit-armor-onlooker'].delay, .05);
  assert.equal(events['combat-hit-body-victim'].dependencies[0].source, 'Player.DamageBody.VictimFlesh');
  const kill = events['combat-kill-body-onlooker'];
  assert.equal(kill.dependencies[0].source, 'Player.DeathBody.Flesh');
  assert.equal(kill.dependencies[0].delay, .1);
  assert.deepEqual(kill.distanceCurve, definitions[kill.source].distance_volume_mapping_curve.map(row => row.slice(0, 2)));
  assert.deepEqual(kill.nativeDefinition.distance_volume_mapping_curve, definitions[kill.source].distance_volume_mapping_curve);
});

test('selects at most three distinct samples per track without losing extra track metadata', () => {
  const fixture = structuredClone(definitions), name = combatEventSources['combat-hit-body-attacker'];
  const files = fixture[name].vsnd_files_track_01;
  fixture[name].vsnd_files_track_01 = [files[0], files[0], ...files.slice(1)];
  fixture[name].vsnd_files_track_02 = files;
  const event = build(fixture)['combat-hit-body-attacker'];
  assert.deepEqual(event.sampleSources, files.slice(0, 3));
  assert.equal(event.tracks.length, 2);
  assert.deepEqual(event.tracks[1].sampleSources, files.slice(0, 3));
  assert.deepEqual(buildCombatEvents(fixture, decode, {sampleLimit: 1})['combat-hit-body-attacker'].samples.length, 1);
  for (const sampleLimit of [0, 4, 2.5, NaN]) assert.throws(() => buildCombatEvents(fixture, decode, {sampleLimit}), /1\.\.3/);
});

test('honors disabled children and rejects missing enabled dependencies, cycles, unknown types and path traversal', () => {
  const fixture = structuredClone(definitions), name = combatEventSources['combat-kill-helmet-attacker'];
  fixture[name].enable_child_events = false;
  fixture[name].soundevent_01 = ['Missing.Child'];
  assert.deepEqual(build(fixture)['combat-kill-helmet-attacker'].dependencies, []);
  fixture[name].enable_child_events = true;
  assert.throws(() => build(fixture), /Missing native event: Missing.Child/);
  fixture[name].soundevent_01 = [name];
  assert.throws(() => build(fixture), /Cyclic child event/);
  fixture[name].soundevent_01 = [];
  fixture[name].type = 'unknown';
  assert.throws(() => build(fixture), /Unsupported native event type/);
  fixture[name].type = 'csgo_mega';
  fixture[name].vsnd_files_track_01 = ['sounds/../outside.vsnd'];
  assert.throws(() => build(fixture), /Unsafe native sample path/);
  delete fixture[name];
  assert.throws(() => build(fixture), /Missing native event/);
});

test('only adds combat events/provenance, preserving manifest build, timelines, nativeStep and unrelated events', () => {
  const manifest = {build: 'old-definition-build', installedBuild: 'old-installed-build',
    events: {existing: {samples: ['old.wav'], nativeStep: {foot: 'right'}}, 'combat-fall': {stale: true}},
    nativeStep: {surfaces: ['concrete']}, footsteps: {build: 'footstep-build'}, audit: {untouched: true},
    timelines: {ak47: {reload: {duration: 2.4, cues: [{key: 'existing', time: .3}]}}}};
  const before = structuredClone(manifest), events = build(definitions), provenance = {build: 'new-combat-build'};
  const merged = mergeCombatManifest(manifest, events, provenance);
  assert.deepEqual(manifest, before);
  for (const key of Object.keys(before).filter(key => key !== 'events')) assert.deepEqual(merged[key], before[key]);
  assert.deepEqual(merged.events.existing, before.events.existing);
  assert.deepEqual(merged.combatFeedback, provenance);
  assert.equal(merged.events['combat-fall'].source, 'Player.DamageFall');
  assert.throws(() => mergeCombatManifest(manifest, {existing: {}}, {}), /non-combat/);
});

function fixtureWav() {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(4, 40);
  return bytes;
}

test('validates real WAV chunks rather than accepting a RIFF/WAVE magic string alone', () => {
  assert.equal(wavInfo(fixtureWav()).dataBytes, 4);
  assert.equal(wavInfo(fixtureWav()).duration, 4 / 96000);
  assert.throws(() => wavInfo(Buffer.from('RIFF0000WAVE')), /Invalid/);
  assert.throws(() => wavInfo(fixtureWav().subarray(0, 46)), /truncated/);
  const bad = fixtureWav(); bad.writeUInt32LE(999, 40);
  assert.throws(() => wavInfo(bad), /Truncated/);
  const invalidRate = fixtureWav(); invalidRate.writeUInt32LE(1, 28);
  assert.throws(() => wavInfo(invalidRate), /audio format/);
});

const manifestUrl = new URL('../../public/revamp/audio/events.json', import.meta.url);
const imported = JSON.parse(fs.readFileSync(manifestUrl, 'utf8'));
test('verifies every published native combat track, dependency, WAV header and provenance hash',
  {skip: !imported.combatFeedback}, () => {
    const metadata = imported.combatFeedback, urls = new Set();
    assert.match(metadata.build, /^\d+$/);
    assert.equal(metadata.steam.ClientVersion, metadata.build);
    assert.equal(metadata.bounds.downloads, 0);
    assert.equal(metadata.eventSource, EVENT_SOURCE);
    assert.equal(metadata.eventSourceSha256, metadata.sourceHashes[EVENT_SOURCE]);
    for (const value of [metadata.steamInfSha256, metadata.eventDefinitionSha256, metadata.source2ViewerSha256,
      ...Object.values(metadata.sourceHashes)]) assert.match(value, /^[a-f0-9]{64}$/);
    function verify(event,eventSource=EVENT_SOURCE) {
      assert.equal(event.build, metadata.build);
      assert.equal(event.eventSource, eventSource);
      assert.ok(event.nativeDefinition);
      for (const track of event.tracks) {
        assert.ok(track.samples.length <= 3);
        assert.equal(track.samples.length, track.sampleSources.length);
        assert.equal(track.samples.length, track.sampleMetadata.length);
        for (let i = 0; i < track.samples.length; i++) {
          const url = track.samples[i];
          assert.match(url, /^\/audio\/native\/combat-[a-f0-9]{16}\.wav$/);
          const bytes = fs.readFileSync(new URL(`../../public/revamp${url}`, import.meta.url));
          const actual = wavInfo(bytes), {sourceSha256, ...expected} = track.sampleMetadata[i];
          assert.deepEqual(actual, expected);
          assert.equal(sourceSha256, metadata.sourceHashes[`${track.sampleSources[i]}_c`]);
          urls.add(url);
        }
      }
      event.dependencies.forEach(child=>verify(child,eventSource));
    }
    for (const key of Object.keys(combatEventSources)) {
      assert.equal(imported.events[key].source, combatEventSources[key]); verify(imported.events[key]);
    }
    for(const [key,source] of Object.entries(contactEventSources)) {
      assert.equal(imported.events[key].source,source);verify(imported.events[key],CONTACT_EVENT_SOURCE);
      assert.ok(imported.events[key].impactSpeedCurve.length>1);
    }
    assert.equal(urls.size, metadata.uniqueSamples);
    assert.ok(urls.size <= metadata.bounds.maxSamples);
  });
