import {describe, expect, it} from 'vitest';
import {advanceActor, STEP, UNIT, type ActorKinematics} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {testArena, type Arena} from './geometry';
import {observeBot} from './perception';
import {createBotTraits} from './skill';
import {DuelSimulation} from './simulation';
import {TacticalBrain} from './tactics';
import type {TradeOrder} from './trading';
import {idleCommand, type DuelActorSnapshot} from './types';
import {DuelWeaponState} from './weapon-state';

const arena = (): Arena => ({...testArena(), lanes: [{side: 1, role: 'camp', axis: {x: 1, z: 0},
  anchor: {x: -5, y: 0, z: 0}, edge: {x: 2, y: 0, z: 0}, retreat: {x: -6, y: 0, z: 0}}]});
const actor = (): DuelActorSnapshot & ActorKinematics => ({id: 2, generation: 1, side: 'enemy',
  position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0, velocity: {x: 0, z: 0}, grounded: true,
  eyeHeight: 64 * UNIT, verticalVelocity: 0, jumpHeld: false, yaw: 0, pitch: 0,
  crouched: false, duckAmount: 0, health: 100, armor: 100, helmet: true, alive: true,
  equipment: 'ak47', ammo: 30, reserve: 90, reloading: false});
const traits = {...createBotTraits(10, 19, 2), recognitionMedianMs: 150, lowAimTendency: 0,
  preaimErrorDegrees: 0, endpointErrorDegrees: 0, brakeErrorMs: 0};
const order: TradeOrder = {victimId: 1, generation: 1, point: {x: 0, y: 64 * UNIT, z: -10},
  observedAt: 0, readyAt: .3, expiresAt: 3.5, source: 'sight'};

