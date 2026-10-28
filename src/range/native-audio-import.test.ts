import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import nativeFootsteps from './native-footsteps-data.json';
// The offline importer is deliberately ESM JavaScript, not part of the browser bundle.
// @ts-expect-error No declaration file for the static conversion tool.
import {extractSoundTimeline} from '../../tools/import-audio.mjs';
// @ts-expect-error Offline conversion helpers are deliberately JavaScript.
import {extractFootsteps, footstepDefinition, selectFootstepSamples} from '../../tools/native-footsteps.mjs';

describe('static native cue import', () => {
  it('resolves footstep overrides through physical ancestry without changing bullet families', () => {
    const physics = [{surfacePropertyName: 'default', m_nameHash: 1},
      {surfacePropertyName: 'wood', m_nameHash: 2},
      {surfacePropertyName: 'dense_wood', m_nameHash: 3, m_baseNameHash: 2},
      {surfacePropertyName: 'quiet_case', m_nameHash: 4}];
    const mappings = {ct_player: {SurfacePropertiesList: [
      {surfacePropertyName: 'default', walkleft: 'CT_Default.StepLeft'},
      {surfacePropertyName: 'wood', walkleft: 'CT_Wood.StepLeft'},
      {surfacePropertyName: 'quiet_case', walkleft: 'CT_Silent.StepLeft'},
    ]}};
    const result = extractFootsteps(physics, mappings, {'Land_Default.StepLeft': {}, 'Land_Wood.StepLeft': {}, 'Land_Silent.StepLeft': {}});
    expect(result.surfaces).toEqual({default: 'default', wood: 'wood', dense_wood: 'wood', quiet_case: 'silent'});
    expect(result.events['land-wood']).toBe('Land_Wood.StepLeft');
    expect(() => extractFootsteps([{surfacePropertyName: 'cycle', m_nameHash: 5, base: 'cycle'}], mappings, {})).toThrow('cycle');
    expect(() => extractFootsteps([{surfacePropertyName: 'orphan', m_nameHash: 6, base: 'missing'}], mappings, {})).toThrow('Missing');
  });
  it('inherits scalar pitch/curves while preserving explicit native silence and full-bank sample spread', () => {
    const sources = {base: {pitch: 1.01, volume: .9, vsnd_files_track_01: ['base.vsnd']},
      land: {base: 'base', vsnd_files_track_01: ['land.vsnd']}, silent: {base: 'base', metadata: 'silentfs'}};
    expect(footstepDefinition(sources, 'land')).toMatchObject({pitch: 1.01, vsnd_files_track_01: ['land.vsnd']});
    expect(footstepDefinition(sources, 'silent').vsnd_files_track_01).toEqual([]);
    expect(() => footstepDefinition({a: {base: 'a'}}, 'a')).toThrow('cycle');
    const files = Array.from({length: 17}, (_, i) => `${i}.vsnd`);
    expect(selectFootstepSamples(files, 4)).toEqual(['0.vsnd', '5.vsnd', '11.vsnd', '16.vsnd']);
    expect(selectFootstepSamples(['a', 'a', 'b'], 4)).toEqual(['a', 'b']);
  });
  it('ships current footstep provenance, inherited pitch, finite curves and every referenced WAV', () => {
    const data = JSON.parse(fs.readFileSync('public/revamp/audio/events.json', 'utf8'));
    expect(data.footsteps.build).toBe(nativeFootsteps.build);
    expect(data.footsteps.sourceHashes).toEqual(nativeFootsteps.sourceHashes);
    const raw = fs.readFileSync('research/audio-events/footsteps.vsndevts');
    expect(crypto.createHash('sha256').update(raw).digest('hex')).toBe(nativeFootsteps.sourceHashes['soundevents/game_sounds_footsteps.vsndevts_c']);
    for (const [key, metadata] of Object.entries(nativeFootsteps.events)) {
      const event = data.events[key];
      expect(event).toMatchObject(metadata);
      expect(event.sampleSources).toHaveLength(event.samples.length);
      expect(event.samples.length).toBeLessThanOrEqual(key.startsWith('step-') && ['step-concrete', 'step-metal', 'step-wood'].includes(key) ? 8 : 4);
      if (!key.endsWith('-silent')) expect(event.samples.length).toBeGreaterThan(0);
      for (const url of event.samples) {
        const wav = fs.readFileSync(`public/revamp${url}`);
        expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
        expect(wav.length).toBeGreaterThan(100);
      }
      event.distanceCurve.forEach(([units, gain]: number[], index: number) => {
        expect(Number.isFinite(units) && Number.isFinite(gain)).toBe(true);
        if (index) expect(units).toBeGreaterThan(event.distanceCurve[index - 1][0]);
      });
    }
    expect(data.events['land-wood'].pitch).toBe(1.01);
    expect(data.events['step-concrete'].sampleSources.at(-1)).toMatch(/17\.vsnd$/);
    expect(nativeFootsteps.landingFallbacks).toEqual(['water', 'wet_sand']);
    expect(nativeFootsteps.rightFootOverrides).toEqual({carpet: 'T_Carpet.StepLeft'});
  });
  it('reads native AK reload sound markers, not ID or particle events', () => {
    const timeline = extractSoundTimeline(fs.readFileSync('research/reload_ak.vnmclip', 'utf8'), 73 / 30);
    expect(timeline.cues.map((cue: {nativeFrame: number}) => cue.nativeFrame)).toEqual([4, 11, 21, 32, 33, 48, 50]);
    expect(timeline.cues[1].key).toBe('native:Weapon_AK47.Clipout');
    expect(timeline.cues[1].time).toBe(11 / 30); expect(timeline.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('extracts native shell reload segment markers and client-only inspect cues', () => {
    const timeline = extractSoundTimeline(fs.readFileSync('research/reload_nova.vnmclip', 'utf8'), 49 / 30);
    expect(timeline.windows).toEqual({intro: {start: 0, duration: 11 / 30},
      loop: {start: 11 / 30, duration: 13 / 30}, outro: {start: 24 / 30, duration: 25 / 30}});
    expect(extractSoundTimeline(fs.readFileSync('research/lookat01_ak.vnmclip', 'utf8'), 5).cues
      .some((cue: {audience: string}) => cue.audience === 'local')).toBe(true);
  });
  it('exports resolvable samples, new equipment sounds and foley-only fire timelines', () => {
    const data = JSON.parse(fs.readFileSync('public/revamp/audio/events.json', 'utf8'));
    expect(data.audit.missing).toEqual([]);
    for (const id of ['nova', 'xm1014', 'mag7', 'sawedoff', 'zeus']) expect(data.events[id].samples.length).toBeGreaterThan(0);
    for (const timelines of Object.values(data.timelines) as Record<string, {cues: {key: string}[]}>[]) {
      for (const [action, timeline] of Object.entries(timelines)) for (const cue of timeline.cues) {
        expect(data.events[cue.key]).toBeDefined();
        if (action.startsWith('fire')) expect(data.events[cue.key].source).not.toMatch(/\.(Single|SingleDistant|Silenced|SilencedShot|Slash|Stab)$/i);
      }
    }
  });
});
