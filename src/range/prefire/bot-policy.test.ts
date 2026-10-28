import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {UNIT} from '../actor-physics';
import {defaults} from '../config';
import {DuelWeaponState} from '../duel/weapon-state';
import {BotUtilityDefense} from '../duel/utility-defense';
import {BotUtilityPlanner} from '../duel/utility-tactics';
import type {ActorCommand} from '../duel/types';
import type {ThreatReport, TradeOrder} from '../duel/trading';
import {PrefireBotController, type PrefireBotActor} from './bot-controller';
import type {BotCollision, PrefireBotPlan} from './bot-behavior';
import {sanitizePrefireConfig} from './config';
import type {PrefireMap} from './map';
import type {NativeMapCollision} from './native-collision';
import {sourcePoint, type PrefireRoute} from './routes';
import {PrefireSimulation} from './session';

const options = {returnFire: true, reactionMs: 300, tradeEnabled: true};
const plan: PrefireBotPlan = {key: 'policy-holder', kind: 'hold', anchor: {x: 0, y: 0, z: 0}, sourceCrouched: false};
const open: BotCollision = {fits: () => true, vertical: p => ({feet: p.y, grounded: true, ceiling: false}),
  sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}), ray: () => undefined};
const blocked: BotCollision = {...open, ray: () => ({distance: .1, normal: {x: 1, y: 0, z: 0}, surfaceId: 0})};
const target = {position: {x: 0, y: 64 * UNIT, z: -10}, alive: true};
const actor = (): PrefireBotActor => ({generation: 1, position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0,
  yaw: 0, pitch: 0, velocity: {x: 0, z: 0}, grounded: true, duckAmount: 0,
  weapon: new DuelWeaponState('m4a4', () => .5)});
const controller = () => new PrefireBotController(plan, 42, 0, 0);

