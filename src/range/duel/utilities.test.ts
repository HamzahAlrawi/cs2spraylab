import {describe, expect, it, vi} from 'vitest';
import {NATIVE_INFERNO} from './inferno-native';
import type {Vec} from '../actor-physics';
import {testArena, type Arena} from './geometry';
import {utilityKinds} from './utility-loadout';
import {UtilitySimulation, UTILITY_RULES as R, utilityLaunchVelocity, smokeSegmentExposure,
  type UtilityActor, type UtilityEffect, type UtilityEvent, type UtilityKind} from './utilities';

const p = (x = 0, y = 0, z = 0): Vec => ({x, y, z});
const actor = (id = 2, at = p(0, 0, 1), extra: Partial<UtilityActor> = {}): UtilityActor => ({
  id, side: 'enemy', position: {...at, y: at.y + 64 * .0254}, feet: at.y, yaw: 0, pitch: 0, alive: true, armor: 0, ...extra,
});
function drop(sim: UtilitySimulation, kind: UtilityKind, origin = p(0, .08), time = 0) {
  return sim.throw({actorId: 1, side: 'player', kind, origin, direction: p(0, -1),
    velocity: p(0, R.throwSpeed * .3 / 1.25), strength: 0, time});
}
function run(sim: UtilitySimulation, seconds: number, arena = testArena(), actors: readonly UtilityActor[] = [], start = 0, frame = .125) {
  const events: UtilityEvent[] = [];
  for (let t = start; t < start + seconds - 1e-9;) {
    const dt = Math.min(frame, start + seconds - t); t += dt;
    events.push(...sim.advance(dt, t, arena, actors));
  }
  return events;
}
const wall = {center: p(.5, 2), size: p(.1, 4, 20)};
const damageEvents = (events: UtilityEvent[]) => events.filter(e => e.type === 'damage');
const smoke = (extra: Partial<UtilityEffect> = {}): UtilityEffect => ({id: 1, actorId: 1, side: 'player',
  kind: 'smoke', type: 'smoke', position: p(0, 1), radius: 4, startedAt: 0, expiresAt: 20, cells: [], holes: [], ...extra});

