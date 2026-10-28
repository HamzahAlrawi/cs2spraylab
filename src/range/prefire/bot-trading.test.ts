import {describe, expect, it} from 'vitest';
import {advanceActor, DEG, STEP, UNIT, type ActorKinematics} from '../actor-physics';
import {DamagePunch} from '../aim-punch';
import {DuelWeaponState} from '../duel/weapon-state';
import {PrefireBotController} from './bot-controller';
import type {BotCollision, PrefireBotPlan} from './bot-behavior';
import type {TradeOrder} from '../duel/trading';
import {aimStep} from '../duel/motor';

const plan: PrefireBotPlan = {key: 'trade-holder', kind: 'hold', anchor: {x: 0, y: 0, z: 0},
  sourceCrouched: false, watchPoint: {x: 0, y: 64 * UNIT, z: -10}};
const exit: PrefireBotPlan = {...plan, kind: 'move-out', exposure: {x: 56 * UNIT, y: 0, z: 0}, intent: 'take-angle'};
const player = {position: {x: 0, y: 64 * UNIT, z: -10}, alive: true};
const terrain: BotCollision = {fits: () => true, vertical: p => ({feet: p.y, grounded: true, ceiling: false}),
  sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}),
  ray: from => from.x < .5 ? {distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 1} : undefined};
const actor = (): ActorKinematics & {generation: number; pitch: number; weapon: DuelWeaponState; punch: DamagePunch} => ({
  generation: 1, position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0, velocity: {x: 0, z: 0}, grounded: true,
  verticalVelocity: 0, eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false, yaw: 0, pitch: 0,
  weapon: new DuelWeaponState('m4a4', () => .5), punch: new DamagePunch(() => .5),
});
const order: TradeOrder = {victimId: 1, generation: 1, point: {...player.position}, observedAt: 0,
  readyAt: .3, expiresAt: 2.5, source: 'sight'};
