import {DEG} from '../actor-physics';
import {equipmentIds, type Equipment} from '../equipment';
import {median} from './fight-feedback';

export const aimRifle = (weapon: Equipment) => ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug'].includes(weapon);
export type AimEncounter = {
  at: number; yaw: number; pitch: number; reactionEligible: boolean;
  responseAt?: number; firstShot?: number; firstDamage?: number; killedAt?: number; correction?: number;
};
export type AimShot = {
  at: number; cycle: number; equipment: Equipment; target?: number; hit: boolean; hiddenHit: boolean;
  head?: boolean; speed: number; maxSpeed: number; duck: number; airborne: boolean;
};
export type AimMeasurements = {
  firstShot: number[]; reaction: number[]; damage: number[]; kill: number[]; damageToKill: number[]; correction: number[];
};
export type AimCounts = {
  encounters: number; damaged: number; killed: number; shots: number; hits: number; headHits: number; headEligibleHits: number;
  rifleShots: number; stoppedRifleShots: number; sprayShots: number; sprayHits: number;
  reactionExcluded: number; reactionUnmeasured: number;
};
export type AimMetrics = {version: 1; measurements: AimMeasurements; counts: AimCounts; weapons: Equipment[]};
const measurementKeys = ['firstShot', 'reaction', 'damage', 'kill', 'damageToKill', 'correction'] as const;
const countKeys = ['encounters', 'damaged', 'killed', 'shots', 'hits', 'headHits', 'headEligibleHits', 'rifleShots',
  'stoppedRifleShots', 'sprayShots', 'sprayHits', 'reactionExcluded', 'reactionUnmeasured'] as const;
export function emptyAimMetrics(): AimMetrics {
  return {version: 1, measurements: {firstShot: [], reaction: [], damage: [], kill: [], damageToKill: [], correction: []},
    counts: {encounters: 0, damaged: 0, killed: 0, shots: 0, hits: 0, headHits: 0, headEligibleHits: 0,
      rifleShots: 0, stoppedRifleShots: 0, sprayShots: 0, sprayHits: 0, reactionExcluded: 0, reactionUnmeasured: 0}, weapons: []};
}
export function eyeAngleChange(from: Pick<AimEncounter, 'yaw' | 'pitch'>, to: {yaw: number; pitch: number}) {
  const yaw = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  return Math.hypot(yaw, to.pitch - from.pitch) / DEG;
}

export function measureAim(shots: readonly AimShot[], encounters: readonly AimEncounter[]): AimMetrics {
  const result = emptyAimMetrics(), {counts: c, measurements: m} = result;
  c.encounters = encounters.length;
  for (const e of encounters) {
    if (e.firstShot !== undefined) m.firstShot.push(Math.max(0, e.firstShot - e.at) * 1000);
    if (e.firstDamage !== undefined) {m.damage.push(Math.max(0, e.firstDamage - e.at) * 1000); c.damaged++;}
    if (e.killedAt !== undefined) {
      m.kill.push(Math.max(0, e.killedAt - e.at) * 1000); c.killed++;
      if (e.firstDamage !== undefined) m.damageToKill.push(Math.max(0, e.killedAt - e.firstDamage) * 1000);
    }
    if (e.correction !== undefined) m.correction.push(e.correction);
    if (e.responseAt === undefined) c.reactionUnmeasured++;
    else {
      const ms = (e.responseAt - e.at) * 1000;
      // Anticipation/continuous input and deliberate holds are not reflex tests.
      if (e.reactionEligible && ms >= 80 && ms < 1000) m.reaction.push(ms);
      else c.reactionExcluded++;
    }
  }
  const seen = shots.filter(s => s.target !== undefined && (!s.hiddenHit || s.hit));
  result.weapons = [...new Set(seen.map(s => s.equipment))];
  c.shots = seen.length; c.hits = seen.filter(s => s.hit).length;
  const headEligible = seen.filter(s => s.equipment !== 'awp' && s.hit);
  c.headEligibleHits = headEligible.length; c.headHits = headEligible.filter(s => s.head).length;
  const rifles = seen.filter(s => aimRifle(s.equipment) && s.duck < .5);
  c.rifleShots = rifles.length;
  c.stoppedRifleShots = rifles.filter(s => !s.airborne && s.speed < s.maxSpeed * .34).length;
  const chains: AimShot[][] = [];
  for (const shot of seen) {
    const chain = chains[chains.length - 1], prev = chain?.[chain.length - 1];
    if (prev && prev.equipment === shot.equipment && prev.target === shot.target && shot.at >= prev.at &&
      shot.at - prev.at <= Math.max(.18, prev.cycle * 1.6)) chain.push(shot);
    else chains.push([shot]);
  }
  const sprays = chains.filter(chain => chain.length >= 3 && aimRifle(chain[0].equipment)).flat();
  c.sprayShots = sprays.length; c.sprayHits = sprays.filter(s => s.hit).length;
  for (const key of measurementKeys) if (m[key].length > 1024) m[key] = m[key].slice(-1024);
  return result;
}

export function mergeAimMetrics(rows: readonly AimMetrics[]): AimMetrics {
  const result = emptyAimMetrics();
  for (const row of rows) {
    for (const key of countKeys) result.counts[key] += row.counts[key];
    for (const key of measurementKeys) result.measurements[key].push(...row.measurements[key]);
  }
  result.weapons = [...new Set(rows.flatMap(row => row.weapons))];
  return result;
}
export const timingValue = (data: AimMetrics, key: keyof AimMeasurements) => median(data.measurements[key]);

export function readAimMetrics(value: unknown): AimMetrics | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as AimMetrics;
  if (v.version !== 1 || !v.counts || !v.measurements || !Array.isArray(v.weapons) || v.weapons.length > 64 ||
    !v.weapons.every(w => equipmentIds.includes(w))) return;
  if (!countKeys.every(k => Number.isSafeInteger(v.counts[k]) && v.counts[k] >= 0 && v.counts[k] <= 1000000) ||
    !measurementKeys.every(k => Array.isArray(v.measurements[k]) && v.measurements[k].length <= 1024 &&
      v.measurements[k].every(n => Number.isFinite(n) && n >= 0 && n <= (k === 'correction' ? 360 : 180000)))) return;
  const c = v.counts;
  if (c.hits > c.shots || c.headHits > c.headEligibleHits || c.headEligibleHits > c.hits ||
    c.stoppedRifleShots > c.rifleShots || c.rifleShots > c.shots || c.sprayHits > c.sprayShots || c.sprayShots > c.shots ||
    c.killed > c.damaged || c.damaged > c.encounters || measurementKeys.some(k => v.measurements[k].length > c.encounters)) return;
  return {version: 1, counts: {...c}, measurements: Object.fromEntries(measurementKeys.map(k => [k, [...v.measurements[k]]])) as AimMeasurements,
    weapons: [...v.weapons]};
}
