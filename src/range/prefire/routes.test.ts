import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import dataset from './data/openprefire-dust2.json';
import retakes from './data/retakes-dust2.json';
import authored from './data/authored-dust2.json';
import combatLeads from './data/combat-dust2-leads.json';
import {prefireAngleSource, prefireClearingRoutes, prefireRoutes, prefireLineup, prefireRouteAliases, sourcePoint} from './routes';
import {choosePrefireAngles, prefireCandidates} from './occupancy';
import {randomStream} from '../duel/rng';
import weightedPools from './data/dust2-weighted-pools.json';
import {placePrefireTarget, prefirePeekPosition} from './placement';
import {NativeMapCollision} from './native-collision';
import {moveOnTerrain} from '../actor-collision';
import {advanceActor, idleInput, STEP, UNIT, type ActorKinematics} from '../actor-physics';
import {nativeSightBlocked, prefireBodyExposed, prefireSpawnEyes, prefireUpperBodyExtrema,
  prefireUpperBodySamples, walkPrefireAuditPath} from './spawn-audit';
import {resolveBulletRay} from '../duel/penetration';
import {PrefireSimulation} from './session';
import {sanitizePrefireConfig} from './config';
import {defaults} from '../config';
import * as THREE from 'three';

describe('licensed common-angle samples', () => {
  it('pins the primary practice source and includes every source profile', () => {
    expect(prefireAngleSource).toMatchObject({repository: 'https://github.com/lengran/OpenPrefirePrac',
      commit: '44fb66eab70fb3b1b7112ed3c30cc68fb977dd26', license: 'MIT'});
    expect(prefireAngleSource.notice).toContain('Copyright (c) 2024 lengran');
    expect(prefireAngleSource.notice).toContain('Permission is hereby granted');
    expect(Object.values(dataset.profiles).reduce((sum, profile) => sum + profile.angles.length, 0)).toBe(202);
    expect(readFileSync('src/range/prefire/data/OpenPrefirePrac.LICENSE.txt', 'utf8')).toContain('Copyright (c) 2024 lengran');
    for (const profile of Object.values(dataset.profiles)) expect(profile.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('preserves sampled position, orientation and stance across both licensed sources', () => {
    const angles = prefireClearingRoutes.flatMap(route => route.angles);
    expect(prefireClearingRoutes).toHaveLength(24);
    expect(prefireRoutes).toHaveLength(10);
    expect(angles).toHaveLength(120);
    expect(angles.some(angle => angle.crouched)).toBe(true);
    for (const angle of prefireRoutes.flatMap(prefireCandidates)) {
      expect(angle.source).toBeDefined();
      const original = angle.source!.dataset === 'spraylab-authored' ? authored.angles[angle.source!.index - 1]
        : angle.source!.dataset === 'duel-density' ? combatLeads.angles[angle.source!.index - 1]
        : angle.source!.dataset === 'retakes' ? retakes.angles[angle.source!.index - 1]
        : dataset.profiles[angle.source!.profile as keyof typeof dataset.profiles].angles[angle.source!.index - 1];
      expect(angle.position).toEqual(original.position);
      expect(angle.rotation).toEqual(original.rotation);
      expect(angle.crouched).toBe(angle.source!.stanceOverride ? angle.source!.stanceOverride === 'crouched' : original.crouched);
      if (angle.source!.stanceOverride) expect(angle.id).toBe('openprefire:mid_to_b/24:standing');
    }
    for (const route of prefireRoutes) expect(route.angles.length).toBeLessThanOrEqual(5);
    for (const id of ['b-doors', 'a-retake']) {
      expect(prefireRoutes.find(route => route.id === id)).toMatchObject({enemySide: 't', phase: 'postplant'});
    }
    for (const id of ['ct-mid-push', 'lower-tunnels']) {
      expect(prefireRoutes.find(route => route.id === id)).toMatchObject({enemySide: 't', phase: 'preplant'});
    }
    expect(prefireRoutes.slice(0, 8).map(route => route.angles.map(angle => `${angle.source!.profile}/${angle.source!.index}`))).toEqual([
      ['a_long/2', 'a_long/9', 'a_long/11', 'a_long/4', 'a_long/10'],
      ['a_long/19', 'a_long/20', 'a_long/23', 'a_long/34', 'a_long/35'],
      ['mid_to_b/14', 'a_short/5', 'a_short/9', 'a_short/11', 'a_short/18'],
      ['b_tunnel/11', 'b_tunnel/9', 'b_tunnel/13', 'b_tunnel/10', 'b_tunnel/16'],
      ['mid_to_b/30', 'mid_to_b/37', 'mid_to_b/46', 'mid_to_b/39', 'mid_to_b/36'],
      ['mid_to_b/27', 'a_long/33', 'a_long/31', 'a_long/30', 'mid_to_b/19'],
      ['ct_push_lower/7', 'ct_push_lower/8', 'ct_push_lower/14', 'ct_push_lower/16', 'ct_push_lower/17'],
      ['a_short/19', 'a_short/18', 'a_short/21', 'a_short/23', 'a_short/15'],
    ]);
  });
  it('uses distinct landmark approaches and retains the original sets as lineups', () => {
    expect(new Set(prefireRoutes.map(route => JSON.stringify([route.spawn, route.path]))).size).toBe(10);
    expect(prefireRoutes.flatMap(route => route.lineups ?? [])).toHaveLength(33);
    for (const route of prefireRoutes) {
      expect(route.startLabel).toBeTruthy();
      for (const lineup of route.lineups ?? []) {
        const variant = prefireLineup(route, lineup.id);
        expect(variant.spawn).toEqual(route.spawn); expect(variant.path).toBe(route.path);
        expect(variant.angles).toEqual(lineup.angles);
        expect(prefireLineup(route, lineup.id)).toBe(variant);
        expect(choosePrefireAngles(variant, 'all', () => 0)).toHaveLength(5);
        expect(new Set(prefireCandidates(variant).map(angle => angle.id))).toEqual(new Set(prefireCandidates(route).map(angle => angle.id)));
      }
    }
    expect(prefireRouteAliases['pit-clear']).toBe('long-doors');
    expect(prefireRouteAliases['b-retake-boxes']).toBe('b-doors');
    expect(prefireRoutes.find(route => route.id === 'long-doors')!.spawn).toEqual([210,-297,2]);
    expect(prefireRoutes.find(route => route.id === 'long-a')!.spawn).toEqual([700,910,0]);
  });
  it('uses an independently native-audited pool, without inflating the exhaustive actor lineup', () => {
    expect(weightedPools.schemaVersion).toBe(1);
    const collision = JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
    expect(weightedPools.collisionSha256).toBe(collision.collisionSha256);
    expect(weightedPools.gates).toEqual({coverMarginUnits: 64, protectedInitialWalkUnits: 32,
      bothWalkingStances: true, fullSpeedMotor: true, maximumActive: 5});
    for (const [file, sha] of Object.entries(weightedPools.dependencySha256)) {
      expect(createHash('sha256').update(readFileSync(`src/range/prefire/${file}`)).digest('hex'), `stale pool dependency ${file}`).toBe(sha);
    }
    for (const route of prefireRoutes) {
      expect((weightedPools.approaches as Record<string, unknown>)[route.id]).toEqual({spawn: route.spawn, path: route.path});
      const candidates = prefireCandidates(route);
      expect(candidates.length).toBeGreaterThanOrEqual(route.angles.length);
      expect(new Set(candidates.map(angle => angle.id)).size).toBe(candidates.length);
    }
    for (const id of ['long-doors', 'long-a', 'short-a', 'b-tunnels', 'b-doors', 'a-retake'])
      expect(prefireCandidates(prefireRoutes.find(route => route.id === id)!).length).toBeGreaterThan(5);
  });
  it('retains the newly source-backed closet, box-top, lower/cat and anti-push checks', () => {
    const holds = (id: string) => prefireCandidates(prefireRoutes.find(route => route.id === id)!).map(angle => angle.id);
    expect(holds('b-tunnels')).toEqual(expect.arrayContaining(['openprefire:b_tunnel/21', 'openprefire:b_tunnel/22',
      'openprefire:b_tunnel/26', 'openprefire:b_tunnel/27', 'openprefire:b_tunnel/20']));
    expect(holds('ct-mid-push')).toEqual(expect.arrayContaining(['openprefire:mid_to_b/11', 'openprefire:mid_to_b/13',
      'openprefire:mid_to_b/15', 'openprefire:ct_push_mid/17', 'openprefire:ct_push_mid/18', 'openprefire:ct_push_mid/20']));
    expect(prefireRoutes.flatMap(prefireCandidates).some(angle => angle.id === 'retakes:dust2/13')).toBe(true);
    for (const id of ['b-doors']) {
      const pool = prefireCandidates(prefireRoutes.find(route => route.id === id)!);
      for (const ids of [['openprefire:mid_to_b/46', 'retakes:dust2/12'], ['openprefire:mid_to_b/49', 'retakes:dust2/9']]) {
        const family = pool.filter(angle => ids.includes(angle.id!));
        expect(family).toHaveLength(2);
        expect(family[0].exclusionGroup).toBeTruthy(); expect(family[0].exclusionGroup).toBe(family[1].exclusionGroup);
      }
    }
    for (const route of prefireRoutes) for (let seed = 0; seed < 32; seed++) {
      expect(choosePrefireAngles(route, 'random', randomStream(seed, 'density'), undefined, 5)).toHaveLength(5);
      const selected = choosePrefireAngles(route, 'random', randomStream(seed, 'default-density'));
      expect(selected).toHaveLength(4);
      expect(selected.filter(angle => angle.exclusionGroup === 'b-closet-pocket').length).toBeLessThanOrEqual(1);
    }
  });
  it('fills sourced Long/car, A and Top Mid omissions without admitting exposed or unreachable points', () => {
    const holds = (id: string) => prefireCandidates(prefireRoutes.find(route => route.id === id)!).map(angle => angle.id);
    expect(holds('long-a')).toEqual(expect.arrayContaining(['openprefire:a_short/26', 'openprefire:a_short/28',
      'openprefire:a_short/19', 'openprefire:a_short/25', 'openprefire:a_short/29', 'openprefire:mid_to_b/26', 'openprefire:mid_to_b/32']));
    expect(holds('short-a')).toEqual(expect.arrayContaining(['openprefire:a_short/19', 'openprefire:a_short/28',
      'openprefire:mid_to_b/26', 'openprefire:a_long/37']));
    expect(holds('a-retake')).toContain('retakes:dust2/17');
    expect(holds('ct-mid-push')).toEqual(expect.arrayContaining(['openprefire:mid_to_b/16', 'openprefire:a_short/3']));
    expect(holds('long-a')).not.toContain('openprefire:a_short/30');
    for (const index of [3, 5, 6]) expect(holds('short-a')).toContain(`openprefire:a_short/${index}`);
    for (const index of [21, 22, 23]) expect(holds('ct-mid-push')).not.toContain(`openprefire:ct_push_mid/${index}`);
    for (const [routeId, ids] of [['long-a', ['openprefire:a_long/27', 'openprefire:a_short/26']],
      ['ct-mid-push', ['openprefire:ct_push_mid/1', 'openprefire:mid_to_b/16']]] as const) {
      const variants = prefireCandidates(prefireRoutes.find(route => route.id === routeId)!).filter(angle => (ids as readonly string[]).includes(angle.id!));
      expect(variants).toHaveLength(2);
      expect(variants[0].exclusionGroup).toBeTruthy();
      expect(variants[0].exclusionGroup).toBe(variants[1].exclusionGroup);
    }
  });
  it('admits the missing close CT-mid and upper-tunnel corners to their validated approaches only', () => {
    const holds = (id: string) => prefireCandidates(prefireRoutes.find(route => route.id === id)!).map(angle => angle.id);
    expect(holds('mid-doors')).toEqual(expect.arrayContaining(['openprefire:mid_to_b/20', 'openprefire:mid_to_b/21']));
    expect(holds('upper-tunnels')).toEqual(expect.arrayContaining(['openprefire:b_tunnel/1', 'openprefire:b_tunnel/5']));
    expect(new Set(prefireRoutes.flatMap(prefireCandidates).map(angle => angle.id)).size).toBe(197);
    expect(prefireRoutes.flatMap(prefireCandidates)).toHaveLength(347);
    for (const id of ['mid-doors', 'upper-tunnels']) {
      const route = prefireRoutes.find(route => route.id === id)!;
      expect(route).toMatchObject({enemySide: 'ct', phase: 'preplant'});
      expect(route.angles).toHaveLength(5);
    }
  });
  it('exposes focused site and CT-box lineups without adding duplicate walking approaches', () => {
    for (const [routeId, lineupId, expected] of [
      ['mid-doors','ct-spawn-boxes','openprefire:mid_to_b/24:standing'],
      ['long-a','long-a-boxes','openprefire:a_short/11'],
      ['short-a','short-a-boxes','openprefire:a_short/14'],
      ['b-tunnels','b-tunnel-boxes','retakes:dust2/13'],
    ]) {
      const route = prefireRoutes.find(route => route.id === routeId)!;
      const lineup = prefireLineup(route, lineupId);
      expect(lineup.angles.some(angle => angle.id === expected)).toBe(true);
      expect(choosePrefireAngles(lineup,'all',()=>0)).toHaveLength(5);
      expect(lineup.path).toBe(route.path);
    }
    const ct = prefireCandidates(prefireRoutes.find(route => route.id === 'mid-doors')!);
    const variants = ct.filter(angle => angle.source?.profile === 'mid_to_b' && angle.source.index === 24);
    expect(variants).toHaveLength(2);
    expect(new Set(variants.map(angle => angle.exclusionGroup))).toEqual(new Set(['ct-spawn-box']));
    for (let seed=0;seed<64;seed++) expect(choosePrefireAngles(prefireRoutes.find(route=>route.id==='mid-doors')!,
      'random',randomStream(seed,'ct-box'),undefined,5).filter(angle=>angle.exclusionGroup==='ct-spawn-box').length).toBeLessThanOrEqual(1);
  });
});

describe('orientation-independent covered-start audit', () => {
  it('includes standing and crouched shoulder/crown corners in both probe densities', () => {
    const feet = {x: 1, y: 2, z: 3};
    for (const sampler of [prefireUpperBodyExtrema, prefireUpperBodySamples]) for (const crouched of [false, true]) {
      const samples = sampler(feet, crouched), duck = crouched ? 18 : 0;
      for (const [radius, heights] of [[20, [34, 58]], [8, [58, 72]]] as const) {
        for (const x of [-radius, radius]) for (const z of [-radius, radius]) for (const y of heights) {
          expect(samples).toContainEqual({x: feet.x + x * UNIT, y: feet.y + (y - duck) * UNIT, z: feet.z + z * UNIT});
        }
      }
    }
    expect(new Set(prefireSpawnEyes(feet).map(p => (p.y - feet.y) / UNIT)).size).toBe(4);
  });
  it('rejects an exposed corner immediately and does not count target-wall contact as cover', () => {
    const eye = {x: 0, y: 0, z: 0}, samples = [{x: 2, y: 0, z: 0}, {x: 2, y: 0, z: 1}];
    let calls = 0;
    const collision = {ray: () => ++calls === 1 ? {distance: 1, normal: eye, surfaceId: 0} : undefined};
    expect(prefireBodyExposed(collision, [eye], [samples])).toBe(true);
    expect(calls).toBe(2);
    expect(nativeSightBlocked({ray: () => ({distance: 2 - UNIT / 2, normal: eye, surfaceId: 0})}, eye, samples[0])).toBe(false);
  });
});

describe('strict training placement', () => {
  it('allows only a small floor correction with exact horizontal coordinates', () => {
    const calls: number[] = [];
    const collision = {vertical: (p: any, _from: number, _to: number, height: number) => {
      calls.push(height); return {feet: p.y + .02, grounded: true, ceiling: false};
    }, fits: () => true};
    expect(placePrefireTarget(collision, [100, 200, 30], true)).toEqual({x: 100 * UNIT, y: 30 * UNIT + .02, z: -200 * UNIT});
    expect(calls).toEqual([54 * UNIT]);
  });
  it.each([
    {feet: 0, grounded: false, fits: true},
    {feet: 0, grounded: true, fits: false},
    {feet: -3, grounded: true, fits: true},
    {feet: 3, grounded: true, fits: true},
  ])('rejects blocked or wrong-floor samples instead of relocating: %j', fixture => {
    const collision = {vertical: () => ({feet: fixture.feet, grounded: fixture.grounded, ceiling: false}), fits: () => fixture.fits};
    expect(() => placePrefireTarget(collision, [100, 200, 0])).toThrow('does not fit this map revision');
  });
});

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('sourced angles in the installed Dust 2', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    collision = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => collision?.dispose());
  for (const route of prefireRoutes) {
    it(`${route.name}: native cover hides every standing/crouched upper-body corner without using camera yaw`, () => {
      const spawn = placePrefireTarget(collision, route.spawn);
      const bodies = prefireCandidates(route).flatMap(angle => {
        const feet = placePrefireTarget(collision, angle.position, angle.crouched);
        return [prefireUpperBodySamples(feet), prefireUpperBodySamples(feet, true)];
      });
      expect(collision.fits(spawn, spawn.y, 54 * UNIT)).toBe(true);
      expect(prefireBodyExposed(collision, prefireSpawnEyes(spawn), bodies), 'exposed native shoulder/head corner at spawn').toBe(false);
      const look = sourcePoint(route.look), exit = sourcePoint(route.path[0]);
      const alignment = ((look.x - spawn.x) * (exit.x - spawn.x) + (look.z - spawn.z) * (exit.z - spawn.z)) /
        (Math.hypot(look.x - spawn.x, look.z - spawn.z) * Math.hypot(exit.x - spawn.x, exit.z - spawn.z));
      expect(alignment, 'spawn looks along its covered exit').toBeGreaterThan(.99);
      const margin = 64;
      for (const x of [-margin, 0, margin]) for (const z of [-margin, 0, margin]) {
        const eyes = [46, 52, 58, 64].map(height => ({x: spawn.x + x * UNIT, y: spawn.y + height * UNIT, z: spawn.z + z * UNIT}));
        expect(prefireBodyExposed(collision, eyes, bodies), `exposed ${margin}-unit cover margin at ${x},${z}`).toBe(false);
      }
    }, 60000);
    it(`${route.name}: both player stances walk continuously and need deliberate movement before the first target`, () => {
      const bodies = prefireCandidates(route).flatMap(angle => {
        const feet = placePrefireTarget(collision, angle.position, angle.crouched);
        return [prefireUpperBodySamples(feet), prefireUpperBodySamples(feet, true)];
      });
      const first = route.angles[0], feet = placePrefireTarget(collision, first.position, first.crouched);
      const head = {...feet, y: feet.y + (first.crouched ? 46 : 64) * UNIT};
      for (const crouched of [false, true]) {
        const walked = walkPrefireAuditPath(collision, [route.spawn, ...route.path], crouched);
        let distance = 0, firstHeadDistance: number | undefined;
        for (let i = 0; i < walked.length; i++) {
          const p = walked[i];
          if (i) distance += Math.hypot(p.x - walked[i - 1].x, p.z - walked[i - 1].z) / UNIT;
          const eyes = [46, 64].map(height => ({...p, y: p.y + height * UNIT}));
          // Dense validation of the initial 32 units prevents a probe-only corner false negative.
          if (distance <= 32) expect(prefireBodyExposed(collision, eyes, bodies), `premature exposure after ${distance} units`).toBe(false);
          const eye = {...p, y: p.y + (crouched ? 46 : 64) * UNIT};
          if (firstHeadDistance === undefined && !nativeSightBlocked(collision, eye, head)) firstHeadDistance = distance;
        }
        expect(firstHeadDistance, 'first sampled head must become visible on the supported route').toBeDefined();
        expect(firstHeadDistance!).toBeGreaterThanOrEqual(32);
        expect(firstHeadDistance!).toBeLessThan(1536);
      }
    }, 60000);
    it(`${route.name}: full-speed yaw steering clears every waypoint without a wall-stall workaround`, () => {
      const p = placePrefireTarget(collision, route.spawn), world = {floor: null, solids: [], native: collision};
      let actor: ActorKinematics = {position: {...p, y: p.y + 64 * UNIT}, velocity: {x: 0, z: 0}, yaw: 0,
        feet: p.y, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true};
      for (const point of route.path) {
        const target = placePrefireTarget(collision, point);
        const initialGap = Math.hypot(target.x - actor.position.x, target.z - actor.position.z);
        const budget = Math.ceil(initialGap / (215 * UNIT) / STEP) + 128;
        let tick = 0;
        for (; tick < budget && Math.hypot(target.x - actor.position.x, target.z - actor.position.z) > .16; tick++) {
          actor.yaw = Math.atan2(-(target.x - actor.position.x), -(target.z - actor.position.z));
          actor = advanceActor(actor, {...idleInput(), forward: 1}, 215 * UNIT, STEP, undefined, undefined, undefined, world);
          expect(actor.grounded, `airborne toward ${point}`).toBe(true);
        }
        expect(Math.hypot(target.x - actor.position.x, target.z - actor.position.z), `motor stalled toward ${point}`).toBeLessThanOrEqual(.16);
      }
    }, 15000);
    it(`${route.name}: exact sampled XY and authored stance fit without nudging`, () => {
      for (const point of [route.spawn, ...route.path]) {
        const actual = placePrefireTarget(collision, point), sample = sourcePoint(point);
        expect(actual.x).toBe(sample.x); expect(actual.z).toBe(sample.z);
      }
      for (const angle of prefireCandidates(route)) {
        const sample = sourcePoint(angle.position), feet = placePrefireTarget(collision, angle.position, angle.crouched);
        expect(feet.x).toBe(sample.x); expect(feet.z).toBe(sample.z);
        expect(Math.abs(feet.y - sample.y)).toBeLessThanOrEqual(6 * UNIT);
        expect(collision.fits(feet, feet.y, (angle.crouched ? 54 : 72) * UNIT)).toBe(true);
        const peek = prefirePeekPosition(collision, angle);
        if (peek) expect(collision.sweep(feet, peek, (angle.crouched ? 54 : 72) * UNIT).fraction).toBeGreaterThanOrEqual(.999);
      }
    });
    it(`${route.name}: a player can walk the route and hit each actual standing/crouched head`, () => {
      let p = placePrefireTarget(collision, route.spawn);
      const views = [{...p, y: p.y + 64 * UNIT}];
      for (const point of route.path) {
        const target = placePrefireTarget(collision, point);
        for (let tick = 0; tick < 2400 && Math.hypot(target.x - p.x, target.z - p.z) > .08; tick++) {
          const d = Math.hypot(target.x - p.x, target.z - p.z);
          const moved = moveOnTerrain(p, {...p, x: p.x + (target.x - p.x) / d * .05, z: p.z + (target.z - p.z) / d * .05},
            72 * UNIT, {floor: null, solids: [], native: collision}, true);
          p = moved.position;
          if (tick % 10 === 0) views.push({...p, y: p.y + 64 * UNIT});
        }
        expect(Math.hypot(target.x - p.x, target.z - p.z), `blocked walking segment: ${point}`).toBeLessThan(.15);
      }
      for (const angle of prefireCandidates(route)) {
        const feet = placePrefireTarget(collision, angle.position, angle.crouched), height = (angle.crouched ? 46 : 64) * UNIT;
        const head = {...feet, y: feet.y + height};
        const target = {id: 1, side: 'enemy', position: head, feet: feet.y, duckAmount: Number(angle.crouched), alive: true, armor: 100, helmet: true};
        expect(views.some(origin => {
          const d = Math.hypot(head.x - origin.x, head.y - origin.y, head.z - origin.z);
          if (!d) return false;
          const result = resolveBulletRay({origin, direction: {x: (head.x - origin.x) / d, y: (head.y - origin.y) / d, z: (head.z - origin.z) / d},
            range: d + 1, equipment: 'ak47', arena: {solids: [], native: collision}, actors: [target], shooterId: 0, shooterSide: 'player'});
          return result.hits.some(hit => hit.actorId === 1 && hit.group === 'head');
        }), `unhittable sampled head: ${angle.name}`).toBe(true);
      }
    }, 15000);
    it(`${route.name}: every placed holder remains supported in the shared movement simulation`, () => {
      const map = {scene: new THREE.Group(), collision, settle: (point: any) => placePrefireTarget(collision, point), dispose() {}};
      const sim = new PrefireSimulation(map, sanitizePrefireConfig({population: 'all', movingBots: false}), route, 42, defaults);
      const start = sim.snapshot().slice(1);
      sim.start();
      for (let tick = 0; tick < 256; tick++) sim.step();
      for (const [index, actor] of sim.snapshot().slice(1).entries()) {
        expect(actor.alive).toBe(true);
        expect(actor.grounded, `${route.name}: ${route.angles[index].name}`).toBe(true);
        expect(actor.position.x).toBeCloseTo(start[index].position.x, 5);
        expect(actor.position.z).toBeCloseTo(start[index].position.z, 5);
        expect(actor.crouched).toBe(!!route.angles[index].crouched);
        expect(actor.duckAmount).toBe(Number(route.angles[index].crouched));
      }
    }, 15000);
  }
});