describe('utility launch and deterministic lifecycle', () => {
  it('uses the documented full/lob launch speed, inherited motion and no hidden offsets', () => {
    const inherited=utilityLaunchVelocity(p(10),1,p(1,2,3));
    expect(inherited.x).toBeCloseTo(R.throwSpeed+1.25,5);expect(inherited.y).toBeCloseTo(2.5,5);expect(inherited.z).toBeCloseTo(3.75,5);
    expect(utilityLaunchVelocity(p(1), 0).x).toBeCloseTo(R.throwSpeed * .3);
    expect(utilityLaunchVelocity(p(1), -10)).toEqual(utilityLaunchVelocity(p(1), 0));
    expect(utilityLaunchVelocity(p(), 1)).toEqual(p());
    const sim = new UtilitySimulation();
    const origin = p(1, 2, 3);
    sim.throw({actorId: 1, side: 'player', kind: 'he', origin, direction: p(1), strength: 1, time: 0});
    origin.x = 99;
    expect(sim.projectiles[0].position).toEqual(p(1, 2, 3));
    sim.advance(R.step, R.step, testArena(), []);
    expect(sim.projectiles[0].position.y).toBeCloseTo(2 - .5 * R.gravity * R.step ** 2);
  });
  it.each(utilityKinds)('detonates %s and removes all projectiles/effects within bounded time', kind => {
    const sim = new UtilitySimulation(3);
    drop(sim, kind);
    const events = run(sim, 30);
    expect(events.some(e => e.type === 'detonate' && e.kind === kind)).toBe(true);
    expect(sim.projectiles).toHaveLength(0); expect(sim.effects).toHaveLength(0);
  });
  it('is independent of render frame partitioning at the fixed physics tick', () => {
    const a = new UtilitySimulation(90), b = new UtilitySimulation(90);
    for (const sim of [a, b]) {drop(sim, 'he', p(0, 2)); drop(sim, 'decoy', p(3, .08));}
    const eventsA = run(a, 4, testArena(), [actor()], 0, .125);
    const eventsB = run(b, 4, testArena(), [actor()], 0, .0625);
    expect(eventsA).toEqual(eventsB); expect(a.snapshot()).toEqual(b.snapshot());
  });
  it('supports future release times without moving a projectile before release', () => {
    const sim = new UtilitySimulation(); drop(sim, 'he', p(0, 2), .5);
    run(sim, .5); expect(sim.projectiles[0].position).toEqual(p(0, 2));
    expect(run(sim, 1.75, testArena(), [], .5).some(e => e.type === 'detonate')).toBe(true);
  });
  it('resets IDs, entities, clock and seeded decoy rhythm', () => {
    const sim = new UtilitySimulation(5); drop(sim, 'decoy');
    const first = run(sim, 3); sim.reset(); drop(sim, 'decoy');
    expect(run(sim, 3)).toEqual(first);
  });
  it('bounds throws, snapshots, smoke holes and suspension catch-up', () => {
    const sim = new UtilitySimulation();
    for (let i = 0; i < R.maxProjectiles; i++) expect(drop(sim, 'he')).toBeDefined();
    expect(drop(sim, 'he')).toBeUndefined();
    const snapshot = sim.snapshot(); snapshot.projectiles[0].position.x = 900;
    expect(sim.projectiles[0].position.x).toBe(0);
    const events = sim.advance(60, 60, testArena(), [actor()]);
    expect(events.length).toBeLessThanOrEqual(R.maxEvents);
    expect(damageEvents(events)).toHaveLength(0); expect(sim.projectiles).toHaveLength(0);
    sim.reset(); drop(sim, 'smoke'); run(sim, 2);
    for (let i = 0; i < 100; i++) sim.clearSmokeSegment(p(-5, 1), p(5, 1), 2);
    expect(sim.effects[0].holes).toHaveLength(R.maxHoles);
    sim.advance(60, 62, testArena(), []); expect(sim.effects).toHaveLength(0);
  });
  it('rejects invalid input and noncontiguous/reversed clocks without poisoning state', () => {
    const sim = new UtilitySimulation();
    expect(drop(sim, 'he', p(NaN))).toBeUndefined();
    expect(sim.throw({actorId: 1, side: 'player', kind: 'he', origin: p(), direction: p(), strength: 1, time: 0})).toBeUndefined();
    expect(() => sim.advance(-1, 0, testArena(), [])).toThrow(RangeError);
    sim.advance(.125, .125, testArena(), []);
    expect(() => sim.advance(.125, 1, testArena(), [])).toThrow(RangeError);
    expect(drop(sim, 'he', p(), 0)).toBeUndefined();
  });
  it('caps persistent effects under repeated maximum-size throws', () => {
    const sim = new UtilitySimulation();
    for (let batch = 0; batch < 3; batch++) {
      for (let i = 0; i < R.maxProjectiles; i++) drop(sim, 'smoke', p(0, .08), batch * 1.5);
      run(sim, 1.5, testArena(), [], batch * 1.5);
    }
    expect(sim.effects).toHaveLength(R.maxEffects); expect(sim.projectiles).toHaveLength(0);
    run(sim, 22, testArena(), [], 4.5);
    expect(sim.effects).toHaveLength(0);
  });
});

