import type {PrefireReview} from './coaching';
import type {PrefireAngleReview} from './coaching';
import {readCoachingSummary, type CoachingSummary} from '../coaching-types';
import {angleSummary} from './angle-practice';
import {legacyNativeMapId} from './maps';
import type {PrefireCatalog} from './schema';
import type {NativeMapCollision} from './native-collision';

export type PrefireTrainingIdentity = {mapId: string; catalogRevision: string; gameBuild: string; geometrySha256: string};
type SavedIdentity = Partial<PrefireTrainingIdentity>;
export const prefireTrainingIdentity = (catalog: PrefireCatalog, collision: NativeMapCollision): PrefireTrainingIdentity => ({
  mapId: catalog.id, catalogRevision: catalog.revision, gameBuild: collision.build ?? '', geometrySha256: collision.collisionSha256 ?? '',
});
export function prefireRecordMatches(record: SavedIdentity, identity: SavedIdentity): boolean {
  if ((record.mapId ?? legacyNativeMapId) !== (identity.mapId ?? legacyNativeMapId)) return false;
  // Untagged legacy rows have unknown revisions, but can only match their original map.
  return (['catalogRevision', 'gameBuild', 'geometrySha256'] as const).every(field =>
    identity[field] === undefined || (record[field] === undefined && record.mapId === undefined) || record[field] === identity[field]);
}
function readIdentity(value: SavedIdentity): SavedIdentity | undefined {
  if (value.mapId === undefined) {
    return value.catalogRevision === undefined && value.gameBuild === undefined && value.geometrySha256 === undefined ? {} : undefined;
  }
  return (['mapId', 'catalogRevision', 'gameBuild', 'geometrySha256'] as const).every(field =>
    value[field] === undefined || typeof value[field] === 'string' && value[field]!.length <= 300)
    && value.mapId.length > 0 ? {mapId: value.mapId, catalogRevision: value.catalogRevision,
      gameBuild: value.gameBuild, geometrySha256: value.geometrySha256} : undefined;
}
function bounded<T extends SavedIdentity>(rows: readonly T[], limit: number): T[] {
  const counts = new Map<string, number>();
  return rows.filter(row => {
    const key = JSON.stringify([row.mapId ?? legacyNativeMapId, row.catalogRevision, row.gameBuild, row.geometrySha256]);
    const count = counts.get(key) ?? 0; counts.set(key, count + 1); return count < limit;
  });
}

export type PrefireAttempt = SavedIdentity & {
  key: string; route: string; outcome: 'won' | 'lost' | 'draw'; date: string;
  score: number | null; seconds: number; goalMet: boolean;
};
const storageKey = 'spraylab.prefire.history.v1';
const valid = (value: unknown): value is PrefireAttempt => {
  if (!value || typeof value !== 'object') return false;
  const v = value as PrefireAttempt;
  return !!readIdentity(v) && typeof v.key === 'string' && v.key.length <= 500 && typeof v.route === 'string' && v.route.length <= 100 &&
    ['won', 'lost', 'draw'].includes(v.outcome) && typeof v.date === 'string' && Number.isFinite(Date.parse(v.date)) &&
    (v.score === null || typeof v.score === 'number' && Number.isFinite(v.score) && v.score >= 0 && v.score <= 100) &&
    Number.isFinite(v.seconds) && v.seconds >= 0 && v.seconds <= 180.1 && typeof v.goalMet === 'boolean';
};
export function loadPrefireHistory(identity?: SavedIdentity): PrefireAttempt[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? bounded(value.filter(valid), 40).filter(row => !identity || prefireRecordMatches(row, identity)) : [];
  } catch {return [];}
}
export function savePrefireHistory(history: readonly PrefireAttempt[], identity?: SavedIdentity) {
  const others = identity ? loadPrefireHistory().filter(row => !prefireRecordMatches(row, identity)) : [];
  try {localStorage.setItem(storageKey, JSON.stringify(bounded([...history.filter(valid), ...others], 40)));} catch { /* Session-only when storage is blocked. */ }
}
export function summarizePrefireHistory(history: readonly PrefireAttempt[], key: string, identity: SavedIdentity = {mapId: legacyNativeMapId}) {
  const comparable = history.filter(attempt => attempt.key === key && prefireRecordMatches(attempt, identity));
  let streak = 0;
  for (const attempt of comparable) {if (attempt.outcome !== 'won' || !attempt.goalMet) break; streak++;}
  const scores = comparable.flatMap(attempt => attempt.score === null ? [] : [attempt.score]);
  return {attempts: comparable.length, last: comparable[0], best: scores.length ? Math.max(...scores) : null, streak};
}
export function prefireAttempt(review: PrefireReview, key: string, route: string, outcome: PrefireAttempt['outcome'], seconds: number, identity?: PrefireTrainingIdentity): PrefireAttempt {
  return {...identity, key, route, outcome, seconds, score: review.score, goalMet: review.goalMet && outcome === 'won', date: new Date().toISOString()};
}

