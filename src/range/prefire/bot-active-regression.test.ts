import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import * as THREE from 'three';
import {advanceActor, STEP, UNIT, type ActorKinematics, type Vec} from '../actor-physics';
import {defaults} from '../config';
import {DuelWeaponState} from '../duel/weapon-state';
import {PrefireBotController} from './bot-controller';
import {createPrefireBotPlan, hasPrefireSight, prefireBotKey, prefireRouteViews, validPrefireExcursion,
  type BotCollision, type PrefireBotPlan} from './bot-behavior';
import {sanitizePrefireConfig} from './config';
import {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import {prefireRoutes} from './routes';
import {prefireCandidates} from './occupancy';
import {PrefireSimulation} from './session';

const gap = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const heading = (a: Vec, b: Vec) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const options = {returnFire: true, reactionMs: 300, tradeEnabled: false};
const block = () => ({distance: .1, normal: {x: 0, y: 0, z: 1}, surfaceId: 0});
const flat: BotCollision = {vertical: p => ({feet: p.y, grounded: true, ceiling: false}), fits: () => true,
  sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}), ray: () => undefined};
const plan: PrefireBotPlan = {key: 'pressure-fixture', kind: 'move-out', intent: 'check-recover',
  anchor: {x: 0, y: 0, z: 0}, exposure: {x: -1.5, y: 0, z: 0}, attackFromAnchor: true,
  sourceCrouched: false, travelCrouched: false, peekStyle: 'wide', watchPoint: {x: 0, y: 64 * UNIT, z: -8},
  pressure: {endpoint: {x: 0, y: 0, z: -1.4}, travelCrouched: false}};

