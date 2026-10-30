import {afterEach, describe, expect, it, vi} from 'vitest';
import {DEG, STEP, UNIT, type Vec} from '../actor-physics';
import type {Equipment} from '../equipment';
import type {ActorHitPose} from './actor-hitboxes';
import {MAX_VISIBILITY_RAYS} from './actor-visibility';
import {BotBrain} from './brain';
import {sanitizeDuelConfig} from './config';
import {testArena, type Arena} from './geometry';
import * as perception from './perception';
import type {RandomStream} from './rng';
import {DuelSimulation} from './simulation';
import {TacticalBrain} from './tactics';
import {idleCommand, type Hitgroup} from './types';

const eye = 64 * UNIT;
const point = (x = 0, y = eye, z = 0): Vec => ({x, y, z});
const capsule = (group: Hitgroup, y = eye, radius = .1) =>
  ({group, point0: point(0, y), point1: point(0, y), radius});
const fullPose = (): ActorHitPose => ({capsules: [capsule('head'), capsule('chest', 1.3, .15), capsule('stomach', 1.1, .25)]});

function fixture(weapon: Equipment = 'ak47', autonomous = false, arena: Arena = testArena()) {
  if (!autonomous) vi.spyOn(BotBrain.prototype, 'command').mockReturnValue(idleCommand());
  const sense = vi.spyOn(perception, 'observeBot');
  const sim = new DuelSimulation(sanitizeDuelConfig({weapons: [weapon], skill: '10+', behavior: 'holder',
    generatedMaps: true, utilitiesEnabled: false, radarEnabled: false}), 701, arena);
  const [player, bot] = sim.actors;
  player.position = point(); player.yaw = Math.PI;
  bot.position = point(0, eye, 8); bot.yaw = 0; bot.grounded = true;
  sim.actorSensorPose = actor => actor.id === 0 ? fullPose() : undefined;
  sim.start();
  const lastIndex = () => {
    for (let i = sense.mock.calls.length - 1; i >= 0; i--) if (sense.mock.calls[i][1].id === bot.id) return i;
    throw Error('simulation did not sample the bot');
  };
  const call = () => sense.mock.calls[lastIndex()];
  const latest = () => {
    return sense.mock.results[lastIndex()].value as perception.BotObservation;
  };
  const next = () => {
    do {sim.step();} while (sim.tick % 4 !== 1 && sim.phase === 'fighting');
    return latest();
  };
  return {sim, player, bot, sense, call, latest, next};
}

afterEach(() => vi.restoreAllMocks());

