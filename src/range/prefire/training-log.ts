import type {PrefireReview} from './coaching';
import type {PrefireAngleReview} from './coaching';
import {readCoachingSummary, type CoachingSummary} from '../coaching-types';
import {angleSummary} from './angle-practice';

export type PrefireAttempt = {
  key: string; route: string; outcome: 'won' | 'lost' | 'draw'; date: string;
  score: number | null; seconds: number; goalMet: boolean;
};
const storageKey = 'spraylab.prefire.history.v1';
const valid = (value: unknown): value is PrefireAttempt => {
  if (!value || typeof value !== 'object') return false;
  const v = value as PrefireAttempt;
  return typeof v.key === 'string' && v.key.length <= 500 && typeof v.route === 'string' && v.route.length <= 100 &&
    ['won', 'lost', 'draw'].includes(v.outcome) && typeof v.date === 'string' && Number.isFinite(Date.parse(v.date)) &&
    (v.score === null || typeof v.score === 'number' && Number.isFinite(v.score) && v.score >= 0 && v.score <= 100) &&
    Number.isFinite(v.seconds) && v.seconds >= 0 && v.seconds <= 180.1 && typeof v.goalMet === 'boolean';
};
export function loadPrefireHistory(): PrefireAttempt[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value.filter(valid).slice(0, 40) : [];
  } catch {return [];}
}
export function savePrefireHistory(history: readonly PrefireAttempt[]) {
  try {localStorage.setItem(storageKey, JSON.stringify(history.filter(valid).slice(0, 40)));} catch { /* Session-only when storage is blocked. */ }
}
export function summarizePrefireHistory(history: readonly PrefireAttempt[], key: string) {
  const comparable = history.filter(attempt => attempt.key === key);
  let streak = 0;
  for (const attempt of comparable) {if (attempt.outcome !== 'won' || !attempt.goalMet) break; streak++;}
  const scores = comparable.flatMap(attempt => attempt.score === null ? [] : [attempt.score]);
  return {attempts: comparable.length, last: comparable[0], best: scores.length ? Math.max(...scores) : null, streak};
}
export function prefireAttempt(review: PrefireReview, key: string, route: string, outcome: PrefireAttempt['outcome'], seconds: number): PrefireAttempt {
  return {key, route, outcome, seconds, score: review.score, goalMet: review.goalMet && outcome === 'won', date: new Date().toISOString()};
}

export type AngleDiagnosis = {id: string; key: string; routeId: string; angleId: string; date: string;
  scope: 'route' | 'angle'; summary: CoachingSummary; cleared: boolean};
const angleKey = 'spraylab.prefire.angles.v1';
export function angleDiagnosis(angle: PrefireAngleReview, input: Omit<AngleDiagnosis, 'summary' | 'cleared'>): AngleDiagnosis {
  return {...input, summary: angleSummary(angle), cleared: angle.cleared};
}
export function loadAngleDiagnoses(): AngleDiagnosis[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(angleKey) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 160).flatMap(value => {
      if (!value || !['id', 'key', 'routeId', 'angleId', 'date'].every(k => typeof value[k] === 'string' && value[k].length <= 4000)
        || !Number.isFinite(Date.parse(value.date)) || !['route', 'angle'].includes(value.scope) || typeof value.cleared !== 'boolean') return [];
      const summary = readCoachingSummary(value.summary);
      return summary ? [{id: value.id, key: value.key, routeId: value.routeId, angleId: value.angleId, date: value.date, scope: value.scope, cleared: value.cleared, summary}] : [];
    });
  } catch {return [];}
}
export function saveAngleDiagnoses(rows: readonly AngleDiagnosis[]) {
  try {localStorage.setItem(angleKey, JSON.stringify(rows.slice(0, 160)));} catch { /* Session-only when blocked. */ }
}
