import {dust2Catalog} from './routes';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import * as THREE from 'three';
import {advanceActor, DEG, STEP, UNIT, type ActorKinematics, type Vec} from '../actor-physics';
import {defaults} from '../config';
import {actorHeadPoint, traceActor} from '../duel/geometry';
import {aimStep} from '../duel/motor';
import {DuelWeaponState} from '../duel/weapon-state';
import {PrefireBotController} from './bot-controller';
import {createPrefireBotPlan, hasPrefireSight, PREFIRE_ENDPOINT_RADIUS, prefireBotKey, prefireRouteViews,
  type BotCollision, type PrefireBotPlan} from './bot-behavior';
import {idleCommand} from '../duel/types';
import {sanitizePrefireConfig} from './config';
import {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import {prefireRoutes} from './routes';
import {PrefireSimulation} from './session';

type TestActor = ActorKinematics & {pitch: number; weapon: DuelWeaponState};
const collision: BotCollision = {
  vertical: p => ({feet: p.y, grounded: true, ceiling: false}), fits: () => true,
  sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}), ray: () => undefined,
};
const coveredLane = {...collision, ray: (origin: Vec) => origin.x < .5 ?
  {distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 0} : undefined};
const makeActor = (): TestActor => ({position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0, yaw: 0, pitch: 0,
  velocity: {x: 0, z: 0}, grounded: true, duckAmount: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false,
  weapon: new DuelWeaponState('m4a4', () => .5, {spread: false})});
const makePlan = (patch: Partial<PrefireBotPlan> = {}): PrefireBotPlan => ({key: 'strong-peek/1', kind: 'periodic-peek',
  anchor: {x: 0, y: 0, z: 0}, exposure: {x: 112 * UNIT, y: 0, z: 0}, sourceCrouched: false, peekStyle: 'quick', ...patch});
const options = {returnFire: true, reactionMs: 300};
const makePlayer = (feet = 0, duckAmount = 0, yaw = 0) => ({position: {x: 0, y: feet + (64 - 18 * duckAmount) * UNIT, z: -15},
  feet, duckAmount, yaw, alive: true});
const heading = (a: Vec, b: Vec) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const gap = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.z - a.z);

