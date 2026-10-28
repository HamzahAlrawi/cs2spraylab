import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  HEARING_HISTORY_LIMIT, HearingPlayback, HearingTrialDeck, angularError, boardHearingPoint, comparableHearingResults, hearingAngle, hearingCoaching,
  hearingDefaults, hearingPoint, hearingScoring, hearingSequence, hearingStats, normalizeHearingConfig,
  parseHearingHistory, readHearingStorage, saveHearingStorage, scoreHearing, signedHearingError, type HearingConfig, type HearingResult,
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

function answer({bearing = 0, guessBearing = bearing, range = 12, guessRange = range, config = hearingDefaults, heading = 0, replays = 0, index = 0,
  event = config.sounds === 'shots' ? config.gun : `step-${config.surface}`, muffled = false, volume = .5}: {
  bearing?: number; guessBearing?: number; range?: number; guessRange?: number; config?: HearingConfig; heading?: number;
  replays?: number; index?: number; event?: string; muffled?: boolean; volume?: number;
} = {}): HearingResult {
  const target = hearingPoint(bearing, range), guess = hearingPoint(guessBearing, guessRange), scoring = hearingScoring(config);
  return {date: new Date(Date.UTC(2026, 9, 10, 0, 0, 120 - index)).toISOString(), target, guess, scoring, replays,
    context: {config: {...config}, heading, volume, event, muffled}, ...scoreHearing(target, guess, scoring)};
}

describe('hearing skill feedback', () => {
  it('provides signed shortest-bearing correction and overshot/undershot range evidence', () => {
    expect(signedHearingError(1, 359)).toBe(2);
    expect(signedHearingError(359, 1)).toBe(-2);
    const right = hearingCoaching(answer({bearing: 1, guessBearing: 359, guessRange: 17}), hearingDefaults);
    expect(right.evidence).toContain('2.0 degrees right'); expect(right.evidence).toContain('overshot range by 5.0 m');
    expect(right.action).toContain('same sound'); expect(right.goal).toContain('within 3 m');
    const left = hearingCoaching(answer({bearing: 359, guessBearing: 1, guessRange: 8}), hearingDefaults);
    expect(left.evidence).toContain('2.0 degrees left'); expect(left.evidence).toContain('undershot range by 4.0 m');
    expect(left.confidence).toContain('One small sample');
  });
  it('does not choose an arbitrary left/right correction for the opposite bearing', () => {
    const summary = hearingCoaching(answer({bearing: 90, guessBearing: 270}), hearingDefaults);
    expect(summary.evidence).toContain('opposite your estimate');
    expect(summary.evidence).not.toMatch(/180.0 degrees (left|right)/);
  });
  it('judges direction-only trials independently of distance', () => {
    const config: HearingConfig = {...hearingDefaults, task: 'direction'};
    const near = hearingCoaching(answer({config, range: 24, guessRange: 1}), config);
    const exact = hearingCoaching(answer({config, range: 24, guessRange: 24}), config);
    expect(near.score).toBe(100); expect(near.score).toBe(exact.score);
    expect(near.metrics.map(metric => metric.label)).toEqual(['Direction error']);
    expect(near.evidence).toContain('distance is not scored'); expect(near.goal).toContain('distance does not affect');
    expect(near.evidence).not.toMatch(/overshot|undershot/);
  });
  it('does not infer or score any directional skill in mono, even from misleading input scoring', () => {
    const config: HearingConfig = {...hearingDefaults, device: 'mono'};
    const row = {...answer({config, bearing: 0, guessBearing: 180}), scoring: 'direction-distance' as const};
    const summary = hearingCoaching(row, config, [row]);
    expect(summary.score).toBe(100); expect(summary.metrics.map(metric => metric.label)).toEqual(['Distance error']);
    expect(summary.focus).toBe('Estimate range, not direction'); expect(summary.strength).toBeUndefined();
    expect(summary.evidence).toContain('no directional judgment'); expect(summary.evidence).not.toMatch(/source|front\/back|degrees/);
    expect(summary.action).toContain('Mono has no left/right cue'); expect(summary.goal).toContain('bearing is not judged');
  });
  it('identifies front/back mirror confusion relative to the rotated listener', () => {
    const summary = hearingCoaching(answer({bearing: 110, guessBearing: 250, heading: 90}), hearingDefaults);
    expect(summary.focus).toBe('Check front versus back'); expect(summary.evidence).toContain('swapped the front/back half');
    expect(summary.action).toContain('90 degrees'); expect(summary.goal).toContain('identify the front/back half first');
    expect(hearingCoaching(answer({bearing: 90, guessBearing: 270}), hearingDefaults).focus).not.toBe('Check front versus back');
    expect(hearingCoaching(answer({bearing: 0, guessBearing: 45}), hearingDefaults).focus).not.toBe('Check front versus back');
  });
  it('attributes equal-power ambiguity to the setup instead of poor listening', () => {
    const config: HearingConfig = {...hearingDefaults, panner: 'equalpower'};
    const summary = hearingCoaching(answer({config, guessBearing: 180}), config);
    expect(summary.action).toContain('Try HRTF with headphones');
    expect(summary.confidence).toContain('ambiguity is not proof of poor listening');
  });
  it('uses speaker calibration recommendations and limits directional advice to that setup', () => {
    const config: HearingConfig = {...hearingDefaults, device: 'stereo'};
    const summary = hearingCoaching(answer({config, guessBearing: 50}), config);
    expect(summary.action).toContain('speaker placement fixed'); expect(summary.goal).toContain('45 degrees');
  });
  it('does not punish replays or claim distance precision transfers into real gameplay', () => {
    const config = {...hearingDefaults, muffled: true};
    const row = answer({config, guessRange: 22, muffled: true}), assisted = {...row, replays: 4};
    const summary = hearingCoaching(assisted, config);
    expect(summary.score).toBe(hearingCoaching(row, config).score);
    expect(summary.focus).toBe('Separate muffling from distance'); expect(summary.action).toContain('quieter audio directly into metres');
    expect(summary.metrics[1].detail).toContain('not a guarantee of in-game range');
    expect(summary.confidence).toContain('score is unchanged'); expect(summary.goal).toContain('in this drill');
  });
  it('keeps positive feedback specific to one result and gives a numeric next-trial goal', () => {
    const summary = hearingCoaching(answer({guessBearing: 5, guessRange: 13}), hearingDefaults);
    expect(summary.strength).toBe('Bearing error was 5.0 degrees on this trial.');
    expect(summary.goal).toContain('within 10 degrees and range within 2 m');
    expect(summary.confidence).toContain('1 comparable'); expect(summary.confidence).not.toMatch(/mastered|expert|professional/);
  });
});

