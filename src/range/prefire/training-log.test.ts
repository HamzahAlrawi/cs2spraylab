import {afterEach, describe, expect, it, vi} from 'vitest';
import {loadPrefireHistory, prefireAttempt, savePrefireHistory, summarizePrefireHistory, type PrefireAttempt} from './training-log';
import {PrefireCoach} from './coaching';
const attempt = (patch: Partial<PrefireAttempt> = {}): PrefireAttempt => ({key: 'same', route: 'Long doors', outcome: 'won',
  date: '2026-10-10T00:00:00.000Z', score: 80, seconds: 20, goalMet: true, ...patch});
afterEach(() => vi.unstubAllGlobals());
describe('bounded local Prefire progress', () => {
  it('compares only like-for-like setups and requires consecutive clean wins', () => {
    const data = [attempt({score: 90}), attempt({key: 'different', score: 100}), attempt({score: 85}), attempt({outcome: 'lost', goalMet: false}), attempt()];
    expect(summarizePrefireHistory(data, 'same')).toMatchObject({attempts: 4, streak: 2, best: 90, last: data[0]});
    expect(summarizePrefireHistory(data, 'unknown')).toMatchObject({attempts: 0, streak: 0, best: null});
  });
  it('does not register a loss or draw as a clean win, regardless of quality metrics', () => {
    const review = {...new PrefireCoach(['Car']).review(), goalMet: true};
    expect(prefireAttempt(review, 'same', 'Long doors', 'lost', 20).goalMet).toBe(false);
    expect(prefireAttempt(review, 'same', 'Long doors', 'won', 20).goalMet).toBe(true);
  });
  it('persists only valid entries and caps records without touching Duel history', () => {
    const values = new Map([['spraylab.duel.history.v1', 'existing']]);
    vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value)});
    savePrefireHistory([...Array.from({length: 60}, () => attempt()), attempt({score: Infinity})]);
    expect(loadPrefireHistory()).toHaveLength(40);
    expect(values.get('spraylab.duel.history.v1')).toBe('existing');
  });
  it.each([null, '{}', 'null', '[]', '{', 'false', '42'])('tolerates malformed history %s', raw => {
    vi.stubGlobal('localStorage', {getItem: () => raw}); expect(loadPrefireHistory()).toEqual([]);
  });
  it('rejects malformed scores, dates, outcomes, durations and unbounded labels', () => {
    const corrupt = [attempt({score: -1}), attempt({score: 101}), attempt({date: 'bad'}), attempt({outcome: 'other' as any}),
      attempt({seconds: -1}), attempt({seconds: 181}), attempt({key: 'x'.repeat(501)}), attempt({goalMet: 'true' as any}), null];
    vi.stubGlobal('localStorage', {getItem: () => JSON.stringify([...corrupt, attempt({score: null})])});
    expect(loadPrefireHistory()).toEqual([attempt({score: null})]);
  });
  it('continues with session progress when storage is missing or blocked', () => {
    vi.stubGlobal('localStorage', undefined); expect(loadPrefireHistory()).toEqual([]); expect(() => savePrefireHistory([attempt()])).not.toThrow();
    vi.stubGlobal('localStorage', {getItem: () => {throw new Error('blocked');}, setItem: () => {throw new Error('quota');}});
    expect(loadPrefireHistory()).toEqual([]); expect(() => savePrefireHistory([attempt()])).not.toThrow();
  });
});
