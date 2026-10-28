import {describe, expect, it, vi} from 'vitest';
import {STEP, UNIT, type Vec} from '../actor-physics';
import {PrefireBotController, type PrefireBotActor} from './bot-controller';
import type {BotCollision, PrefireBotPlan} from './bot-behavior';
import {aimStep} from '../duel/motor';

const silent = {returnFire: false, reactionMs: 300};
const combat = {...silent, returnFire: true};
const origin = {x: 0, y: 0, z: 0};
const eye = 64 * UNIT;
const heading = (from: Vec, to: Vec) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const offset = (p: Vec, base: Vec): Vec => ({x: p.x + base.x, y: p.y + base.y, z: p.z + base.z});
const collisionFor = (ray: BotCollision['ray']): BotCollision => ({ray,
  fits: () => true, sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}),
  vertical: (_point, from) => ({feet: from, grounded: true, ceiling: false})});
function actorAt(base = origin): PrefireBotActor {
  return {position: offset({x: 0, y: eye, z: 0}, base), feet: base.y, yaw: 0, pitch: 0,
    velocity: {x: 0, z: 0}, grounded: true, duckAmount: 0,
    weapon: {ammo: 30, reserve: 90, ordinal: 0, nextShotAt: 0, reloadUntil: 0, actions: {stats: {speed: 225}}}};
}
function course(base = origin, rise = 0): PrefireBotPlan {
  return {key: 'awareness/course', kind: 'hold', anchor: {...base}, sourceCrouched: false,
    watchPoint: offset({x: -5, y: eye + rise, z: -9}, base),
    approachViews: [{x: -5, y: eye + rise, z: -9}, {x: 3, y: eye + rise, z: -8},
      {x: 7, y: eye + rise, z: -8}, {x: 0, y: eye + rise, z: 9}].map(p => offset(p, base))};
}
// Finite wall across the middle; both side openings are real LOS exits.
function wall(base = origin): BotCollision['ray'] {
  return (from, direction, maxDistance) => {
    const t = (base.z - 5 - from.z) / direction.z;
    const x = from.x + direction.x * t - base.x;
    return t > 0 && t < maxDistance && x >= -1 && x <= 4
      ? {distance: t, normal: {x: 0, y: 0, z: 1}, surfaceId: 0} : undefined;
  };
}
function settle(controller: PrefireBotController, actor: PrefireBotActor,
  player: {position: Vec; alive: boolean}, collision: BotCollision, start: number, seconds = .9, options = silent) {
  const commands = [];
  for (let tick = 0; tick < Math.ceil(seconds / STEP); tick++) {
    const command = controller.command(start + tick * STEP, actor, player, collision, options);
    actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
    commands.push(command);
  }
  return commands;
}

