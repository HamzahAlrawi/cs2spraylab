import {equipmentIds} from './equipment';
import {migrateMode} from './config';
import {readDrillMetrics} from './drills';
import {readCoachingSummary} from './coaching-types';
import {coachRangeAttempt, type RangePractice} from './range-coaching';
import type {ImpactSample, Result} from './simulation';

function readPractice(value: unknown): RangePractice | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as RangePractice;
  if (typeof v.spread !== 'boolean' || typeof v.moving !== 'boolean' || !['bullet', 'kill'].includes(v.transferRule)
    || !Number.isFinite(v.distance) || v.distance < 0 || v.distance > 250 || !Number.isInteger(v.burst) || v.burst < 1 || v.burst > 150
    || !Number.isInteger(v.transferAfter) || v.transferAfter < 1 || v.transferAfter > 149) return;
  return {spread: v.spread, moving: v.moving, transferRule: v.transferRule, distance: v.distance, burst: v.burst, transferAfter: v.transferAfter,
    ...(['practice', 'challenge'].includes(v.pace ?? '') ? {pace: v.pace} : {}),
    ...(typeof v.peekDuration === 'number' && Number.isFinite(v.peekDuration) && v.peekDuration >= .5 && v.peekDuration <= 10 ? {peekDuration: v.peekDuration} : {})};
}
function sample(value: unknown): ImpactSample | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as ImpactSample;
  if (!['x', 'y', 'bullet'].every(k => Number.isFinite(v[k as keyof ImpactSample])) || v.bullet < 1 || v.bullet > 150
    || typeof v.hit !== 'boolean' || typeof v.head !== 'boolean' || v.head && !v.hit) return;
  const result: ImpactSample = {x: v.x, y: v.y, bullet: v.bullet, hit: v.hit, head: v.head};
  if (['at', 'distance', 'aimX', 'aimY'].every(k => Number.isFinite(v[k as keyof ImpactSample]))
    && v.at! >= 0 && v.distance! >= 0 && v.distance! <= 250 && (v.target === 0 || v.target === 1)
    && typeof v.settled === 'boolean' && typeof v.wrongTarget === 'boolean' && typeof v.targetAlive === 'boolean') {
    Object.assign(result, {at: v.at, distance: v.distance, aimX: v.aimX, aimY: v.aimY,
      target: v.target, settled: v.settled, wrongTarget: v.wrongTarget, targetAlive: v.targetAlive});
  }
  return result;
}
export function parseRangeResults(value: unknown): Result[] {
  if (!Array.isArray(value)) return [];
  const results = value.slice(0, 100).flatMap(raw => {
    if (!raw || !equipmentIds.includes(raw.weapon) || typeof raw.id !== 'string' || raw.id.length > 120
      || !['shots', 'hits', 'heads', 'seconds', 'tracking'].every(k => typeof raw[k] === 'number' && Number.isFinite(raw[k]) && raw[k] >= 0)
      || raw.shots > 150 || raw.hits > raw.shots || raw.heads > raw.hits || typeof raw.date !== 'string' || !Number.isFinite(Date.parse(raw.date))
      || !Array.isArray(raw.samples) || raw.samples.length > 150) return [];
    const samples = raw.samples.map(sample);
    if (samples.some((s: ImpactSample | undefined) => !s)) return [];
    const result: Result = {id: raw.id, weapon: raw.weapon, mode: raw.mode === 'tracking' ? 'tracking' : migrateMode(raw.mode),
      shots: raw.shots, hits: raw.hits, heads: raw.heads, seconds: raw.seconds, tracking: raw.tracking, date: raw.date, samples,
      drill: readDrillMetrics(raw.drill), practice: readPractice(raw.practice)};
    result.coaching = result.drill?.coaching ?? readCoachingSummary(raw.coaching);
    return [result];
  });
  for (let index = results.length - 1; index >= 0; index--) {
    if (['guided', 'spray', 'transfer'].includes(results[index].mode)) results[index].coaching = coachRangeAttempt(results[index], results.slice(index + 1));
  }
  return results;
}
