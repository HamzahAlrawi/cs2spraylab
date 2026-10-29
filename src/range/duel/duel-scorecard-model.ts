import {readCoachingSummary, type SkillMetric} from '../coaching-types';
import type {DuelHistory, DuelReview} from './coaching';
import {readAimMetrics, timingValue} from './aim-metrics';
import {readDuelDebrief} from './fight-feedback';

export const validNumber = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const integer = (value: unknown): value is number => validNumber(value) && Number.isSafeInteger(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const safeText = (value: unknown) => typeof value === 'string' && value.trim() && value.length <= 1500 &&
  !/\b(?:NaN|undefined|Infinity|null)\b|\[object \w+\]|[\x00-\x08\x0b\x0c\x0e-\x1f]/i.test(value) ? value.trim() : undefined;
export const measured = (value: unknown, digits = 0, unit = '', max = Number.MAX_SAFE_INTEGER) =>
  validNumber(value, max) ? `${value.toFixed(digits)}${unit}` : '--';
export const count = (value: unknown) => integer(value) ? String(value) : '--';
export const scoreLabel = (review: DuelReview) => {
  const value = review.coaching?.score === undefined ? review.score : review.coaching.score;
  return validNumber(value, 100) ? `${Math.round(value)}/100` : 'Unscored';
};
const hasActivity = (review?: DuelReview) => !!review &&
  [review.shots, review.hits, review.kills, review.damage, review.taken].some(value => validNumber(value) && value > 0);

export function selectScorecardReview({review, completedReview, history, setupKey, completedSetupKey}: {
  review?: DuelReview; completedReview?: DuelReview; history: DuelHistory[]; setupKey?: string; completedSetupKey?: string;
}) {
  const rounds: DuelHistory[] = Array.isArray(history)
    ? history.filter(row => record(row) && record(row.review)).slice(0, 50) : [];
  const live = record(review) ? review : undefined, completed = record(completedReview) ? completedReview : undefined;
  const r = hasActivity(live) ? live : hasActivity(completed) ? completed
    : rounds.find(row => hasActivity(row.review))?.review ?? completed ?? rounds[0]?.review ?? live;
  return {review: r, rounds, current: r === live, profileKey: r === live ? setupKey
    : r === completed ? completedSetupKey : rounds.find(row => row.review === r)?.setupKey};
}

export type ScorecardStat = {label: string; value: string; help: string; sample?: string};
export type ScorecardSkill = {label: 'Aim' | 'Movement' | 'Positioning'; value: string; detail: string};
export type ScorecardWeakness = {key: string; title: string; evidence: string; action: string};

function skillMetrics(value: unknown): SkillMetric[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap(row => {
    if (!record(row)) return [];
    const label = safeText(row.label), value = safeText(row.value), detail = safeText(row.detail);
    return label && value ? [{label, value, detail: detail ?? '', score: validNumber(row.score, 100) ? row.score : null}] : [];
  });
}

// These persisted metrics only expose their sample counts in countValue's text format.
// Never use the score: the accuracy score can describe a pre-spread ray, not hit rate.
function metricCounts(metrics: SkillMetric[], label: string) {
  const match = metrics.find(row => row.label === label)?.value.match(/^(\d+)\s*\/\s*(\d+)(?:\s*\(\d+%\))?$/);
  if (!match) return;
  const good = Number(match[1]), total = Number(match[2]);
  return integer(good) && integer(total) && total > 0 && good <= total ? {good, total} : undefined;
}

const findingActions: Record<string, string> = {
  movement: 'Stop before firing; keep the burst settled, then reposition.',
  air: 'Use the jump peek for information, then land before the shooting peek.',
  exposure: 'Clear one angle at a time, using cover to block the second opponent.',
  placement: 'Pre-aim the exposed target before peeking; correct for elevation and crouching.',
  control: 'Keep tracking and compensating; reset behind cover if the spray leaves the target.',
  aim: 'Make the small correction before firing. At range, use taps or short bursts.',
  'aim-sample': 'Check the opening correction, then compare five more openings at the same range.',
  cover: 'Aim at the exposed part of the model, or change the peek width.',
  reload: 'Break line of sight behind cover before changing the magazine.',
  awareness: 'Protect the unchecked angle with cover, then reposition after contact.',
};
const findingCategory: Record<string, string> = {movement: 'movement', air: 'movement', exposure: 'positioning',
  placement: 'aim', control: 'aim', aim: 'aim', 'aim-sample': 'aim', cover: 'positioning', reload: 'positioning', awareness: 'positioning'};

export function duelScorecardModel(review: DuelReview) {
  const metrics = skillMetrics(review.coaching?.metrics);
  const rawSummary = readCoachingSummary(review.coaching);
  const summary = rawSummary && [rawSummary.focus, rawSummary.evidence, rawSummary.action, rawSummary.goal, rawSummary.confidence,
    ...rawSummary.metrics.flatMap(row => [row.label, row.value, row.detail])].every(value => !value || !!safeText(value)) ? rawSummary : undefined;
  const rawAim = readAimMetrics(review.aim);
  const aim = rawAim && rawAim.measurements.damage.length <= rawAim.counts.damaged &&
    rawAim.measurements.kill.length <= rawAim.counts.killed && rawAim.measurements.damageToKill.length <= rawAim.counts.killed &&
    rawAim.measurements.correction.length <= rawAim.counts.damaged ? rawAim : undefined;
  const rawDebrief = readDuelDebrief(review.debrief);
  const debrief = rawDebrief && [rawDebrief.openings, rawDebrief.openingHits, ...Object.values(rawDebrief.misses)].every(integer)
    ? {...rawDebrief, findings: rawDebrief.findings.filter(row =>
      [row.key, row.title, row.evidence, row.action, row.goal].every(value => !!safeText(value))),
    fights: rawDebrief.fights.filter(row => [row.enemy, row.visibleEnemies, row.shots, row.hits, row.heads].every(integer) && row.firstShot >= row.started &&
      (row.firstDamage === undefined || row.firstDamage >= row.firstShot) &&
      (row.killedAt === undefined || row.killedAt >= (row.firstDamage ?? row.firstShot)) &&
      row.hits <= row.shots && row.heads <= row.hits)} : undefined;
  const prepared = metricCounts(metrics, 'Prepared openings'), timing = metricCounts(metrics, 'Shot timing');
  const isolated = metricCounts(metrics, 'Single-angle openings');
  const spotted = aim && aim.counts.shots > 0 ? {good: aim.counts.hits, total: aim.counts.shots}
    : metricCounts(metrics, 'Visible-target accuracy');
  const skills: ScorecardSkill[] = [
    {label: 'Aim', value: prepared ? `${prepared.good}/${prepared.total}` : spotted ? `${spotted.good}/${spotted.total}` : '--',
      detail: prepared ? 'prepared openings' : spotted ? 'visible-target hits' : 'Not measured'},
    {label: 'Movement', value: timing ? `${timing.good}/${timing.total}` : '--', detail: timing ? 'disciplined shots' : 'Not measured'},
    {label: 'Positioning', value: isolated ? `${isolated.good}/${isolated.total}` : '--', detail: isolated ? 'isolated openings' : 'Not measured'},
  ];
  const categories = new Set<string>();
  const weaknesses: ScorecardWeakness[] = [];
  for (const finding of debrief?.findings ?? []) {
    if (!Object.prototype.hasOwnProperty.call(findingActions, finding.key)) continue;
    const category = findingCategory[finding.key];
    if (!category || categories.has(category)) continue;
    categories.add(category);
    weaknesses.push({key: finding.key, title: finding.title, evidence: finding.evidence,
      action: safeText(finding.action) ?? findingActions[finding.key]});
    if (weaknesses.length === 2) break;
  }
  const openings = debrief?.openings;
  const headline: ScorecardStat[] = [
    {label: 'Time to damage', value: aim ? measured(timingValue(aim, 'damage'), 0, ' ms') : measured(review.timeToDamage, 0, ' ms'),
      sample: aim ? `n=${aim.measurements.damage.length} damaged contacts` : 'Legacy timing; sample unknown',
      help: 'Median visible contact to first damage, including deliberate holds. Not reaction time. No-damage contacts are omitted, not zero.'},
    {label: 'Time to kill', value: aim ? measured(timingValue(aim, 'kill'), 0, ' ms') : '--',
      sample: aim ? `n=${aim.measurements.kill.length} lethal contacts` : 'Not measured',
      help: 'Median visible contact to lethal gun damage. Kills only; weapon, health and armor affect this.'},
    {label: 'Opening accuracy', value: debrief && debrief.openings > 0 ? measured(debrief.openingHits / debrief.openings * 100, 0, '%', 100) : '--',
      sample: debrief && debrief.openings > 0 ? `${debrief.openingHits}/${debrief.openings} openings hit` : 'Not measured',
      help: 'First gunshot in each measured engagement, not every burst.'},
    {label: 'Spotted accuracy', value: spotted ? measured(spotted.good / spotted.total * 100, 0, '%', 100) : '--',
      sample: spotted ? `${spotted.good}/${spotted.total} visible-target shots` : 'Not measured',
      help: 'Actual landed shots at visible targets, not the pre-spread aim line or all-shot accuracy.'},
    {label: 'Damage dealt / taken', value: `${measured(review.damage)} / ${measured(review.taken)}`,
      help: 'Round health damage, including melee and utility. Not limited to measured gun contacts.'},
    {label: 'Hits / shots', value: `${integer(review.shots) && integer(review.hits) && review.hits <= review.shots ? count(review.hits) : '--'} / ${count(review.shots)}`,
      help: 'All gunshots, including blind fire and wallbangs. Knife swings are excluded.'},
  ];
  return {aim, debrief, metrics, summary, skills, weaknesses, headline,
    sample: `${openings === undefined ? 'Opening count unknown' : `${openings} measured opening${openings === 1 ? '' : 's'}`}${aim ? ` / ${aim.counts.shots} visible-target shots` : ''}`,
    provisional: openings === undefined || openings < 3,
    nextRep: debrief?.findings.find(row => ['strength', 'spread', 'opening-result'].includes(row.key))?.action
      ?? 'Take five aimed openings with the same weapon and range before judging consistency.',
    legacyFocus: safeText(review.coaching?.focus) ?? safeText(review.message),
    legacyAction: safeText(review.coaching?.action) ?? safeText(review.tip),
  };
}