describe('comparable hearing evidence', () => {
  it('preserves old answers without assuming their audio setup', () => {
    const legacy = {...answer(), context: undefined};
    expect(parseHearingHistory([legacy])).toHaveLength(1);
    expect(comparableHearingResults(hearingDefaults, [legacy], .5)).toEqual([]);
    const summary = hearingCoaching(legacy, hearingDefaults, Array.from({length: 30}, () => legacy));
    expect(summary.confidence).toContain('no setup metadata'); expect(summary.metrics).toHaveLength(2);
  });
  it('round-trips bounded setup metadata, clones it, and drops malformed metadata without losing the answer', () => {
    const row = answer(), parsed = parseHearingHistory([row])[0];
    expect(parsed.context).toEqual(row.context); expect(parsed.context).not.toBe(row.context);
    expect(parsed.context!.config).not.toBe(row.context!.config);
    for (const context of [{...row.context, heading: 360}, {...row.context, heading: NaN}, {...row.context, volume: 0}, {...row.context, volume: Infinity},
      {...row.context, volume: 2}, {...row.context, event: 'x'.repeat(1000)}, {...row.context, event: 'step-metal'}, {...row.context, muffled: true},
      {...row.context, config: {...hearingDefaults, gain: 99}}, {...row.context, config: {...hearingDefaults, device: 'surround'}},
      {...row.context, config: {}}, {...row.context, config: {...hearingDefaults, device: 'mono'}}]) {
      const accepted = parseHearingHistory([{...row, context}]);
      expect(accepted).toHaveLength(1); expect(accepted[0].context).toBeUndefined();
    }
  });
  it('does not combine different devices, modes, volumes, guns, surfaces or audio processing', () => {
    const ref = answer();
    const differences: Partial<HearingConfig>[] = [{device: 'stereo'}, {device: 'mono'}, {panner: 'equalpower'}, {falloff: 'calibrated'},
      {task: 'direction'}, {gain: .4}, {muffled: true}, {sounds: 'steps'}, {surface: 'wood'}, {gun: 'm4a4'}];
    const rows = differences.map((patch, index) => answer({config: {...hearingDefaults, ...patch}, index: index + 1}));
    rows.push(answer({index: 50, volume: .6}), {...answer({index: 51}), context: undefined});
    expect(comparableHearingResults(hearingDefaults, [ref, ...rows], .5, ref)).toEqual([ref]);
  });
  it('separates actual sound, muffling and first-listen versus replayed cohorts without lowering scores', () => {
    const config = {...hearingDefaults, muffled: true}, ref = answer({config});
    const rows = [ref, answer({config, index: 1, event: 'ak47'}), answer({config, index: 2, muffled: true}), answer({config, index: 3, replays: 1})];
    expect(comparableHearingResults(config, rows, .5, ref)).toEqual([ref]);
    const replayed = answer({config, index: 4, replays: 2});
    expect(comparableHearingResults(config, [...rows, replayed], .5, replayed)).toEqual([replayed]);
  });
  it('bounds and deduplicates history so repeated records cannot inflate confidence', () => {
    const ref = answer(), rows = Array.from({length: 200}, () => ref);
    expect(comparableHearingResults(hearingDefaults, rows, .5, ref)).toHaveLength(1);
    expect(hearingCoaching(ref, hearingDefaults, rows).confidence).toContain('1 comparable');
    const unique = Array.from({length: 200}, (_, index) => answer({index}));
    expect(comparableHearingResults(hearingDefaults, unique, .5, ref)).toHaveLength(HEARING_HISTORY_LIMIT);
  });
  it('does not show weak-sector or trend claims for empty or insufficient history', () => {
    const rows = Array.from({length: 11}, (_, index) => answer({index, bearing: index % 3 * 45}));
    const summary = hearingCoaching(rows[0], hearingDefaults, rows.slice(1));
    expect(summary.metrics.map(metric => metric.label)).toEqual(['Direction error', 'Distance error']);
    expect(summary.confidence).toContain('Early sample');
  });
  it('only identifies the weakest adequately sampled sectors using listener-relative directions', () => {
    const rows = Array.from({length: 12}, (_, index) => answer({index, heading: 90, bearing: index < 6 ? 90 : 270,
      guessBearing: index < 6 ? 95 : 310}));
    const summary = hearingCoaching(rows[0], hearingDefaults, rows.slice(1));
    const worst = summary.metrics.find(metric => metric.label === 'Weakest sampled sector');
    expect(worst?.value).toBe('back'); expect(worst?.detail).toContain('40.0 degrees');
    expect(worst?.detail).toContain('Only 2/8 sectors');
    const oneSector = rows.map(row => ({...row, target: hearingPoint(90, 12), ...scoreHearing(hearingPoint(90, 12), row.guess, row.scoring)}));
    expect(hearingCoaching(oneSector[0], hearingDefaults, oneSector.slice(1)).metrics.some(metric => metric.label === 'Weakest sampled sector')).toBe(false);
  });
  it('shows matched-sector and matched-distance trends only with two adequate blocks', () => {
    const rows = Array.from({length: 24}, (_, index) => {
      const bearing = index % 3 * 90, range = [8, 14, 21][index % 3];
      return answer({index, bearing, guessBearing: bearing + (index < 12 ? 5 : 30), range, guessRange: range + (index < 12 ? 1 : 3)});
    });
    const metrics = hearingCoaching(rows[0], hearingDefaults, rows.slice(1)).metrics;
    expect(metrics.find(metric => metric.label === 'Direction trend')?.value).toBe('30.0 -> 5.0 degrees');
    expect(metrics.find(metric => metric.label === 'Distance trend')?.value).toBe('3.0 -> 1.0 m');
    expect(metrics.find(metric => metric.label === 'Direction trend')?.detail).toContain('matched direction sectors');
    const mono = {...hearingDefaults, device: 'mono' as const};
    const monoRows = rows.map((row, index) => answer({config: mono, index, bearing: index % 3 * 90}));
    expect(hearingCoaching(monoRows[0], mono, monoRows.slice(1)).metrics.some(metric => /Direction|sector/.test(metric.label))).toBe(false);
  });
  it('suppresses trends when older and newer trials have different difficulty strata', () => {
    const rows = Array.from({length: 24}, (_, index) => answer({index, bearing: index < 12 ? 0 : 180, range: index < 12 ? 8 : 21}));
    expect(hearingCoaching(rows[0], hearingDefaults, rows.slice(1)).metrics.some(metric => /trend/.test(metric.label))).toBe(false);
  });
  it('does not manufacture a weak sector when all sampled directions are similarly accurate', () => {
    const rows = Array.from({length: 24}, (_, index) => answer({index, bearing: index % 8 * 45, guessBearing: index % 8 * 45 + 2}));
    expect(hearingCoaching(rows[0], hearingDefaults, rows.slice(1)).metrics.some(metric => metric.label === 'Weakest sampled sector')).toBe(false);
  });
});