describe('world collision and ignition', () => {
  it('sweeps a thin authored wall, reflects its collision normal and cannot tunnel', () => {
    const sim = new UtilitySimulation();
    sim.throw({actorId: 1, side: 'player', kind: 'he', origin: p(0, 1), direction: p(1), strength: 1, time: 0});
    const events = run(sim, .125, {...testArena(), solids: [wall]});
    const bounce = events.find(e => e.type === 'bounce');
    expect(bounce?.type === 'bounce' && bounce.normal).toEqual(p(-1));
    expect(sim.projectiles[0].velocity.x).toBeLessThan(0);
    expect(sim.projectiles[0].position.x).toBeLessThan(.4);
  });
  it('bounces firebombs on walls instead of igniting wall splash', () => {
    const sim = new UtilitySimulation();
    sim.throw({actorId: 1, side: 'player', kind: 'molotov', origin: p(0, 2), direction: p(1), strength: 1, time: 0});
    const events = run(sim, .125, {...testArena(), solids: [wall]});
    expect(events.some(e => e.type === 'bounce')).toBe(true);
    expect(events.some(e => e.type === 'detonate')).toBe(false); expect(sim.effects).toHaveLength(0);
  });
  it('uses native sphere contact normals without seven native ray queries or phantom ground', () => {
    const ray = vi.fn(() => undefined);
    const sphere = vi.fn((from: Vec, to: Vec) => to.x > .05 ? {position: from, fraction: .1,
      startSolid: false, contact: {normal: p(-1)}} : {position: to, fraction: 1, startSolid: false});
    const arena: Arena = {...testArena(), native: {ray, sweepSphere: sphere, fits: () => true,
      sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}),
      vertical: (_at, _from, to) => ({feet: to, grounded: false, ceiling: false})}};
    const sim = new UtilitySimulation();
    sim.throw({actorId: 1, side: 'player', kind: 'he', origin: p(0, 1), direction: p(1), strength: 1, time: 0});
    const events = sim.advance(R.step, R.step, arena, []);
    expect(sphere).toHaveBeenCalled(); expect(ray).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'bounce' && e.normal.x === -1)).toBe(true);
    sim.reset(); drop(sim, 'molotov', p(0, 4)); run(sim, 2.1, arena);
    expect(sim.effects.filter(e => e.type === 'fire')).toHaveLength(0);
  });
  it('air-fused firebombs do not ignite distant floors', () => {
    const sim = new UtilitySimulation(); drop(sim, 'molotov', p(0, 100));
    const events = run(sim, 2.1);
    expect(events.some(e => e.type === 'detonate')).toBe(true);
    expect(sim.effects).toHaveLength(0);
  });
  it.each(['molotov', 'incendiary'] as const)('%s burns only supported reachable floor cells at extracted 40 DPS', kind => {
    const sim = new UtilitySimulation(); drop(sim, kind);
    const targets = [actor(2, p()), actor(3, p(1)), actor(4, p(0, 2))];
    const arena = {...testArena(), solids: [wall]};
    const events = run(sim, 1.5, arena, targets);
    const hits = damageEvents(events);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(e => e.targetId === 2 && e.healthDamage > 0 && e.healthDamage <= 8 && e.armorDamage === 0)).toBe(true);
    expect(hits[0].healthDamage).toBeLessThan(hits[hits.length-1].healthDamage);
    const fire = sim.effects.find(e => e.type === 'fire')!;
    expect(fire.cells.every(c => c.x < .45 && c.y === 0)).toBe(true);
    expect(fire.expiresAt - fire.startedAt).toBeGreaterThanOrEqual(kind === 'molotov' ? 7 : 5.5);
    expect(fire.radius).toBe(kind === 'molotov' ? 150 * .0254 : 110 * .0254);
  });
});

describe('HE, flash and decoy actor effects', () => {
  it('outputs distance-falling HE damage and armor consumption without mutating actors', () => {
    const sim = new UtilitySimulation(); drop(sim, 'he');
    const actors = [actor(2, p()), actor(3, p(3)), actor(4, p(20)), actor(5, p(), {armor: 100}), actor(6, p(), {alive: false})];
    const before = JSON.stringify(actors), hits = damageEvents(run(sim, 2, testArena(), actors));
    expect(hits.map(e => e.targetId)).toEqual([2, 3, 5]);
    expect(hits[0].damage).toBeGreaterThan(hits[1].damage);
    expect(hits[2].healthDamage).toBeCloseTo(hits[0].healthDamage * .6,4);
    expect(hits[2].armorDamage).toBeGreaterThan(0);
    expect(hits[0].shooter).toBe(1); expect(hits[0].victim).toBe(2);
    expect(JSON.stringify(actors)).toBe(before);
  });
  it('never deals HE damage or flash through solid world cover', () => {
    for (const kind of ['he', 'flash'] as const) {
      const sim = new UtilitySimulation(); drop(sim, kind);
      const events = run(sim, 2, {...testArena(), solids: [wall]}, [actor(2, p(1))]);
      expect(events.filter(e => e.type === 'damage' || e.type === 'flash')).toHaveLength(0);
    }
  });
  it('flash duration, rather than visibility alpha, accounts for facing, distance and positive-up pitch', () => {
    const sim = new UtilitySimulation(); drop(sim, 'flash');
    const front = actor(2, p(0, 0, 3)), back = actor(3, p(0, 0, 3), {yaw: Math.PI});
    const events = run(sim, 2, testArena(), [front, back, actor(4, p(0, 0, 15))]);
    const flashes = events.filter(e => e.type === 'flash');
    expect(flashes).toHaveLength(3);
    expect(flashes.every(e=>e.exposure===1)).toBe(true);
    expect(flashes[0].duration).toBeGreaterThan(flashes[1].duration * 3);
    expect(flashes[0].duration).toBeGreaterThan(flashes[2].duration);
    const high = new UtilitySimulation(); drop(high, 'flash', p(0, 12));
    const tilted = run(high, 2, testArena(), [actor(2, p(), {pitch: Math.PI / 2}), actor(3, p(), {pitch: -Math.PI / 2})])
      .filter(e => e.type === 'flash');
    expect(tilted[0].duration).toBeGreaterThan(tilted[1].duration);
  });
  it('decoy produces repeatable positional sounds followed by an occluded small end blast', () => {
    const a = new UtilitySimulation(77), b = new UtilitySimulation(77);
    for (const sim of [a, b]) drop(sim, 'decoy');
    const arena = {...testArena(), solids: [wall]}, actors = [actor(2, p()), actor(3, p(1))];
    const events = run(a, 18, arena, actors);
    expect(events).toEqual(run(b, 18, arena, actors));
    const sounds = events.filter(e => e.type === 'sound' && e.sound === 'decoy');
    expect(sounds.length).toBeGreaterThan(15);
    expect(sounds.every(e => e.position.x === 0)).toBe(true);
    expect(damageEvents(events).map(e => e.targetId)).toEqual([2]);
  });
});