const options = {returnFire: true, reactionMs: 300, tradeEnabled: true};
describe('prefire physical death trade responses', () => {
  it('takes a validated local exit, reacts through sight, then physically returns to its hold', () => {
    const controller = new PrefireBotController(plan, 42, 0, 0, exit);
    let self = actor(); controller.orderTrade(order);
    let fastest = 0, shots = 0, moved = false;
    for (let tick = 0; tick < 5 / STEP; tick++) {
      const time = tick * STEP, command = controller.command(time, self, player, terrain, options);
      if (time < order.readyAt) expect(command.forward === 0 && command.side === 0).toBe(true);
      self.yaw += command.yawDelta; self.pitch += command.pitchDelta;
      self = {...self, ...advanceActor(self, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      fastest = Math.max(fastest, Math.hypot(self.velocity.x, self.velocity.z) / UNIT);
      moved ||= self.position.x > 32 * UNIT;
      if (command.fireHeld) {
        expect(controller.snapshot().visible).toBe(true);
        expect(time - controller.snapshot().seenAt!).toBeGreaterThanOrEqual(.3);
        expect(Math.hypot(self.velocity.x, self.velocity.z)).toBeLessThan(.15);
      }
      if (self.weapon.advance(time, STEP, command, self)) shots++;
      expect(self.grounded).toBe(true);
    }
    expect(moved).toBe(true); expect(fastest).toBeGreaterThan(150); expect(shots).toBeGreaterThan(0);
    expect(Math.hypot(self.position.x, self.position.z)).toBeLessThan(2 * UNIT);
    expect(controller.snapshot()).toMatchObject({phase: 'holding', trading: false});
  });
  it.each(['disabled', 'silent', 'generation'] as const)('does not force movement or firing when %s', reason => {
    const controller = new PrefireBotController(plan, 42, 0, 0, exit), self = actor();
    controller.orderTrade(reason === 'generation' ? {...order, generation: 2} : order);
    for (let tick = 0; tick < 128; tick++) {
      const command = controller.command(tick * STEP, self, player, terrain,
        {...options, tradeEnabled: reason !== 'disabled', returnFire: reason !== 'silent'});
      expect(command.forward).toBe(0); expect(command.side).toBe(0); expect(command.fireHeld).toBe(false);
    }
  });
  it('does not change unrelated peek timing before recognizing a sound', () => {
    const moving = {...exit, kind: 'periodic-peek' as const, intent: 'check-recover' as const};
    const quiet = new PrefireBotController(moving, 42, 0, 0), heard = new PrefireBotController(moving, 42, 0, 0);
    const self = actor(), blind = {...terrain, ray: () => ({distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 1})};
    heard.hear({x: 5, y: 1.6, z: -5}, 0, 2500, true);
    for (let tick = 0; tick < 1 / STEP; tick++) {
      expect(heard.command(tick * STEP, self, player, blind, options)).toEqual(quiet.command(tick * STEP, self, player, blind, options));
    }
  });
  it('corrects aim punch through bounded mouse input and withholds a displaced shot', () => {
    const controller = new PrefireBotController(plan, 42, 0, 0), self = actor();
    const open = {...terrain, ray: () => undefined};
    controller.command(0, self, player, open, options);
    self.punch.angle = {pitch: 4, yaw: 0, roll: 0};
    const command = controller.command(.4, self, player, open, options);
    const shotPunch = self.punch.shotFor(self.weapon.recovery.angle);
    const expected = aimStep({yawRate: 0, pitchRate: 0}, 0, -shotPunch.pitch * DEG, 170);
    expect(command.pitchDelta).toBeCloseTo(expected.pitchDelta, 12);
    expect(command.fireHeld).toBe(false);
    expect(self.punch.angle.pitch).toBe(4);
  });
  it('retains a crouched trade firing hull instead of borrowing the old crouch-hide standing pose', () => {
    const original = {...plan, kind: 'crouch-hide' as const, sourceCrouched: true};
    const crouchExit = {...exit, sourceCrouched: true, travelCrouched: true};
    const controller = new PrefireBotController(original, 42, 0, 0, crouchExit);
    let self = actor(); self.duckAmount = 1; self.eyeHeight = 46 * UNIT; self.position.y = self.eyeHeight;
    controller.orderTrade(order); let exposed = false;
    for (let tick = 0; tick < 2.5 / STEP; tick++) {
      const command = controller.command(tick * STEP, self, player, terrain, options);
      self.yaw += command.yawDelta; self.pitch += command.pitchDelta;
      self = {...self, ...advanceActor(self, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      if (controller.snapshot().trading && controller.snapshot().phase === 'exposed') {
        exposed = true; expect(command.crouch).toBe(true); expect(self.duckAmount).toBe(1);
      }
    }
    expect(exposed).toBe(true);
  });
  it('allows a later trade after a temporary blocker is gone and the holder has returned', () => {
    const controller = new PrefireBotController(plan, 42, 0, 0, exit);
    let self = actor(); controller.orderTrade(order);
    let attempted = false;
    // A stationary body-contact fixture rejects the first excursion's movement.
    for (let tick = 0; tick < 2.4 / STEP; tick++) {
      const command = controller.command(tick * STEP, self, player, terrain, options);
      attempted ||= Math.abs(command.forward) + Math.abs(command.side) > .5;
    }
    expect(attempted).toBe(true);
    expect(controller.snapshot()).toMatchObject({phase: 'holding', trading: false});
    controller.orderTrade({...order, observedAt: 3, readyAt: 3.2, expiresAt: 5.5});
    let excursion = 0;
    for (let tick = 0; tick < 3 / STEP; tick++) {
      const command = controller.command(3 + tick * STEP, self, player, terrain, options);
      self.yaw += command.yawDelta; self.pitch += command.pitchDelta;
      self = {...self, ...advanceActor(self, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      excursion = Math.max(excursion, self.position.x);
    }
    expect(excursion).toBeGreaterThan(32 * UNIT);
  });
  it('prefers newer recognized evidence after the brief sight-priority window, but never overrides visible contact', () => {
    const controller = new PrefireBotController(plan, 42, 0, 0), self = actor();
    const open = {...terrain, ray: () => undefined}, blind = {...terrain, ray: () => ({distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 1})};
    controller.command(0, self, player, open, options);
    controller.command(.1, self, player, blind, options);
    controller.orderTrade({...order, point: {x: 10, y: self.position.y, z: -10}, observedAt: .2, readyAt: .2});
    expect(controller.command(1, self, player, blind, options).yawDelta).toBeLessThan(0);
    controller.hear({x: -10, y: self.position.y, z: -10}, 1.1, 100, false);
    expect(controller.command(1.2, self, player, blind, options).yawDelta).toBeGreaterThan(0);
    const left = {...player, position: {x: -5, y: self.position.y, z: -10}};
    controller.orderTrade({...order, point: {x: 10, y: self.position.y, z: -10}, observedAt: 1.3, readyAt: 1.3});
    expect(controller.command(1.4, self, left, open, options).yawDelta).toBeGreaterThan(0);
  });
  it('retains only the last recognized sight report across occlusion and refuses stale or unrecognized sight', () => {
    const controller = new PrefireBotController(plan, 42, 0, 0), self = actor();
    const open = {...terrain, ray: () => undefined};
    controller.command(0, self, player, open, options);
    expect(controller.threatReport(.1, 300)).toBeNull();
    controller.command(.4, self, player, open, options);
    const sight = controller.threatReport(.4, 300)!;
    expect(sight).toMatchObject({source: 'sight', observedAt: .4});
    controller.command(.5, self, player, terrain, options);
    expect(controller.threatReport(.6, 300)).toEqual(sight);
    const moved = {...player, position: {...player.position, x: 6}};
    controller.command(.7, self, moved, open, options);
    expect(controller.threatReport(.7, 300)?.point).toEqual(sight.point);
    controller.command(.8, self, moved, terrain, options);
    expect(controller.threatReport(2, 300)).toBeNull();
  });
  it('uses the last rounds for a timely trade, counterstrafing after recognition instead of running to a distant endpoint', () => {
    const longExit = {...exit, exposure: {x: 10, y: 0, z: 0}};
    const controller = new PrefireBotController(plan, 42, 0, 0, longExit);
    let self = actor(); self.weapon.ammo = 2; controller.orderTrade(order);
    let shots = 0, furthestBeforeShot = 0, sawBrake = false, firstShot = Infinity;
    for (let tick = 0; tick < 2 / STEP; tick++) {
      const time = tick * STEP, command = controller.command(time, self, player, terrain, options);
      if (!shots) {
        expect(command.reloadPressed).toBe(false);
        furthestBeforeShot = Math.max(furthestBeforeShot, self.position.x);
      }
      sawBrake ||= self.velocity.x > 1 && command.side < -.5;
      self.yaw += command.yawDelta; self.pitch += command.pitchDelta;
      self = {...self, ...advanceActor(self, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      if (self.weapon.advance(time, STEP, command, self)) {shots++; firstShot = Math.min(firstShot, time);}
    }
    expect(shots).toBeGreaterThan(0); expect(sawBrake).toBe(true);
    expect(firstShot).toBeLessThan(1.5); expect(furthestBeforeShot).toBeLessThan(5);
  });
  it('does not count unavailable weapon commands as a started burst or abandon a loaded trade', () => {
    const controller = new PrefireBotController(plan, 42, 0, 0), self = actor();
    self.weapon.actions.readyAt = 1.2;
    controller.orderTrade(order);
    const open = {...terrain, ray: () => undefined};
    let shots = 0;
    for (let tick = 0; tick < 1.8 / STEP; tick++) {
      const time = tick * STEP, command = controller.command(time, self, player, open, options);
      if (time < 1.2) {expect(command.fireHeld).toBe(false); expect(controller.snapshot().burstSize).toBe(0);}
      self.yaw += command.yawDelta; self.pitch += command.pitchDelta;
      if (self.weapon.advance(time, STEP, command, self)) shots++;
    }
    expect(shots).toBeGreaterThan(0);
  });
  it('keeps a trade strafe committed and independent of unseen player motion or duplicate orders', () => {
    const a = new PrefireBotController(plan, 42, 0, 0, exit), b = new PrefireBotController(plan, 42, 0, 0, exit);
    const hidden = {...terrain, ray: () => ({distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 1})};
    a.orderTrade(order); b.orderTrade(order);
    let left = actor(), right = actor();
    for (let tick = 0; tick < 1.3 / STEP; tick++) {
      const time = tick * STEP;
      if (tick % 4 === 0) b.orderTrade(order);
      const first = a.command(time, left, player, hidden, options);
      const second = b.command(time, right, {...player, position: {x: tick, y: 1.62, z: 15}}, hidden, options);
      expect(second).toEqual(first); expect(first.fireHeld).toBe(false);
      for (const [self, command] of [[left, first], [right, second]] as const) {
        self.yaw += command.yawDelta; self.pitch += command.pitchDelta;
      }
      left = {...left, ...advanceActor(left, first, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      right = {...right, ...advanceActor(right, second, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      if (time > .5) expect(a.snapshot().phase).not.toBe('retreating');
    }
    expect(left.position.x).toBeGreaterThan(.8);
  });
});