describe('Prefire combat policy evidence and reload intent', () => {
  it('uses remaining rounds during sight and only tops up after contact memory is safe', () => {
    const brain = controller(), self = actor(); self.weapon.ammo = 2;
    expect(brain.command(0, self, target, open, options).reloadPressed).toBe(false);
    expect(brain.command(.31, self, target, open, options).fireHeld).toBe(true);
    expect(brain.command(.5, self, target, blocked, options).reloadPressed).toBe(false);
    expect(brain.command(1.9, self, target, blocked, options).reloadPressed).toBe(true);
    expect(brain.snapshot().phase).toBe('holding');
  });

  it('exports current recognized sight separately from sound/memory and never exports hidden motion', () => {
    const brain = controller(), self = actor();
    brain.command(0, self, target, open, options);
    expect(brain.combatPolicyState(.29, self, options).visible).toBe(false);
    expect(brain.combatPolicyState(.29, self, options).allowUtility).toBe(false);
    brain.command(.31, self, target, open, options);
    brain.hear({x: 40, y: 1, z: 20}, .32, 300, false);
    const evidence = brain.combatPolicyState(.33, self, options);
    expect(evidence.visible).toBe(true); expect(evidence.report?.source).toBe('sight');
    expect(evidence.report?.point).toEqual(target.position);
    evidence.report!.point.x = 100;
    expect(brain.combatPolicyState(.34, self, options).report?.point.x).toBe(0);
    const hidden = {...target, position: {...target.position, x: 200}};
    brain.guardSight(.35, self, hidden, blocked);
    const memory = brain.combatPolicyState(.35, self, options);
    expect(memory.visible).toBe(false); expect(memory.report?.point.x).not.toBe(200);
    brain.command(.4, self, target, open, options);
    expect(brain.combatPolicyState(.4, self, options).visible).toBe(false);
    brain.command(.71, self, target, open, options);
    expect(brain.combatPolicyState(.71, self, options).visible).toBe(true);
  });

  it('does not promote a stale idle sensor sample to current sight', () => {
    const brain = controller(), self = actor();
    brain.command(0, self, target, open, options); brain.command(.31, self, target, open, options);
    expect(brain.combatPolicyState(1, self, options).visible).toBe(false);
  });

  it('offers utility setup only while holding still, never during an authored peek or retreat', () => {
    const self = actor(), holder = controller();
    expect(holder.combatPolicyState(0, self, options).allowUtility).toBe(true);
    self.velocity.x = 1;
    expect(holder.combatPolicyState(0, self, options).allowUtility).toBe(false);
    self.velocity.x = 0;
    const peeker = new PrefireBotController({...plan, kind: 'periodic-peek', attackFromAnchor: true,
      exposure: {x: 1, y: 0, z: 0}}, 42, 0, 0);
    expect(peeker.combatPolicyState(0, self, options).allowUtility).toBe(false);
    peeker.command(0, self, target, blocked, options);
    expect(peeker.snapshot().phase).toBe('retreating');
    expect(peeker.combatPolicyState(0, self, options).allowUtility).toBe(false);
  });

  it('reserves the last rounds for delayed trades, respecting opt-out, expiry and generation', () => {
    const brain = controller(), self = actor(); self.weapon.ammo = 2;
    const order: TradeOrder = {point: {...target.position}, observedAt: 0, readyAt: 1, expiresAt: 3,
      source: 'sound', generation: 1, victimId: 2};
    brain.orderTrade(order);
    expect(brain.combatPolicyState(.5, self, options).tradePending).toBe(true);
    expect(brain.command(.5, self, target, blocked, options).reloadPressed).toBe(false);
    expect(brain.combatPolicyState(1.1, self, options).tradePending).toBe(true);
    expect(brain.combatPolicyState(.5, self, {...options, tradeEnabled: false}).tradePending).toBe(false);
    expect(brain.combatPolicyState(.5, self, {...options, returnFire: false}).tradePending).toBe(false);
    expect(brain.combatPolicyState(.5, {...self, generation: 2}, options).tradePending).toBe(false);
    expect(brain.combatPolicyState(3, self, options).tradePending).toBe(false);
    expect(brain.command(3, self, target, blocked, options).reloadPressed).toBe(true);
  });

  it('resets rifle burst ordinals on a sidearm draw and observes deploy/reload attack floors', () => {
    const brain = controller(), self = actor();
    brain.command(0, self, target, open, options);
    expect(brain.command(.31, self, target, open, options).fireHeld).toBe(true);
    expect(brain.snapshot().burstSize).toBeGreaterThan(0);
    self.weapon = new DuelWeaponState('usp', () => .5); self.equipReadyAt = 1;
    expect(brain.command(.4, self, target, open, options).fireHeld).toBe(false);
    expect(brain.snapshot().burstSize).toBe(0);
    const floor = vi.spyOn(self.weapon.reload!, 'fireReadyAt', 'get').mockReturnValue(1.2);
    expect(brain.command(1, self, target, open, options).fireHeld).toBe(false);
    expect(brain.command(1.21, self, target, open, options)).toMatchObject({fireHeld: true, firePressed: true});
    self.weapon.nextShotAt = 1.5;
    expect(brain.command(1.22, self, target, open, options).firePressed).toBe(false);
    floor.mockRestore();
  });
});

const route: PrefireRoute = {id: 'long-doors', name: 'Policy fixture', spawn: [0, 0, 0], look: [0, 200, 0],
  path: [[0, 100, 0]], angles: [{name: 'Holder', position: [0, 200, 0]}]};
const flatMap = (): PrefireMap => ({scene: new THREE.Group(), dispose() {}, settle: sourcePoint,
  collision: {...open, vertical: (_p: unknown, _from: number, to: number) =>
    ({feet: Math.max(0, to), grounded: to <= 0, ceiling: false})} as unknown as NativeMapCollision});

class RecordingSimulation extends PrefireSimulation {
  calls: {time: number; report: ThreatReport | null; visible: boolean; allowUtility?: boolean; tradePending?: boolean}[] = [];
  protected applyBotCombatPolicy(_id: number, command: Partial<ActorCommand>, report: ThreatReport | null,
    visible: boolean, context?: {allowUtility?: boolean; tradePending?: boolean}): Partial<ActorCommand> {
    this.calls.push({time: this.time, report, visible, ...context});
    return {...command, yawDelta: .001, pitchDelta: 0, fireHeld: false, firePressed: false, reloadPressed: false};
  }
}

