import {afterEach, describe, expect, it, vi} from 'vitest';
import {angleDiagnosis, loadAngleDiagnoses, saveAngleDiagnoses, loadPrefireHistory, prefireAttempt, savePrefireHistory,
  summarizePrefireHistory, loadPrefireRetentions, savePrefireRetention, prefireRecordMatches, type PrefireAttempt, type PrefireTrainingIdentity} from './training-log';
import {PrefireCoach} from './coaching';
import {legacyNativeMapId} from './maps';
const attempt = (patch: Partial<PrefireAttempt> = {}): PrefireAttempt => ({key: 'same', route: 'Long doors', outcome: 'won',
  date: '2026-10-10T00:00:00.000Z', score: 80, seconds: 20, goalMet: true, ...patch});
afterEach(() => vi.unstubAllGlobals());
describe('bounded local Prefire progress', () => {
  const original: PrefireTrainingIdentity = {mapId: legacyNativeMapId, catalogRevision: 'r1', gameBuild: 'build', geometrySha256: 'geometry'};
  const second: PrefireTrainingIdentity = {...original, mapId: 'synthetic'};
  const diagnosis = (identity?: PrefireTrainingIdentity) => angleDiagnosis({id: 1, name: 'Corner', cleared: false, shots: 1,
    openingStopped: false, readyAim: null, entry: true, openingHit: false, openingHead: false, threats: 1,
    contactToHitMs: null, message: 'Moving', tip: 'Brake'}, {...identity, id: 'same', key: 'same', routeId: 'same', angleId: 'same',
    date: '2026-10-10T00:00:00.000Z', scope: 'route'});
  const storage = () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value)});
    return values;
  };
  it('pins untagged history and diagnoses to the legacy map despite colliding IDs', () => {
    storage();
    savePrefireHistory([attempt(), attempt({...second, score: 99})]);
    saveAngleDiagnoses([diagnosis(), diagnosis(second)]);
    expect(loadPrefireHistory(original)).toHaveLength(1);
    expect(loadPrefireHistory(second)).toHaveLength(1);
    expect(summarizePrefireHistory(loadPrefireHistory(), 'same', second)).toMatchObject({attempts: 1, best: 99});
    expect(loadAngleDiagnoses(original)).toEqual([diagnosis()]);
    expect(loadAngleDiagnoses(second)).toEqual([diagnosis(second)]);
  });
  it('preserves other maps, legacy records and revisions when saving a bounded namespace', () => {
    storage();
    const revised = {...second, catalogRevision: 'r2'};
    savePrefireHistory([attempt()]); saveAngleDiagnoses([diagnosis()]);
    savePrefireHistory([attempt({...second})], second); saveAngleDiagnoses([diagnosis(second)], second);
    savePrefireHistory(Array.from({length: 50}, () => attempt({...revised})), revised);
    saveAngleDiagnoses(Array.from({length: 170}, () => diagnosis(revised)), revised);
    expect(loadPrefireHistory()).toHaveLength(42); expect(loadAngleDiagnoses()).toHaveLength(162);
    expect(loadPrefireHistory(original)).toHaveLength(1); expect(loadAngleDiagnoses(original)).toHaveLength(1);
    expect(loadPrefireHistory(second)).toHaveLength(1); expect(loadAngleDiagnoses(second)).toHaveLength(1);
    expect(loadPrefireHistory({...second, geometrySha256: 'changed'})).toHaveLength(0);
    expect(loadAngleDiagnoses({...second, gameBuild: 'changed'})).toHaveLength(0);
  });
  it('keeps a legacy retention bookmark when another map saves and consumes its own check', () => {
    const values = storage();
    const legacy = {diagnosis: diagnosis(), due: '2026-10-31T00:00:00.000Z'};
    values.set('spraylab.prefire.retention.v1', JSON.stringify(legacy));
    expect(prefireRecordMatches(loadPrefireRetentions()[0].diagnosis, second)).toBe(false);
    const other = {diagnosis: diagnosis(second), due: legacy.due};
    expect(savePrefireRetention(other, second)).toBe(true);
    expect(loadPrefireRetentions()).toEqual([other, legacy]);
    expect(savePrefireRetention(undefined, second)).toBe(true);
    expect(loadPrefireRetentions()).toEqual([legacy]);
    expect(prefireRecordMatches(legacy.diagnosis, original)).toBe(true);
  });
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