describe('death trades reach tactical motor and firearm execution', () => {
  it('takes a direct reachable opening without backtracking to an unrelated anchor or waiting through holder setup', () => {
    const map = arena(), self = actor(), brain = new TacticalBrain(traits, 'holder', 1, () => .5, map, 10, 'ak47', 2);
    brain.phase = 'setup'; brain.orderTrade(order);
    brain.perceive({time: .3, self, visible: null});
    const command = brain.command(self, .3);
    expect(brain.phase).toBe('expose');
    const yaw = self.yaw + (command.yawDelta ?? 0);
    expect((command.side ?? 0) * Math.cos(yaw) - (command.forward ?? 0) * Math.sin(yaw)).toBeGreaterThan(.5);
    expect(command.walk).toBe(false); expect(command.fireHeld).toBe(false);
  });
  it('does not start an optional reload while a loaded trade is waiting for recognition', () => {
    const self = actor(), brain = new TacticalBrain(traits, 'holder', 1, () => .5, arena(), 10, 'ak47', 2);
    self.ammo = 2; brain.phase = 'setup'; brain.orderTrade(order);
    brain.perceive({time: .1, self, visible: null}); brain.command(self, .1);
    expect(brain.phase).toBe('setup');
    brain.perceive({time: .3, self, visible: null}); brain.command(self, .3);
    expect(brain.phase).toBe('expose');
  });
  it('does not let normal sound investigation hijack a committed trade lane', () => {
    const self = actor(), brain = new TacticalBrain(traits, 'aggressive', 1, () => .5, arena(), 10, 'ak47', 2);
    brain.hear({x: -8, y: self.position.y, z: -10}, .2, 'gunshot', false);
    brain.orderTrade({...order, readyAt: .4});
    brain.perceive({time: .4, self, visible: null});
    expect(brain.command(self, .4).fireHeld).toBe(false);
    expect(brain.phase).toBe('expose');
  });
  it('checks an imprecise sound area even if the reported center is inside cover, without firing blind', () => {
    const map = arena(); map.solids = [{center: {x: 0, y: 1.5, z: -10}, size: {x: 1, y: 3, z: 1}}];
    const self = actor(), brain = new TacticalBrain(traits, 'holder', 1, () => .5, map, 10, 'ak47', 2);
    brain.orderTrade({...order, source: 'sound'}); brain.perceive({time: .3, self, visible: null});
    expect(brain.command(self, .3).fireHeld).toBe(false); expect(brain.phase).toBe('expose');
  });
  it('counterstrafes, recognizes its own new sight, and fires a real shared-model round', () => {
    const map = arena(), brain = new TacticalBrain(traits, 'holder', 1, () => .5, map, 10, 'ak47', 2);
    let self = actor(); const weapon = new DuelWeaponState('ak47', () => .5);
    const player = {...actor(), id: 0, side: 'player' as const, position: {...order.point}};
    brain.orderTrade(order); let shots = 0, sawBrake = false, firstSight = Infinity, firstShot = Infinity;
    for (let tick = 0; tick < 2 / STEP; tick++) {
      const time = tick * STEP;
      const sensed = self.position.x > .4 ? observeBot(time, self, [player], map) : {time, self, visible: null};
      if (sensed.visible) firstSight = Math.min(firstSight, time);
      brain.perceive(sensed);
      const command = {...idleCommand(), ...brain.command(self, time, weapon.recovery.recoil)};
      if (time < firstSight + traits.recognitionMedianMs / 1000) expect(command.fireHeld).toBe(false);
      const yaw = self.yaw + command.yawDelta;
      const wishX = command.side * Math.cos(yaw) - command.forward * Math.sin(yaw);
      sawBrake ||= self.velocity.x > .4 && wishX < -.5;
      self.yaw = yaw; self.pitch += command.pitchDelta;
      self = {...self, ...advanceActor(self, command, 215 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      if (weapon.advance(time, STEP, command, self)) {shots++; firstShot = Math.min(firstShot, time);}
      self.ammo = weapon.ammo;
    }
    expect(firstShot).toBeLessThan(1.5); expect(shots).toBeGreaterThan(0); expect(sawBrake).toBe(true);
  });
});

class ObservedDeathSimulation extends DuelSimulation {
  orders: {actorId: number; order: TradeOrder}[] = [];
  report(actorId: number) {return this.threatReport(actorId);}
  protected override orderTrade(actorId: number, order: TradeOrder) {
    this.orders.push({actorId, order}); super.orderTrade(actorId, order);
  }
}

describe('real observed teammate death dispatch', () => {
  it('offers and executes a trade after an actual lethal shot using real sensed reports', () => {
    const sim = new ObservedDeathSimulation(sanitizeDuelConfig({botCount: 2, skill: 10, tradeEnabled: true}), 2, arena());
    sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 8}; sim.actors[0].health = 10000;
    for (const id of [1, 2]) {
      sim.actors[id].position = {x: id === 1 ? -2 : 2, y: 64 * UNIT, z: 0};
      sim.actors[id].yaw = Math.PI;
    }
    sim.start();
    for (let tick = 0; tick < .8 / STEP; tick++) sim.step();
    expect(sim.report(1)).not.toBeNull();
    const victim = sim.actors[1], player = sim.actors[0]; victim.health = 1;
    // Isolate death/trade dispatch from the shooter's accumulated incoming flinch.
    player.punch.angle = {pitch:0,yaw:0,roll:0};
    sim.command(1, idleCommand()); victim.velocity = {x:0,z:0};
    const dx = victim.position.x - player.position.x, dz = victim.position.z - player.position.z;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = Math.atan2(victim.feet + 40 * UNIT - player.position.y, Math.hypot(dx, dz));
    player.weapon = new DuelWeaponState('ak47', () => .5, {spread: false});
    sim.command(0, {firePressed: true}); sim.step(); sim.command(0, {firePressed: false});
    expect(victim.alive).toBe(false);
    expect(sim.orders.some(row => row.actorId === 2 && row.order.victimId === 1)).toBe(true);
    const trade = sim.orders.find(row => row.actorId === 2)!.order;
    sim.drainEvents(); let fired = false;
    for (let tick = 0; tick < 2 / STEP; tick++) {
      sim.step(); fired ||= sim.drainEvents().some(event => event.kind === 'fire' && event.actorId === 2 && sim.time >= trade.readyAt);
    }
    expect(fired).toBe(true);
  });
});