describe('Prefire shared-policy handoff', () => {
  it('submits the authoritative policy result once and uses Prefire recognition, not the Duel brain', () => {
    const sim = new RecordingSimulation(flatMap(), sanitizePrefireConfig({...options, population: 'all', botBehavior: 'static'}),
      route, 42, defaults);
    sim.start(); const yaw = sim.actors[1].yaw;
    sim.step(); expect(sim.actors[1].yaw).toBeCloseTo(yaw + .001);
    expect(sim.calls[0]).toMatchObject({visible: false, report: null, allowUtility: false, tradePending: false});
    while (sim.time < .5) sim.step();
    expect(sim.calls.some(call => call.visible && call.report?.source === 'sight')).toBe(true);
    expect(sim.calls.filter(call => call.visible).every(call => call.time >= .3)).toBe(true);
    expect(sim.calls).toHaveLength(sim.tick);
  });

  it('keeps combat-off targets out of loadout/utility opportunity planning', () => {
    const sim = new RecordingSimulation(flatMap(), sanitizePrefireConfig({population: 'all', returnFire: false}), route, 42, defaults);
    sim.start(); sim.step(); expect(sim.calls).toHaveLength(0);
  });

  it('leaves delayed utility defense exclusively in the shared movement loop', () => {
    const defense = vi.spyOn(BotUtilityDefense.prototype, 'command');
    try {
      const sim = new RecordingSimulation(flatMap(), sanitizePrefireConfig({...options, population: 'all'}), route, 42, defaults);
      sim.start(); sim.step();
      expect(defense).toHaveBeenCalledTimes(1);
      expect(defense.mock.calls[0][1].id).toBe(1);
    } finally {defense.mockRestore();}
  });
});

const simulation = (visible = true) => {
  const map = flatMap();
  if (!visible) map.collision.ray = blocked.ray;
  const sim = new PrefireSimulation(map, sanitizePrefireConfig({...options, population: 'all', botBehavior: 'static'}),
    route, 42, defaults);
  sim.actors[0].health = 10000;
  return sim;
};
const until = (sim: PrefireSimulation, time: number) => {while (sim.time < time && sim.phase === 'fighting') sim.step();};

