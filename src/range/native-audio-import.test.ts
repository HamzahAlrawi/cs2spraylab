import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
// The offline importer is deliberately ESM JavaScript, not part of the browser bundle.
// @ts-expect-error No declaration file for the static conversion tool.
import {extractSoundTimeline} from '../../tools/import-audio.mjs';

describe('static native cue import', () => {
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
