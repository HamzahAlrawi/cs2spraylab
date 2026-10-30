import {dust2Catalog} from './routes';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import * as THREE from 'three';
import {STEP, UNIT, stanceCurve} from '../actor-physics';
import {defaults} from '../config';
import {equipmentStats} from '../equipment';
import {actorHeadPoint} from '../duel/geometry';
import type {DuelEvent} from '../duel/types';
import {PrefireBotController} from './bot-controller';
import {hasPrefireSight, validPrefireExcursion, type PrefireBotPlan} from './bot-behavior';
import {sanitizePrefireConfig, type PrefireConfig} from './config';
import type {PrefireMap} from './map';
import {NativeMapCollision, type NativeCollisionManifest} from './native-collision';
import {placePrefireTarget} from './placement';
import {prefireRoutes, type PrefireRoute} from './routes';
import {PrefireSimulation} from './session';
import {nativeSightBlocked, prefireUpperBodyExtrema} from './spawn-audit';

// These scenes exercise the actual Rapier queries and shared motor/weapon APIs.
// No fixture substitutes its own shot, recoil, movement or visibility formula.
async function scene(geometries: THREE.BoxGeometry[]) {
  const groups: NativeCollisionManifest['groups'] = [], buffers: Buffer[] = [];
  let offset = 0;
  for (const [id, geometry] of geometries.entries()) {
    const vertices = new Float32Array(geometry.getAttribute('position').array);
    const indices = new Uint32Array(geometry.getIndex()!.array);
    groups.push({id, offset, vertexCount: vertices.length / 3, indexCount: indices.length, movement: true, shots: true});
    buffers.push(Buffer.from(vertices.buffer), Buffer.from(indices.buffer));
    offset += vertices.byteLength + indices.byteLength;
    geometry.dispose();
  }
  const bytes = Buffer.concat(buffers);
  return NativeMapCollision.create({version: 1, unit: UNIT, build: 'training-quality-fixture', collisionSha256: '', groups},
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

const fixtureRoute: PrefireRoute = {id: 'long-doors', name: 'Regression lane', spawn: [0, 0, 0], look: [0, 240, 0],
  path: [[0, 80, 0]], angles: [{name: 'One angle', position: [0, 240, 0]}]};
const makeMap = (collision: NativeMapCollision): PrefireMap => ({scene: new THREE.Group(), collision,
  settle: point => placePrefireTarget(collision, point), dispose() {}});
const botShots = (events: DuelEvent[]) => events.filter(event => event.kind === 'fire' && event.actorId > 0);
const playerShots = (events: DuelEvent[]) => events.filter(event => event.kind === 'fire' && event.actorId === 0);
const head = (actor: PrefireSimulation['actors'][number]) => actorHeadPoint({...actor.position, y: actor.feet}, actor.duckAmount ?? 0, actor.yaw);

function run(sim: PrefireSimulation, seconds: number) {
  const events: DuelEvent[] = [];
  sim.start();
  const end = sim.time + seconds;
  while (sim.time + STEP / 2 < end && sim.phase === 'fighting') {sim.step(); events.push(...sim.drainEvents());}
  return events;
}
function relocatedPlayer(sim: PrefireSimulation, x: number, z = 0) {
  // Test setup only: hidden trajectories must not influence the bot's decisions.
  Object.assign(sim.actors[0].position, {x, z});
  sim.actors[0].velocity = {x: 0, z: 0};
}

describe('Prefire training-quality state transitions', () => {
  let open: NativeMapCollision, cover: NativeMapCollision;
  beforeAll(async () => {
    open = await scene([new THREE.BoxGeometry(40, .2, 40).translate(0, -.1, 0)]);
    cover = await scene([new THREE.BoxGeometry(40, .2, 40).translate(0, -.1, 0),
      new THREE.BoxGeometry(2, 4, .2).translate(0, 2, -3)]);
  }, 30000);
  afterAll(() => {open?.dispose(); cover?.dispose();});
  const simulation = (patch: Partial<PrefireConfig> = {}, seed = 42, collision = open, route = fixtureRoute) => {
    const sim = new PrefireSimulation(makeMap(collision), sanitizePrefireConfig({population: 'all', botBehavior: 'static', ...patch}), route, seed, defaults, undefined, dust2Catalog);
    sim.actors.forEach(actor => {actor.health = 1e8;});
    return sim;
  };

  it('freezes controller, weapon, reload and accumulated motor time while paused, including advance()', () => {
    const sim = simulation({returnFire: true, reactionMs: 300});
    sim.actors[0].weapon.ammo = 0;
    sim.command(0, {reloadPressed: true, forward: 1});
    run(sim, .12);
    expect(sim.actors[0].weapon.reloadUntil).toBeGreaterThan(sim.time);
    sim.pause();
    const frozen = {actors: sim.snapshot(), controller: sim.prefireBotDecision(1), time: sim.time, tick: sim.tick,
      accumulator: sim.accumulator, reloadUntil: sim.actors[0].weapon.reloadUntil};
    for (let tick = 0; tick < 256; tick++) {sim.step(); sim.advance(.25);}
    expect({actors: sim.snapshot(), controller: sim.prefireBotDecision(1), time: sim.time, tick: sim.tick,
      accumulator: sim.accumulator, reloadUntil: sim.actors[0].weapon.reloadUntil}).toEqual(frozen);
    expect(sim.drainEvents()).toEqual([]);
    sim.resume(); sim.step();
    expect(sim.time).toBe(frozen.time + STEP);
    expect(sim.actors[0].weapon.reloadUntil).toBe(frozen.reloadUntil);
    expect(botShots(sim.drainEvents())).toHaveLength(0);
  });

  it('requires fresh player input after pause rather than firing an earlier queued pistol tap', () => {
    const sim = simulation();
    sim.equipPlayer(2); sim.start();
    sim.command(0, {firePressed: true}); sim.step();
    expect(playerShots(sim.drainEvents())).toHaveLength(1);
    sim.command(0, {firePressed: true}); sim.step();
    expect(playerShots(sim.drainEvents())).toHaveLength(0);
    expect(sim.actors[0].weapon.pendingPress).toBe(true);
    const ammo = sim.actors[0].weapon.ammo;
    sim.pause(); sim.advance(10); sim.resume();
    const resumed = run(sim, equipmentStats(defaults.sidearm).cycle + .1);
    expect(playerShots(resumed), `No click after resume; shots at ${playerShots(resumed).map(event => event.tick * STEP)}`).toHaveLength(0);
    expect(sim.actors[0].weapon.ammo).toBe(ammo);
  });

  it('cancels a holstered reload, preserves ammo and enforces draw time before the new gun fires', () => {
    const sim = simulation(), rifle = sim.actors[0].weapon;
    rifle.ammo = 5;
    sim.command(0, {reloadPressed: true});
    expect(run(sim, .1).some(event => event.kind === 'action' && event.action === 'reload-start')).toBe(true);
    sim.equipPlayer(2);
    expect(rifle.reloadUntil).toBe(0);
    const player = sim.actors[0], pistol = player.weapon;
    expect(pistol.id).toBe(defaults.sidearm);
    sim.command(0, {firePressed: true});
    const drawEvents = run(sim, equipmentStats(pistol.id).deploy - 2 * STEP);
    expect(playerShots(drawEvents)).toHaveLength(0);
    expect(pistol.pendingPress).toBe(false);
    run(sim, .1);
    sim.command(0, {firePressed: true});
    expect(playerShots(run(sim, STEP))).toHaveLength(1);
    sim.equipPlayer(1);
    expect(sim.actors[0].weapon).toBe(rifle);
    run(sim, 4);
    expect(rifle.ammo).toBe(5);
    expect(rifle.reloadUntil).toBe(0);
  });

  it('has no bot shot or damage through actual native cover while the player can still fire into it', () => {
    const sim = simulation({returnFire: true, reactionMs: 300}, 42, cover);
    expect(hasPrefireSight(cover, sim.actors[1].position, head(sim.actors[0]))).toBe(false);
    sim.command(0, {fireHeld: true});
    const health = sim.actors.map(actor => actor.health), events = run(sim, 1);
    expect(playerShots(events).length).toBeGreaterThan(4);
    expect(events.some(event => event.kind === 'surface' && event.shooter === 0)).toBe(true);
    expect(botShots(events)).toHaveLength(0);
    expect(events.filter(event => event.kind === 'hit')).toHaveLength(0);
    expect(sim.actors.map(actor => actor.health)).toEqual(health);
  });

  it('hidden position, stance, facing, jumping and shooting cannot alter last-seen aim', () => {
    const a = simulation({returnFire: true, reactionMs: 2500}, 7, cover);
    const b = simulation({returnFire: true, reactionMs: 2500}, 7, cover);
    for (const sim of [a, b]) {relocatedPlayer(sim, 4); run(sim, .25); relocatedPlayer(sim, 0);}
    expect(a.prefireBotDecision(1)?.visible).toBe(true);
    for (let tick = 0; tick < 192; tick++) {
      relocatedPlayer(b, tick % 2 ? -.25 : .25, tick % 3 ? 0 : .5);
      b.command(0, {crouch: tick % 2 === 0, yawDelta: .01, jump: tick === 0, fireHeld: true});
      a.step(); b.step();
      const shotsA = botShots(a.drainEvents()), shotsB = botShots(b.drainEvents());
      expect(shotsA).toEqual(shotsB);
      expect(a.actors[1].yaw, `hidden tick ${tick}`).toBe(b.actors[1].yaw);
      expect(a.actors[1].pitch, `hidden tick ${tick}`).toBe(b.actors[1].pitch);
      expect(a.prefireBotDecision(1)).toEqual(b.prefireBotDecision(1));
    }
    expect(a.prefireBotDecision(1)?.seenAt).toBeUndefined();
    expect(a.prefireBotDecision(1)?.visible).toBe(false);
  });

  it('restarts the configured reaction delay after a one-tick loss of sight, not just a perception-sample loss', () => {
    const sim = simulation({returnFire: true, reactionMs: 1000}, 42, cover);
    relocatedPlayer(sim, 4);
    run(sim, .2);
    const sightTime = sim.prefireBotDecision(1)?.seenAt;
    expect(sightTime).toBeDefined();
    // One 128-Hz motor tick is shorter than the idle 75-105ms sensing interval.
    relocatedPlayer(sim, 0); sim.step();
    expect(hasPrefireSight(cover, sim.actors[1].position, head(sim.actors[0]))).toBe(false);
    expect(botShots(sim.drainEvents())).toHaveLength(0);
    relocatedPlayer(sim, 4);
    const reacquiredAt = sim.time;
    const events = run(sim, .98);
    expect(botShots(events), `First sight ${sightTime}; reacquired ${reacquiredAt}; shots ${botShots(events).map(event => event.tick * STEP)}`).toHaveLength(0);
    expect(sim.prefireBotDecision(1)?.seenAt).toBeGreaterThanOrEqual(reacquiredAt);
  });

  it('physically retreats after exhausting a burst with no reserve instead of remaining exposed forever', () => {
    const route: PrefireRoute = {...fixtureRoute, angles: [{...fixtureRoute.angles[0], peek: [80, 240, 0]}]};
    const sim = simulation({botBehavior: 'angle-specific', returnFire: true, reactionMs: 300}, 42, open, route);
    const bot = sim.actors[1]; bot.weapon.ammo = 1; bot.weapon.reserve = 0;
    // Exercise a fully exhausted loadout, not the separately tested backup policy.
    bot.inventory.delete('usp');
    const events = run(sim, 10);
    expect(botShots(events)).toHaveLength(1);
    expect(bot.weapon.ammo).toBe(0);
    expect(sim.prefireBotDecision(1)?.phase).not.toBe('exposed');
  });

  it.each([7, 42])('normal ammunition and reload cycles cannot leave a dry peeker stuck exposed (seed %s)', seed => {
    const route: PrefireRoute = {...fixtureRoute, angles: [{...fixtureRoute.angles[0], peek: [80, 240, 0]}]};
    const sim = simulation({botBehavior: 'angle-specific', returnFire: true, reactionMs: 300}, seed, open, route);
    const bot = sim.actors[1], startingRounds = bot.weapon.ammo + bot.weapon.reserve;
    bot.inventory.delete('usp');
    let shots = 0, reloads = 0, exposedEmptySince: number | undefined, longestEmptyExposure = 0;
    sim.start();
    while (sim.phase === 'fighting') {
      sim.step();
      const events = sim.drainEvents();
      shots += botShots(events).length;
      reloads += events.filter(event => event.kind === 'action' && event.actorId === bot.id && event.action === 'reload-end').length;
      if (bot.weapon.ammo === 0 && bot.weapon.reserve === 0 && sim.prefireBotDecision(bot.id)?.phase === 'exposed') {
        exposedEmptySince ??= sim.time;
        longestEmptyExposure = Math.max(longestEmptyExposure, sim.time - exposedEmptySince);
      } else exposedEmptySince = undefined;
    }
    expect(shots).toBe(startingRounds);
    expect(reloads).toBeGreaterThan(0);
    expect(longestEmptyExposure, `${startingRounds} rounds fired, ${reloads} reloads; dry exposed ${longestEmptyExposure}s`).toBeLessThan(3);
  });

  it('matches an uninterrupted seeded run after pause for combat and moving/crouching bots', () => {
    const route: PrefireRoute = {...fixtureRoute, angles: [{...fixtureRoute.angles[0], peek: [80, 240, 0], crouched: true}]};
    const a = simulation({botBehavior: 'angle-specific', returnFire: true, reactionMs: 300}, 17, open, route);
    const b = simulation({botBehavior: 'angle-specific', returnFire: true, reactionMs: 300}, 17, open, route);
    run(a, .5); run(b, .5);
    b.pause(); for (let tick = 0; tick < 1000; tick++) {b.step(); b.advance(.016);}
    b.resume();
    const eventsA = run(a, 4), eventsB = run(b, 4);
    expect(eventsB).toEqual(eventsA);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.prefireBotDecision(1)).toEqual(a.prefireBotDecision(1));
  });

  it('random occupancy is reproducible without changing source position, stance, facing or behavior identity', () => {
    const route: PrefireRoute = {...fixtureRoute, angles: Array.from({length: 5}, (_, index) => ({
      name: `Angle ${index}`, position: [index * 80 - 160, 240 + index * 80, 0] as const,
      rotation: [index * 3, index * 45, 0] as const, crouched: index % 2 === 0}))};
    const all = simulation({}, 42, open, route), signatures = new Set<string>();
    for (let seed = 0; seed < 32; seed++) {
      const a = simulation({population: 'random', botsPerRun: 3}, seed, open, route);
      const b = simulation({population: 'random', botsPerRun: 3, returnFire: true}, seed, open, route);
      const keys = a.actors.slice(1).map(actor => a.prefireBotDecision(actor.id)!.key);
      expect(keys.length).toBeGreaterThan(0); expect(keys.length).toBeLessThanOrEqual(route.angles.length);
      expect(b.snapshot()).toEqual(a.snapshot());
      signatures.add(keys.join('|'));
      for (const actor of a.actors.slice(1)) {
        const original = all.actors.find(candidate => all.prefireBotDecision(candidate.id)?.key === a.prefireBotDecision(actor.id)?.key)!;
        expect({position: actor.position, feet: actor.feet, yaw: actor.yaw, pitch: actor.pitch, duck: actor.duckAmount})
          .toEqual({position: original.position, feet: original.feet, yaw: original.yaw, pitch: original.pitch, duck: original.duckAmount});
      }
    }
    expect(signatures.size).toBeGreaterThan(8);
  });

  it('random occupancy can leave every authored angle empty on some attempts, including the first', () => {
    const route: PrefireRoute = {...fixtureRoute, angles: Array.from({length: 5}, (_, index) => ({
      name: `Angle ${index}`, position: [index * 80 - 160, 240 + index * 80, 0] as const}))};
    const omitted = new Set<string>();
    const all = simulation({}, 0, open, route).actors.slice(1).map(actor => `${actor.position.x},${actor.position.z}`);
    for (let seed = 0; seed < 64; seed++) {
      const sim = simulation({population: 'random'}, seed, open, route);
      const occupied = new Set(sim.actors.slice(1).map(actor => `${actor.position.x},${actor.position.z}`));
      for (const key of all) if (!occupied.has(key)) omitted.add(key);
      expect(occupied.size).toBeGreaterThan(0);
    }
    expect([...omitted].sort(), 'No target should become a guaranteed memorized shot in random mode').toEqual([...all].sort());
  });

  it('does not perform lane planning or silhouette scans on idle controller ticks', () => {
    const sim = simulation({}, 42, cover), actor = sim.actors[1], player = sim.actors[0];
    const plan: PrefireBotPlan = {key: 'audit/idle', kind: 'hold', anchor: {...actor.position, y: actor.feet}, sourceCrouched: false};
    const controller = new PrefireBotController(plan, 42, actor.yaw, actor.pitch);
    const ray = vi.spyOn(cover, 'ray'), fits = vi.spyOn(cover, 'fits'), vertical = vi.spyOn(cover, 'vertical'), sweep = vi.spyOn(cover, 'sweep');
    try {
      for (let tick = 0; tick < 10 / STEP; tick++) {
        const command = controller.command(tick * STEP, actor, player, cover, {returnFire: true, reactionMs: 300});
        expect(command.fireHeld).toBe(false);
      }
      // Four bounded head/chest/shoulder probes per perception, not a dense
      // silhouette grid or a scan on every one of the 1280 motor ticks.
      expect(ray.mock.calls.length).toBeGreaterThan(80 * 4); expect(ray.mock.calls.length).toBeLessThan(140 * 4);
      expect(fits).not.toHaveBeenCalled(); expect(vertical).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled();
      ray.mockClear();
      for (let tick = 0; tick < 128; tick++) controller.command(10 + tick * STEP, actor, player, cover, {returnFire: false, reactionMs: 300});
      expect(ray.mock.calls.length).toBeGreaterThan(8 * 4); expect(ray.mock.calls.length).toBeLessThan(14 * 4);
      expect(fits).not.toHaveBeenCalled(); expect(vertical).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled();
    } finally {vi.restoreAllMocks();}
  });

  it('rejects a real obstacle and unsupported ledge without nudging the original anchor', () => {
    const anchor = {x: 0, y: 0, z: -1.5};
    expect(validPrefireExcursion(cover, anchor, {...anchor, z: -4.5}, false)).toBe(false);
    expect(validPrefireExcursion(open, {x: 19, y: 0, z: 0}, {x: 21, y: 0, z: 0}, false)).toBe(false);
    expect(anchor).toEqual({x: 0, y: 0, z: -1.5});
  });
});

const hasNativeAssets = existsSync('public/revamp/maps/dust2/collision.bin') && existsSync('public/revamp/maps/dust2/collision.json');
describe.skipIf(!hasNativeAssets)('installed Dust2 training-quality regression', () => {
  let native: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    native = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => native?.dispose());

  for (const route of prefireRoutes) it(`${route.id}: supported physical excursions preserve covered starts and never return-fire through the map`, () => {
    const sim = new PrefireSimulation(makeMap(native), sanitizePrefireConfig({population: 'all', botBehavior: 'angle-specific', returnFire: true, reactionMs: 300}), route, 20261010, defaults, undefined, dust2Catalog);
    sim.actors[0].health = 1e8; sim.start();
    const player = sim.actors[0], feet = {...player.position, y: player.feet};
    const eyes = [46, 52, 58, 64].map(height => ({...feet, y: feet.y + height * UNIT}));
    const origins = sim.actors.slice(1).map(actor => ({...actor.position, y: actor.feet}));
    const alreadyHoldingFiringPoint = new Set(sim.actors.slice(1).filter(actor => {
      const decision = sim.prefireBotDecision(actor.id)!;
      return decision.kind === 'move-out' && decision.phase === 'exposed';
    }).map(actor => actor.id));
    const moved = new Set<number>();
    for (let tick = 0; tick < 6 / STEP; tick++) {
      sim.step();
      const events = sim.drainEvents();
      expect(botShots(events), `${route.id}: tick ${tick}`).toHaveLength(0);
      for (const actor of sim.actors.slice(1)) {
        const context = `${route.id}/${sim.prefireBotDecision(actor.id)?.key} tick ${tick}`;
        expect(actor.grounded, context).toBe(true);
        expect(Number.isFinite(actor.feet), context).toBe(true);
        const from = origins[actor.id - 1];
        if (Math.hypot(actor.position.x - from.x, actor.position.z - from.z) > 16 * UNIT) moved.add(actor.id);
        if (tick % 64 !== 0) continue;
        const physicalFeet = {...actor.position, y: actor.feet};
        expect(native.fits(physicalFeet, actor.feet, (72 - 18 * stanceCurve(actor.duckAmount ?? 0)) * UNIT), context).toBe(true);
        const body = prefireUpperBodyExtrema(physicalFeet, (actor.duckAmount ?? 0) >= .95);
        body.push(head(actor));
        for (const eye of eyes) for (const point of body) expect(nativeSightBlocked(native, eye, point), context).toBe(true);
      }
    }
    for (const actor of sim.actors.slice(1)) if (['periodic-peek', 'move-out'].includes(sim.prefireBotDecision(actor.id)!.kind)) {
      if (alreadyHoldingFiringPoint.has(actor.id)) {
        expect(moved.has(actor.id), `${route.id}: an already-taken firing point must not manufacture a cover loop`).toBe(false);
      } else expect(moved.has(actor.id), `${route.id}: a planned excursion must physically traverse its lane`).toBe(true);
    }
  }, 20000);

  it('keeps cold route planning separate from cached repeats and random-population attempts', () => {
    const practice = sanitizePrefireConfig({population: 'all', botBehavior: 'angle-specific'});
    const timings: {route: string; coldMs: number; cachedMs: number}[] = [];
    for (const original of prefireRoutes) {
      const route = {...original};
      const start = performance.now();
      const first = new PrefireSimulation(makeMap(native), practice, route, 42, defaults, undefined, dust2Catalog);
      const coldMs = performance.now() - start;
      const ray = vi.spyOn(native, 'ray'), sweep = vi.spyOn(native, 'sweep');
      try {
        const repeatAt = performance.now();
        const repeat = new PrefireSimulation(makeMap(native), practice, route, 7, defaults, undefined, dust2Catalog);
        const cachedMs = performance.now() - repeatAt;
        expect(ray, route.id).not.toHaveBeenCalled(); expect(sweep, route.id).not.toHaveBeenCalled();
        const random = new PrefireSimulation(makeMap(native), {...practice, population: 'random'}, route, 20261010, defaults, undefined, dust2Catalog);
        ray.mockClear(); sweep.mockClear();
        new PrefireSimulation(makeMap(native), {...practice, population: 'random'}, route, 20261010, defaults, undefined, dust2Catalog);
        expect(ray, route.id).not.toHaveBeenCalled(); expect(sweep, route.id).not.toHaveBeenCalled();
        expect(repeat.actors.length).toBe(first.actors.length);
        expect(random.actors.length).toBeGreaterThan(1);
        timings.push({route: route.id, coldMs: +coldMs.toFixed(2), cachedMs: +cachedMs.toFixed(2)});
      } finally {ray.mockRestore(); sweep.mockRestore();}
    }
    // Measurements are diagnostic; machine-dependent milliseconds are not a CI gate.
    console.info('Prefire isolated native plan timings (ms):', JSON.stringify(timings));
  }, 20000);
});
