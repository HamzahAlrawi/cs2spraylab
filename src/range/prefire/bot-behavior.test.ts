import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {DEG, UNIT, type Vec} from '../actor-physics';
import {traceActor} from '../duel/geometry';
import {createPrefireBotPlan, hasPrefireSight, PREFIRE_ENDPOINT_RADIUS, PREFIRE_MIN_PEEK_LATERALNESS, prefirePeekLateralness, prefireBotCatalog, prefireBotKey, prefireRouteViews,
  validPrefireExcursion, type BotCollision} from './bot-behavior';
import {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import {prefireClearingRoutes, prefireRoutes, sourcePoint, type PrefireAngle} from './routes';
import dataset from './data/openprefire-dust2.json';

const collisionFixture = (overrides: Partial<BotCollision> = {}): BotCollision => ({
  vertical: p => ({feet: p.y, grounded: true, ceiling: false}), fits: () => true,
  sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}), ray: () => undefined, ...overrides,
});
const anchor = {x: 0, y: 0, z: 0}, exposure = {x: 48 * UNIT, y: 0, z: 0};
const sample = (profile: 'a_long', index: number): PrefireAngle => ({name: 'Fixture', position: [0, 0, 0],
  rotation: [0, 0, 0], source: {profile, index}});
const blockedRay: BotCollision['ray'] = () => ({distance: .5, normal: {x: 1, y: 0, z: 0}, surfaceId: 0});

// Offline native regression probes use the real hit zones, not only eye centers.
function upperBodyVisible(collision: BotCollision, origin: Vec, feet: Vec, crouched: boolean, yaw?: number): boolean {
  for (const height of [32, 40, 48, 56, 64, 68, 72]) {
    for (const x of [-.4, -.31, -.22, -.135, 0, .135, .22, .31, .4]) for (const z of [-.17, 0, .17]) {
      const target = {x: feet.x + x, y: feet.y + (height - (crouched ? 18 : 0)) * UNIT, z: feet.z + z};
      const distance = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z);
      const direction = {x: (target.x - origin.x) / distance, y: (target.y - origin.y) / distance, z: (target.z - origin.z) / distance};
      const hit = traceActor(origin, direction, feet, crouched, distance + .5, yaw);
      if (hit.group && hit.group !== 'leg' && Number.isFinite(hit.distance) &&
        !collision.ray(origin, direction, Math.max(0, hit.distance - .0001))) return true;
    }
  }
  return false;
}