describe('smoke visibility, holes and fire suppression', () => {
  it('tests finite segments and bloom/expiry with analytic optical depth', () => {
    const effects = [smoke()];
    expect(smokeSegmentExposure(p(-6, 1), p(6, 1), effects, 2)).toBeGreaterThan(.99);
    expect(smokeSegmentExposure(p(-6, 1), p(-5, 1), effects, 2)).toBe(0);
    expect(smokeSegmentExposure(p(-6, 8), p(6, 8), effects, 2)).toBe(0);
    expect(smokeSegmentExposure(p(-6, 1), p(6, 1), effects, 0)).toBe(0);
    expect(smokeSegmentExposure(p(-6, 1), p(6, 1), effects, 20)).toBe(0);
    expect(smokeSegmentExposure(p(0, 1), p(0, 1), effects, 2)).toBe(0);
  });
  it('supports per-point sight callbacks, bounded temporary bullet holes and recovery', () => {
    const sim = new UtilitySimulation(); drop(sim, 'smoke'); run(sim, 2);
    const from = p(-6, 1), to = p(6, 1);
    expect(sim.obscuresSegment(from, to, 2)).toBe(true);
    const filter = sim.sightFilter(from, 2);
    expect(filter(to)).toBe(false); expect(filter(p(-5, 1))).toBe(true);
    sim.clearSmokeSegment(from, to, 2);
    expect(sim.obscuresSegment(from, to, 2.1)).toBe(false);
    expect(sim.obscuresSegment(p(-6, 2), p(6, 2), 2.1)).toBe(true);
    expect(sim.obscuresSegment(from, to, 2.5)).toBe(true);
    const snapshot = sim.snapshot(); snapshot.effects[0].holes[0].from.x = 400;
    expect(sim.effects[0].holes[0].from.x).toBe(-6);
  });
  it('HE opens temporary smoke holes, without deleting the cloud', () => {
    const sim = new UtilitySimulation(); drop(sim, 'smoke'); run(sim, 2);
    drop(sim, 'he', p(0, .08), 2); run(sim, 1.75, testArena(), [], 2);
    const effect = sim.effects.find(e => e.type === 'smoke')!;
    expect(effect.holes).toHaveLength(1);
    expect(sim.smokeExposure(p(-2, .5), p(2, .5), 3.75)).toBe(0);
    expect(sim.smokeExposure(p(-2, .5), p(2, .5), 4.75)).toBeGreaterThan(.9);
  });
  it('does not turn the trainer smoke sight envelope into an invented solid flash wall', () => {
    const sim = new UtilitySimulation(); drop(sim, 'smoke'); run(sim, 2);
    drop(sim, 'flash', p(0, .08), 2);
    const events = run(sim, 2, testArena(), [actor(2, p(0, 0, 3))], 2);
    expect(events.some(e => e.type === 'detonate' && e.kind === 'flash')).toBe(true);
    expect(events.some(e => e.type === 'flash')).toBe(true);
  });
  it.each(['molotov', 'incendiary'] as const)('smoke extinguishes %s and prevents new fire inside it', kind => {
    const sim = new UtilitySimulation(); drop(sim, kind); run(sim, .5);
    expect(sim.effects.some(e => e.type === 'fire')).toBe(true);
    drop(sim, 'smoke', p(0, .08), .5);
    const events = run(sim, 2, testArena(), [actor(2, p())], .5);
    expect(events.some(e => e.type === 'extinguish')).toBe(true);
    expect(sim.effects.some(e => e.type === 'fire')).toBe(false);
    expect(damageEvents(run(sim, .5, testArena(), [actor(2, p())], 2.5))).toHaveLength(0);
    drop(sim, kind, p(0, .08), 3);
    run(sim, .5, testArena(), [], 3);
    expect(sim.effects.some(e => e.type === 'fire')).toBe(false);
  });
  it('does not extinguish fire through a separating wall', () => {
    const sim = new UtilitySimulation(), arena = {...testArena(), solids: [wall]};
    drop(sim, 'molotov'); run(sim, .5, arena);
    drop(sim, 'smoke', p(1, .08), .5); const events = run(sim, 2, arena, [], .5);
    expect(events.some(e => e.type === 'extinguish')).toBe(false);
    expect(sim.effects.some(e => e.type === 'fire')).toBe(true);
  });
  it('budgets native queries for fire at 5 Hz and smoke/fire coverage at 10 Hz', () => {
    const ray = vi.fn((from: Vec, direction: Vec, range: number) => {
      const d = -from.y / direction.y;
      return direction.y < 0 && d >= 0 && d <= range ? {distance: d, normal: p(0, 1), surfaceId: 0} : undefined;
    });
    const sphere = vi.fn((from: Vec, to: Vec, radius: number) => {
      const fraction = (radius - from.y) / (to.y - from.y);
      return to.y < radius && fraction >= 0 && fraction <= 1
        ? {position: from, fraction, startSolid: false, contact: {normal: p(0, 1)}}
        : {position: to, fraction: 1, startSolid: false};
    });
    const arena: Arena = {...testArena(), native: {ray, sweepSphere: sphere, fits: () => true,
      sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}),
      vertical: (_at, _from, to) => ({feet: to, grounded: false, ceiling: false})}};
    const sim = new UtilitySimulation(); drop(sim, 'molotov'); drop(sim, 'smoke', p(10, .08));
    run(sim, 2, arena); ray.mockClear(); sphere.mockClear();
    const events = run(sim, 1, arena, [actor(2, p(.1))], 2);
    expect(damageEvents(events)).toHaveLength(5);
    // Separate smoke has no overlapping cells: only the five damage LOS rays remain.
    expect(ray).toHaveBeenCalledTimes(5); expect(sphere).not.toHaveBeenCalled();
    sim.reset(); drop(sim, 'molotov'); run(sim, .5, arena);
    // Existing fire behind a solid partition from a nearby overlapping smoke.
    ray.mockImplementation((from, direction, range) => {
      if (Math.abs(direction.x) + Math.abs(direction.z) > .01) return {distance: .01, normal: p(-1), surfaceId: 1};
      const d = -from.y / direction.y;
      return direction.y < 0 && d >= 0 && d <= range ? {distance: d, normal: p(0, 1), surfaceId: 0} : undefined;
    });
    drop(sim, 'smoke', p(3, .08), .5); run(sim, 2, arena, [], .5); ray.mockClear();
    run(sim, 1, arena, [], 2.5);
    expect(sim.effects.some(e => e.type === 'fire')).toBe(true);
    // Incremental fire still projects children; disconnected smoke adds no long LOS work.
    expect(ray.mock.calls.every(([, , range])=>range<=NATIVE_INFERNO.spacing+1e-6)).toBe(true);
    expect(ray.mock.calls.length).toBeLessThanOrEqual(NATIVE_INFERNO.maxTraces*11);
  });
});