export type AngleDiagnosis = SavedIdentity & {id: string; key: string; routeId: string; angleId: string; date: string;
  scope: 'route' | 'angle'; summary: CoachingSummary; cleared: boolean};
const angleKey = 'spraylab.prefire.angles.v1';
export function angleDiagnosis(angle: PrefireAngleReview, input: Omit<AngleDiagnosis, 'summary' | 'cleared'>): AngleDiagnosis {
  return {...input, summary: angleSummary(angle), cleared: angle.cleared};
}
export function loadAngleDiagnoses(identity?: SavedIdentity): AngleDiagnosis[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(angleKey) || '[]');
    if (!Array.isArray(raw)) return [];
    const rows: AngleDiagnosis[] = raw.flatMap(value => {
      if (!value || !['id', 'key', 'routeId', 'angleId', 'date'].every(k => typeof value[k] === 'string' && value[k].length <= 4000)
        || !Number.isFinite(Date.parse(value.date)) || !['route', 'angle'].includes(value.scope) || typeof value.cleared !== 'boolean') return [];
      const summary = readCoachingSummary(value.summary);
      const savedIdentity = readIdentity(value);
      return summary && savedIdentity ? [{...savedIdentity, id: value.id, key: value.key, routeId: value.routeId, angleId: value.angleId, date: value.date, scope: value.scope, cleared: value.cleared, summary}] : [];
    });
    return bounded(rows, 160).filter(row => !identity || prefireRecordMatches(row, identity));
  } catch {return [];}
}
export function saveAngleDiagnoses(rows: readonly AngleDiagnosis[], identity?: SavedIdentity) {
  const others = identity ? loadAngleDiagnoses().filter(row => !prefireRecordMatches(row, identity)) : [];
  try {localStorage.setItem(angleKey, JSON.stringify(bounded([...rows, ...others], 160)));} catch { /* Session-only when blocked. */ }
}

export type PrefireRetention = {diagnosis: AngleDiagnosis; due: string; settingsKey?: string};
const retentionKey = 'spraylab.prefire.retention.v1';
export function loadPrefireRetentions(): PrefireRetention[] {
  try {
    const raw = JSON.parse(localStorage.getItem(retentionKey) || 'null');
    return (Array.isArray(raw) ? raw : [raw]).filter(value => value && typeof value.diagnosis?.angleId === 'string'
      && typeof value.diagnosis.routeId === 'string' && !!readIdentity(value.diagnosis)
      && readCoachingSummary(value.diagnosis.summary) && Number.isFinite(Date.parse(value.due))
      && (value.settingsKey === undefined || typeof value.settingsKey === 'string'));
  } catch {return [];}
}
export function savePrefireRetention(check: PrefireRetention | undefined, identity: PrefireTrainingIdentity): boolean {
  const others = loadPrefireRetentions().filter(row => !prefireRecordMatches(row.diagnosis, identity));
  try {localStorage.setItem(retentionKey, JSON.stringify(check ? [check, ...others] : others)); return true;} catch {return false;}
}