describe('live simulation weapon-aware perception', () => {
  it.each(['running', 'recovering', 'airborne'] as const)('selects a larger exposed part while %s, unlike the same settled rifle', state => {
    const {sim, bot, call, next} = fixture();
    if (state === 'running') bot.velocity.x = bot.weapon.actions.stats.speed * UNIT;
    if (state === 'recovering') bot.weapon.recovery.penalty = .08;
    if (state === 'airborne') {bot.grounded = false; bot.verticalVelocity = 250 * UNIT;}
    const observation = next();
    expect(call()[8]!.angularUncertainty).toBeGreaterThan(.03);
    expect(observation.visible!.aimCandidate!.group).toBe('stomach');
    expect(observation.visible!.bodyPoint).toEqual(observation.visible!.aimPoint);
    const self = observation.self;
    expect(perception.selectVisibleAimCandidate({...self, velocity: {x: 0, z: 0}},
      observation.visible!.candidates!)!.group).toBe('head');
    expect(sim.actors[1].weapon.ammo).toBe(30);
  });

  it('uses settled live spread, and reads recovery without mutating it or consuming shot RNG', () => {
    const {bot, next, call} = fixture();
    const before = bot.weapon.recovery.fork(), random = bot.weapon['random'] as RandomStream;
    const randomBefore = random.snapshot!();
    const inaccuracy = vi.spyOn(bot.weapon.recovery, 'inaccuracy');
    const observation = next();
    expect(observation.visible!.aimCandidate!.group).toBe('head');
    expect(call()[8]!.angularUncertainty).toBeCloseTo(before.penalty + bot.weapon.actions.stats.spread);
    expect(inaccuracy).not.toHaveBeenCalled();
    expect(bot.weapon.recovery.time).toBeCloseTo(STEP, 10);
    expect(bot.weapon.recovery.index).toBe(before.index);
    expect(bot.weapon.ordinal).toBe(0);
    expect(random.snapshot!()).toBe(randomBefore);
    expect(bot.weapon.recovery.angle).toEqual(before.angle);
  });

  it('tracks actual speed and the current walking command rather than desired movement', () => {
    const {bot, next, call} = fixture();
    const stats = bot.weapon.actions.stats;
    bot.velocity.x = stats.speed * UNIT * .5; bot.command.walk = true;
    next(); const walking = call()[8]!.angularUncertainty!;
    bot.velocity.x = stats.speed * UNIT * .5; bot.command.walk = false;
    next(); const running = call()[8]!.angularUncertainty!;
    bot.velocity = {x: 0, z: 0}; bot.command.forward = 1;
    next(); const stopped = call()[8]!.angularUncertainty!;
    expect(running).toBeGreaterThan(walking);
    expect(walking).toBeGreaterThan(stopped);
  });

  it('uses the active scoped accuracy mode on the first sensor tick after zoom', () => {
    const {bot, next, call} = fixture('awp');
    next(); const unscoped = call()[8]!.angularUncertainty!;
    bot.weapon.actions.secondary(0); bot.weapon.actions.advance(1);
    bot.weapon.recovery.penalty = bot.weapon.actions.stats.stand;
    next();
    expect(call()[8]!.horizontalFov).toBe(40);
    expect(call()[8]!.angularUncertainty!).toBeLessThan(unscoped / 10);
    expect(call()[8]!.angularUncertainty).toBeCloseTo(bot.weapon.actions.stats.stand + bot.weapon.actions.stats.spread);
  });

  it.each(['recoil', 'damage-punch', 'motor-error'] as const)('accounts for own residual %s and not already compensated displacement', state => {
    const {sim, bot, next, latest, call} = fixture();
    expect(next().visible!.aimCandidate!.group).toBe('head');
    if (state === 'recoil') bot.weapon.recovery.angle.pitch = 2;
    if (state === 'damage-punch') bot.punch.angle.pitch = 2;
    if (state === 'motor-error') bot.yaw = 4 * DEG;
    expect(next().visible!.aimCandidate!.group).toBe('stomach');
    const target = latest().visible!.aimPoint;
    do {
      const recoil = bot.weapon.recovery.recoil, punch = bot.punch.shotFor(bot.weapon.recovery.angle);
      bot.yaw = Math.atan2(-(target.x - bot.position.x), -(target.z - bot.position.z)) + (recoil.yaw + punch.yaw) * DEG;
      bot.pitch = Math.atan2(target.y - bot.position.y, Math.hypot(target.x - bot.position.x, target.z - bot.position.z)) -
        (recoil.pitch + punch.pitch) * DEG;
      sim.step();
    } while (sim.tick % 4 !== 1);
    expect(latest().visible!.aimCandidate!.group).toBe('head');
    expect(Number.isFinite(call()[8]!.shotAngles!.pitch)).toBe(true);
  });

  it('retains near-equivalent choices, but not a newly hidden group or a different target generation', () => {
    const {sim, next, call} = fixture('awp');
    let headRadius = .2, bodyRadius = .195, headVisible = true;
    sim.actorSensorPose = actor => actor.id === 0 ? {capsules: [
      ...(headVisible ? [capsule('head', eye, headRadius)] : []), capsule('chest', eye - .3, bodyRadius)]} : undefined;
    const first = next().visible!;
    expect(first.aimCandidate!.group).toBe('head');
    bodyRadius = .205;
    const held = next().visible!;
    expect(perception.selectVisibleAimCandidate(call()[1], held.candidates!,
      {angularUncertainty: call()[8]!.angularUncertainty})!.group).toBe('chest');
    expect(held.aimCandidate!.group).toBe('head');
    headVisible = false;
    expect(next().visible!.aimCandidate!.group).toBe('chest');
    headVisible = true; headRadius = .21; sim.actors[0].generation++;
    const respawned = next().visible!;
    expect(perception.selectVisibleAimCandidate(call()[1], respawned.candidates!,
      {angularUncertainty: call()[8]!.angularUncertainty, previousVisible: call()[8]!.previousVisible})!.group).toBe('chest');
    expect(respawned.aimCandidate!.group).toBe('head');
  });

  it('settles to a coherent exposed part as recovery and the real aim motor settle', () => {
    const {bot, next} = fixture('ak47', true);
    bot.weapon.nextShotAt = Infinity;
    bot.weapon.recovery.penalty = .08;
    const groups: Hitgroup[] = [];
    for (let frame = 0; frame < 48; frame++) groups.push(next().visible!.aimCandidate!.group);
    expect(groups[0]).toBe('stomach');
    expect(groups.slice(-8)).toEqual(Array(8).fill('head'));
    expect(groups.filter((group, i) => i > 0 && group !== groups[i - 1]).length).toBeLessThanOrEqual(3);
  });

  it('delivers weapon-aware live observations to the tactical controller too', () => {
    const arena = testArena();
    arena.lanes = [{side: 1, anchor: point(0, eye, 8), edge: point(0, eye, 7), retreat: point(0, eye, 9)}];
    const perceive = vi.spyOn(TacticalBrain.prototype, 'perceive');
    const {bot, next} = fixture('ak47', true, arena);
    bot.weapon.recovery.penalty = .08;
    expect(next().visible!.aimCandidate!.group).toBe('stomach');
    expect(perceive).toHaveBeenCalledOnce();
    expect(perceive.mock.calls[0][0].visible!.aimCandidate!.group).toBe('stomach');
  });

  it('revalidates the transfer endpoint, drops it behind cover, and resets after lost sight', () => {
    const {sim, bot, next, call} = fixture();
    next(); bot.yaw = 4 * DEG;
    const transfer = next().visible!;
    expect(transfer.aimTransitionFrom!.group).toBe('head');
    const copied = perception.copyVisibleEnemy(transfer);
    copied.aimTransitionFrom!.point.x = 100;
    expect(transfer.aimTransitionFrom!.point.x).toBe(0);
    sim.actorSensorPose = actor => actor.id === 0 ? {capsules: [capsule('stomach', 1.1, .25)]} : undefined;
    expect(next().visible!.aimTransitionFrom).toBeUndefined();
    sim.actorSensorPose = actor => actor.id === 0 ? {capsules: []} : undefined;
    expect(next().visible).toBeNull();
    sim.actorSensorPose = actor => actor.id === 0 ? fullPose() : undefined;
    bot.weapon.recovery.penalty = bot.weapon.actions.stats.stand;
    expect(next().visible!.aimCandidate!.group).toBe('head');
    expect(call()[8]!.previousVisible).toBeNull();
  });

  it('discards aim-transfer and hysteresis evidence after sensor work has been suspended', () => {
    const {sim, bot, next, call} = fixture();
    next(); bot.weapon.recovery.penalty = .08;
    expect(next().visible!.aimCandidate!.group).toBe('stomach');
    sim.setSpawnAuthoring(true);
    for (let tick = 0; tick < 16; tick++) sim.step();
    sim.setSpawnAuthoring(false);
    bot.weapon.recovery.penalty = bot.weapon.actions.stats.stand;
    bot.yaw = 4 * DEG;
    const fresh = next().visible!;
    expect(fresh.aimCandidate!.group).toBe('head');
    expect(fresh.aimTransitionFrom).toBeUndefined();
    expect(fresh.aimCandidate!.observedAt - call()[8]!.previousVisible!.aimCandidate!.observedAt).toBeGreaterThan(.075);
  });

  it('does not publish hidden root/HP/armor or follow an unseen opponent between sensor frames', () => {
    const {sim, player, next, latest} = fixture();
    const first = next().visible!;
    player.position = point(.8, eye, -.5); player.health = 1; player.armor = 0; player.helmet = false;
    const sameSight = next().visible!;
    expect(sameSight.position).toEqual(first.position);
    expect(sameSight.position).not.toEqual(player.position);
    expect(sameSight.aimCandidate!.group).toBe(first.aimCandidate!.group);
    expect(sameSight).not.toHaveProperty('health'); expect(sameSight).not.toHaveProperty('armor');
    expect(sameSight).not.toHaveProperty('helmet');
    sim.actorSensorPose = actor => actor.id === 0 ? {capsules: []} : undefined;
    expect(next().visible).toBeNull();
    player.position.x += 2;
    sim.step();
    expect(latest().visible).toBeNull();
  });

  it('keeps autonomous decisions identical for identical exposed points despite hidden root and equipment protection changes', () => {
    const run = (hidden: boolean) => {
      const {sim, player, bot, latest} = fixture('ak47', true);
      if (hidden) {player.position.x = .8; player.health = 1; player.armor = 0; player.helmet = false;}
      bot.weapon.nextShotAt = Infinity;
      for (let tick = 0; tick < 128; tick++) sim.step();
      return {bot: sim.snapshot()[1], decision: sim.botDecision(1), seen: latest().visible};
    };
    expect(run(true)).toEqual(run(false));
  });

  it.each(['head', 'arm', 'leg'] as const)('keeps %s-only live observations and physically fired shots possible', group => {
    const arena = testArena();
    arena.solids = group === 'head' ? [{center: point(0, .7, .5), size: point(4, 1.4, .1)}]
      : group === 'arm' ? [{center: point(-2, 1.5, .5), size: point(4.8, 3, .1)}]
      : [{center: point(0, 2.2, .5), size: point(4, 3, .1)}];
    const {sim, bot, next, latest} = fixture('ak47', true, arena);
    const arm = capsule('arm', 1.2, .2); arm.point0.x = arm.point1.x = .7;
    const pose = {capsules: [capsule('head', eye, .135), capsule('stomach', 1.1, .25), arm, capsule('leg', .4, .2)]};
    // Keep the arm behind the vertical head/leg covers as well.
    if (group !== 'arm') arm.point0.x = arm.point1.x = 0;
    sim.actorSensorPose = actor => actor.id === 0 ? pose : undefined;
    sim.actorHitPose = actor => actor.id === 0 ? pose : undefined;
    next();
    expect(latest().visible!.aimCandidate!.group).toBe(group);
    expect(latest().visible!.candidates!.map(candidate => candidate.group)).toEqual([group]);
    for (let tick = 0; tick < 160 && sim.phase === 'fighting'; tick++) sim.step();
    const events = sim.drainEvents();
    expect(events.some(event => event.kind === 'fire' && event.actorId === bot.id)).toBe(true);
    expect(events.some(event => event.kind === 'hit' && event.shooter === bot.id && event.group === group)).toBe(true);
  });

  it('keeps sensor pose cadence and utility probes bounded when every candidate is obscured', () => {
    const {sim, next} = fixture();
    const provider = vi.fn(() => ({capsules: [capsule('head'), capsule('chest', 1.3, .2),
      capsule('stomach', 1, .2), ...Array.from({length: 6}, () => capsule('arm', 1.2)),
      ...Array.from({length: 6}, () => capsule('leg', .4))]}));
    sim.actorSensorPose = provider;
    const filter = vi.spyOn(sim, 'canSeeUtility').mockReturnValue(false);
    expect(next().visible).toBeNull();
    expect(provider).toHaveBeenCalledTimes(2);
    // One opposing actor plus its existing twelve-sample shadow proxy.
    expect(filter.mock.calls.filter(args => args[0] === 1).length).toBeLessThanOrEqual(MAX_VISIBILITY_RAYS + 12);
    const count = provider.mock.calls.length;
    for (let tick = 0; tick < 3; tick++) sim.step();
    expect(provider).toHaveBeenCalledTimes(count);
  });
});