describe('angle-specific behavior catalog', () => {
  it('keeps legacy catalog overrides pinned to source identity, independent of route expansion', () => {
    const kinds = new Set<string>();
    for (const [key, spec] of Object.entries(prefireBotCatalog)) {
      kinds.add(spec.kind);
      const [profile, index] = key.split('/');
      const original = dataset.profiles[profile as keyof typeof dataset.profiles].angles[Number(index) - 1];
      const angle: PrefireAngle = {name: 'Sourced', position: original.position as unknown as PrefireAngle['position'],
        rotation: original.rotation as unknown as PrefireAngle['rotation'], crouched: original.crouched,
        source: {profile: profile as keyof typeof dataset.profiles, index: Number(index)}};
      expect(prefireBotKey(angle)).toBe(key);
      expect(prefireBotKey({...angle, name: 'Renamed'})).toBe(key);
    }
    expect([...kinds].sort()).toEqual(['crouch-hide', 'hold', 'move-out', 'periodic-peek']);
  });
  it('namespaces new datasets, leaves OpenPrefire keys unchanged, and defaults unspecified angles to holds', () => {
    const original = sample('a_long', 9);
    const source = {...original.source!, datasetId: 'retake'};
    const other = {...original, source};
    const openSource = {...source, datasetId: 'openprefire'};
    expect(prefireBotKey({...original, source: openSource})).toBe('a_long/9');
    expect(prefireBotKey(other)).toBe('retake:a_long/9');
    expect(prefireBotKey({...original, source: {...original.source!, dataset: 'retakes'}})).toBe('retakes:a_long/9');
    expect(createPrefireBotPlan(collisionFixture(), other, true).kind).toBe('hold');
    expect(createPrefireBotPlan(collisionFixture(), sample('a_long', 1), true).kind).toBe('hold');
    const authored = createPrefireBotPlan(collisionFixture(), {...other, moving: true}, true);
    expect(authored.kind).toBe('hold'); expect(authored.exposure).toBeUndefined();
  });
  it('retains local identities and the Source-to-eye coordinate contract', () => {
    expect(prefireBotKey({name: 'Local', position: [100, 200, 30]})).toBe('local:100,200,30');
    expect(prefireRouteViews([[100, 200, 30]])).toEqual([{x: 100 * UNIT, y: 94 * UNIT, z: -200 * UNIT}]);
    const settled = collisionFixture({vertical: p => ({feet: p.y + .02, grounded: true, ceiling: false})});
    expect(prefireRouteViews([[100, 200, 30]], settled)).toEqual([{x: 100 * UNIT, y: 94 * UNIT + .02, z: -200 * UNIT}]);
  });
  it('honors source-unlisted local moving/peek hints, but keeps passive crouched holds and static mode fixed', () => {
    const views = [{x: 10, y: 64 * UNIT, z: 10}, {x: 5, y: 64 * UNIT, z: 0}];
    const lane = collisionFixture({ray: (origin, direction, distance) => {
      const end = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      if (origin.x > 9 || end.x > 9) return blockedRay(origin, direction, distance);
      return Math.abs(origin.x < end.x ? origin.z : end.z) < .6 ? blockedRay(origin, direction, distance) : undefined;
    }});
    const local: PrefireAngle = {...sample('a_long', 11), id: 'spraylab:dust2/test-car',
      source: {dataset: 'spraylab-authored', profile: 'dust2', index: 11}};
    expect(prefireBotKey(local)).toBe('spraylab:dust2/test-car');
    expect(createPrefireBotPlan(lane, {...local, moving: true}, true, views))
      .toMatchObject({kind: 'move-out', intent: 'check-recover'});
    expect(createPrefireBotPlan(lane, {...local, peek: [0, 56, 0]}, true, views))
      .toMatchObject({kind: 'periodic-peek', intent: 'check-recover'});
    expect(createPrefireBotPlan(lane, {...local, crouched: true}, true, views))
      .toMatchObject({kind: 'hold', sourceCrouched: true});
    expect(createPrefireBotPlan(lane, {...local, moving: true}, false, views).kind).toBe('hold');
    expect(createPrefireBotPlan(collisionFixture(), {...local, moving: true}, true, views).kind).toBe('hold');
    expect(createPrefireBotPlan({...lane, sweep: from => ({position: from, fraction: 0, startSolid: false})},
      {...local, moving: true}, true, views).kind).toBe('hold');
  });
  it('never invents route views across a wall or an unsupported gap between fitting endpoints', () => {
    const points = [[0, 0, 0], [512, 0, 0]] as const;
    const wall = collisionFixture({sweep: (from, to) => {
      const blocked = from.x < 6 && to.x >= 6;
      return {position: blocked ? from : to, fraction: blocked ? 0 : 1, startSolid: false};
    }});
    const gap = collisionFixture({vertical: p => ({feet: 0, grounded: p.x < 5 || p.x > 7, ceiling: false})});
    const endpoints = prefireRouteViews(points);
    expect(prefireRouteViews(points, wall)).toEqual(endpoints);
    expect(prefireRouteViews(points, gap)).toEqual(endpoints);
    expect(prefireRouteViews(points, collisionFixture()).length).toBeGreaterThan(endpoints.length);
  });
  it('recovers a narrow sightline only from a certified native route walk, never a blocked chord', () => {
    const points = [[0, 0, 0], [512, 0, 0]] as const;
    const target = {...sample('a_long', 11), position: [256, 200, 0] as const};
    const narrow = collisionFixture({ray: (origin, direction, distance) => {
      const end = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      const routeX = Math.abs(origin.z) < .1 ? origin.x : end.x;
      return Math.abs(routeX - 200 * UNIT) < .05 ? undefined : blockedRay(origin, direction, distance);
    }});
    const coarse = prefireRouteViews(points, narrow);
    expect(coarse.some(view => Math.abs(view.x - 200 * UNIT) < .05)).toBe(false);
    const plan = createPrefireBotPlan(narrow, target, false, coarse);
    expect(plan.watchPoint?.x).toBeCloseTo(200 * UNIT);
    expect(plan.approachViews).toContainEqual(plan.watchPoint);
    const wall = {...narrow, sweep: ((from, to) => ({position: from, fraction: 0, startSolid: false})) as BotCollision['sweep']};
    expect(createPrefireBotPlan(wall, target, false, prefireRouteViews(points, wall)).watchPoint).toBeUndefined();
    // Passing a bare list cannot authorize interpolation through unknown terrain.
    expect(createPrefireBotPlan(narrow, target, false, prefireRouteViews(points)).watchPoint).toBeUndefined();
  });
  it('static mode preserves sampled anchors and crouch without planning excursions', () => {
    const ray = vi.fn(() => undefined), sweep = vi.fn(collisionFixture().sweep);
    for (const angle of prefireRoutes.flatMap(route => route.angles)) {
      const plan = createPrefireBotPlan(collisionFixture({ray, sweep}), angle, false);
      expect(plan).toMatchObject({anchor: sourcePoint(angle.position), kind: 'hold', sourceCrouched: !!angle.crouched});
      expect(plan.exposure).toBeUndefined();
    }
    expect(sweep).not.toHaveBeenCalled(); expect(ray).not.toHaveBeenCalled();
  });
  it('retains designated holders even when a lineup carries a generic moving flag or peek endpoint', () => {
    const ray = vi.fn(() => undefined), sweep = vi.fn(collisionFixture().sweep);
    const angle = {...sample('a_long', 11), moving: true, peek: [112, 0, 0] as const};
    expect(createPrefireBotPlan(collisionFixture({ray, sweep}), angle, true,
      [{x: 0, y: 64 * UNIT, z: -5}])).toMatchObject({kind: 'hold', anchor: sourcePoint(angle.position), sourceCrouched: false});
    expect(sweep).not.toHaveBeenCalled(); expect(ray).toHaveBeenCalledTimes(1);
    expect(createPrefireBotPlan(collisionFixture(), angle, true, [{x: 0, y: 64 * UNIT, z: -5}]).watchPoint)
      .toEqual({x: 0, y: 64 * UNIT, z: -5});
  });
});

