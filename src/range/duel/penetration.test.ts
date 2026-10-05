import {describe, expect, it} from 'vitest';
import {UNIT} from '../actor-physics';
import nativeLoss from './native-penetration-fixture.json';
import nativeSurfaces from './native-surface-fixture.json';
import {damageThroughSurface, penetrationLoss, penetrationMaterials, raySolidInterval, resolveBulletRay,
  type BulletRayRequest, type PenetrationActor, type PenetrationSolid, type PenetrationStats} from './penetration';

const stats: PenetrationStats = {damage: 100, penetration: 2, armorRatio: 1.5, headshotMultiplier: 4, rangeModifier: .98};
const actor = (id: number, z: number, side = 'enemy'): PenetrationActor => ({id, side, position: {x: 0, y: 1.6256, z},
  feet: 0, alive: true, duckAmount: 0, armor: 0, helmet: false});
const wall = (z: number, thickness = .1, material = 'wood'): PenetrationSolid => ({
  id: `wall-${z}`, center: {x: 0, y: 1.5, z}, size: {x: 4, y: 3, z: thickness}, material,
});
const request = (patch: Partial<BulletRayRequest> = {}): BulletRayRequest => ({origin: {x: 0, y: 1.3, z: 0},
  direction: {x: 0, y: 0, z: -1}, range: 30, stats, arena: {solids: []}, actors: [], shooterId: 1, shooterSide: 'player', ...patch});

