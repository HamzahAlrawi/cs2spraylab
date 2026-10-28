import {describe, expect, it} from 'vitest';
import {defaults} from './config';
import {practiceOutcome, practicePlan, practiceSettingsKey, recordPractice, startPractice} from './adaptive-practice';
import {readCoachingSummary, sameCoachingMetrics, type CoachingSummary} from './coaching-types';
import {skillTrends} from './skill-trends';
import {setupKey} from './setup-key';

const summary: CoachingSummary = {score: 60, focus: 'Brake', evidence: 'Measured', action: 'Stop', goal: 'Settle', confidence: 'Local', metrics: [
  {label: 'Shot discipline', score: 40, value: '40%', detail: 'Grounded'}, {label: 'Opening preparation', score: null, value: '--', detail: 'Unknown'},
  {label: 'Recoil containment', score: 80, value: '80%', detail: 'Center'}]};
describe('measured practice blocks', () => {
  it('matches sanitized review measurements by fields, independent of object key insertion order', () => {
    const cleaned = readCoachingSummary(summary)!;
    expect(JSON.stringify(cleaned.metrics)).not.toBe(JSON.stringify(summary.metrics));
    expect(sameCoachingMetrics(cleaned.metrics, summary.metrics)).toBe(true);
    expect(sameCoachingMetrics(cleaned.metrics, summary.metrics.slice(1))).toBe(false);
    for (const patch of [{score: 0}, {label: 'Other skill'}, {value: '--'}, {detail: 'Other evidence'}]) {
      expect(sameCoachingMetrics(cleaned.metrics, [{...summary.metrics[0], ...patch}, ...summary.metrics.slice(1)])).toBe(false);
    }
  });
  it('selects a measured weakness, a specific criterion and contextual lesson', () => {
    expect(practicePlan(summary)).toEqual({skill: 'Shot discipline', target: 95, baseline: 40, reps: 3, lesson: 0});
    expect(practicePlan({...summary, metrics: summary.metrics.map(row => ({...row, score: null}))})).toBeUndefined();
  });
  it('counts only new compatible reps and preserves unknowns rather than scoring zero', () => {
    let block = startPractice(practicePlan(summary)!, 'same');
    expect(recordPractice(block, '1', 'changed', summary)).toBe(block);
    block = recordPractice(block, '1', 'same', summary);
    expect(recordPractice(block, '1', 'same', summary)).toBe(block);
    block = recordPractice(block, '2', 'same');
    block = recordPractice(block, '3', 'same', {...summary, metrics: [{...summary.metrics[0], score: 100}]});
    expect(practiceOutcome(block)).toEqual({complete: false, measured: 2, average: 70, passed: 1});
    block = recordPractice(block, '4', 'same', summary);
    expect(practiceOutcome(block).complete).toBe(true);
    expect(recordPractice(block, '5', 'same', summary)).toBe(block);
    expect(practiceOutcome(startPractice(practicePlan(summary)!, 'empty')).average).toBeNull();
  });
  it('separates task settings but not cosmetic or rendering changes', () => {
    const key = practiceSettingsKey(defaults, 12);
    expect(practiceSettingsKey({...defaults, volume: 0, quality: 'performance'}, 12)).toBe(key);
    for (const patch of [{weapon: 'm4a4' as const}, {spread: false}, {burst: 10}, {drillPace: 'challenge' as const}, {moving: true}, {sensitivity: 2}]) {
      expect(practiceSettingsKey({...defaults, ...patch}, 12)).not.toBe(key);
    }
    expect(practiceSettingsKey(defaults, 25)).not.toBe(key);
  });
  it('filters skill trends by exact task key and reports actual non-null sample counts', () => {
    const samples = [null, 100, 80, 60, 40, 20, 0].map((score, i) => ({id: String(i), key: 'same', date: '', metrics: [{label: 'Brake', score}]}));
    samples.unshift({id: 'other', key: 'easier', date: '', metrics: [{label: 'Brake', score: 100}]});
    expect(skillTrends(samples, 'same')).toEqual([{label: 'Brake', recent: 80, previous: 20, samples: 6, recentCount: 3, previousCount: 3}]);
    expect(skillTrends(samples, 'missing')).toEqual([]);
  });
  it('keeps full-context fingerprints deterministic and within legacy history bounds', () => {
    const large = {route: 'long', settings: Array.from({length: 1000}, (_, i) => `angle-${i}`)};
    expect(setupKey(large)).toHaveLength(41);
    expect(setupKey(large)).toBe(setupKey(large));
    expect(setupKey({...large, route: 'short'})).not.toBe(setupKey(large));
  });
});
