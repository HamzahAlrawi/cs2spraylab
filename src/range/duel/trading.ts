import type {Vec} from '../actor-physics';
import type {SkillLevel} from './config';
import type {DuelActorSnapshot} from './types';

export type ThreatReport = {point: Vec; observedAt: number; readyAt: number; source: 'sight' | 'sound'};
export type TradeOrder = ThreatReport & {victimId: number; generation: number; expiresAt: number};
export type TradePeer = {actor: DuelActorSnapshot; level: SkillLevel; report?: ThreatReport | null};
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const finite = (point: Vec) => [point.x, point.y, point.z].every(Number.isFinite);
const freshReport = (report: ThreatReport | null | undefined, time: number): report is ThreatReport => !!report &&
  finite(report.point) && Number.isFinite(report.readyAt) && Number.isFinite(report.observedAt) &&
  time >= report.observedAt && time - report.observedAt <= 1.5;

// Call only after the event was actually audible/observed by this responder.
// A death locates a fight area, never the killer. Keep a nonzero spatial error.
export function deathSoundReport(point: Vec, time: number, reactionSeconds: number, random: () => number): ThreatReport | null {
  if (!finite(point) || !Number.isFinite(time) || !Number.isFinite(reactionSeconds) || reactionSeconds < 0) return null;
  const angle = random() * Math.PI * 2, radius = 1 + random() * 1.5;
  return {point: {x: point.x + Math.cos(angle) * radius, y: point.y, z: point.z + Math.sin(angle) * radius},
    observedAt: time, readyAt: time + reactionSeconds, source: 'sound'};
}

// Training policy, not measured FACEIT trade rates. Only allied state and
// pre-existing sightings/hearing enter this event-time planner.
export function deathTradeOrders(victim: DuelActorSnapshot, peers: readonly TradePeer[], time: number,
  report: ThreatReport | null, random: () => number): {actorId: number; order: TradeOrder}[] {
  if (!Number.isFinite(time) || !finite(victim.position)) return [];
  const available = peers.filter(({actor}) => actor.id !== victim.id && actor.side === victim.side && actor.alive && finite(actor.position) &&
    actor.health >= 20 && (actor.ammo > 0 || actor.equipment === 'knife') && !actor.reloading &&
    distance(actor.position, victim.position) <= 18)
    .sort((a, b) => Number(a.actor.equipment === 'knife') - Number(b.actor.equipment === 'knife') ||
      distance(a.actor.position, victim.position) - distance(b.actor.position, victim.position) || a.actor.id - b.actor.id);
  const result: {actorId: number; order: TradeOrder}[] = [];
  const considered = new Set<number>();
  for (const {actor, level, report: local} of available) {
    if (considered.has(actor.id)) continue;
    considered.add(actor.id);
    const evidence = [report, local].filter(value => freshReport(value, time))
      .sort((a, b) => b.observedAt - a.observedAt)[0];
    if (!evidence) continue;
    const skill = level === '10+' ? 1 : (level - 1) / 9;
    const proximity = Math.max(0, 1 - distance(actor.position, victim.position) / 12);
    if (random() >= Math.min(.98, .4 + skill * .55 + proximity * .1)) continue;
    const response = .12 + (1 - skill) * .5 + random() * (.08 + (1 - skill) * .2);
    const readyAt = Math.max(evidence.readyAt, time + response) + result.length * (.08 + (1 - skill) * .1);
    if (readyAt >= time + 3.5) continue;
    result.push({actorId: actor.id, order: {...evidence, point: {...evidence.point}, victimId: victim.id,
      generation: actor.generation, readyAt, expiresAt: time + 3.5}});
    if (result.length === 2) break;
  }
  return result;
}

export const copyTradeOrder = (order: TradeOrder): TradeOrder => ({...order, point: {...order.point}});
export const activeTrade = (order: TradeOrder | undefined, time: number, generation?: number) =>
  !!order && Number.isFinite(time) && finite(order.point) && Number.isFinite(order.observedAt) &&
  Number.isFinite(order.readyAt) && Number.isFinite(order.expiresAt) && order.readyAt >= order.observedAt &&
  time >= order.readyAt && time < order.expiresAt && (generation === undefined || generation === order.generation);