describe('stateless penetration and collateral ray', () => {
  it('uses supplied physical mesh intervals without inventing analytic hits',()=>{
    const result=resolveBulletRay(request({actors:[actor(2,-5),actor(3,-10)],physicalActorIntervals:[
      {actorId:2,entry:4.7,exit:5.1,group:'head'},{actorId:3,entry:9.8,exit:10.1,group:'chest'}]}));
    expect(result.hits.map(hit=>[hit.actorId,hit.distance,hit.exitDistance,hit.group])).toEqual([
      [2,4.7,5.1,'head'],[3,9.8,10.1,'chest']]);
    expect(result.hits[1].residualDamage).toBeLessThan(result.hits[0].residualDamage);
    expect(resolveBulletRay(request({actors:[actor(2,-5)],physicalActorIntervals:[]})).hits).toHaveLength(0);
  });
  it('rejects invalid physical intervals before creating impacts',()=>{
    expect(()=>resolveBulletRay(request({actors:[actor(2,-5)],physicalActorIntervals:[
      {actorId:2,entry:5,exit:4,group:'head'}]}))).toThrow(RangeError);
  });
  it('keeps first actor damage consistent with the existing hitgroup/armor formula', () => {
    const result = resolveBulletRay(request({actors: [{...actor(2, -5), armor: 100}]}));
    const hit = result.hits[0], raw = stats.damage * Math.pow(.98, hit.distance / (500 * UNIT));
    expect(hit.group).toBe('chest'); expect(hit.healthDamage).toBeCloseTo(raw * .75, 10);
    expect(hit.armorDamage).toBeCloseTo(raw * .25 / 2, 10);
  });
  it('returns ordered entries, exits, and collateral hits with decreasing residual damage', () => {
    const input = request({arena: {solids: [wall(-2)]}, actors: [actor(3, -10), actor(2, -5)]});
    const before = JSON.stringify(input), result = resolveBulletRay(input);
    expect(result.surfaces.map(s => s.phase)).toEqual(['entry', 'exit']);
    expect(result.surfaces.map(s => s.distance)).toEqual([1.95, 2.05]);
    expect(result.hits.map(h => h.actorId)).toEqual([2, 3]);
    expect(result.hits[1].residualDamage).toBeLessThan(result.hits[0].residualDamage);
    expect(result.hits[0].residualDamage).toBeLessThan(result.surfaces[0].residualDamage);
    expect(result.contacts.every((c, i) => !i || c.distance >= result.contacts[i - 1].distance)).toBe(true);
    expect(result.penetrations).toBe(3); expect(JSON.stringify(input)).toBe(before);
  });
  it('never damages friends, but friendly flesh reduces downstream damage and consumes a count', () => {
    const result = resolveBulletRay(request({actors: [actor(2, -5, 'player'), actor(3, -10)]}));
    expect(result.hits[0]).toMatchObject({friendly: true, healthDamage: 0, armorDamage: 0});
    expect(result.hits[1].healthDamage).toBeGreaterThan(0);
    expect(result.hits[1].penetrations).toBe(1);
    const opaque = resolveBulletRay(request({actors: [actor(2, -5, 'player'), actor(3, -10)], friendlyFleshPenetration: 0}));
    expect(opaque.hits).toHaveLength(1); expect(opaque.stopped).toBe('flesh');
  });
  it('enforces the same budget across cover and flesh, including glass/grates', () => {
    const result = resolveBulletRay(request({maxPenetrations: 1, arena: {solids: [wall(-2, .02, 'glass'), wall(-3, .02, 'grate')]}, actors: [actor(2, -5)]}));
    expect(result.penetrations).toBe(1); expect(result.hits).toHaveLength(0);
    expect(result.surfaces.map(s => s.phase)).toEqual(['entry', 'exit', 'entry']);
    expect(result.stopped).toBe('penetration-limit');
  });
  it('distinguishes thin glass/grates, wood, metal and thick concrete', () => {
    const loss = (material: string, thickness = .1) => resolveBulletRay(request({arena: {solids: [wall(-2, thickness, material)]}}));
    expect(loss('glass').residualDamage).toBeGreaterThan(loss('wood').residualDamage);
    expect(loss('grate').residualDamage).toBe(loss('glass').residualDamage);
    expect(loss('wood').residualDamage).toBeGreaterThan(loss('metal').residualDamage);
    expect(loss('concrete', 3).stopped).toBe('surface');
    expect(loss('glass', .2).residualDamage).toBeLessThan(loss('wood', .2).residualDamage);
  });
  it('uses geometric chord thickness at oblique angles and does not invent exits for blocked rays', () => {
    const solid = {...wall(-2, .1), size: {x: 10, y: 3, z: .1}};
    const straight = resolveBulletRay(request({arena: {solids: [solid]}}));
    const angled = resolveBulletRay(request({direction: {x: 1, y: 0, z: -1}, arena: {solids: [solid]}}));
    expect(angled.surfaces[0].thickness).toBeCloseTo(straight.surfaces[0].thickness * Math.SQRT2, 12);
    expect(angled.residualDamage).toBeLessThan(straight.residualDamage);
    const blocked = resolveBulletRay(request({stats: {...stats, penetration: 0}, arena: {solids: [solid]}, actors: [actor(2, -5)]}));
    expect(blocked.surfaces).toHaveLength(1); expect(blocked.hits).toHaveLength(0);
    expect(blocked.distance).toBe(straight.surfaces[0].distance);
  });
  it('normalizes direction, and ignores dead actors, the shooter and disabled environment solids', () => {
    const input = request({actors: [actor(1, -1), {...actor(2, -2), alive: false}, actor(3, -5)],
      arena: {solids: [{...wall(-2), active: false}, {...wall(-3), health: 0}, {...wall(-4), shotBlocking: false}]}});
    const a = resolveBulletRay(input), b = resolveBulletRay({...input, direction: {x: 0, y: 0, z: -100}});
    expect(a).toEqual(b); expect(a.hits.map(h => h.actorId)).toEqual([3]); expect(a.surfaces).toEqual([]);
  });
  it('deducts falloff once over total distance, including distance inside cover', () => {
    const cover = {...wall(-2), damageLoss: 0, penetrationModifier: 1e100};
    const result = resolveBulletRay(request({arena: {solids: [cover]}, actors: [actor(2, -5)]}));
    expect(result.hits[0].residualDamage).toBeCloseTo(100 * .98 ** (result.hits[0].distance / (500 * UNIT)), 10);
  });
  it('clips range without producing an exit beyond it, including an origin inside a solid', () => {
    const result = resolveBulletRay(request({range: .25, arena: {solids: [wall(0, 1, 'glass')]}}));
    expect(result.surfaces).toHaveLength(1); expect(result.surfaces[0].distance).toBe(0);
    expect(result.distance).toBe(.25); expect(result.endPoint.z).toBe(-.25);
  });
  it('lets range use an exact target-mesh hit distance without substituting analytic actors', () => {
    const meshDistance = 7.231, direct = resolveBulletRay(request({range: meshDistance}));
    const covered = resolveBulletRay(request({range: meshDistance, arena: {solids: [wall(-2), wall(-9)]}}));
    expect(covered.stopped).toBe('range'); expect(covered.distance).toBe(meshDistance);
    expect(covered.hits).toEqual([]); expect(covered.surfaces).toHaveLength(2);
    expect(covered.residualDamage).toBeLessThan(direct.residualDamage);
  });
  it('does not count multiple hit zones of one actor as separate flesh penetrations', () => {
    const result = resolveBulletRay(request({origin: {x: -.7, y: 1.1, z: -5}, direction: {x: 1, y: 0, z: 0}, actors: [actor(2, -5)]}));
    expect(result.hits).toHaveLength(1); expect(result.hits[0].group).toBe('arm');
    expect(result.hits[0].thickness).toBeCloseTo(.8, 10); expect(result.penetrations).toBe(1);
  });
  it('clips actual ramp wedges rather than their empty AABB corners', () => {
    const solid: PenetrationSolid = {center: {x: 0, y: 1, z: -3}, size: {x: 4, y: 2, z: 2}, shape: {kind: 'ramp', axis: 'x', highSide: 1}};
    expect(raySolidInterval({x: -1, y: 1.5, z: 0}, {x: 0, y: 0, z: -1}, solid)).toBeUndefined();
    expect(raySolidInterval({x: 1.5, y: 1.5, z: 0}, {x: 0, y: 0, z: -1}, solid)).toMatchObject({entry: 2, exit: 4});
  });
  it('fails closed on missing/invalid penetration and rejects invalid rays', () => {
    expect(penetrationLoss(100, .1, NaN, 1, .16)).toBe(Infinity);
    expect(penetrationLoss(100, 0, 2, 1e-100, 0)).toBe(Infinity);
    expect(() => resolveBulletRay(request({direction: {x: 0, y: 0, z: 0}}))).toThrow(RangeError);
    expect(() => resolveBulletRay(request({range: Infinity}))).toThrow(RangeError);
    expect(() => resolveBulletRay(request({maxPenetrations: NaN}))).toThrow(RangeError);
    expect(resolveBulletRay(request({stats: {...stats, penetration: undefined}, arena: {solids: [wall(-2)]}})).stopped).toBe('surface');
  });
  it('exports the same pure material loss calculation for existing mesh-raycast callers', () => {
    const result = damageThroughSurface(100, stats, {entry: {x: 0, y: 0, z: 0}, exit: {x: 0, y: 0, z: .1}}, 'wood');
    expect(result.penetrated).toBe(true);
    expect(result.residualDamage).toBe(100 - penetrationLoss(100, .1, 2, 3, .16));
    expect(damageThroughSurface(100, stats, {entry: {x: 0, y: 0, z: 0}, exit: {x: 0, y: 0, z: 3}}, 'concrete').residualDamage).toBe(0);
  });
  it('stops at entry without consuming a count or inventing an exit below one residual damage', () => {
    const weak = {...stats, damage: 1.5, rangeModifier: 1};
    const cover = {...wall(-2, .01), penetrationModifier: 1e20, damageLoss: .5};
    const surface = resolveBulletRay(request({stats: weak, arena: {solids: [cover]}, actors: [actor(2, -5)]}));
    expect(surface.stopped).toBe('damage'); expect(surface.penetrations).toBe(0);
    expect(surface.surfaces.map(s => s.phase)).toEqual(['entry']); expect(surface.hits).toEqual([]);
    expect(surface.distance).toBe(cover.center.z * -1 - cover.size.z / 2);
    expect(surface.residualDamage).toBeCloseTo(.75, 12);
    const fleshCost = penetrationLoss(0, .34, stats.penetration!, penetrationMaterials.flesh.modifier, penetrationMaterials.flesh.damageLoss);
    const flesh = resolveBulletRay(request({stats: {...weak, damage: (fleshCost + .5) / .84}, actors: [actor(2, -2), actor(3, -5)]}));
    expect(flesh.stopped).toBe('damage'); expect(flesh.hits).toHaveLength(1);
    expect(flesh.penetrations).toBe(0); expect(flesh.contacts.some(c => c.kind === 'flesh-exit')).toBe(false);
    expect(flesh.residualDamage).toBeCloseTo(.5, 5);
    expect(damageThroughSurface(1.5, weak, {entry: {x: 0, y: 0, z: 0}, exit: {x: 0, y: 0, z: .01}}, 'wood',
      {penetrationModifier: 1e20, damageLoss: .5}).penetrated).toBe(false);
  });
});

