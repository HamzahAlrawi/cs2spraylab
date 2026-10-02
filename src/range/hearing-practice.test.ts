import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  HEARING_HISTORY_LIMIT, HearingPlayback, HearingTrialDeck, angularError, boardHearingPoint, hearingAngle,
  hearingDefaults, hearingPoint, hearingScoring, hearingSequence, hearingStats, normalizeHearingConfig,
  parseHearingHistory, readHearingStorage, saveHearingStorage, scoreHearing, type HearingResult,
} from './hearing-practice';

afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
describe('hearing direction and distance', () => {
  it('uses north=0, east=90 and clockwise angles with wrapped error', () => {
    expect(hearingPoint(0, 8)).toEqual({x: 0, z: -8});
    expect(hearingPoint(90, 8).x).toBeCloseTo(8);
    for (const angle of [0, 90, 180, 270, 359, -1, 721]) expect(angularError(hearingAngle(hearingPoint(angle, 8)), angle)).toBeCloseTo(0);
    expect(angularError(359, 1)).toBe(2); expect(angularError(0, 180)).toBe(180);
    expect(angularError(720, -360)).toBe(0);
  });
  it('scores absolute distance without a directional sign or near/far bias', () => {
    const target = hearingPoint(0, 12);
    expect(scoreHearing(target, target, 'direction-distance').score).toBe(100);
    expect(scoreHearing(target, hearingPoint(0, 6), 'distance')).toMatchObject({distanceError: 6, score: 50});
    expect(scoreHearing(target, hearingPoint(0, 18), 'distance').score).toBe(50);
    expect(scoreHearing(target, hearingPoint(90, 24), 'direction-distance').score).toBe(0);
    expect(scoreHearing(target, hearingPoint(180, 12), 'distance').score).toBe(100);
    expect(scoreHearing(target, hearingPoint(0, 24), 'direction').score).toBe(100);
    expect(hearingScoring({...hearingDefaults, device: 'mono', task: 'direction'})).toBe('distance');
  });
  it('projects board clicks to fixed world points and clamps corners', () => {
    expect(boardHearingPoint(.5, .5)).toEqual({x: 0, z: 0});
    const right = boardHearingPoint(1, .5);
    expect(right).toEqual({x: 24, z: 0});
    const corner = boardHearingPoint(1, 1);
    expect(Math.hypot(corner.x, corner.z)).toBeCloseTo(24);
    expect(hearingAngle(corner)).toBeCloseTo(135);
  });
});
describe('balanced hidden sound trials', () => {
  it('covers all 24 sector/band combinations per cycle with deterministic randomness', () => {
    const deck = new HearingTrialDeck(() => .5), seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const trial = deck.next({...hearingDefaults, sounds: 'steps', surface: 'wood'});
      const distance = Math.hypot(trial.point.x, trial.point.z);
      seen.add(`${Math.round(hearingAngle(trial.point) / 45)}-${Math.floor((distance - 4) / (20 / 3))}`);
      expect(distance).toBeGreaterThanOrEqual(4); expect(distance).toBeLessThanOrEqual(24);
      expect(trial).toMatchObject({event: 'step-wood', steps: true, muffled: false});
    }
    expect(seen.size).toBe(24);
    expect(deck.next({...hearingDefaults, sounds: 'shots', gun: 'm4a1s'}).event).toBe('m4a1s');
  });
  it('jitter stays inside sectors and only optional muffling is randomized', () => {
    for (const random of [.001, .999]) {
      const deck = new HearingTrialDeck(() => random);
      for (let i = 0; i < 24; i++) {
        const t = deck.next({...hearingDefaults, muffled: true});
        expect(t.muffled).toBe(random < .5);
        expect(t.steps).toBe(random < .5);
        expect(Math.hypot(t.point.x, t.point.z)).toBeGreaterThanOrEqual(4);
        expect(Math.hypot(t.point.x, t.point.z)).toBeLessThanOrEqual(24);
      }
    }
  });
});
describe('hearing persistence', () => {
  it('rejects invalid enum values and nonfinite gains, clamps finite gain', () => {
    for (const input of [null, [], 8, {sounds: 'invalid', surface: 'carpet', gun: 'aug', panner: 'fake', gain: NaN, muffled: 'true'}])
      expect(normalizeHearingConfig(input)).toEqual(hearingDefaults);
    expect(normalizeHearingConfig({gain: 8}).gain).toBe(1);
    expect(normalizeHearingConfig({gain: -4}).gain).toBe(.1);
    expect(normalizeHearingConfig({gain: Infinity}).gain).toBe(.55);
    expect(normalizeHearingConfig({falloff: 'invalid'}).falloff).toBe('native');
    expect(normalizeHearingConfig({falloff: 'calibrated'}).falloff).toBe('calibrated');
    expect(normalizeHearingConfig({sounds: 'shots', device: 'mono', muffled: true})).toMatchObject({sounds: 'shots', device: 'mono', muffled: true});
  });
  it('bounds and validates history and recomputes untrusted scores', () => {
    const row: HearingResult = {date: '2026-10-02T00:00:00Z', target: hearingPoint(0, 8), guess: hearingPoint(0, 8), scoring: 'direction-distance',
      replays: 0, directionError: 999, distanceError: 999, score: 999};
    expect(parseHearingHistory(Array.from({length: 150}, () => row))).toHaveLength(HEARING_HISTORY_LIMIT);
    expect(parseHearingHistory([row])[0]).toMatchObject({score: 100, directionError: 0, distanceError: 0});
    for (const bad of [{...row, date: 'bad'}, {...row, target: {x: NaN, z: 2}}, {...row, guess: {x: 0, z: 0}}, {...row, replays: -1}, {...row, scoring: 'fake'}])
      expect(parseHearingHistory([bad])).toEqual([]);
    expect(parseHearingHistory({})).toEqual([]);
    expect(hearingStats([])).toEqual({count: 0, score: null, direction: null, distance: null});
    const rows = parseHearingHistory([{...row, scoring: 'distance'}, {...row, scoring: 'direction'}]);
    expect(hearingStats(rows)).toMatchObject({count: 2, score: 100, direction: 0, distance: 0});
  });
  it('handles denied storage and malformed JSON honestly', () => {
    vi.stubGlobal('localStorage', {getItem: () => '{', setItem: () => {throw new Error('Quota');}});
    expect(readHearingStorage('key')).toBeNull(); expect(saveHearingStorage('key', {})).toBe(false);
  });
});
describe('hearing playback generation', () => {
  it('cancels all pending sounds and rejects stale async loading completions', () => {
    vi.useFakeTimers(); const stop = vi.fn(), sound = vi.fn();
    const gate = new HearingPlayback(stop), old = gate.begin();
    for (const delay of hearingSequence(true)) gate.schedule(old, delay, sound);
    vi.advanceTimersByTime(440); expect(sound).toHaveBeenCalledTimes(2);
    const next = gate.begin();
    expect(gate.current(old)).toBe(false);
    gate.schedule(old, 0, sound); gate.schedule(next, 50, sound);
    vi.advanceTimersByTime(2000); expect(sound).toHaveBeenCalledTimes(3);
    gate.cancel(); expect(stop).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
  });
  it('answer, hide, suspension, replay and unmount can share immediate cancellation', () => {
    vi.useFakeTimers(); const callback = vi.fn(), gate = new HearingPlayback(vi.fn());
    for (let i = 0; i < 5; i++) {const token = gate.begin(); gate.schedule(token, 10, callback); gate.cancel();}
    vi.runAllTimers(); expect(callback).not.toHaveBeenCalled();
    expect(hearingSequence(false)).toEqual([0, 240]);
  });
});
