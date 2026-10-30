import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {defaults} from '../config';
import {PrefireSession, PrefireSimulation} from './session';
import {sanitizePrefireConfig} from './config';
import {dust2Catalog, sourcePoint, type PrefireRoute} from './routes';
import type {PrefireMap} from './map';
import type {NativeMapCollision} from './native-collision';
import type {PrefireCatalog} from './schema';
import {DEG, STEP, UNIT, type Vec} from '../actor-physics';
import {actorHeadPoint} from '../duel/geometry';
import {loadAngleDiagnoses, loadPrefireHistory} from './training-log';
import {legacyNativeMapId, nativeMaps} from './maps';

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});

const route: PrefireRoute = {id: 'long-doors', name: 'Test angle', spawn: [0, 0, 0], look: [0, 200, 0], path: [[0, 100, 0]],
  angles: [{name: 'First', position: [0, 200, 0], peek: [60, 200, 0]}, {name: 'Second', position: [200, 400, 0]}]};
function flatMap(blocked = false): PrefireMap {
  return {scene: new THREE.Group(), dispose() {}, settle: sourcePoint,
    collision: {bounds: {minX: -68, maxX: 55, minZ: -95, maxZ: 36}, fits: () => true, sweep: (_from: any, to: any) => ({position: to, fraction: 1, startSolid: false}),
      vertical: (_p: any, _from: number, to: number) => ({feet: Math.max(0, to), grounded: to <= 0, ceiling: false}),
      ray: () => blocked ? {distance: 1, normal: {x: 0, y: 0, z: 1}, surfaceId: 0} : undefined} as unknown as NativeMapCollision};
}
function simulate(sim: PrefireSimulation, seconds: number) {
  sim.start(); const events = [];
  while (sim.time < seconds && sim.phase === 'fighting') {sim.step(); events.push(...sim.drainEvents());}
  return events;
}
describe('prefire scenarios use shared weapon and movement simulation', () => {
  it.each([
    undefined, null, {},
    {minX: NaN, maxX: 55, minZ: -95, maxZ: 36},
    {minX: -68, maxX: Infinity, minZ: -95, maxZ: 36},
    {minX: -68, maxX: 55, minZ: -Infinity, maxZ: 36},
    {minX: -68, maxX: 55, minZ: -95, maxZ: NaN},
    {minX: 55, maxX: -68, minZ: -95, maxZ: 36},
    {minX: -68, maxX: -68, minZ: -95, maxZ: 36},
    {minX: -68, maxX: 55, minZ: 36, maxZ: -95},
    {minX: -68, maxX: 55, minZ: 36, maxZ: 36},
  ])('rejects missing or invalid native bounds without querying collision: %j', bounds => {
    const map = flatMap(); Object.assign(map.collision, {bounds});
    const fits = vi.spyOn(map.collision, 'fits'), ray = vi.spyOn(map.collision, 'ray');
    expect(() => new PrefireSimulation(map, sanitizePrefireConfig({}), route, 42, defaults, undefined, dust2Catalog))
      .toThrow('Prefire requires finite native collision bounds');
    expect(fits).not.toHaveBeenCalled(); expect(ray).not.toHaveBeenCalled();
  });
  it('uses the supplied native bounds unchanged', () => {
    const map = flatMap(), bounds = {minX: -12, maxX: 25, minZ: -30, maxZ: 9};
    Object.assign(map.collision, {bounds});
    const sim = new PrefireSimulation(map, sanitizePrefireConfig({}), route, 42, defaults, undefined, dust2Catalog);
    expect(sim.arena).toMatchObject(bounds);
    expect(map.collision.bounds).toBe(bounds);
  });
  it('isolates colliding routes, diagnoses, history and practice keys by map, revision and collision', () => {
    expect(nativeMaps.has('synthetic')).toBe(false);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value)});
    const make = (id: string, revision = 'r1', geometry = 'geometry') => {
      const catalog: PrefireCatalog = {id, name: id, revision, routes: [route], sources: []};
      const map = flatMap(); Object.assign(map.collision, {build: 'build', collisionSha256: geometry});
      return new PrefireSession(map, sanitizePrefireConfig({mapId: id, routeId: route.id, routeGuide: false, population: 'all'}, catalog), catalog);
    };
    const first = make(legacyNativeMapId), other = make('synthetic');
    const a = first.create(defaults, 1), b = other.create(defaults, 1);
    expect(other.mapId).toBe('synthetic'); expect(b.config.mapId).toBe('synthetic');
    expect(a.config.mapId).toBe(legacyNativeMapId);
    expect(b.replay.export().setup?.config.mapId).toBe('synthetic');
    b.start(); b.step();
    expect(b.replay.export().setup?.config.mapId).toBe('synthetic');
    expect(first.activeKey).not.toBe(other.activeKey);
    expect(first.practiceKey(defaults)).not.toBe(other.practiceKey(defaults));
    for (const sim of [a, b]) vi.spyOn(sim.coach, 'review').mockReturnValue({...sim.coach.review(), angles: route.angles.map((angle, index) => ({
      id: index + 1, name: angle.name, cleared: false, shots: 1, openingStopped: false, readyAim: null,
      entry: true, openingHit: false, openingHead: false, threats: 1, contactToHitMs: null, message: 'Moving', tip: 'Brake',
    }))});
    a.phase = b.phase = 'result'; a.outcome = b.outcome = 'won';
    first.report(a); other.report(b);
    expect(loadPrefireHistory()).toHaveLength(2);
    expect(loadAngleDiagnoses()).toHaveLength(4);
    expect(make('synthetic').diagnoses).toHaveLength(2);
    expect(make('synthetic', 'r2').diagnoses).toHaveLength(0);
    expect(make('synthetic', 'r1', 'new-geometry').diagnoses).toHaveLength(0);
    expect(() => other.configure(first.config)).toThrow('map identity mismatch');
    const revised = make('synthetic', 'r2'); revised.create(defaults, 1);
    expect(revised.activeKey).not.toBe(other.activeKey);
  });
  it.each(['footstep', 'landing', 'gunshot'] as const)('ignores allied %s before Prefire hearing and contact memory', sound => {
    const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({population: 'all', botBehavior: 'static'}), route, 42, defaults, undefined, dust2Catalog);
    const hear = vi.spyOn(sim as any, 'hearBot');
    for (const teammate of sim.actors.slice(1)) sim['informHearing'](teammate, teammate.position, sound);
    expect(hear).not.toHaveBeenCalled();
    expect(sim['lastContactAt'].size).toBe(0);
    sim['informHearing'](sim.actors[0], sim.actors[0].position, sound);
    expect(hear).toHaveBeenCalledTimes(2);
    expect(sim['lastContactAt'].size).toBe(2);
    expect(sim.prefireBotDecision(1)?.visible).not.toBe(true);
  });

  it('retains only unfinished floor directions and updates their GPU data only at checkpoints', () => {
    const map = flatMap(), config = sanitizePrefireConfig({population:'all',routeGuide:true,navigationHints:false});
    const path = {...route,path:[[0,100,0],[200,100,0]] as const};
    const catalog:PrefireCatalog={id:'fixture',name:'Fixture',revision:'1',routes:[path],sources:[]};
    const session=new PrefireSession(map,{...config,mapId:catalog.id},catalog),sim=session.create(defaults,42);
    session.report(sim);
    const arrows=session.scene.getObjectByName('prefire-guide-arrows') as THREE.InstancedMesh;
    const line=session.scene.getObjectByName('prefire-guide-line') as THREE.Line;
    const count=arrows.count,version=arrows.instanceMatrix.version;
    session.report(sim);expect(arrows.instanceMatrix.version).toBe(version);
    Object.assign(sim.actors[0],{feet:0,position:{...sourcePoint(path.path[0]),y:64*UNIT}});
    expect(session.report(sim).navigation?.waypoint).toBe(2);
    expect(arrows.count).toBeLessThan(count);expect(arrows.count).toBeGreaterThan(0);
    expect(line.geometry.drawRange.start).toBeGreaterThan(0);
    const updated=arrows.instanceMatrix.version;
    session.report(sim);expect(arrows.instanceMatrix.version).toBe(updated);
    Object.assign(sim.actors[0],{feet:0,position:{...sourcePoint(path.path[1]),y:64*UNIT}});
    expect(session.report(sim).navigation?.complete).toBe(true);
    expect(arrows.count).toBe(0);expect(line.geometry.drawRange.count).toBe(0);
    const next=session.create(defaults,43);
    const fresh=session.scene.getObjectByName('prefire-guide-arrows') as THREE.InstancedMesh;
    expect(fresh.count).toBe(count);
    session.report(sim);expect(fresh.count).toBe(count);
    expect(session.report(next).navigation?.complete).toBe(false);
  });
  it('reports ordered route navigation and disposes replaced floor arrow resources', () => {
    const map = flatMap(), config = sanitizePrefireConfig({population:'all',routeGuide:true});
    const catalog: PrefireCatalog = {id:'fixture',name:'Fixture',revision:'1',routes:[route],sources:[]};
    const session = new PrefireSession(map,{...config,mapId:catalog.id},catalog), sim = session.create(defaults,42);
    expect(session.report(sim).navigation).toMatchObject({waypoint:1,total:1,complete:false,destination:'Test angle'});
    const guide = session.scene.children.find(child => child !== map.scene)!;
    const arrows = guide.children.find(child => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    expect(arrows.count).toBeGreaterThan(0);
    const geometry = vi.spyOn(arrows.geometry,'dispose'), material = vi.spyOn(arrows.material as THREE.Material,'dispose');
    sim.actors[0].position = {...sourcePoint(route.path[0]),y:64*UNIT}; sim.actors[0].feet = 0;
    expect(session.report(sim).navigation?.complete).toBe(true);
    session.configure({...config,mapId:catalog.id,routeGuide:false});
    const reset = session.create(defaults,43);
    expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce();
    expect(guide.visible).toBe(false);
    expect(session.report(reset).navigation?.complete).toBe(false);
  });
  it.each([[false, true, false], [true, false, false], [true, true, true]])(
    'gates shared death trading on return fire=%s and preference=%s', (returnFire, tradeEnabled, expected) => {
      const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({returnFire, tradeEnabled}), route, 7, defaults, undefined, dust2Catalog);
      expect(sim.config.tradeEnabled).toBe(expected);
    });
  it('Static targets neither roam nor fire with combat off', () => {
    const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({population: 'all', movingBots: false}), route, 42, defaults, undefined, dust2Catalog);
    const start = sim.snapshot().slice(1).map(a => ({...a.position}));
    const events = simulate(sim, 2);
    expect(sim.snapshot().slice(1).map(a => a.position)).toEqual(start);
    expect(events.filter(e => e.kind === 'fire')).toHaveLength(0);
    expect(sim.actors[0].weapon.id).toBe(defaults.weapon);
    sim.equipPlayer(2);
    expect(sim.actors[0].weapon.id).toBe(defaults.sidearm);
  });
  it('authored peeks do not manufacture a cover cycle on an entirely open flat map', () => {
    const authored = {...route, angles: [{...route.angles[0], source: {profile: 'a_long', index: 2}}, route.angles[1]]};
    const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({population: 'all', movingBots: true}), authored, 7, defaults, undefined, dust2Catalog);
    const start = sim.snapshot().slice(1).map(a => ({...a.position}));
    simulate(sim, 2);
    expect(sim.actors[1].position).toEqual(start[0]);
    expect(sim.actors[2].position).toEqual(start[1]);
  });
  it('preserves sampled crouched stance and coordinates while facing the authored approach, not a hidden live player', () => {
    const sample: PrefireRoute = {...route, angles: [{name: 'Crouched holder', position: [0, 200, 0], crouched: true, rotation: [5, 180, 0]}]};
    const map = flatMap(), sim = new PrefireSimulation(map, sanitizePrefireConfig({movingBots: false}), sample, 7, defaults, undefined, dust2Catalog);
    const yaw = sim.actors[1].yaw, pitch = sim.actors[1].pitch;
    expect(Math.abs(yaw)).toBeCloseTo(Math.PI, 10);
    expect(pitch).toBeCloseTo(Math.atan2(18, 200), 10);
    expect(sample.angles[0].rotation).toEqual([5, 180, 0]);
    expect(sim.actors[1].eyeHeight).toBe(46 * UNIT);
    map.collision.ray = () => ({distance: 1, normal: {x: 0, y: 0, z: 1}, surfaceId: 0});
    sim.actors[0].position.x = 15;
    simulate(sim, 2);
    expect(sim.actors[1].duckAmount).toBe(1);
    expect(sim.actors[1].yaw).toBeCloseTo(yaw, 10);
    expect(sim.actors[1].pitch).toBeCloseTo(pitch, 10);
  });
  it('does not start a return-fire timer for a player behind the held angle', () => {
    const sample: PrefireRoute = {...route, angles: [{name: 'Away', position: [0, 200, 0], rotation: [0, 90, 0]}]};
    const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({returnFire: true}), sample, 7, defaults, undefined, dust2Catalog);
    sim.actors[0].position.z = -12;
    expect(simulate(sim, 2).some(event => event.kind === 'fire')).toBe(false);
    expect(Math.abs(sim.actors[1].yaw)).toBeCloseTo(Math.PI, 10);
  });
  it('return fire waits for continuous visibility and the configured delay', () => {
    const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({movingBots: false, returnFire: true, reactionMs: 1000}), route, 5, defaults, undefined, dust2Catalog);
    sim.actors[0].health = 10000;
    expect(simulate(sim, .95).some(e => e.kind === 'fire')).toBe(false);
    expect(simulate(sim, 2).some(e => e.kind === 'fire' && e.actorId > 0)).toBe(true);
    const hidden = new PrefireSimulation(flatMap(true), sim.practice, route, 5, defaults, undefined, dust2Catalog);
    expect(simulate(hidden, 2).some(e => e.kind === 'fire')).toBe(false);
  });
  it('drops contact through cover and requires a full reaction after reacquiring', () => {
    const map = flatMap(), originalRay = map.collision.ray;
    const sim = new PrefireSimulation(map, sanitizePrefireConfig({botBehavior: 'static', returnFire: true, reactionMs: 500}),
      {...route, angles: [route.angles[0]]}, 5, defaults, undefined, dust2Catalog);
    sim.actors[0].health = 10000;
    simulate(sim, .35);
    map.collision.ray = () => ({distance: 1, normal: {x: 0, y: 0, z: 1}, surfaceId: 0});
    expect(simulate(sim, .8).some(e => e.kind === 'fire')).toBe(false);
    expect(sim.prefireBotDecision(1)?.visible).toBe(false);
    map.collision.ray = originalRay;
    expect(simulate(sim, 1.2).some(e => e.kind === 'fire')).toBe(false);
    expect(simulate(sim, 1.7).some(e => e.kind === 'fire')).toBe(true);
  });
  it('never emits a pending shot when a wall appears on a firing tick', () => {
    const map = flatMap();
    const sim = new PrefireSimulation(map, sanitizePrefireConfig({botBehavior: 'static', returnFire: true, reactionMs: 300}),
      {...route, angles: [route.angles[0]]}, 17, defaults, undefined, dust2Catalog);
    sim.actors[0].health = 10000;
    expect(simulate(sim, .6).some(e => e.kind === 'fire')).toBe(true);
    map.collision.ray = () => ({distance: 1, normal: {x: 0, y: 0, z: 1}, surfaceId: 0});
    expect(simulate(sim, 2).some(e => e.kind === 'fire')).toBe(false);
  });
  it('fires finite bursts separated by quiet periods rather than continuous full-auto', () => {
    const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({botBehavior: 'static', returnFire: true, reactionMs: 300}),
      {...route, angles: [route.angles[0]]}, 17, defaults, undefined, dust2Catalog);
    sim.actors[0].health = 10000;
    const shots = simulate(sim, 4).filter(e => e.kind === 'fire');
    expect(shots.length).toBeGreaterThan(4);
    const gaps = shots.slice(1).map((e, i) => (e.tick - shots[i].tick) * STEP);
    expect(gaps.some(gap => gap > .4)).toBe(true);
    expect(shots.length).toBeLessThan(24);
  });
  it('uses shared reload timing and never shoots while reloading', () => {
    const sim = new PrefireSimulation(flatMap(), sanitizePrefireConfig({botBehavior: 'static', returnFire: true, reactionMs: 300}),
      {...route, angles: [route.angles[0]]}, 17, defaults, undefined, dust2Catalog);
    sim.actors[0].health = 10000; sim.actors[1].weapon.ammo = 0;
    sim.actors[1].inventory.delete('usp');
    const events = simulate(sim, 1);
    expect(events.some(e => e.kind === 'action' && e.action === 'reload-start')).toBe(true);
    expect(events.some(e => e.kind === 'fire')).toBe(false);
    expect(sim.actors[1].weapon.reloadUntil).toBeGreaterThan(sim.time);
    expect(simulate(sim, 5).some(e => e.kind === 'fire')).toBe(true);
  });
  it('turns toward a seen player but does not track their movement behind cover', () => {
    const map = flatMap();
    const sim = new PrefireSimulation(map, sanitizePrefireConfig({botBehavior: 'static', returnFire: true, reactionMs: 2500}),
      {...route, angles: [{...route.angles[0], rotation: [0, 230, 0]}]}, 17, defaults, undefined, dust2Catalog);
    const start = sim.actors[1].yaw;
    sim.actors[0].position.x = 1;
    simulate(sim, .3);
    expect(sim.actors[1].yaw).toBeGreaterThan(start);
    const player = sim.actors[0], bot = sim.actors[1];
    const observedHead = actorHeadPoint({...player.position, y: player.feet}, player.duckAmount ?? 0, player.yaw);
    const expectedYaw = Math.atan2(-(observedHead.x - bot.position.x), -(observedHead.z - bot.position.z));
    const referenceMap = flatMap(), reference = new PrefireSimulation(referenceMap, sim.practice,
      {...route, angles: [{...route.angles[0], rotation: [0, 230, 0]}]}, 17, defaults, undefined, dust2Catalog);
    reference.actors[0].position.x = 1; simulate(reference, .3);
    map.collision.ray = () => ({distance: 1, normal: {x: 0, y: 0, z: 1}, surfaceId: 0});
    referenceMap.collision.ray = map.collision.ray;
    sim.actors[0].position.x = 15;
    reference.actors[0].position.x = -15;
    simulate(sim, 1); simulate(reference, 1);
    expect(sim.prefireBotDecision(1)?.visible).toBe(false);
    expect(sim.actors[1].yaw).toBe(reference.actors[1].yaw);
    expect(sim.actors[1].pitch).toBe(reference.actors[1].pitch);
    expect(Math.abs(Math.atan2(Math.sin(bot.yaw - expectedYaw), Math.cos(bot.yaw - expectedYaw)))).toBeLessThan(.1 * DEG);
    simulate(sim, 13);
    expect(Math.abs(bot.yaw - start)).toBeLessThan(.1 * DEG);
  });
  it('keeps paused controller ticks ray-free and restores awareness on resume', () => {
    const map = flatMap(), sim = new PrefireSimulation(map, sanitizePrefireConfig({botBehavior: 'static'}), route, 17, defaults, undefined, dust2Catalog);
    const ray = vi.spyOn(map.collision, 'ray');
    sim.start(); sim.pause(); const state = sim.snapshot();
    for (let i = 0; i < 128; i++) sim.step();
    expect(sim.time).toBe(0); expect(sim.snapshot()).toEqual(state); expect(ray).not.toHaveBeenCalled();
    sim.resume(); sim.step(); expect(sim.time).toBe(STEP); expect(ray).toHaveBeenCalled();
  });
  it('random population is repeatable, bounded and never empty', () => {
    const config = sanitizePrefireConfig({population: 'random'});
    for (let seed = 0; seed < 12; seed++) {
      const a = new PrefireSimulation(flatMap(), config, route, seed, defaults, undefined, dust2Catalog);
      const b = new PrefireSimulation(flatMap(), config, route, seed, defaults, undefined, dust2Catalog);
      expect(a.actors.length).toBeGreaterThanOrEqual(2);
      expect(a.snapshot()).toEqual(b.snapshot());
    }
  });
  it('places weighted alternatives with exact source stance/coordinates and watches their authored approach', () => {
    const expanded: PrefireRoute = {...route, alternatives: [{id: 'alternate', name: 'Alternate crouched',
      position: [-200, 400, 0], crouched: true, rotation: [7, 180, 0]}]};
    const all = new PrefireSimulation(flatMap(), sanitizePrefireConfig({population: 'all'}), expanded, 42, defaults, undefined, dust2Catalog);
    expect(all.actors).toHaveLength(3);
    const random = new PrefireSimulation(flatMap(), sanitizePrefireConfig({population: 'random', botsPerRun: 3,
      botBehavior: 'static'}), expanded, 42, defaults, undefined, dust2Catalog);
    expect(random.actors).toHaveLength(4);
    const alternate = random.actors[3];
    expect(alternate.position.x).toBe(-200 * UNIT); expect(alternate.position.z).toBe(-400 * UNIT);
    expect(alternate.duckAmount).toBe(1);
    expect(alternate.yaw).toBeCloseTo(Math.atan2(-200, -400), 10);
    expect(alternate.pitch).toBeCloseTo(Math.atan2(18, Math.hypot(200, 400)), 10);
    expect(expanded.alternatives![0].rotation).toEqual([7, 180, 0]);
    expect(random.prefireBotDecision(3)).toMatchObject({key: 'local:-200,400,0', kind: 'hold'});
  });
  it('advances only after a completed win, and explicit selection remains authoritative', () => {
    const session = new PrefireSession(flatMap(), sanitizePrefireConfig({}), dust2Catalog);
    session.beforeRestart('lost', true); expect(session.routeIndex).toBe(0);
    session.beforeRestart('won', false); expect(session.routeIndex).toBe(0);
    session.beforeRestart('won', true); expect(session.routeIndex).toBe(1);
    session.select('long-doors'); expect(session.routeIndex).toBe(0);
    session.configure(sanitizePrefireConfig({autoAdvance: false}));
    session.beforeRestart('won', true); expect(session.routeIndex).toBe(0);
    session.select('not-a-course'); expect(session.routeIndex).toBe(0);
  });
  it('forwards the current view to optional native visibility culling', () => {
    const map = flatMap(), points: Vec[] = [], point = {x: 2, y: 3, z: 4};
    map.updateVisibility = position => points.push(position);
    new PrefireSession(map, sanitizePrefireConfig({}), dust2Catalog).updateView(point);
    expect(points).toEqual([point]);
    expect(() => new PrefireSession(flatMap(), sanitizePrefireConfig({}), dust2Catalog).updateView(point)).not.toThrow();
  });
  it('keeps readable Prefire review timing separate from the short Duel round delay', () => {
    const session = new PrefireSession(flatMap(), sanitizePrefireConfig({reviewSeconds: 8}), dust2Catalog);
    expect(session.feedbackSeconds()).toBe(8);
    session.configure(sanitizePrefireConfig({reviewSeconds: 99})); expect(session.feedbackSeconds()).toBe(10);
  });
  it('uses a future map catalog without falling back to Dust 2 courses or names', () => {
    const courses = [{...route, id: 'other-entry'}, {...route, id: 'other-retake'}];
    const catalog: PrefireCatalog = {id: 'future-map', name: 'Future Map', revision: 'fixture-1', routes: courses, sources: []};
    const config = sanitizePrefireConfig({mapId: catalog.id, routeId: 'other-retake', population: 'all', routeGuide: false}, catalog);
    const session = new PrefireSession(flatMap(), config, catalog);
    expect(session.name).toBe('Future Map Prefire'); expect(session.routes).toBe(courses);
    expect(session.create(defaults, 42).route.id).toBe('other-retake');
    session.beforeRestart('won', true); expect(session.create(defaults, 42).route.id).toBe('other-entry');
    session.select('long-doors'); expect(session.routeIndex).toBe(0);
    session.configure({...config, routeId: 'unknown'}); expect(session.config.routeId).toBe('other-entry');
    expect(() => new PrefireSession(flatMap(), config, {...catalog, routes: []})).toThrow('at least one validated course');
  });
  it('rejects density from a different map rather than applying coincident coordinates', () => {
    const catalog: PrefireCatalog = {id: 'future-map', name: 'Future Map', revision: 'fixture-1', routes: [route], sources: [],
      density: {schemaVersion: 1, mapId: 'de_dust2', source: {url: 'fixture', revision: 'fixture', author: 'fixture', license: 'fixture'},
        sample: {matches: 1, rounds: 1, povs: 10}, cells: [{position: route.angles[0].position, side: 'ct', context: 'preplant',
          episodeAnchors: 10000, seconds: 10000, rounds: 1, matches: 1}]}};
    const practice = sanitizePrefireConfig({mapId: catalog.id, routeGuide: false}, catalog);
    const session = new PrefireSession(flatMap(), practice, catalog);
    for (let seed = 0; seed < 24; seed++) {
      expect(session.create(defaults, seed).snapshot()).toEqual(new PrefireSimulation(flatMap(), practice, route, seed, defaults, undefined, dust2Catalog).snapshot());
    }
  });
});