describe('current offline native penetration arithmetic', () => {
  it('uses extracted base modifiers rather than Source-family priors', () => {
    expect(nativeSurfaces.build).toBe('2000924');
    for (const [material, values] of Object.entries(nativeSurfaces.materials)) {
      expect(penetrationMaterials[material as keyof typeof penetrationMaterials].modifier).toBe(values.distanceModifier);
    }
    expect(nativeSurfaces.materials.metal.damageModifier).toBe(.3);
    expect(nativeSurfaces.materials.plastic.gameMaterial).toBe('L');
  });
  it('matches each float32 loss fixture from build 2000924', () => {
    expect(nativeLoss.build).toBe('2000924');
    for (const sample of nativeLoss.samples) expect(penetrationLoss(sample.damage, sample.thicknessUnits * UNIT,
      sample.power, sample.modifier, sample.damageLoss)).toBe(sample.lostDamage);
  });
  it('matches the native one-damage continuation boundary, including equality', () => {
    for (const sample of nativeLoss.stopSamples) {
      const result = damageThroughSurface(sample.damage, {...stats, penetration: 1e30},
        {entry: {x: 0, y: 0, z: 0}, exit: {x: 0, y: 0, z: 0}}, 'wood',
        {penetrationModifier: 1e30, damageLoss: sample.lostDamage / sample.damage});
      expect(result.penetrated).toBe(sample.continued);
      // This helper recomputes loss from a proportion, rather than taking the
      // fixture's already-rounded loss as input. Check the stop decision here.
      expect(Math.fround(Math.fround(sample.damage) - Math.fround(sample.lostDamage))).toBe(sample.residualDamage);
      if (sample.lostDamage === 4) expect(result.residualDamage).toBe(1);
      expect(sample.remainingPenetrations).toBe(sample.continued ? 3 : 4);
    }
  });
  it('uses the native six-unit glass threshold, without an assumed 90-unit cutoff', () => {
    const at = (units: number) => damageThroughSurface(100, stats,
      {entry: {x: 0, y: 0, z: 0}, exit: {x: 0, y: 0, z: units * UNIT}}, 'glass');
    expect(at(5.99).residualDamage).toBeGreaterThan(at(6).residualDamage);
    expect(at(6 - 1e-9).residualDamage).toBe(at(6).residualDamage);
    const tough = damageThroughSurface(100000, {...stats, penetration: 100},
      {entry: {x: 0, y: 0, z: 0}, exit: {x: 0, y: 0, z: 91 * UNIT}}, 'wood');
    expect(tough.penetrated).toBe(true);
  });
});