function play(plan: PrefireBotPlan, seconds = 8, target = makePlayer(), terrain: BotCollision = coveredLane, fighting = true) {
  const controller = new PrefireBotController(plan, 42, 0, 0);
  let actor = makeActor();
  if (plan.sourceCrouched) {
    actor.duckAmount = 1; actor.crouchHeld = true; actor.eyeHeight = 46 * UNIT; actor.position.y = actor.eyeHeight;
  }
  const rows = [];
  for (let tick = 0; tick < seconds / STEP; tick++) {
    const time = tick * STEP, before = {...actor, position: {...actor.position}, velocity: {...actor.velocity}};
    const recoilBefore = {...actor.weapon.recovery.recoil};
    const command = controller.command(time, actor, target, terrain, {...options, returnFire: fighting});
    actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
    actor = {...actor, ...advanceActor(actor, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
    const legal = !command.fireHeld || controller.verifyShot(time + STEP, actor, target, terrain, options.reactionMs);
    const shot = actor.weapon.advance(time + STEP, STEP, legal ? command : {...command, fireHeld: false, firePressed: false}, actor);
    rows.push({time, before, actor: {...actor, position: {...actor.position}, velocity: {...actor.velocity}},
      command, shot, recoilBefore, decision: controller.snapshot()});
  }
  return rows;
}

describe('deliberate Prefire peeking, not shift-walk oscillation', () => {
  it('accelerates a wide lane to rifle running speed, then counterstrafes before each burst and returns physically', () => {
    const plan = makePlan({peekStyle: 'wide'}), rows = play(plan, 12), attacks = rows.filter(row => row.shot);
    expect(Math.max(...rows.map(row => Math.hypot(row.actor.velocity.x, row.actor.velocity.z) / UNIT))).toBeGreaterThan(220);
    expect(rows.every(row => !row.command.walk)).toBe(true);
    expect(attacks.length).toBeGreaterThan(4);
    expect(rows.some(row => row.decision.phase === 'retreating')).toBe(true);
    expect(rows.some((row, i) => i > 0 && row.decision.phase === 'waiting' && rows[i - 1].decision.phase === 'retreating')).toBe(true);
    let counterInputs = 0;
    for (const row of rows) {
      const yaw = row.before.yaw + row.command.yawDelta;
      const wish = {x: row.command.side * Math.cos(yaw) - row.command.forward * Math.sin(yaw),
        z: -row.command.side * Math.sin(yaw) - row.command.forward * Math.cos(yaw)};
      if (Math.hypot(wish.x, wish.z) > 0) expect(Math.hypot(wish.x, wish.z)).toBeCloseTo(1, 12);
      if (wish.x * row.before.velocity.x + wish.z * row.before.velocity.z < -.5) counterInputs++;
      expect(gap(row.before.position, row.actor.position)).toBeLessThanOrEqual(225 * UNIT * STEP + 1e-10);
      if (row.shot) {
        expect(row.decision.phase).toBe('exposed');
        expect(Math.hypot(row.before.velocity.x, row.before.velocity.z)).toBeLessThan(.12);
        expect(row.actor.grounded).toBe(true);
        expect(row.decision.seenAt).toBeDefined();
        expect(row.time - row.decision.seenAt!).toBeGreaterThanOrEqual(options.reactionMs / 1000);
      }
    }
    expect(counterInputs).toBeGreaterThan(4);
    for (const row of rows.filter(row => row.decision.phase === 'waiting')) expect(gap(row.actor.position, plan.anchor)).toBeLessThan(.14);
  });

  it('corrects known aim during the exit, not after spending a second stationary at the corner', () => {
    const target = makePlayer(); target.position.x = 5;
    const rows = play(makePlan(), 3, target);
    const head = actorHeadPoint({...target.position, y: target.feet}, target.duckAmount, target.yaw);
    const outbound = rows.filter(row => row.decision.phase === 'outbound' && row.decision.visible);
    expect(outbound.length).toBeGreaterThan(2);
    const error = (row: typeof rows[number]) => Math.abs(row.actor.yaw - heading(row.actor.position, head));
    expect(outbound.some(row => Math.abs(row.command.yawDelta) > 0)).toBe(true);
    expect(error(outbound[outbound.length - 1])).toBeLessThan(error(outbound[0]) * .8);
    const exposed = rows.find(row => row.decision.phase === 'exposed')!;
    expect(rows.some(row => row.time >= exposed.time && row.time < exposed.time + .4 && error(row) < DEG)).toBe(true);
    expect(rows.filter(row => row.decision.phase === 'outbound').every(row => !row.command.fireHeld)).toBe(true);
  });

  it('keeps quick exposure shorter than a deliberate wide hold and varies successive peek timing', () => {
    const spans = (style: 'quick' | 'wide') => {
      const hidden = {...collision, ray: () => ({distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 0})};
      const rows = play(makePlan({peekStyle: style}), 40, makePlayer(), hidden, false), result: number[] = [];
      let start: number | undefined;
      for (const row of rows) {
        if (row.decision.phase === 'exposed') start ??= row.time;
        else if (start !== undefined) {result.push(row.time - start); start = undefined;}
      }
      return result;
    };
    const quick = spans('quick'), wide = spans('wide');
    expect(quick.length).toBeGreaterThan(4); expect(wide.length).toBeGreaterThan(4);
    expect(Math.max(...quick)).toBeLessThan(.52); expect(Math.min(...wide)).toBeGreaterThan(.69);
    expect(new Set(quick.map(span => Math.round(span / STEP))).size).toBeGreaterThan(2);
  });

  it('quick checks counterstrafe on contact while a wide swing completes its planned lateral commitment', () => {
    const quick = play(makePlan({peekStyle: 'quick'}), 3);
    const wide = play(makePlan({peekStyle: 'wide'}), 3);
    const firstQuickShot = quick.find(row => row.shot)!, firstWideShot = wide.find(row => row.shot)!;
    expect(firstQuickShot).toBeDefined(); expect(firstWideShot).toBeDefined();
    expect(firstWideShot.actor.position.x - firstQuickShot.actor.position.x).toBeGreaterThan(32 * UNIT);
    expect(Math.hypot(firstQuickShot.before.velocity.x, firstQuickShot.before.velocity.z)).toBeLessThan(.12);
    expect(firstQuickShot.decision.visible).toBe(true);
    expect(quick.some(row => row.decision.phase === 'retreating')).toBe(true);
  });

  it('sprints before a crouch-wide stance change and waits for the physical duck transition before shooting', () => {
    const rows = play(makePlan({kind: 'periodic-peek', peekStyle: 'crouch'}));
    expect(Math.max(...rows.filter(row => row.decision.phase === 'outbound').map(row => Math.hypot(row.actor.velocity.x, row.actor.velocity.z) / UNIT))).toBeGreaterThan(200);
    expect(rows.some(row => row.shot)).toBe(true);
    for (const row of rows.filter(row => row.shot)) expect(row.before.duckAmount).toBeGreaterThanOrEqual(.95);
    expect(rows.some(row => row.decision.phase === 'retreating' && !row.command.crouch)).toBe(true);
  });

  it('runs a validated standing lane from a crouched source, then restores its fighting stance', () => {
    const rows = play(makePlan({sourceCrouched: true, travelCrouched: false, peekStyle: 'wide'}), 12);
    expect(Math.max(...rows.filter(row => row.decision.phase === 'outbound').map(row =>
      Math.hypot(row.actor.velocity.x, row.actor.velocity.z) / UNIT))).toBeGreaterThan(220);
    expect(rows.some(row => row.shot)).toBe(true);
    for (const row of rows.filter(row => row.shot)) expect(row.before.duckAmount).toBeGreaterThanOrEqual(.95);
    expect(rows.some(row => row.decision.phase === 'retreating' && !row.command.crouch)).toBe(true);
  });

  it('uses the concealed endpoint as home when the sourced anchor is the actual fighting point', () => {
    const cover = {...collision, ray: (origin: Vec) => origin.x < -.5 ?
      {distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 0} : undefined};
    const plan = makePlan({exposure: {x: -112 * UNIT, y: 0, z: 0}, attackFromAnchor: true});
    const rows = play(plan, 12, makePlayer(), cover);
    expect(rows[0].decision.phase).toBe('exposed');
    expect(rows[0].actor.position.x).toBe(0);
    expect(rows.some(row => row.decision.phase === 'retreating')).toBe(true);
    expect(rows.some(row => row.shot)).toBe(true);
    for (const row of rows.filter(row => row.decision.phase === 'waiting')) {
      expect(gap(row.actor.position, plan.exposure!)).toBeLessThan(.14); expect(row.decision.visible).toBe(false);
    }
    for (const row of rows.filter(row => row.shot)) expect(gap(row.actor.position, plan.anchor)).toBeLessThan(.14);
  });

  it('a reversed move-out recovers and checks again instead of permanently camping its sourced endpoint', () => {
    const hidden = {...collision, ray: () => ({distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 0})};
    const rows = play(makePlan({kind: 'move-out', attackFromAnchor: true}), 20, makePlayer(), hidden, false);
    expect(rows[0].decision.phase).toBe('retreating');
    expect(rows.filter((row, i) => i && row.decision.phase === 'outbound' && rows[i - 1].decision.phase === 'waiting').length).toBeGreaterThan(1);
    expect(rows.some(row => row.decision.phase === 'exposed')).toBe(true);
  });

  it('pre-aims the authored lane during silent practice and cover return without tracking a hidden player', () => {
    const watchPoint = {x: 8, y: 64 * UNIT, z: -12};
    const plan = makePlan({watchPoint}), target = makePlayer();
    target.position.x = -20;
    const hidden = {...coveredLane, ray: ((origin: Vec, direction: Vec, distance: number) => {
      const endX = origin.x + direction.x * (distance + .01);
      return endX < -10 ? {distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 0} : coveredLane.ray(origin);
    })};
    const rows = play(plan, 12, target, hidden, false);
    for (const phase of ['outbound', 'retreating']) {
      expect(rows.some(row => row.decision.phase === phase &&
        Math.abs(row.actor.yaw - heading(row.actor.position, watchPoint)) < 1 * DEG), phase).toBe(true);
    }
    expect(rows.every(row => !row.decision.visible && row.decision.seenAt === undefined && !row.shot)).toBe(true);
  });

  it('settles within two Source units of both endpoints instead of leaving an edge-of-cover gap', () => {
    const plan = makePlan({peekStyle: 'wide'}), rows = play(plan, 12, makePlayer(), coveredLane, false);
    const settled = rows.filter(row => row.decision.phase === 'waiting' || row.decision.phase === 'exposed');
    expect(settled.some(row => row.decision.phase === 'exposed')).toBe(true);
    for (const row of settled) expect(gap(row.actor.position,
      row.decision.phase === 'waiting' ? plan.anchor : plan.exposure!)).toBeLessThanOrEqual(2 * UNIT);
  });

  it('bounds an information peek even if contact repeatedly flickers before reaction completes', () => {
    const plan = makePlan(), flickering = {...collision, ray: (origin: Vec) => origin.x < .5 ||
      Math.floor(activeTime / .2) % 2 ? {distance: .2, normal: {x: 1, y: 0, z: 0}, surfaceId: 0} : undefined};
    let activeTime = 0, actor = makeActor(), exposedAt: number | undefined;
    const controller = new PrefireBotController(plan, 42, 0, 0), target = makePlayer();
    for (let tick = 0; tick < 8 / STEP; tick++) {
      activeTime = tick * STEP;
      const command = controller.command(activeTime, actor, target, flickering, {...options, reactionMs: 1000});
      actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
      actor = {...actor, ...advanceActor(actor, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      const phase = controller.snapshot().phase;
      if (phase === 'exposed') exposedAt ??= activeTime;
      else if (exposedAt !== undefined) {
        expect(phase).toBe('retreating'); expect(activeTime - exposedAt).toBeLessThan(2);
        return;
      }
    }
    throw new Error('Flickering sight kept the information peek exposed indefinitely');
  });
});

describe('strong return fire uses the same physical shot ray as the player', () => {
  it.each([
    {name: 'uphill standing', feet: 2, duck: 0, yaw: 0},
    {name: 'downhill standing', feet: -1, duck: 0, yaw: Math.PI},
    {name: 'crouched and sideways', feet: 0, duck: 1, yaw: Math.PI / 2},
  ])('$name: aims at the yaw-aware head and controls a short burst without disabling recoil', ({feet, duck, yaw}) => {
    const target = makePlayer(feet, duck, yaw), rows = play(makePlan({kind: 'hold', exposure: undefined}), 2, target, collision);
    const firstBurst = rows.filter(row => row.shot).slice(0, 4);
    expect(firstBurst.length).toBeGreaterThanOrEqual(2);
    for (const row of firstBurst) {
      const shot = row.shot!;
      const hit = traceActor(shot.origin, shot.direction, {...target.position, y: feet}, duck, 25, yaw);
      expect(hit.group, `${row.time}: ${JSON.stringify(shot.direction)}`).toBe('head');
    }
    expect(rows.some(row => row.recoilBefore.pitch > .5)).toBe(true);
    expect(rows.some(row => row.command.pitchDelta < 0)).toBe(true);
  });

  it('remembers only the observed physical head; hidden pose and position changes do not update aim', () => {
    const controller = new PrefireBotController(makePlan({kind: 'hold', exposure: undefined}), 42, 0, 0), actor = makeActor();
    const target = makePlayer(2, 1, Math.PI / 2);
    const remembered = actorHeadPoint({...target.position, y: target.feet}, target.duckAmount, target.yaw);
    controller.command(.1, actor, target, collision, options);
    target.position.x = 10; target.position.y += 4; target.feet += 4; target.duckAmount = 0; target.yaw = 0;
    const hidden = {...collision, ray: () => ({distance: .5, normal: {x: 1, y: 0, z: 0}, surfaceId: 0})};
    const command = controller.command(.3, actor, target, hidden, options);
    const expectedPitch = Math.atan2(remembered.y - actor.position.y, gap(remembered, actor.position));
    const expected = aimStep({yawRate: 0, pitchRate: 0}, heading(actor.position, remembered), expectedPitch, 170);
    expect(command.yawDelta).toBeCloseTo(expected.yawDelta, 12);
    expect(command.pitchDelta).toBeCloseTo(expected.pitchDelta, 12);
    expect(command.fireHeld).toBe(false); expect(controller.snapshot().visible).toBe(false);
  });
});

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('native Long doors deliberate defenders', () => {
  let native: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    native = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => native?.dispose());
  it('b_tunnel/11 repeatedly recovers and re-peeks its native fighting endpoint without seeing the hidden spawn', () => {
    const route = prefireRoutes.find(route => route.angles.some(angle => prefireBotKey(angle) === 'b_tunnel/11'))!;
    const angle = route.angles.find(angle => prefireBotKey(angle) === 'b_tunnel/11')!;
    const reserved = route.angles.map(angle => placePrefireTarget(native, angle.position, angle.crouched));
    const plan = createPrefireBotPlan(native, angle, true, prefireRouteViews([route.spawn, ...route.path], native), reserved);
    expect(plan).toMatchObject({key: 'b_tunnel/11', kind: 'move-out', attackFromAnchor: true, intent: 'check-recover'});
    expect(hasPrefireSight(native, {...plan.anchor, y: plan.anchor.y + 64 * UNIT}, plan.watchPoint!)).toBe(true);
    expect(hasPrefireSight(native, {...plan.exposure!, y: plan.exposure!.y + 64 * UNIT}, plan.watchPoint!)).toBe(false);
    const map = {scene: new THREE.Group(), collision: native,
      settle: (p: Parameters<typeof placePrefireTarget>[1]) => placePrefireTarget(native, p), dispose() {}};
    const sim = new PrefireSimulation(map,
      sanitizePrefireConfig({botBehavior: 'angle-specific', population: 'all', returnFire: true, reactionMs: 300}),
      route, 20261010, defaults, undefined, dust2Catalog);
    const bot = sim.actors.slice(1).find(actor => sim.prefireBotDecision(actor.id)!.key === plan.key)!;
    const start = {...bot.position}; sim.actors[0].health = 1e8;
    sim.start();
    let previous = sim.prefireBotDecision(bot.id)!.phase, checks = 0, returns = 0, displacement = 0;
    for (let tick = 0; tick < 24 / STEP; tick++) {
      sim.step();
      expect(sim.drainEvents().filter(event => event.kind === 'fire')).toHaveLength(0);
      const decision = sim.prefireBotDecision(bot.id)!;
      expect(decision.visible).toBe(false);
      if (decision.phase === 'outbound' && previous === 'waiting') checks++;
      if (decision.phase === 'waiting' && previous === 'retreating') returns++;
      previous = decision.phase;
      displacement = Math.max(displacement, gap(bot.position, start));
      expect(bot.grounded).toBe(true);
    }
    expect(checks).toBeGreaterThan(2); expect(returns).toBeGreaterThan(2);
    expect(displacement).toBeGreaterThan(16 * UNIT);
  }, 15000);
  it('rejects a swing that exposes its back to an earlier Long approach and retains a useful hold', () => {
    const route = prefireRoutes.find(route => route.angles.some(angle => prefireBotKey(angle) === 'a_long/2'))!;
    const map = {scene: new THREE.Group(), collision: native, settle: (p: Parameters<typeof placePrefireTarget>[1]) => placePrefireTarget(native, p), dispose() {}};
    const sim = new PrefireSimulation(map, sanitizePrefireConfig({botBehavior: 'angle-specific', population: 'all', returnFire: false}), route, 42, defaults, undefined, dust2Catalog);
    const moving = sim.actors.slice(1).filter(actor => ['move-out', 'periodic-peek'].includes(sim.prefireBotDecision(actor.id)!.kind));
    const committed = sim.actors.slice(1).find(actor => sim.prefireBotDecision(actor.id)!.key === 'a_long/2')!;
    expect(sim.prefireBotDecision(committed.id)!.kind).toBe('hold');
    const holders = sim.actors.slice(1).filter(actor => sim.prefireBotDecision(actor.id)!.kind === 'hold');
    expect(holders.some(actor => sim.prefireBotDecision(actor.id)!.key === 'a_long/11')).toBe(true);
    const anchors = new Map(holders.map(actor => [actor.id, {...actor.position}]));
    const speeds = new Map<number, number>();
    const player = sim.actors[0], targets = route.path.map(point => placePrefireTarget(native, point));
    let waypoint = 0;
    sim.start();
    for (let tick = 0; tick < 12 / STEP; tick++) {
      if (gap(player.position, targets[waypoint]) < .5 && waypoint < targets.length - 1) waypoint++;
      const desiredYaw = heading(player.position, targets[waypoint]);
      const yawDelta = Math.atan2(Math.sin(desiredYaw - player.yaw), Math.cos(desiredYaw - player.yaw));
      sim.command(0, {...idleCommand(), forward: gap(player.position, targets[waypoint]) > .5 ? 1 : 0, yawDelta});
      sim.step(); sim.drainEvents();
      for (const actor of moving) {
        speeds.set(actor.id, Math.max(speeds.get(actor.id) ?? 0, Math.hypot(actor.velocity.x, actor.velocity.z) / UNIT));
        expect(actor.grounded, sim.prefireBotDecision(actor.id)!.key).toBe(true);
      }
      for (const actor of holders) expect(gap(actor.position, anchors.get(actor.id)!)).toBeLessThan(.001);
    }
    const views = prefireRouteViews([route.spawn, ...route.path], native);
    const reserved = sim.actors.slice(1).map(actor => ({...actor.position, y: actor.feet}));
    const plan = createPrefireBotPlan(native, route.angles.find(angle => prefireBotKey(angle) === 'a_long/2')!, true, views, reserved);
    expect(plan.kind).toBe('hold'); expect(plan.exposure).toBeUndefined();
    expect(gap(committed.position, anchors.get(committed.id)!)).toBeLessThan(.001);
    expect(gap(player.position, targets[0])).toBeGreaterThan(64 * UNIT);
  }, 15000);
  it('physically returns a sourced information check behind native cover while retaining lane pre-aim', () => {
    const route = prefireRoutes.find(route => route.angles.some(angle => prefireBotKey(angle) === 'b_tunnel/9'))!;
    const angle = route.angles.find(angle => prefireBotKey(angle) === 'b_tunnel/9')!;
    const reserved = route.angles.map(angle => placePrefireTarget(native, angle.position, angle.crouched));
    const plan = createPrefireBotPlan(native, angle, true, prefireRouteViews([route.spawn, ...route.path], native), reserved);
    expect(plan.kind).toBe('periodic-peek'); expect(plan.watchPoint).toBeDefined();
    const home = plan.attackFromAnchor ? plan.exposure! : plan.anchor;
    const controller = new PrefireBotController(plan, 42, (angle.rotation![1] - 90) * DEG, -angle.rotation![0] * DEG);
    let actor = makeActor(), returned = false, previous = controller.snapshot().phase, attacks = 0;
    actor.feet = plan.anchor.y; actor.position = {...plan.anchor, y: actor.feet + actor.eyeHeight};
    actor.yaw = (angle.rotation![1] - 90) * DEG; actor.pitch = -angle.rotation![0] * DEG;
    const target = {position: plan.watchPoint!, alive: true};
    for (let tick = 0; tick < 12 / STEP; tick++) {
      const time = tick * STEP, before = {...actor.position};
      const command = controller.command(time, actor, target, native, options);
      actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
      actor = {...actor, ...advanceActor(actor, command, 225 * UNIT, STEP, undefined, undefined, undefined,
        {solids: [], floor: null, native})};
      const legal = !command.fireHeld || controller.verifyShot(time + STEP, actor, target, native, options.reactionMs);
      const shot = actor.weapon.advance(time + STEP, STEP, legal ? command : {...command, fireHeld: false}, actor);
      if (shot) attacks++;
      const phase = controller.snapshot().phase;
      expect(actor.grounded, `${plan.key}/${phase}`).toBe(true);
      expect(gap(before, actor.position)).toBeLessThanOrEqual(225 * UNIT * STEP + .001);
      if (phase === 'waiting' && previous === 'retreating') {
        returned = true;
        expect(gap(actor.position, home)).toBeLessThan(PREFIRE_ENDPOINT_RADIUS);
        expect(hasPrefireSight(native, actor.position, plan.watchPoint!)).toBe(false);
        expect(Math.abs(actor.yaw - heading(actor.position, plan.watchPoint!))).toBeLessThan(1 * DEG);
      }
      previous = phase;
    }
    expect(returned).toBe(true); expect(attacks).toBeGreaterThan(1);
  }, 15000);
  it('fights a physically advancing player with native LOS and stopped shots, not a scripted firing timer', () => {
    const route = prefireRoutes.find(route => route.angles.some(angle => prefireBotKey(angle) === 'b_tunnel/9'))!;
    const map = {scene: new THREE.Group(), collision: native,
      settle: (p: Parameters<typeof placePrefireTarget>[1]) => placePrefireTarget(native, p), dispose() {}};
    const sim = new PrefireSimulation(map,
      sanitizePrefireConfig({botBehavior: 'angle-specific', population: 'all', returnFire: true, reactionMs: 300}), route, 42, defaults, undefined, dust2Catalog);
    const player = sim.actors[0]; player.health = 1e9;
    const targets = route.path.map(point => placePrefireTarget(native, point));
    const movingIds = new Set(sim.actors.slice(1).filter(actor =>
      ['move-out', 'periodic-peek'].includes(sim.prefireBotDecision(actor.id)!.kind)).map(actor => actor.id));
    let waypoint = 0, movingShots = 0, holdShots = 0;
    sim.start();
    const start = {...player.position};
    for (let tick = 0; tick < 25 / STEP; tick++) {
      const target = targets[waypoint];
      if (gap(player.position, target) < .5 && waypoint < targets.length - 1) waypoint++;
      const desiredYaw = heading(player.position, targets[waypoint]);
      const yawDelta = Math.atan2(Math.sin(desiredYaw - player.yaw), Math.cos(desiredYaw - player.yaw));
      sim.command(0, {...idleCommand(), forward: gap(player.position, targets[waypoint]) > .5 ? 1 : 0, yawDelta});
      const before = sim.actors.map(actor => ({speed: Math.hypot(actor.velocity.x, actor.velocity.z), grounded: actor.grounded}));
      sim.step();
      for (const event of sim.drainEvents()) {
        if (event.kind !== 'fire' || !event.actorId) continue;
        const decision = sim.prefireBotDecision(event.actorId)!;
        expect(['holding', 'exposed', 'waiting']).toContain(decision.phase);
        expect(before[event.actorId].speed).toBeLessThan(.12);
        expect(before[event.actorId].grounded).toBe(true);
        expect(decision.seenAt).toBeDefined();
        expect(sim.time - decision.seenAt!).toBeGreaterThanOrEqual(.3);
        const head = actorHeadPoint({...player.position, y: player.feet}, player.duckAmount ?? 0, player.yaw);
        const chest = {...player.position, y: player.feet + (48 - 14 * (player.duckAmount ?? 0)) * UNIT};
        const samples = [head, chest, ...[-1, 1].map(side => ({...chest,
          x: chest.x + Math.cos(player.yaw) * .22 * side, z: chest.z - Math.sin(player.yaw) * .22 * side}))];
        expect(samples.some(point => hasPrefireSight(native, event.origin, point)), 'Firing requires an actually exposed body point').toBe(true);
        if (movingIds.has(event.actorId)) movingShots++; else holdShots++;
      }
    }
    expect(gap(player.position, start)).toBeGreaterThan(64 * UNIT);
    expect(movingShots).toBeGreaterThan(1); expect(holdShots).toBeGreaterThan(1);
  }, 15000);
});
