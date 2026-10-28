import type {CoachingSummary} from './coaching-types';

export type SkillSample = {id: string; key: string; date: string; metrics: {label: string; score: number | null}[]};
const storageKey = 'spraylab.skill-trends.v1';
export function skillSample(id: string, key: string, summary: CoachingSummary, date = new Date().toISOString()): SkillSample {
  return {id, key, date, metrics: summary.metrics.map(({label, score}) => ({label, score}))};
}
export function loadSkillSamples(): SkillSample[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(raw) ? raw.filter((v): v is SkillSample => !!v && typeof v.id === 'string' && v.id.length < 500 &&
      typeof v.key === 'string' && v.key.length < 4000 && typeof v.date === 'string' && Number.isFinite(Date.parse(v.date)) &&
      Array.isArray(v.metrics) && v.metrics.length <= 8 && v.metrics.every((m: SkillSample['metrics'][number]) =>
        !!m && typeof m.label === 'string' && m.label.length < 200 && (m.score === null || typeof m.score === 'number' && Number.isFinite(m.score) && m.score >= 0 && m.score <= 100))).slice(0, 240) : [];
  } catch {return [];}
}
export function saveSkillSamples(samples: readonly SkillSample[]) {
  try {localStorage.setItem(storageKey, JSON.stringify(samples.slice(0, 240)));} catch { /* Session-only history. */ }
}
export function skillTrends(samples: readonly SkillSample[], key: string) {
  const matching = samples.filter(sample => sample.key === key);
  const labels = [...new Set(matching.flatMap(sample => sample.metrics.map(metric => metric.label)))];
  return labels.map(label => {
    const values = matching.flatMap(sample => {
      const value = sample.metrics.find(metric => metric.label === label)?.score;
      return value == null ? [] : [value];
    });
    const average = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    return {label, samples: values.length, recent: average(values.slice(0, 3)), previous: average(values.slice(3, 6)),
      recentCount: Math.min(3, values.length), previousCount: Math.min(3, Math.max(0, values.length - 3))};
  });
}
