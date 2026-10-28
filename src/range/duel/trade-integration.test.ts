import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';
import type {ThreatReport, TradeOrder} from './trading';

class ReportedFight extends DuelSimulation {
  orders: {actorId: number; order: TradeOrder}[] = [];
  report: ThreatReport | null = {point: {x: 5, y: 1.6, z: 2}, observedAt: 0, readyAt: 0, source: 'sight'};
  protected override threatReport() {return this.report;}
  protected override orderTrade(actorId: number, order: TradeOrder) {this.orders.push({actorId, order});}
}
function fight(tradeEnabled: boolean, seed = 2) {
  const sim = new ReportedFight(sanitizeDuelConfig({botCount: 2, skill: 10, tradeEnabled}), seed, testArena());
  sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 10};
  sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0);
  sim.actors[1].position = {x: 0, y: 64 * UNIT, z: 0}; sim.actors[1].health = 1;
  sim.actors[2].position = {x: 3, y: 64 * UNIT, z: 0};
  sim.command(1, {}); sim.command(2, {}); sim.start(); sim.command(0, {firePressed: true});
  return sim;
}
describe('shared lethal-hit trade dispatch', () => {
  it('dispatches a teammate death from the shot tick without revealing the killer position', () => {
    const sim = fight(true); sim.step();
    expect(sim.actors[1].alive).toBe(false); expect(sim.actors[2].alive).toBe(true);
    expect(sim.orders).toHaveLength(1);
    expect(sim.orders[0]).toMatchObject({actorId: 2, order: {victimId: 1, point: {x: 5, y: 1.6, z: 2}}});
    expect(sim.orders[0].order.readyAt).toBeGreaterThan(STEP);
    expect(sim.orders[0].order.point).not.toEqual(sim.actors[0].position);
  });
  it('does nothing when disabled and uses an audible death area when there is no sighting', () => {
    const disabled = fight(false); disabled.step(); expect(disabled.orders).toEqual([]);
    const unknown = fight(true); unknown.report = null; unknown.step();
    expect(unknown.orders).toHaveLength(1);
    expect(unknown.orders[0].order.source).toBe('sound');
    expect(unknown.orders[0].order.point).not.toEqual(unknown.actors[0].position);
    expect(unknown.orders[0].order.readyAt).toBeGreaterThan(unknown.time + .15);
    const distant = fight(true); distant.report = null; distant.actors[2].position.x = 25;
    distant.step(); expect(distant.orders).toEqual([]);
    const silent = fight(true); silent.report = null;
    Object.assign(silent,{acoustics:{resolve:()=>({gain:0,distance:3,apparentPosition:{x:0,y:1.6,z:0}})}});
    silent.step(); expect(silent.orders).toEqual([]);
  });
  it('selects final survivors after collateral deaths, independent of front-to-back casualty order', () => {
    const run = (reverse: boolean) => {
      const sim = new ReportedFight(sanitizeDuelConfig({botCount: 4, skill: 10, tradeEnabled: true}), 2, testArena());
      sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 10};
      sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0);
      for (const id of [1, 2]) {
        sim.actors[id].position = {x: 0, y: 64 * UNIT, z: (id === 1) !== reverse ? 0 : -3};
        sim.actors[id].health = 1;
      }
      sim.actors[3].position = {x: 3, y: 64 * UNIT, z: 0};
      sim.actors[4].position = {x: 4, y: 64 * UNIT, z: 0};
      for (let id = 1; id <= 4; id++) sim.command(id, {});
      sim.start(); sim.command(0, {firePressed: true}); sim.step();
      expect(sim.actors.slice(1, 3).every(actor => !actor.alive)).toBe(true);
      expect(sim.orders.length).toBeGreaterThan(0);
      expect(sim.orders.every(order => order.actorId >= 3)).toBe(true);
      return sim.orders;
    };
    expect(run(false)).toEqual(run(true));
  });
});
