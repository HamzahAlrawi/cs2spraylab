import type {CoachingSummary} from './coaching-types';
import type {Settings} from './config';

export type PracticePhase = 'guided' | 'unassisted' | 'varied' | 'pressure' | 'retention';
export type PracticePlan = {skill: string; target: number; baseline: number; reps: 3; lesson: 0 | 1 | 2};
export type PracticeBlock = {plan: PracticePlan; phase: PracticePhase; key: string; values: (number | null)[]; ids: string[]};
export function practicePlan(summary: CoachingSummary): PracticePlan | undefined {
  const measured = summary.metrics.filter(metric => metric.score !== null && Number.isFinite(metric.score));
  const metric = measured.reduce<(typeof measured)[number] | undefined>((lowest, row) => !lowest || row.score! < lowest.score! ? row : lowest, undefined);
  if (!metric) return;
  const label = metric.label.toLowerCase();
  return {skill: metric.label, baseline: metric.score!, target: /discipline|settled|stopp/.test(label) ? 95 : 80, reps: 3,
    lesson: /discipline|settled|stopp|brak|counter/.test(label) ? 0 : /isolat|entry|threat|cover/.test(label) ? 2 : 1};
}
export function startPractice(plan: PracticePlan, key: string, phase: PracticePhase = 'guided'): PracticeBlock {
  return {plan, key, phase, values: [], ids: []};
}
export function recordPractice(block: PracticeBlock, id: string, key: string, summary?: CoachingSummary): PracticeBlock {
  if (block.key !== key || block.ids.includes(id) || block.values.length >= block.plan.reps) return block;
  const score = summary?.metrics.find(metric => metric.label === block.plan.skill)?.score;
  if (score == null || !Number.isFinite(score)) return block;
  return {...block, ids: [...block.ids, id], values: [...block.values, score]};
}
export function practiceOutcome(block: PracticeBlock) {
  const measured = block.values.filter((v): v is number => v !== null);
  return {complete: block.values.length >= block.plan.reps, measured: measured.length,
    passed: measured.filter(value => value >= block.plan.target).length,
    average: measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null};
}
// Include the controls that change the task or its assistance, not cosmetic/render settings.
export function practiceSettingsKey(settings: Settings, distance?: number) {
  return JSON.stringify([settings.mode, settings.weapon, settings.sidearm, settings.primaryEnabled,
    settings.spread, settings.burst, settings.moving, settings.targetSpeed, settings.drillPace,
    settings.peekScenario, settings.peekDuration, settings.transferRule, settings.transferAfter,
    settings.follow, settings.showImpactPattern, settings.showMousePath, settings.sensitivity, settings.dpi,
    distance === undefined ? null : Math.round(distance / 2) * 2]);
}