function pressureRun({hiddenX = 0, contact = true, movingContact = false, lossAt = .55, suppliedPlan = plan} = {}) {
  const controller = new PrefireBotController(suppliedPlan, 42, 0, 0);
  let actor: ActorKinematics & {pitch: number; weapon: DuelWeaponState} = {position: {x: 0, y: 64 * UNIT, z: 0},
    feet: 0, yaw: 0, pitch: 0, velocity: {x: 0, z: 0}, grounded: true, duckAmount: 0, verticalVelocity: 0,
    eyeHeight: 64 * UNIT, jumpHeld: false, weapon: new DuelWeaponState('m4a4', () => .5)};
  actor.weapon.nextShotAt = 2;
  const rows = [];
  for (let tick = 0; tick < 8 / STEP; tick++) {
    const time = tick * STEP, visible = contact && time < lossAt || movingContact && actor.position.z < -.6;
    const collision = {...flat, ray: visible ? flat.ray : block};
    const target = {position: {x: visible ? 0 : hiddenX, y: 64 * UNIT, z: -8}, alive: true};
    const before = {...actor.position}, speed = Math.hypot(actor.velocity.x, actor.velocity.z);
    const command = controller.command(time, actor, target, collision, options);
    actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
    actor = {...actor, ...advanceActor(actor, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
    controller.guardSight(time + STEP, actor, target, collision);
    const shot = actor.weapon.advance(time + STEP, STEP,
      controller.verifyShot(time + STEP, actor, target, collision, 300) ? command : {...command, fireHeld: false}, actor);
    rows.push({time, before, position: {...actor.position}, speed, command, shot: !!shot, decision: controller.snapshot()});
  }
  return rows;
}

describe('bounded, evidence-led pressure and contact decisions', () => {
  it('uses a recent recognized sighting to push, counterstrafe and return via the fighting point', () => {
    const rows = pressureRun(), phases = rows.map(row => row.decision.phase);
    expect(phases).toContain('pushing'); expect(phases).toContain('recovering'); expect(phases).toContain('retreating');
    expect(Math.min(...rows.map(row => row.position.z))).toBeLessThan(-1.3);
    const recovered = rows.find((row, i) => i && row.decision.phase === 'retreating' && rows[i - 1].decision.phase === 'recovering')!;
    expect(gap(recovered.position, plan.anchor)).toBeLessThan(2 * UNIT);
    expect(rows.some(row => row.time > recovered.time && row.decision.phase === 'waiting' && gap(row.position, plan.exposure!) < 2 * UNIT)).toBe(true);
    expect(rows.filter((row, i) => i && row.decision.phase === 'pushing' && rows[i - 1].decision.phase !== 'pushing')).toHaveLength(1);
    for (const row of rows) {
      expect(gap(row.before, row.position)).toBeLessThanOrEqual(225 * UNIT * STEP + 1e-9);
      if (['pushing', 'recovering', 'outbound', 'retreating'].includes(row.decision.phase)) expect(row.command.fireHeld).toBe(false);
    }
  });

  it('does not invent pressure without recognized sight, a corridor, or when contact is still visible', () => {
    expect(pressureRun({contact: false}).some(row => row.decision.pressureActive)).toBe(false);
    expect(pressureRun({lossAt: Infinity}).some(row => row.decision.pressureActive)).toBe(false);
    expect(pressureRun({suppliedPlan: {...plan, pressure: undefined}}).some(row => row.decision.pressureActive)).toBe(false);
    const rows = pressureRun({movingContact: true});
    const contact = rows.find(row => row.decision.phase === 'exposed' && row.position.z < -.6 && row.decision.visible)!;
    expect(contact).toBeDefined();
    expect(rows.filter(row => row.shot).every(row => row.speed < .12 && row.decision.visible)).toBe(true);
  });

  it('makes identical pressure decisions for divergent hidden player coordinates', () => {
    const a = pressureRun({hiddenX: -30}), b = pressureRun({hiddenX: 30});
    expect(a.map(({position, command, decision}) => ({position, command, decision})))
      .toEqual(b.map(({position, command, decision}) => ({position, command, decision})));
  });

  it('a fresh local sound hastens the planned check without creating sight or fire permission', () => {
    const make = () => new PrefireBotController({...plan, attackFromAnchor: false}, 42, 0, 0);
    const ordinary = make(), alerted = make(), remote = make();
    const actor = {position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0, yaw: 0, pitch: 0, velocity: {x: 0, z: 0},
      weapon: {ammo: 30, reserve: 90, ordinal: 0, nextShotAt: 0, reloadUntil: 0}};
    const player = {position: {...plan.watchPoint!}, alive: true}, hidden = {...flat, ray: block};
    alerted.hear(plan.watchPoint!, 0, 300, false);
    remote.hear({...plan.watchPoint!, x: 50}, 0, 300, false);
    const baseline = ordinary.command(.2, actor, player, hidden, options);
    const command = alerted.command(.2, actor, player, hidden, options);
    remote.command(.2, actor, player, hidden, options);
    expect(alerted.snapshot().until).toBeLessThan(ordinary.snapshot().until);
    expect(remote.snapshot().until).toBe(ordinary.snapshot().until);
    expect(command.fireHeld).toBe(false); expect(baseline.fireHeld).toBe(false); expect(alerted.snapshot().visible).toBe(false);
  });
});

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('native active-hold physical regressions', () => {
  let native: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    native = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => native?.dispose());

  it('certifies native pressure corridors independently of live player state', () => {
    const pressure: string[] = [];
    for (const route of prefireRoutes) {
      const views = prefireRouteViews([route.spawn, ...route.path], native);
      for (const angle of prefireCandidates(route)) {
        const reserved = [placePrefireTarget(native, angle.position, angle.crouched)];
        const plan = createPrefireBotPlan(native, angle, true, views, reserved);
        if (!plan.pressure) continue;
        pressure.push(`${route.id}/${plan.key}`);
        const attack = plan.attackFromAnchor ? plan.anchor : plan.exposure!;
        expect(plan.kind).toBe('move-out'); expect(plan.intent).toBe('check-recover');
        expect(validPrefireExcursion(native, attack, plan.pressure.endpoint, plan.pressure.travelCrouched,
          reserved.filter(p => gap(p, plan.anchor) > .01))).toBe(true);
        expect(gap(plan.pressure.endpoint, plan.watchPoint!)).toBeLessThan(gap(attack, plan.watchPoint!) - 16 * UNIT);
        expect(hasPrefireSight(native, {...plan.pressure.endpoint, y: plan.pressure.endpoint.y + (plan.sourceCrouched ? 46 : 64) * UNIT}, plan.watchPoint!)).toBe(true);
      }
    }
    expect(pressure.length).toBeGreaterThan(0);
  }, 20000);

  it('physically runs and recovers eligible native pressure corridors with the shared motor', () => {
    const eligible: PrefireBotPlan[] = [];
    for (const route of prefireRoutes) {
      const views = prefireRouteViews([route.spawn, ...route.path], native);
      for (const angle of prefireCandidates(route)) {
        const plan = createPrefireBotPlan(native, angle, true, views, [placePrefireTarget(native, angle.position, angle.crouched)]);
        if (plan.pressure && !eligible.some(old => old.key === plan.key)) eligible.push(plan);
      }
    }
    expect(eligible.length).toBeGreaterThan(0);
    for (const original of eligible.slice(0, 3)) {
      const attack = original.attackFromAnchor ? original.anchor : original.exposure!;
      // Start at this plan's already-reached fighting point. This is a fixture
      // setup, not an in-simulation reposition or a replacement movement motor.
      const plan = {...original, anchor: attack, exposure: original.attackFromAnchor ? original.exposure : original.anchor,
        attackFromAnchor: true};
      const duck = plan.sourceCrouched ? 1 : 0;
      let actor: ActorKinematics & {pitch: number; weapon: DuelWeaponState} = {position: {...attack, y: attack.y + (64 - 18 * duck) * UNIT},
        feet: attack.y, yaw: heading(attack, plan.watchPoint!), pitch: 0, velocity: {x: 0, z: 0}, grounded: true,
        duckAmount: duck, verticalVelocity: 0, eyeHeight: (64 - 18 * duck) * UNIT, jumpHeld: false,
        weapon: new DuelWeaponState('m4a4', () => .5)};
      // Certify actual travel separately from evidence selection: the controller
      // supplies counterstrafing for the same endpoint in an outbound fixture.
      const travel = new PrefireBotController({...plan, anchor: attack, exposure: plan.pressure!.endpoint,
        attackFromAnchor: false, pressure: undefined}, 42, actor.yaw, actor.pitch);
      let returned = false, arrived = false;
      for (let tick = 0; tick < 12 / STEP; tick++) {
        const time = tick * STEP, before = {...actor.position};
        const command = travel.command(time, actor, {position: plan.watchPoint!, alive: false}, native, {...options, returnFire: false});
        actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
        actor = {...actor, ...advanceActor(actor, command, 225 * UNIT, STEP, undefined, undefined, undefined,
          {solids: [], floor: null, native})};
        const phase = travel.snapshot().phase;
        expect(actor.grounded, original.key).toBe(true);
        expect(native.fits(actor.position, actor.feet, (command.crouch ? 54 : 72) * UNIT), original.key).toBe(true);
        expect(gap(before, actor.position)).toBeLessThanOrEqual(225 * UNIT * STEP + .001);
        if (phase === 'exposed') {arrived = true; expect(gap(actor.position, plan.pressure!.endpoint)).toBeLessThan(2 * UNIT);}
        if (arrived && phase === 'waiting') {returned = true; expect(gap(actor.position, attack)).toBeLessThan(2 * UNIT); break;}
      }
      expect(arrived, original.key).toBe(true); expect(returned, original.key).toBe(true);
    }
  }, 20000);

  it.each(['b_tunnel/11', 'b_tunnel/9', 'ct_push_lower/7', 'mid_to_b/30'])('%s: repeated physical checks, stable static holders, and hidden-spawn safety', key => {
    const route = prefireRoutes.find(route => route.angles.some(angle => prefireBotKey(angle) === key))!;
    expect(route, key).toBeDefined();
    const map = {scene: new THREE.Group(), collision: native,
      settle: (p: Parameters<typeof placePrefireTarget>[1]) => placePrefireTarget(native, p), dispose() {}};
    const sim = new PrefireSimulation(map, sanitizePrefireConfig({population: 'all', botBehavior: 'angle-specific', ...options}), route, 42, defaults);
    const bot = sim.actors.slice(1).find(actor => sim.prefireBotDecision(actor.id)!.key === key)!;
    const starts = sim.actors.map(actor => ({...actor.position}));
    const holds = sim.actors.slice(1).filter(actor => sim.prefireBotDecision(actor.id)?.kind === 'hold');
    let previous = sim.prefireBotDecision(bot.id)!.phase, checks = 0, returns = 0;
    sim.actors[0].health = 1e8; sim.start();
    for (let tick = 0; tick < 24 / STEP; tick++) {
      const before = {...bot.position};
      sim.step();
      expect(sim.drainEvents().filter(event => event.kind === 'fire')).toHaveLength(0);
      const decision = sim.prefireBotDecision(bot.id)!;
      if (decision.phase === 'outbound' && previous === 'waiting') checks++;
      if (decision.phase === 'waiting' && previous === 'retreating') returns++;
      previous = decision.phase;
      expect(bot.grounded).toBe(true); expect(decision.pressureActive).toBe(false);
      expect(gap(before, bot.position)).toBeLessThanOrEqual(225 * UNIT * STEP + .001);
      for (const holder of holds) expect(gap(holder.position, starts[holder.id])).toBeLessThan(.001);
    }
    expect(checks).toBeGreaterThan(2); expect(returns).toBeGreaterThan(2);
  }, 20000);
});
