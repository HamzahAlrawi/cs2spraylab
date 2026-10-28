/** Local practice scores, not a FACEIT rank or a professional-player benchmark. */
export type SkillMetric = {label: string; value: string; score: number | null; detail: string};
export type CoachingSummary = {
  score: number | null;
  focus: string;
  evidence: string;
  action: string;
  goal: string;
  strength?: string;
  confidence: string;
  metrics: SkillMetric[];
};

export function sameCoachingMetrics(left: SkillMetric[], right: SkillMetric[]) {
  return left.length === right.length && left.every((metric, index) => {
    const other = right[index];
    return metric.label === other.label && metric.value === other.value && metric.score === other.score && metric.detail === other.detail;
  });
}

export function readCoachingSummary(value: unknown): CoachingSummary | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  const text = (s: unknown) => typeof s === 'string' && s.length <= 1500;
  const score = (n: unknown) => n === null || typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  if (!score(v.score) || !['focus', 'evidence', 'action', 'goal', 'confidence'].every(k => text(v[k]))
    || v.strength !== undefined && !text(v.strength) || !Array.isArray(v.metrics) || v.metrics.length > 8) return;
  const metrics: SkillMetric[] = [];
  for (const row of v.metrics) {
    if (!row || typeof row !== 'object' || !text(row.label) || !text(row.value) || !text(row.detail) || !score(row.score)) return;
    metrics.push({label: row.label, value: row.value, detail: row.detail, score: row.score});
  }
  return {score: v.score as number | null, focus: v.focus as string, evidence: v.evidence as string,
    action: v.action as string, goal: v.goal as string, confidence: v.confidence as string,
    ...(v.strength === undefined ? {} : {strength: v.strength as string}), metrics};
}
