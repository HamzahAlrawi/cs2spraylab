import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeAudioManifest} from '../import-audio.mjs';

for (const actionsOnly of [true, false]) {
  test(`${actionsOnly ? 'actions-only' : 'full'} import preserves unrelated manifest data`, () => {
    const combatEvents = Object.fromEntries(Array.from({length: 25}, (_, i) =>
      [`combat-${i}`, {build: '2000935', samples: [`/audio/native/combat-${i}.wav`],
        dependencies: [{source: 'native-child', volume: .5}]}]));
    const old = {
      build: '2000922', installedBuild: '2000924',
      combatFeedback: {build: '2000935', sourceHashes: {player: 'fresh-hash'}},
      footsteps: {build: '2000933', rightFootOverrides: {carpet: 'T_Carpet.StepLeft'}},
      customMetadata: {keep: true},
      events: {...combatEvents, 'step-carpet': {samples: ['carpet.wav']},
        ak47: {samples: ['cached-shot.wav']}, 'cue-reload': {samples: ['old-cue.wav']}},
      timelines: {m249: {reload: {fps: 30, cues: []}, custom: {cues: [{time: 1}]}},
        unrelatedWeapon: {draw: {cues: []}}},
      audit: {cachedDefinitions: false, missing: ['old'], customAudit: {keep: true}},
    };
    const update = {
      build: actionsOnly ? '2000922' : '2000935', installedBuild: '2000935',
      events: {'cue-reload': {samples: ['new-cue.wav']},
        ...(!actionsOnly && {ak47: {samples: ['fresh-shot.wav']}})},
      timelines: {m249: {reload: {fps: 60, cues: [{time: 266 / 60}]}}},
      audit: {cachedDefinitions: actionsOnly, missing: [], timing: 'compiled source FPS'},
    };
    const before = structuredClone({old, update});
    const merged = JSON.parse(JSON.stringify(mergeAudioManifest(old, update)));
    for (const key of ['combatFeedback', 'footsteps', 'customMetadata'])
      assert.deepEqual(merged[key], old[key]);
    for (const [key, event] of Object.entries(combatEvents)) assert.deepEqual(merged.events[key], event);
    assert.deepEqual(merged.events['step-carpet'], old.events['step-carpet']);
    assert.deepEqual(merged.events.ak47, actionsOnly ? old.events.ak47 : update.events.ak47);
    assert.deepEqual(merged.events['cue-reload'], update.events['cue-reload']);
    assert.deepEqual(merged.timelines.m249.reload, update.timelines.m249.reload);
    assert.deepEqual(merged.timelines.m249.custom, old.timelines.m249.custom);
    assert.deepEqual(merged.timelines.unrelatedWeapon, old.timelines.unrelatedWeapon);
    assert.deepEqual(merged.audit, {...old.audit, ...update.audit});
    assert.equal(merged.build, update.build);
    assert.equal(merged.installedBuild, update.installedBuild);
    assert.deepEqual({old, update}, before);
  });
}

test('full import can create a manifest without existing maps', () => {
  const update = {build: '2000935', installedBuild: '2000935', events: {ak47: {samples: []}},
    timelines: {ak47: {reload: {cues: []}}}, audit: {cachedDefinitions: false}};
  assert.deepEqual(mergeAudioManifest({}, update), update);
});

test('empty updates preserve existing events, actions and audit fields', () => {
  const manifest = {events: {custom: {samples: []}}, timelines: {custom: {draw: {cues: []}}},
    audit: {custom: true}, combatFeedback: {build: '2000935'}};
  assert.deepEqual(mergeAudioManifest(manifest, {}), manifest);
});
