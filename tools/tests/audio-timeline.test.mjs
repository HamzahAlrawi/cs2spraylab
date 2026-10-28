import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractCompiledSourceFps, extractSoundTimeline} from '../import-audio.mjs';

const compiled = (frames, seconds) => `CLI resource preamble
<!-- kv3 encoding:text -->
{ m_nNumFrames = ${frames} m_flDuration = ${seconds} m_compressedPoseData = #[ 00 FF ] }`;

const definition = fps => `{
  m_sourceFilename = "animation/test.dmx"
  m_eventTracks = [{ m_events = [
    { _class = "CNmClipDocEvent_Sound" m_name = "Weapon.Test.Late" m_flStartTime = ${4 * fps} m_relevance = "Client" }
    { _class = "CNmClipDocEvent_Sound" m_name = "Weapon.Test.Early" m_flStartTime = ${fps / 2} m_relevance = "ClientAndServer" }
    { _class = "CNmClipDocEvent_Sound" m_name = "Weapon.Test.Edge" m_flStartTime = ${5 * fps + 1} }
    { _class = "CNmClipDocEvent_Sound" m_name = "Weapon.Test.Outside" m_flStartTime = ${5 * fps + 2} }
    { _class = "CNmClipDocEvent_Sound" m_name = "Weapon.Test.Negative" m_flStartTime = -1 }
    { _class = "CNmClipDocEvent_ID" m_ID = "WPN_RELOAD_INTRO" m_flStartTime = 0 m_flDuration = ${fps} }
    { _class = "CNmClipDocEvent_ID" m_ID = "WPN_RELOAD_LOOP" m_flStartTime = ${fps} m_flDuration = ${2 * fps} }
    { _class = "CNmClipDocEvent_ID" m_ID = "WPN_RELOAD_OUTRO" m_flStartTime = ${3 * fps} m_flDuration = ${2 * fps} }
  ] }]
}`;

test('compiled 30/60 Hz sources produce equivalent cue and reload-window timings', () => {
  for (const fps of [30, 60]) {
    const sourceFps = extractCompiledSourceFps(compiled(5 * fps + 1, 5));
    assert.equal(sourceFps, fps);
    const timeline = extractSoundTimeline(definition(fps), 5, sourceFps);
    assert.equal(timeline.fps, fps);
    assert.equal(timeline.source, 'animation/test.vnmclip_c');
    assert.deepEqual(timeline.cues.map(({time, key, audience}) => ({time, key, audience})), [
      {time: .5, key: 'native:Weapon.Test.Early', audience: 'all'},
      {time: 4, key: 'native:Weapon.Test.Late', audience: 'local'},
      {time: 5 + 1 / fps, key: 'native:Weapon.Test.Edge', audience: 'all'},
    ]);
    assert.deepEqual(timeline.windows, {
      intro: {start: 0, duration: 1}, loop: {start: 1, duration: 2}, outro: {start: 3, duration: 2},
    });
  }
});

test('uses compiled M249 frame count, never baked GLB samples', () => {
  assert.equal(extractCompiledSourceFps(compiled(343, 5.7)), 60);
  assert.equal(extractCompiledSourceFps(`{
    m_nNumFrames = 343 m_flDuration = 5.7 samples = 172 seconds = 5.7
  }`), 60);
  assert.equal(extractCompiledSourceFps('{ samples = 343 seconds = 5.7 }'), 30);
});

test('M249 60 Hz reload retains late cues that 30 Hz would discard', () => {
  const frames = [34, 47, 80, 137, 159, 177, 224, 266];
  const raw = `{ m_sourceFilename = "animation/reload_m249.dmx" m_eventTracks = [{ m_events = [
    ${frames.map(frame => `{ _class = "CNmClipDocEvent_Sound" m_name = "Weapon_M249.Cue"
      m_flStartTime = ${frame} m_relevance = "ClientAndServer" }`).join('\n')}
  ] }] }`;
  const timeline = extractSoundTimeline(raw, 5.7, extractCompiledSourceFps(compiled(343, 5.7)));
  assert.equal(timeline.fps, 60);
  assert.deepEqual(timeline.cues.map(cue => cue.nativeFrame), frames);
  assert.deepEqual(timeline.cues.map(cue => cue.time), frames.map(frame => frame / 60));
  assert.equal(extractSoundTimeline(raw, 5.7, 30).cues.length, 5);
});

test('rounds compiled duration precision using the local reload-audit convention', () => {
  assert.equal(extractCompiledSourceFps(compiled(74, 2.4333)), 30);
  assert.equal(extractCompiledSourceFps(compiled(344, 5.716667)), 60);
});

test('missing, malformed or invalid compiled metadata falls back to 30 Hz', () => {
  const invalid = [undefined, null, '', 'not KV3', '{', '{}', 'null',
    '{ m_nNumFrames = 343 }', '{ m_flDuration = 5.7 }',
    compiled(0, 5), compiled(1, 5), compiled(-3, 5), compiled(3.5, 5),
    compiled('"343"', 5.7), compiled(343, '"5.7"'),
    compiled(343, 0), compiled(343, -1), compiled(343, 'NaN'),
    compiled(343, '1e999'), compiled(343, '1e-320'), compiled(2, 100)];
  for (const raw of invalid) {
    const fps = extractCompiledSourceFps(raw);
    assert.equal(fps, 30, `unexpected FPS for ${raw}`);
    assert.equal(extractSoundTimeline(definition(30), 5, fps).cues[0].time, .5);
  }
});

test('preserves the default timeline rate and explicit invalid-rate rejection', () => {
  assert.equal(extractSoundTimeline(definition(30), 5).fps, 30);
  for (const fps of [0, -30, NaN, Infinity, null, '60']) {
    assert.equal(extractSoundTimeline(definition(30), 5, fps), null);
  }
});
