import {describe, expect, it} from 'vitest';
import {activeTrade, deathSoundReport, deathTradeOrders, type ThreatReport} from './trading';
import type {DuelActorSnapshot} from './types';
const actor = (id: number, x = id): DuelActorSnapshot => ({id, generation: 1, side: 'enemy', position: {x, y: 1.62, z: 0}, feet: 0,
  velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0, health: 100, armor: 100,
  helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const report: ThreatReport = {point: {x: 8, y: 1.62, z: 9}, observedAt: 1, readyAt: 1, source: 'sight'};
describe('bounded evidence-only death trading', () => {
  it('uses immutable old evidence, finite reaction time and at most two nearby responders', () => {
    const peers = [2, 3, 4].map(id => ({actor: actor(id), level: 10 as const}));
    const input = {...report, point: {...report.point}};
    const orders = deathTradeOrders(actor(1), peers, 1.1, input, () => 0);
    expect(orders.map(row => row.actorId)).toEqual([2, 3]);
    expect(orders[0].order.readyAt).toBeCloseTo(1.22);
    input.point.x = 100;
    expect(orders[0].order.point.x).toBe(8);
    expect(activeTrade(orders[0].order, 1.21, 1)).toBe(false);
    expect(activeTrade(orders[0].order, 1.3, 1)).toBe(true);
    expect(activeTrade(orders[0].order, 1.3, 2)).toBe(false);
    expect(activeTrade(orders[0].order, 4.6, 1)).toBe(false);
  });
  it('rejects absent, stale, future and nonfinite knowledge', () => {
    const peers = [{actor: actor(2), level: 10 as const}];
    for (const value of [null, {...report, observedAt: -1}, {...report, observedAt: 2},
      {...report, point: {...report.point, x: NaN}}, {...report, readyAt: Infinity}, {...report, observedAt: NaN}]) {
      expect(deathTradeOrders(actor(1), peers, 1.1, value, () => 0)).toEqual([]);
    }
  });
  it('excludes distant, dead, opponent, empty, reloading and critically hurt peers', () => {
    const peers = [actor(2, 30), {...actor(3), alive: false}, {...actor(4), side: 'player' as const},
      {...actor(5), ammo: 0}, {...actor(6), reloading: true}, {...actor(7), health: 19}];
    expect(deathTradeOrders(actor(1), peers.map(actor => ({actor, level: 10})), 1.1, report, () => 0)).toEqual([]);
  });
  it('gives novices fewer and later attempts without granting free sight or damage', () => {
    const peers = [{actor: actor(2), level: 1 as const}];
    expect(deathTradeOrders(actor(1), peers, 1.1, report, () => .5)).toEqual([]);
    const novice = deathTradeOrders(actor(1), peers, 1.1, report, () => 0)[0];
    const expert = deathTradeOrders(actor(1), [{...peers[0], level: 10}], 1.1, report, () => 0)[0];
    expect(novice.order.readyAt).toBeGreaterThan(expert.order.readyAt);
    expect(novice.order.source).toBe('sight');
  });
  it('respects a hearing recognition deadline rather than bypassing it', () => {
    const order = deathTradeOrders(actor(1), [{actor: actor(2), level: 10}], 1.1,
      {...report, source: 'sound', readyAt: 1.8}, () => 0)[0].order;
    expect(order.readyAt).toBe(1.8);
  });
  it('keeps nearby expert attempts strong, novice attempts weaker, and two responders staggered', () => {
    const peers = [2, 3, 4].map(id => ({actor: actor(id), level: 10 as const}));
    const orders = deathTradeOrders(actor(1), peers, 1.1, report, () => .96);
    expect(orders).toHaveLength(2);
    expect(orders[1].order.readyAt - orders[0].order.readyAt).toBeGreaterThanOrEqual(.079);
    expect(deathTradeOrders(actor(1), peers.map(peer => ({...peer, level: 1})), 1.1, report, () => .5)).toEqual([]);
    expect(deathTradeOrders(actor(1), [{actor: actor(2, 18), level: 10}], 1.1, report, () => .96)).toEqual([]);
  });
  it('uses only a responder\'s own fresh report when no common report exists', () => {
    const local = {...report, source: 'sound' as const, readyAt: 1.8};
    const peers = [{actor: actor(2), level: 10 as const, report: local}, {actor: actor(3), level: 10 as const}];
    const orders = deathTradeOrders(actor(1), peers, 1.1, null, () => 0);
    expect(orders.map(row => row.actorId)).toEqual([2]);
    expect(orders[0].order.readyAt).toBe(1.8);
    expect(deathTradeOrders(actor(1), [{...peers[0], report: {...local, observedAt: -2}}], 1.1, null, () => 0)).toEqual([]);
  });
  it('does not let stale common evidence hide a newer local cue or consume a slot with an impossible deadline', () => {
    const peers = [{actor: actor(2), level: 10 as const, report}, {actor: actor(3), level: 10 as const,
      report: {...report, readyAt: 20}}, {actor: actor(4), level: 10 as const, report}];
    expect(deathTradeOrders(actor(1), peers, 1.1, {...report, observedAt: -2}, () => 0).map(row => row.actorId)).toEqual([2, 4]);
  });
  it('prefers loaded firearms over a closer knife and never duplicates a responder', () => {
    const knife = {...actor(2), equipment: 'knife' as const};
    const peers = [knife, actor(3), actor(3), actor(4)].map(actor => ({actor, level: 10 as const}));
    expect(deathTradeOrders(actor(1), peers, 1.1, report, () => 0).map(row => row.actorId)).toEqual([3, 4]);
  });
  it('can check an actually heard death area without locating the killer or bypassing recognition', () => {
    const victim = actor(1), cue = deathSoundReport(victim.position, 1.1, .25, () => 0)!;
    expect(cue.source).toBe('sound');
    expect(Math.hypot(cue.point.x - victim.position.x, cue.point.z - victim.position.z)).toBe(1);
    const order = deathTradeOrders(victim, [{actor: actor(2), level: 10, report: cue}], 1.1, null, () => 0)[0].order;
    expect(activeTrade(order, 1.34, 1)).toBe(false);
    expect(activeTrade(order, 1.36, 1)).toBe(true);
    expect(order.point).toEqual(cue.point);
    expect(deathSoundReport(victim.position, NaN, .2, () => 0)).toBeNull();
  });
});
