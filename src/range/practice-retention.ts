import {sanitizeSettings, type Settings} from './config';
import type {PracticePlan} from './adaptive-practice';
export type RetentionCheck = {plan: PracticePlan; settings: Settings; due: string; distance?: number; duelSetupKey?: string};
const key = 'spraylab.retention.v1';
export function loadRetention(): RetentionCheck | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (!v || !v.plan || typeof v.plan.skill !== 'string' || v.plan.skill.length > 200 ||
      ![v.plan.target, v.plan.baseline].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100) ||
      v.plan.reps !== 3 || ![0, 1, 2].includes(v.plan.lesson) || !Number.isFinite(Date.parse(v.due))) return;
    return {plan: v.plan, settings: sanitizeSettings(v.settings), due: v.due,
      ...(typeof v.duelSetupKey === 'string' && /^setup-v2:[a-f0-9]{32}$/.test(v.duelSetupKey) ? {duelSetupKey: v.duelSetupKey} : {}),
      ...(typeof v.distance === 'number' && Number.isFinite(v.distance) && v.distance > 0 && v.distance < 250 ? {distance: v.distance} : {})};
  } catch {return;}
}
export function saveRetention(check?: RetentionCheck) {
  try {if (check) localStorage.setItem(key, JSON.stringify(check)); else localStorage.removeItem(key);} catch { /* Optional local bookmark. */ }
}