describe('Prefire consumes the real shared combat policy', () => {
  it('draws an actual loaded backup only after recognizing an exposed empty reload', () => {
    const sim = simulation(), bot = sim.actors[1], rifle = bot.weapon;
    sim.configureUtilities({utilitiesEnabled: false, botUtilities: false, utilityLoadout: []});
    rifle.ammo = 0; sim.start();
    until(sim, .29); expect(bot.weapon).toBe(rifle); expect(rifle.reload.active).toBe(true);
    until(sim, .33); expect(bot.weapon.id).toBe('usp');
    expect(bot.weapon).toBe(bot.inventory.get('usp'));
    expect(bot.equipReadyAt).toBeGreaterThan(sim.time);
    const readyAt = bot.equipReadyAt;
    sim.drainEvents(); until(sim, readyAt - .01);
    expect(sim.drainEvents().some(event => event.kind === 'fire' && event.actorId === 1)).toBe(false);
    until(sim, readyAt + .8);
    expect(sim.drainEvents().some(event => event.kind === 'fire' && event.actorId === 1)).toBe(true);
  });

  it('cancels an uncommitted exposed reload without consuming or replacing its magazine', () => {
    const sim = simulation(), bot = sim.actors[1], rifle = bot.weapon;
    rifle.ammo = 8; rifle.reload.start(0); sim.start();
    until(sim, .29); expect(rifle.reload.active).toBe(true);
    until(sim, .33); expect(rifle.reload.active).toBe(false);
    expect(rifle.ammo + rifle.ordinal).toBe(8); expect(rifle.reload.ammoCommitted).toBe(false);
    expect(bot.weapon).toBe(rifle);
  });

  it('does not draw a backup from a hidden live player position', () => {
    const sim = simulation(false), bot = sim.actors[1], rifle = bot.weapon;
    rifle.ammo = 0; sim.start(); until(sim, .8);
    expect(bot.weapon).toBe(rifle); expect(rifle.reload.active).toBe(true);
    expect(sim.prefireBotDecision(1)?.visible).toBe(false);
  });

  it('uses the shared utility planner once per tick and replaces combat gaze while preparing', () => {
    const planner = vi.spyOn(BotUtilityPlanner.prototype, 'command').mockReturnValue(
      {kind: 'flash', yawDelta: .002, pitchDelta: .001, throw: false});
    try {
      const sim = simulation(false); sim.start(); const yaw = sim.actors[1].yaw;
      sim.step(); expect(planner).toHaveBeenCalledOnce();
      expect(sim.utilityPresentation(1)?.kind).toBe('flash');
      expect(sim.actors[1].yaw).toBeCloseTo(yaw + .002);
      expect(sim.actors[1].command.fireHeld).toBe(false);
      expect(sim.actors[1].command.reloadPressed).toBe(false);
    } finally {planner.mockRestore();}
  });

  it.each([{utilitiesEnabled: false, botUtilities: true}, {utilitiesEnabled: true, botUtilities: false}])(
    'respects shared utility config %j', config => {
      const planner = vi.spyOn(BotUtilityPlanner.prototype, 'command');
      try {
        const sim = simulation(false); sim.configureUtilities({...config, utilityLoadout: []});
        sim.start(); sim.step(); expect(planner).not.toHaveBeenCalled();
      } finally {planner.mockRestore();}
    });

  it('cancels uncommitted utility when a delayed trade arrives', () => {
    const planner = vi.spyOn(BotUtilityPlanner.prototype, 'command').mockReturnValue(
      {kind: 'flash', yawDelta: 0, pitchDelta: 0, throw: false});
    const cancel = vi.spyOn(BotUtilityPlanner.prototype, 'cancel');
    class TradeSimulation extends PrefireSimulation {
      trade(order: TradeOrder) {this.orderTrade(1, order);}
    }
    try {
      const map = flatMap(); map.collision.ray = blocked.ray;
      const sim = new TradeSimulation(map, sanitizePrefireConfig({...options, population: 'all', botBehavior: 'static'}),
        route, 42, defaults);
      sim.start(); sim.step(); expect(sim.utilityPresentation(1)?.kind).toBe('flash');
      sim.trade({point: {...target.position}, observedAt: sim.time, readyAt: sim.time + .5, expiresAt: sim.time + 3,
        source: 'sound', generation: sim.actors[1].generation, victimId: 2});
      planner.mockClear(); sim.step();
      expect(planner).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalled();
      expect(sim.utilityPresentation(1)).toBeUndefined();
    } finally {planner.mockRestore(); cancel.mockRestore();}
  });

  it('finishes an already queued throw neutrally when a trade arrives during release', () => {
    const planner = vi.spyOn(BotUtilityPlanner.prototype, 'command').mockReturnValue(
      {kind: 'flash', yawDelta: 0, pitchDelta: 0, throw: true});
    class TradeSimulation extends PrefireSimulation {
      trade(order: TradeOrder) {this.orderTrade(1, order);}
    }
    try {
      const map = flatMap(); map.collision.ray = blocked.ray;
      const sim = new TradeSimulation(map, sanitizePrefireConfig({...options, population: 'all', botBehavior: 'static'}),
        route, 42, defaults);
      sim.start(); sim.step();
      expect(sim.utilityPresentation(1)?.releaseAt).toBeGreaterThan(sim.time);
      const yaw = sim.actors[1].yaw, releaseAt = sim.utilityPresentation(1)!.releaseAt!;
      sim.trade({point: {x: 10, y: 1.6, z: 0}, observedAt: sim.time, readyAt: sim.time + .05,
        expiresAt: sim.time + 3, source: 'sound', generation: sim.actors[1].generation, victimId: 2});
      planner.mockClear(); until(sim, releaseAt - .01);
      expect(planner).not.toHaveBeenCalled();
      expect(sim.actors[1].yaw).toBeCloseTo(yaw);
      until(sim, 2.6);
      expect(sim.drainEvents().some(event => event.kind === 'utility' && event.actorId === 1 && event.action === 'throw')).toBe(true);
      expect(sim.utilityInventory(1).flash).toBe(0);
    } finally {planner.mockRestore();}
  });
});