describe('supported, reversible native-hull excursion contract', () => {
  it('accepts a clear lane in both directions and checks support over its interior', () => {
    const vertical = vi.fn(collisionFixture().vertical), sweep = vi.fn(collisionFixture().sweep);
    expect(validPrefireExcursion(collisionFixture({vertical, sweep}), anchor, exposure, false)).toBe(true);
    expect(sweep.mock.calls).toEqual([[anchor, exposure, 72 * UNIT], [exposure, anchor, 72 * UNIT]]);
    expect(vertical.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(vertical.mock.calls.some(([p]) => p.x > 0 && p.x < exposure.x)).toBe(true);
  });
  it.each([8, 129])('rejects an inappropriate %su displacement', units => {
    expect(validPrefireExcursion(collisionFixture(), anchor, {...exposure, x: units * UNIT}, false)).toBe(false);
  });
  it.each([
    {label: 'height change', target: {...exposure, y: 4 * UNIT}, collision: collisionFixture()},
    {label: 'solid start', target: exposure, collision: collisionFixture({sweep: (from) => ({position: from, fraction: 1, startSolid: true})})},
    {label: 'blocked return', target: exposure, collision: collisionFixture({sweep: (from, to) => ({position: to, fraction: from.x > 0 ? .5 : 1, startSolid: false})})},
    {label: 'unsupported interior', target: exposure, collision: collisionFixture({vertical: p => ({feet: p.y, grounded: p.x < .4 || p.x > .8, ceiling: false})})},
    {label: 'wrong floor', target: exposure, collision: collisionFixture({vertical: p => ({feet: p.y + 4 * UNIT, grounded: true, ceiling: false})})},
    {label: 'blocked hull', target: exposure, collision: collisionFixture({fits: p => p.x < .4 || p.x > .8})},
  ])('rejects $label without moving the source anchor', ({target, collision}) => {
    expect(validPrefireExcursion(collision, anchor, target, false)).toBe(false);
    expect(anchor).toEqual({x: 0, y: 0, z: 0});
  });
  it('uses the crouched hull and reserves other bots along the entire lane', () => {
    const fits = vi.fn(collisionFixture().fits);
    expect(validPrefireExcursion(collisionFixture({fits}), anchor, exposure, true, [anchor])).toBe(true);
    expect(fits.mock.calls.every(([, , height]) => height === 54 * UNIT)).toBe(true);
    expect(validPrefireExcursion(collisionFixture(), anchor, exposure, false, [{x: exposure.x / 2, y: 0, z: 0}])).toBe(false);
    expect(validPrefireExcursion(collisionFixture(), anchor, exposure, false, [{x: exposure.x / 2, y: 80 * UNIT, z: 0}])).toBe(true);
  });
});

describe('position-appropriate behavior selection', () => {
  it('only crouch-hides when standing fits and low cover genuinely changes visibility', () => {
    const view = {x: 0, y: 64 * UNIT, z: -5};
    const lowCover = collisionFixture({ray: (origin, direction, distance) => {
      if (Math.abs(direction.z) < 1e-9) return undefined;
      const hitDistance = (-.5 - origin.z) / direction.z;
      if (hitDistance < 0 || hitDistance > distance || origin.y + direction.y * hitDistance >= 55 * UNIT) return undefined;
      return {distance: hitDistance, normal: {x: 0, y: 0, z: origin.z < -.5 ? -1 : 1}, surfaceId: 0};
    }});
    const angle = sample('a_long', 20);
    expect(createPrefireBotPlan(lowCover, angle, true, [view])).toMatchObject({kind: 'crouch-hide', anchor: sourcePoint(angle.position)});
    expect(createPrefireBotPlan(collisionFixture(), angle, true, [view]).kind).toBe('hold');
    expect(createPrefireBotPlan(collisionFixture({ray: blockedRay}), angle, true, [view]).kind).toBe('hold');
    expect(createPrefireBotPlan({...lowCover, fits: (_p, _feet, height) => height < 70 * UNIT}, {...angle, crouched: true}, true, [view]).kind).toBe('hold');
  });
  it('keeps move-out and periodic-peek distinct and fails safely when all candidates are blocked', () => {
    const views = [{x: 10, y: 64 * UNIT, z: 10}, {x: 5, y: 64 * UNIT, z: 0}];
    const collision = collisionFixture({ray: (origin, direction, distance) => {
      const to = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      if (origin.x > 9 || to.x > 9) return blockedRay(origin, direction, distance);
      const botZ = origin.x < to.x ? origin.z : to.z;
      return Math.abs(botZ) < .6 ? blockedRay(origin, direction, distance) : undefined;
    }});
    for (const [index, kind] of [[2, 'move-out'], [9, 'periodic-peek']] as const) {
      const angle = sample('a_long', index);
      expect(createPrefireBotPlan(collision, angle, true, views).kind).toBe(kind);
      const plan = createPrefireBotPlan({...collision, sweep: from => ({position: from, fraction: 0, startSolid: false})}, angle, true, views);
      expect(plan.kind).toBe('hold'); expect(plan.exposure).toBeUndefined(); expect(plan.anchor).toEqual(sourcePoint(angle.position));
    }
  });
  it('does not label an unobstructed lateral stroll as a covered periodic peek', () => {
    const views = [{x: 0, y: 64 * UNIT, z: -5}, {x: 3, y: 64 * UNIT, z: -5}];
    const plan = createPrefireBotPlan(collisionFixture(), sample('a_long', 9), true, views);
    expect(plan.kind).not.toBe('periodic-peek');
    expect(createPrefireBotPlan(collisionFixture(), {...sample('a_long', 9), peek: [32, 0, 0]}, true, views).kind).toBe('hold');
  });
  it('requires meaningful cover for move-outs too, including authored endpoints', () => {
    const views = [{x: 0, y: 64 * UNIT, z: -5}, {x: 3, y: 64 * UNIT, z: -5}];
    for (const angle of [sample('a_long', 2), {...sample('a_long', 2), peek: [112, 0, 0] as const}]) {
      expect(createPrefireBotPlan(collisionFixture(), angle, true, views).kind).toBe('hold');
    }
  });
  it('accepts the authored session lane when its fixture supplies cover rather than an always-open ray', () => {
    const lane = collisionFixture({ray: (origin, direction, distance) => {
      const end = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      const bot = origin.z < -4 ? origin : end, view = origin.z < -4 ? end : origin;
      return view.z > -1 || bot.x < .6 ? blockedRay(origin, direction, distance) : undefined;
    }});
    const angle = {...sample('a_long', 2), rotation: undefined, position: [0, 200, 0] as const, peek: [60, 200, 0] as const};
    const views = prefireRouteViews([[0, 0, 0], [0, 100, 0]], lane);
    const authoredOnly = {...lane, sweep: ((from, to, height) => Math.abs(to.z - from.z) < .001 &&
      Math.max(from.x, to.x) <= 60 * UNIT ? lane.sweep(from, to, height) : {position: from, fraction: 0, startSolid: false}) as BotCollision['sweep']};
    const plan = createPrefireBotPlan(authoredOnly, angle, true, views);
    expect(plan).toMatchObject({kind: 'move-out', attackFromAnchor: false, exposure: sourcePoint(angle.peek)});
    expect(plan.watchPoint).toEqual(views[1]);
    expect(createPrefireBotPlan(collisionFixture(), angle, true, views).kind).toBe('hold');
  });
  it('prefers a short check or larger move-out, both recovering, and derives pre-aim only from route views', () => {
    const views = [{x: 10, y: 64 * UNIT, z: 10}, {x: 5, y: 64 * UNIT, z: 0}];
    const collision = collisionFixture({ray: (origin, direction, distance) => {
      const to = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      if (origin.x > 9 || to.x > 9) return blockedRay(origin, direction, distance);
      const botZ = origin.x < to.x ? origin.z : to.z;
      return Math.abs(botZ) < .6 ? blockedRay(origin, direction, distance) : undefined;
    }});
    const quick = createPrefireBotPlan(collision, sample('a_long', 9), true, views);
    const wide = createPrefireBotPlan(collision, sample('a_long', 2), true, views);
    expect(quick).toMatchObject({kind: 'periodic-peek', intent: 'check-recover', peekStyle: 'quick'});
    expect(wide).toMatchObject({kind: 'move-out', intent: 'check-recover', peekStyle: 'wide'});
    expect(Math.hypot(quick.exposure!.x, quick.exposure!.z) / UNIT).toBeLessThanOrEqual(56);
    expect(Math.hypot(wide.exposure!.x, wide.exposure!.z) / UNIT).toBeGreaterThanOrEqual(80);
    expect(views).toContainEqual(quick.watchPoint); expect(views).toContainEqual(wide.watchPoint);
  });
  it('permits a crouched source to run only with standing-hull clearance and retained spawn concealment', () => {
    const views = [{x: 10, y: 64 * UNIT, z: 10}, {x: 5, y: 64 * UNIT, z: 0}];
    const lane = collisionFixture({ray: (origin, direction, distance) => {
      const to = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      if (origin.x > 9 || to.x > 9) return blockedRay(origin, direction, distance);
      return Math.abs(origin.x < to.x ? origin.z : to.z) < .6 ? blockedRay(origin, direction, distance) : undefined;
    }});
    const angle = {...sample('a_long', 9), crouched: true};
    expect(createPrefireBotPlan(lane, angle, true, views)).toMatchObject({kind: 'periodic-peek', travelCrouched: false});
    expect(createPrefireBotPlan({...lane, fits: (_p, _feet, height) => height < 60 * UNIT}, angle, true, views))
      .toMatchObject({kind: 'periodic-peek', travelCrouched: true});
    const standingLeak = {...lane, ray: ((origin, direction, distance) => {
      const to = {x: origin.x + direction.x * (distance + .01), y: origin.y + direction.y * (distance + .01)};
      if (origin.x > 9 && to.y > 55 * UNIT) return undefined;
      return lane.ray(origin, direction, distance);
    }) as BotCollision['ray']};
    const concealed = createPrefireBotPlan(standingLeak, angle, true, views);
    expect(concealed).toMatchObject({kind: 'periodic-peek', travelCrouched: true});
  });
  it('does not select a crouch-at-contact peek with only a standing firing sightline', () => {
    const views = [{x: 10, y: 64 * UNIT, z: 10}, {x: 5, y: 64 * UNIT, z: 0}];
    const lane = collisionFixture({ray: (origin, direction, distance) => {
      const to = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      if (origin.x > 9 || to.x > 9 || origin.x < 4 && origin.y < 50 * UNIT) return blockedRay(origin, direction, distance);
      return Math.abs(origin.x < to.x ? origin.z : to.z) < .6 ? blockedRay(origin, direction, distance) : undefined;
    }});
    const angle = {...sample('a_long', 9), source: {profile: 'a_short', index: 13}};
    expect(createPrefireBotPlan(lane, angle, true, views).kind).toBe('hold');
  });
  it('reverses a peek only when the sourced anchor can fight and the other endpoint truly hides', () => {
    const views = [{x: 10, y: 64 * UNIT, z: 10}, {x: 5, y: 64 * UNIT, z: 0}];
    const collision = collisionFixture({ray: (origin, direction, distance) => {
      const to = {x: origin.x + direction.x * (distance + .01), z: origin.z + direction.z * (distance + .01)};
      if (origin.x > 9 || to.x > 9) return blockedRay(origin, direction, distance);
      const botZ = origin.x < to.x ? origin.z : to.z;
      return Math.abs(botZ) > .6 ? blockedRay(origin, direction, distance) : undefined;
    }});
    const plan = createPrefireBotPlan(collision, sample('a_long', 9), true, views);
    expect(plan).toMatchObject({kind: 'periodic-peek', attackFromAnchor: true});
    expect(upperBodyVisible(collision, views[1], plan.exposure!, false)).toBe(false);
    expect(hasPrefireSight(collision, {...plan.anchor, y: 64 * UNIT}, views[1])).toBe(true);
  });
  it('does not reveal a covered start during an intermediate part of a candidate excursion', () => {
    const collision = collisionFixture({ray: (origin, direction, distance) => {
      const targetZ = origin.z + direction.z * (distance + .01);
      return origin.z < -4 && Math.abs(targetZ) > .6 ? undefined : blockedRay(origin, direction, distance);
    }});
    const spawn = {x: 0, y: 64 * UNIT, z: -5};
    const plan = createPrefireBotPlan(collision, sample('a_long', 2), true, [spawn]);
    // Oblique/forward candidates may be safe even though both old side steps
    // leaked. Reject the leaking lane, not every useful alternative.
    if (plan.exposure) for (let step = 0; step <= 32; step++) {
      const t = step / 32, feet = {x: plan.anchor.x + (plan.exposure.x - plan.anchor.x) * t,
        y: plan.anchor.y, z: plan.anchor.z + (plan.exposure.z - plan.anchor.z) * t};
      expect(upperBodyVisible(collision, spawn, feet, false)).toBe(false);
    }
  });
  it('normalizes sight rays and never queries degenerate eye positions', () => {
    const ray = vi.fn(collisionFixture().ray);
    expect(hasPrefireSight({ray}, anchor, anchor)).toBe(false); expect(ray).not.toHaveBeenCalled();
    expect(hasPrefireSight({ray}, anchor, {x: 3, y: 4, z: 0})).toBe(true);
    expect(ray).toHaveBeenCalledWith(anchor, {x: .6, y: .8, z: 0}, 4.99);
    expect(hasPrefireSight({ray: blockedRay}, anchor, {x: 3, y: 4, z: 0})).toBe(false);
  });
});

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('installed Dust 2 behavior planning', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    collision = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => collision?.dispose());
  it('requires actual upper-body and head-crown hiding, not merely a blocked crouched eye', () => {
    let actualHiders = 0;
    for (const route of prefireClearingRoutes) {
      const views = prefireRouteViews([route.spawn, ...route.path], collision);
      const reserved = route.angles.map(angle => placePrefireTarget(collision, angle.position, angle.crouched));
      for (const angle of route.angles) {
        const plan = createPrefireBotPlan(collision, angle, true, views, reserved);
        if (plan.kind !== 'crouch-hide') continue;
        actualHiders++;
        const qualifying = views.filter(view => hasPrefireSight(collision, {...plan.anchor, y: plan.anchor.y + 64 * UNIT}, view) &&
          !hasPrefireSight(collision, {...plan.anchor, y: plan.anchor.y + 46 * UNIT}, view));
        expect.soft(qualifying.some(view => upperBodyVisible(collision, view, plan.anchor, false) &&
          !upperBodyVisible(collision, view, plan.anchor, true)), `${route.id}/${plan.key}: crouched silhouette remains exposed`).toBe(true);
      }
    }
    expect(actualHiders).toBeGreaterThan(0);
  }, 15000);
  it('validates every selected anchor and full excursion jointly, retaining actual behavior diversity', () => {
    const counts = {'hold': 0, 'crouch-hide': 0, 'periodic-peek': 0, 'move-out': 0};
    for (const route of [...prefireRoutes, ...prefireClearingRoutes]) {
      const views = prefireRouteViews([route.spawn, ...route.path], collision);
      const reserved = route.angles.map(angle => placePrefireTarget(collision, angle.position, angle.crouched));
      for (const angle of route.angles) {
        const plan = createPrefireBotPlan(collision, angle, true, views, reserved), source = sourcePoint(angle.position);
        counts[plan.kind]++;
        expect(plan.anchor.x).toBe(source.x); expect(plan.anchor.z).toBe(source.z);
        expect(Math.abs(plan.anchor.y - source.y)).toBeLessThanOrEqual(6 * UNIT);
        if (plan.exposure) expect(validPrefireExcursion(collision, plan.anchor, plan.exposure,
          plan.travelCrouched ?? plan.sourceCrouched, reserved), plan.key).toBe(true);
        if (plan.kind === 'periodic-peek' || plan.kind === 'move-out') expect(plan.exposure, plan.key).toBeDefined();
        if (plan.kind === 'periodic-peek' || plan.kind === 'move-out') {
          const home = plan.attackFromAnchor ? plan.exposure! : plan.anchor;
          const attack = plan.attackFromAnchor ? plan.anchor : plan.exposure!;
          const yaw = angle.rotation ? (angle.rotation[1] - 90) * DEG : undefined;
          expect(plan.watchPoint, plan.key).toBeDefined();
          expect(prefirePeekLateralness(home, attack, plan.watchPoint!), `${plan.key}: walk toward/away from threat`)
            .toBeGreaterThanOrEqual(PREFIRE_MIN_PEEK_LATERALNESS);
          const duck = plan.sourceCrouched || plan.peekStyle === 'crouch';
          expect(hasPrefireSight(collision, {...attack, y: attack.y + (duck ? 46 : 64) * UNIT}, plan.watchPoint!), plan.key).toBe(true);
          expect(upperBodyVisible(collision, plan.watchPoint!, home, plan.sourceCrouched, yaw), plan.key).toBe(false);
          const length = Math.hypot(attack.x - home.x, attack.z - home.z);
          const nearHome = {x: home.x + (attack.x - home.x) / length * PREFIRE_ENDPOINT_RADIUS, y: home.y,
            z: home.z + (attack.z - home.z) / length * PREFIRE_ENDPOINT_RADIUS};
          const preaimYaw = Math.atan2(-(plan.watchPoint!.x - home.x), -(plan.watchPoint!.z - home.z));
          expect(upperBodyVisible(collision, plan.watchPoint!, nearHome, plan.sourceCrouched, preaimYaw), plan.key).toBe(false);
        }
        if (plan.kind === 'crouch-hide') {
          expect(collision.fits(plan.anchor, plan.anchor.y, 72 * UNIT), plan.key).toBe(true);
          expect(views.some(view => hasPrefireSight(collision, {...plan.anchor, y: plan.anchor.y + 64 * UNIT}, view) &&
            !hasPrefireSight(collision, {...plan.anchor, y: plan.anchor.y + 46 * UNIT}, view)), plan.key).toBe(true);
        }
      }
    }
    expect(Object.values(counts).reduce((a, b) => a + b)).toBe([...prefireRoutes, ...prefireClearingRoutes]
      .reduce((sum, route) => sum + route.angles.length, 0));
    for (const kind of Object.keys(counts) as (keyof typeof counts)[]) expect(counts[kind], JSON.stringify(counts)).toBeGreaterThan(0);
  }, 15000);
});