describe('Prefire contextual opening awareness', () => {
  it('holds the visible exit near the last encounter, not the occluded point or original entrance', () => {
    const actor = actorAt(), plan = course(), controller = new PrefireBotController(plan, 42, 0, 0);
    const player = {position: {x: 3, y: eye, z: -8}, alive: true};
    controller.command(.1, actor, player, collisionFor(() => undefined), silent);
    player.position = {x: 3, y: eye + 5, z: -20};
    const terrain = collisionFor(wall());
    const commands = settle(controller, actor, player, terrain, .3);
    const opening = plan.approachViews![2];
    expect(actor.yaw).toBeCloseTo(heading(actor.position, opening), 3);
    expect(actor.pitch).toBeCloseTo(0, 10);
    expect(commands.every(command => !command.fireHeld && !command.firePressed)).toBe(true);
    expect(controller.snapshot().visible).toBe(false);
    settle(controller, actor, player, terrain, 7);
    expect(actor.yaw).toBeCloseTo(heading(actor.position, opening), 3);
    settle(controller, actor, player, terrain, 13);
    expect(actor.yaw).toBeCloseTo(heading(actor.position, plan.watchPoint!), 3);
  });

  it('gives a just-seen opponent priority over newer conflicting sound, then allows a later switch', () => {
    const actor = actorAt(), plan = course(), controller = new PrefireBotController(plan, 42, 0, 0);
    const player = {position: {...plan.approachViews![2]}, alive: true};
    controller.command(.1, actor, player, collisionFor(() => undefined), silent);
    controller.hear(plan.approachViews![3], .2, 0, true);
    player.position = {x: 0, y: eye, z: -20};
    settle(controller, actor, player, collisionFor(wall()), .3, .5);
    expect(actor.yaw).toBeCloseTo(heading(actor.position, plan.approachViews![2]), 2);
    settle(controller, actor, player, collisionFor(wall()), 1.1);
    expect(actor.yaw).toBeCloseTo(heading(actor.position, plan.approachViews![3]), 3);
    expect(controller.snapshot().visible).toBe(false);
  });

  it('does not return to an old cached entrance after a fresh contact breaks inside the geometry interval', () => {
    const actor = actorAt(), plan = course(), controller = new PrefireBotController(plan, 42, 0, 0);
    const terrain = collisionFor(wall()), hidden = {position: {x: 0, y: eye, z: -20}, alive: true};
    const contact = plan.approachViews![2];
    // Keep both openings in the finite frustum; this fixture tests memory,
    // not the removed 109-degree peripheral acquisition cone.
    actor.yaw = (heading(actor.position, plan.watchPoint!) + heading(actor.position, contact)) / 2;
    controller.command(0, actor, hidden, terrain, silent);
    const seen = controller.command(.12, actor, {position: contact, alive: true}, terrain, silent);
    expect(controller.snapshot().visible).toBe(true);
    actor.yaw += seen.yawDelta; actor.pitch += seen.pitchDelta;
    const error = heading(actor.position, contact) - actor.yaw;
    const expected = aimStep({yawRate: seen.yawDelta / STEP, pitchRate: seen.pitchDelta / STEP},
      Math.atan2(Math.sin(error), Math.cos(error)), -actor.pitch, 170);
    controller.guardSight(.15, actor, hidden, terrain);
    const command = controller.command(.15, actor, hidden, terrain, silent);
    expect(command.yawDelta).toBeCloseTo(expected.yawDelta, 12);
    expect(command.pitchDelta).toBeCloseTo(expected.pitchDelta, 12);
    expect(command.fireHeld).toBe(false); expect(controller.snapshot().visible).toBe(false);
  });
  it('does not acquire a target outside vertical or scoped horizontal vision', () => {
    for (const scoped of [false, true]) {
      const actor = actorAt(), plan = course(), controller = new PrefireBotController(plan, 42, 0, 0);
      actor.weapon.actions!.horizontalFov = scoped ? 40 : 90;
      const player = {position: scoped ? {x: 7, y: eye, z: -8} : {x: 0, y: eye + 30, z: -8}, alive: true};
      controller.command(.1, actor, player, collisionFor(() => undefined), silent);
      expect(controller.snapshot().visible).toBe(false);
    }
  });

  it('uses an audible area to face a visible opening without following either hidden player', () => {
    const actors = [actorAt(), actorAt()], plan = course();
    const controllers = actors.map(() => new PrefireBotController(plan, 42, 0, 0));
    const terrain = collisionFor(wall());
    for (const controller of controllers) controller.hear({x: 4, y: eye, z: -8}, 0, 300, true);
    for (let tick = 0; tick < 180; tick++) {
      const commands = controllers.map((controller, index) => controller.command(.31 + tick * STEP, actors[index],
        {position: index ? {x: -10 + tick * .001, y: eye + 4, z: 20} : {x: 0, y: eye, z: -20}, alive: true}, terrain, silent));
      expect(commands[1]).toEqual(commands[0]);
      for (let index = 0; index < actors.length; index++) {
        actors[index].yaw += commands[index].yawDelta; actors[index].pitch += commands[index].pitchDelta;
      }
      expect(commands.every(command => !command.fireHeld && !command.firePressed)).toBe(true);
    }
    expect(actors[0].yaw).toBeCloseTo(heading(actors[0].position, plan.approachViews![2]), 3);
    expect(controllers.every(controller => !controller.snapshot().visible)).toBe(true);
  });

  it('preserves eye-height evidence and opening heights under translation and elevation', () => {
    const bases = [origin, {x: -38, y: 7.6, z: 61}];
    const states = bases.map(base => {
      const actor = actorAt(base), plan = course(base, .6), controller = new PrefireBotController(plan, 42, 0, 0);
      controller.hear(offset({x: 4, y: eye + .6, z: -8}, base), 0, 300, true);
      return {actor, plan, controller, terrain: collisionFor(wall(base)),
        player: {position: offset({x: 0, y: eye, z: -20}, base), alive: true}};
    });
    for (let tick = 0; tick < 160; tick++) {
      const commands = states.map(state => state.controller.command(.31 + tick * STEP, state.actor, state.player, state.terrain, silent));
      expect(commands[1].yawDelta).toBeCloseTo(commands[0].yawDelta, 12);
      expect(commands[1].pitchDelta).toBeCloseTo(commands[0].pitchDelta, 12);
      states.forEach((state, index) => {state.actor.yaw += commands[index].yawDelta; state.actor.pitch += commands[index].pitchDelta;});
    }
    for (const {actor, plan} of states) {
      const point = plan.approachViews![2];
      expect(actor.yaw).toBeCloseTo(heading(actor.position, point), 3);
      expect(actor.pitch).toBeCloseTo(Math.atan2(point.y - actor.position.y,
        Math.hypot(point.x - actor.position.x, point.z - actor.position.z)), 3);
    }
  });

  it('retains the encountered support level rather than a same-XZ view on the wrong floor', () => {
    const base = {x: -38, y: 6.4, z: 61}, actor = actorAt(base);
    const lower = offset({x: 4, y: eye, z: -8}, base), upper = {...lower, y: lower.y + 4};
    const plan: PrefireBotPlan = {...course(base), watchPoint: lower, approachViews: [lower, upper]};
    const controller = new PrefireBotController(plan, 42, 0, 0);
    controller.command(.1, actor, {position: upper, alive: true}, collisionFor(() => undefined), silent);
    const hidden = {position: offset({x: 20, y: eye, z: 20}, base), alive: false};
    settle(controller, actor, hidden, collisionFor(() => ({distance: .5, normal: {x: 0, y: 0, z: 1}, surfaceId: 0})), 4);
    expect(actor.pitch).toBeCloseTo(Math.atan2(4, Math.hypot(4, 8)), 3);
    expect(actor.yaw).toBeCloseTo(heading(actor.position, upper), 3);
  });

  it.each(['outbound', 'retreating'] as const)('keeps %s movement and preaim on its authored lane without evidence for a rear check', phase => {
    const actor = actorAt(), plan: PrefireBotPlan = {key: 'awareness/moving', kind: 'periodic-peek',
      anchor: {x: 0, y: 0, z: 0}, exposure: {x: 1.8, y: 0, z: 0}, sourceCrouched: false,
      attackFromAnchor: phase === 'retreating', watchPoint: {x: 7, y: eye, z: -8},
      approachViews: [{x: 7, y: eye, z: -8}, {x: 0, y: eye, z: 9}]};
    const controller = new PrefireBotController(plan, 42, 0, 0);
    const command = controller.command(2, actor, {position: {x: 0, y: eye, z: 10}, alive: false}, collisionFor(() => undefined), combat);
    expect(controller.snapshot().phase).toBe(phase);
    expect(command.yawDelta).toBeLessThan(0);
    const yaw = actor.yaw + command.yawDelta;
    const wishX = command.side * Math.cos(yaw) - command.forward * Math.sin(yaw);
    const wishZ = -command.side * Math.sin(yaw) - command.forward * Math.cos(yaw);
    expect(wishX).toBeGreaterThan(.99); expect(wishZ).toBeCloseTo(0, 12);
    expect(command.walk).toBe(false); expect(command.fireHeld).toBe(false);
  });

  it('does not introduce arbitrary rear checks into an idle static holder', () => {
    const actor = actorAt(), plan: PrefireBotPlan = {...course(), watchPoint: {x: 0, y: eye, z: -10},
      approachViews: [{x: 0, y: eye, z: -10}, {x: 0, y: eye, z: 8}]};
    const controller = new PrefireBotController(plan, 42, 0, 0);
    const commands = settle(controller, actor, {position: {x: 0, y: eye, z: 10}, alive: true},
      collisionFor(() => undefined), 0, 1.5);
    expect(commands.every(command => command.yawDelta === 0 && command.pitchDelta === 0 &&
      command.side === 0 && command.forward === 0 && !command.fireHeld)).toBe(true);
    expect(controller.snapshot().phase).toBe('holding'); expect(controller.snapshot().visible).toBe(false);
  });

  it.each(['footstep', 'trade'] as const)('allows a rear %s cue after its reaction deadline, unlike identical silent hidden movement', source => {
    const plan: PrefireBotPlan = {...course(), watchPoint: {x: 0, y: eye, z: -10},
      approachViews: [{x: 0, y: eye, z: -10}, {x: 0, y: eye, z: 8}]};
    const actors = [actorAt(), actorAt()], controllers = actors.map(() => new PrefireBotController(plan, 42, 0, 0));
    const readyAt = .85;
    if (source === 'footstep') controllers[0].hear({x: 0, y: eye, z: 10}, 0, 1000, true);
    else controllers[0].orderTrade({point: {x: 0, y: eye, z: 10}, source: 'sound', observedAt: 0,
      readyAt, expiresAt: 3.5, generation: 0, victimId: 1});
    const options = source === 'footstep' ? {...silent, reactionMs: 1000} : combat;
    // The course opening at z=8 is visible, but the moving player beyond it is not.
    const terrain = collisionFor((from, direction, maxDistance) => {
      const distance = (8.5 - from.z) / direction.z;
      return distance > 0 && distance < maxDistance
        ? {distance, normal: {x: 0, y: 0, z: -1}, surfaceId: 0} : undefined;
    });
    for (let tick = 0; tick < 300; tick++) {
      const time = tick * STEP, player = {position: {x: Math.sin(time) * .3, y: eye, z: 10 + time}, alive: true};
      const commands = controllers.map((controller, index) => controller.command(time, actors[index], player, terrain, options));
      if (time < readyAt) expect(commands[0]).toEqual(commands[1]);
      expect(commands[1].yawDelta).toBe(0); expect(commands[1].pitchDelta).toBe(0);
      commands.forEach((command, index) => {
        actors[index].yaw += command.yawDelta; actors[index].pitch += command.pitchDelta;
        expect(command.fireHeld).toBe(false); expect(command.firePressed).toBe(false);
      });
    }
    expect(Math.abs(actors[0].yaw)).toBeCloseTo(Math.PI, 3);
    expect(actors[1].yaw).toBe(0);
    expect(controllers.every(controller => !controller.snapshot().visible)).toBe(true);
  });

  it('caps geometry candidates and refreshes at no more than five Hz, even for rapidly changing sound', () => {
    const actor = actorAt(), plan = course();
    plan.approachViews = Array.from({length: 1200}, (_, i) => ({x: i * .01 - 6, y: eye, z: -8}));
    const controller = new PrefireBotController(plan, 42, 0, 0), queriedAt: number[] = [];
    let time = 0;
    const ray = vi.fn(() => {queriedAt.push(time); return undefined;});
    const terrain = collisionFor(ray);
    for (let tick = 0; tick < 256; tick++) {
      time = tick * STEP;
      controller.hear({x: 4 + Math.sin(tick) * .1, y: eye, z: -8}, time, 0, true);
      controller.command(time, actor, {position: {x: 100, y: eye, z: 100}, alive: false}, terrain, silent);
    }
    const batches = [...new Set(queriedAt)];
    expect(batches.length).toBeGreaterThan(1); expect(batches.length).toBeLessThanOrEqual(10);
    expect(ray.mock.calls.length).toBeLessThanOrEqual(80);
    for (let index = 1; index < batches.length; index++) expect(batches[index] - batches[index - 1]).toBeGreaterThanOrEqual(.2 - 1e-9);
    for (const batch of batches) expect(queriedAt.filter(time => time === batch).length).toBeLessThanOrEqual(8);
  });

  it('reuses cached geometry between refreshes and drops an opening when native LOS changes', () => {
    const actor = actorAt(), plan = course(); plan.watchPoint = {...plan.approachViews![2]};
    const controller = new PrefireBotController(plan, 42, 0, 0);
    let closeRight = false;
    const ray = vi.fn<BotCollision['ray']>((from, direction, maxDistance) => closeRight && direction.x >= 0
      ? {distance: Math.min(1, maxDistance / 2), normal: {x: -1, y: 0, z: 0}, surfaceId: 0} : undefined);
    const terrain = collisionFor(ray), player = {position: {x: 0, y: eye, z: 20}, alive: false};
    expect(controller.command(0, actor, player, terrain, silent).yawDelta).toBeLessThan(0);
    const initial = ray.mock.calls.length; closeRight = true;
    expect(controller.command(.01, actor, player, terrain, silent).yawDelta).toBeLessThan(0);
    expect(ray).toHaveBeenCalledTimes(initial);
    expect(controller.command(.21, actor, player, terrain, silent).yawDelta).toBeGreaterThan(0);
    expect(ray.mock.calls.length).toBeGreaterThan(initial);
  });

  it('keeps visible shot reaction and alignment gates despite useful preaim', () => {
    const actor = actorAt(), plan = course(), player = {position: {x: 0, y: eye, z: -10}, alive: true};
    const controller = new PrefireBotController(plan, 42, 0, 0), terrain = collisionFor(() => undefined);
    for (let tick = 0; tick < 30; tick++) {
      const command = controller.command(tick * STEP, actor, player, terrain, combat);
      actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
      expect(command.fireHeld).toBe(false);
    }
    expect(controller.command(.31, actor, player, terrain, combat).fireHeld).toBe(true);
    expect(controller.command(.32, actor, player, terrain, silent).fireHeld).toBe(false);
    const hidden = controller.command(.5, actor, player, collisionFor(() => ({distance: 1,
      normal: {x: 0, y: 0, z: 1}, surfaceId: 0})), combat);
    expect(hidden.fireHeld).toBe(false); expect(hidden.firePressed).toBe(false);
  });
});
