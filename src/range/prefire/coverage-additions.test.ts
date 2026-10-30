import {dust2Catalog} from './routes';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {UNIT} from '../actor-physics';
import {defaults} from '../config';
import {actorHeadPoint} from '../duel/geometry';
import {resolveBulletRay} from '../duel/penetration';
import {createPrefireBotPlan, prefireRouteViews} from './bot-behavior';
import {sanitizePrefireConfig} from './config';
import {NativeMapCollision} from './native-collision';
import {prefireCandidates} from './occupancy';
import {placePrefireTarget} from './placement';
import {prefireRoutes, sourcePoint} from './routes';
import {PrefireSimulation} from './session';
import {nativeSightBlocked, walkPrefireAuditPath} from './spawn-audit';

const additions = [['mid-doors', 'openprefire:mid_to_b/20'], ['mid-doors', 'openprefire:mid_to_b/21'],
  ['upper-tunnels', 'openprefire:b_tunnel/1'], ['upper-tunnels', 'openprefire:b_tunnel/5'],
  ['mid-doors', 'openprefire:mid_to_b/24'], ['mid-doors', 'openprefire:mid_to_b/24:standing'],
  ['mid-doors', 'openprefire:mid_to_b/25'], ['long-a', 'openprefire:a_short/11'],
  ['long-a', 'openprefire:a_short/14'], ['a-retake', 'openprefire:a_short/11'],
  ['short-a', 'retakes:dust2/17'], ['b-tunnels', 'retakes:dust2/13'],
  ['b-tunnels', 'openprefire:b_tunnel/24'], ['b-tunnels', 'retakes:dust2/15']] as const;

describe('CT and site coverage in native Dust 2, including route-facing physical heads', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const manifest = JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.collisionSha256);
    collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => collision?.dispose());

  it('provides a genuinely standing CT-box headglitch rather than an uncovered body on the floor', () => {
    const route = prefireRoutes.find(route => route.id === 'mid-doors')!;
    const angle = prefireCandidates(route).find(angle => angle.id === 'openprefire:mid_to_b/24:standing')!;
    expect(angle.crouched).toBe(false);
    expect(angle.source?.stanceOverride).toBe('standing');
    const feet = placePrefireTarget(collision, angle.position);
    const views = prefireRouteViews([route.spawn, ...route.path], collision);
    const plan = createPrefireBotPlan(collision, angle, true, views);
    expect(plan.kind).toBe('hold');
    expect(plan.sourceCrouched).toBe(false);
    const yaw = Math.atan2(-(plan.watchPoint!.x - feet.x), -(plan.watchPoint!.z - feet.z));
    const head = actorHeadPoint(feet, false, yaw);
    const torso = [34,42,50,56].flatMap(height => [-12,0,12].map(x =>
      ({...feet, x: feet.x + x * UNIT, y: feet.y + height * UNIT})));
    const headOnly = walkPrefireAuditPath(collision, [route.spawn, ...route.path]).filter((_,i) => i % 4 === 0)
      .map(point => ({...point, y: point.y + 64 * UNIT}))
      .filter(eye => !nativeSightBlocked(collision, eye, head) && torso.every(point => nativeSightBlocked(collision, eye, point)));
    expect(headOnly.length, 'standing head visible while upper-body samples remain behind native cover').toBeGreaterThan(0);
    expect(collision.fits(feet, feet.y, 72 * UNIT)).toBe(true);
  },30000);

  for (const [routeId, angleId] of additions) it(`${routeId}/${angleId}: supported, hittable and facing its authored approach`, () => {
    const route = prefireRoutes.find(route => route.id === routeId)!;
    const angle = prefireCandidates(route).find(angle => angle.id === angleId)!;
    expect(angle, 'must be accepted, not merely proposed').toBeDefined();
    const source = structuredClone(angle), feet = placePrefireTarget(collision, angle.position, angle.crouched);
    const views = prefireRouteViews([route.spawn, ...route.path], collision);
    const plan = createPrefireBotPlan(collision, angle, false, views);
    expect(plan.watchPoint, 'native route must supply a reachable pre-aim view').toBeDefined();
    const map = {scene: new THREE.Group(), collision, settle: (point: Parameters<typeof placePrefireTarget>[1]) => placePrefireTarget(collision, point), dispose() {}};
    const sim = new PrefireSimulation(map, sanitizePrefireConfig({population: 'all', botBehavior: 'static', returnFire: false}),
      {...route, angles: [angle], alternatives: [], lineups: undefined}, 42, defaults, undefined, dust2Catalog);
    const [player, bot] = sim.actors;
    const yaw = (a: typeof player.position, b: typeof player.position) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
    expect(player.yaw).toBeCloseTo(yaw(player.position, sourcePoint(route.look)), 10);
    expect(bot.yaw).toBeCloseTo(yaw(bot.position, plan.watchPoint!), 10);
    expect(bot.pitch).toBeCloseTo(Math.atan2(plan.watchPoint!.y - bot.position.y,
      Math.hypot(plan.watchPoint!.x - bot.position.x, plan.watchPoint!.z - bot.position.z)), 10);
    const head = actorHeadPoint(feet, !!angle.crouched, bot.yaw);
    expect(walkPrefireAuditPath(collision, [route.spawn, ...route.path]).some(point => {
      const origin = {...point, y: point.y + 64 * UNIT}, d = Math.hypot(head.x - origin.x, head.y - origin.y, head.z - origin.z);
      const result = resolveBulletRay({origin, direction: {x: (head.x - origin.x) / d, y: (head.y - origin.y) / d, z: (head.z - origin.z) / d},
        range: d + 1, equipment: 'ak47', arena: {solids: [], native: collision}, actors: [bot], shooterId: 0, shooterSide: 'player'});
      return result.hits.some(hit => hit.actorId === bot.id && hit.group === 'head');
    }), 'route-facing physical head must be hittable, not only an unrotated center ray').toBe(true);
    const initial = {...bot.position}, facing = bot.yaw;
    sim.start();
    for (let tick = 0; tick < 256; tick++) sim.step();
    expect(bot.grounded).toBe(true);
    expect(bot.position.x).toBeCloseTo(initial.x, 5); expect(bot.position.z).toBeCloseTo(initial.z, 5);
    expect(bot.yaw).toBe(facing);
    expect(angle).toEqual(source);
  }, 30000);
});
