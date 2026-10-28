import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {UNIT} from '../actor-physics';
import {actorHeadPoint} from '../duel/geometry';
import {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import {prefireRoutes, prefireLineup} from './routes';
import {prefireCandidates, choosePrefireAngles} from './occupancy';
import {prefireRouteViews, createPrefireBotPlan} from './bot-behavior';
import {nativeSightBlocked, walkPrefireAuditPath, auditPrefireMotorPath} from './spawn-audit';
import authored from './data/authored-dust2.json';
import combatLeads from './data/combat-dust2-leads.json';

describe('requested Pit, car, A-site, Ninja and close Catwalk coverage', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const manifest = JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    expect(manifest.build).toBe(authored.mapBuild);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(authored.collisionSha256);
    collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  },30000);

  for(const sample of combatLeads.angles)it(`combat lead ${sample.id}: source point is admitted with native cover and a hittable head`,()=>{
    const routes=prefireRoutes.filter(route=>prefireCandidates(route).some(angle=>angle.id===`duel-density:dust2/${sample.id}`));
    expect(routes.length).toBeGreaterThan(0);
    for(const route of routes) {
      const angle=prefireCandidates(route).find(angle=>angle.id===`duel-density:dust2/${sample.id}`)!;
      expect(angle.position).toEqual(sample.position);expect(angle.source?.dataset).toBe('duel-density');
      const feet=placePrefireTarget(collision,angle.position,false),head=actorHeadPoint(feet,false,0);
      expect(collision.fits(feet,feet.y,72*UNIT)).toBe(true);
      const walked=walkPrefireAuditPath(collision,[route.spawn,...route.path]);
      expect(walked.some(point=>!nativeSightBlocked(collision,{...point,y:point.y+64*UNIT},head))).toBe(true);
    }
  },30000);
  afterAll(() => collision?.dispose());

  for (const sample of authored.angles) it(`${sample.name}: admitted, supported and physically visible on an approach`, () => {
    const routes = prefireRoutes.filter(route => prefireCandidates(route).some(angle => angle.id === `spraylab:dust2/${sample.id}`));
    expect(routes.length, 'a proposal must actually be admitted to a playable course').toBeGreaterThan(0);
    for (const route of routes) {
      const angle = prefireCandidates(route).find(angle => angle.id === `spraylab:dust2/${sample.id}`)!;
      expect(angle.position).toEqual(sample.position);
      expect(angle.source?.dataset).toBe('spraylab-authored');
      const feet = placePrefireTarget(collision, angle.position, angle.crouched);
      expect(collision.fits(feet, feet.y, (angle.crouched ? 54 : 72) * UNIT)).toBe(true);
      const views = prefireRouteViews([route.spawn, ...route.path], collision);
      const plan = createPrefireBotPlan(collision, angle, false, views);
      expect(plan.watchPoint, `${route.id}: pre-aim must use a supported, visible approach`).toBeDefined();
      const yaw = Math.atan2(-(plan.watchPoint!.x - feet.x), -(plan.watchPoint!.z - feet.z));
      const head = actorHeadPoint(feet, !!angle.crouched, yaw);
      expect(walkPrefireAuditPath(collision, [route.spawn, ...route.path]).some(point =>
        !nativeSightBlocked(collision, {...point, y: point.y + 64 * UNIT}, head)), `${route.id} must expose a hittable head`).toBe(true);
    }
  },30000);

  it('starts before close Catwalk rather than excluding those angles as exposed-at-spawn', () => {
    const route = prefireRoutes.find(route => route.id === 'short-a')!;
    expect(route.startLabel).toBe('Top Mid / Catwalk approach');
    expect(route.spawn).toEqual([200,160,8]);
    const pool = prefireCandidates(route);
    expect(pool.map(angle => angle.id)).toEqual(expect.arrayContaining([
      'openprefire:a_short/3','openprefire:a_short/5','openprefire:a_short/6', 'openprefire:mid_to_b/13','openprefire:mid_to_b/14',
      'spraylab:dust2/a-ninja', 'spraylab:dust2/a-default-box-top', 'spraylab:dust2/a-ramp-short-high',
    ]));
    auditPrefireMotorPath(collision,[route.spawn,...route.path]);
  },30000);

  it('offers directly selectable five-bot focus lineups without changing the ten-approach budget', () => {
    expect(prefireRoutes).toHaveLength(10);
    for (const [routeId, lineupId, required] of [
      ['long-doors','long-pit-floor','spraylab:dust2/pit-slope'],
      ['long-a','long-car-variations','spraylab:dust2/car-back-edge'],
      ['short-a','catwalk-close','openprefire:mid_to_b/14'],
      ['short-a','short-a-ninja-ramp','spraylab:dust2/a-ninja'],
    ]) {
      const route = prefireRoutes.find(route => route.id === routeId)!;
      const lineup = prefireLineup(route,lineupId);
      expect(lineup.angles.some(angle => angle.id === required), lineupId).toBe(true);
      expect(choosePrefireAngles(lineup,'all',()=>0)).toHaveLength(5);
    }
  });
});