describe('grenade-specific contacts',()=>{
  it('bounces against a live actor hull without damaging them on contact',()=>{
    const sim=new UtilitySimulation(),target=actor(2,p(0,0,2));
    sim.throw({actorId:1,side:'player',kind:'he',origin:p(0,1,0),direction:p(0,0,1),strength:1,time:0});
    const events=run(sim,.125,testArena(),[target]);
    expect(events.some(event=>event.type==='bounce'&&event.normal.z<-.9)).toBe(true);
    expect(sim.projectiles[0].velocity.z).toBeLessThan(0);expect(damageEvents(events)).toHaveLength(0);
  });
  it('does not re-query player clips when a native grenade sweep found no contact',()=>{
    const sphere=vi.fn(()=>({position:p(),fraction:.1,startSolid:false,contact:{normal:p(0,0,-1)}}));
    const grenade=vi.fn((_from:Vec,to:Vec)=>({position:to,fraction:1,startSolid:false}));
    const arena={...testArena(),native:{ray:()=>undefined,sweepGrenade:grenade,sweepSphere:sphere,
      fits:()=>true,sweep:(_from:Vec,to:Vec)=>({position:to,fraction:1,startSolid:false}),
      vertical:(_at:Vec,_from:number,to:number)=>({feet:to,grounded:false,ceiling:false})}};
    const sim=new UtilitySimulation();sim.throw({actorId:1,side:'player',kind:'he',origin:p(0,2),direction:p(0,0,1),strength:1,time:0});
    run(sim,.125,arena);expect(grenade).toHaveBeenCalled();expect(sphere).not.toHaveBeenCalled();
    expect(sim.projectiles[0].bounces).toBe(0);
  });
});
