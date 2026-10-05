import {describe, expect, it} from 'vitest';
import {advanceActor, idleInput, STEP, UNIT, type ActorKinematics} from '../actor-physics';
import {arenaPOIs, environmentPOIs, placePOI} from './arena-pois';
import {solidsOverlap} from './arena-layout';
import {canFitInArena, duelArena, moveInArena, testArena, traceEnvironmentUse, traceSolid, type Arena, type Solid} from './geometry';
import {advanceEnvironment, arenaBoostPOIs, availableTraversalLinks, boostPOIs, createEnvironmentState, damageEnvironmentPiece, environmentSolids, environmentTerrainWorld,
  shadowFootprints, traversalAt, useEnvironmentPiece} from './environment';
import {clearSegment, routeTo} from './navigation';
import {fitsTerrain, moveOnTerrain} from '../actor-collision';

const p = (x = 0, y = 0, z = 0) => ({x, y, z});
function fixture(templateId: string): Arena {
  const template = environmentPOIs.find(t => t.id === templateId)!;
  const placed = placePOI(template, p(), 1, 1, 'fixture', 0);
  return {...testArena(), solids: placed.solids, pois: [placed.instance], traversalVolumes: placed.volumes, traversalLinks: placed.links};
}
const doorArena = () => fixture('switchback-security-door');

describe('pure dynamic environment', () => {
  it('preserves old Solid literals and stable static-array IDs', () => {
    const old: Solid = {center: p(0, 1), size: p(1, 2, .5)};
    const arena = {...testArena(), solids: [old]}, state = createEnvironmentState(arena);
    expect(state.pieces['solid-0'].active).toBe(true);
    expect(traceSolid(p(0, 1, -2), p(0, 0, 1), arena, 10, state).surfaceId).toBe(0);
    expect(arena.solids[0]).toBe(old);
    expect(() => createEnvironmentState({...arena, solids: [{...old, id: 'same'}, {...old, id: 'same'}]})).toThrow('Duplicate');
  });
  it('opens/closes a reachable door immutably and synchronizes collision, rays, navigation and links', () => {
    const arena = doorArena(), before = JSON.stringify(arena), initial = createEnvironmentState(arena), id = 'fixture/panel';
    const eye = p(0, 1.6, -.9), from = p(0, 0, -.9), to = p(0, 0, .85);
    expect(clearSegment(from, to, arena, initial)).toBe(false);
    expect(traceSolid(eye, p(0, 0, 1), arena, 1.7, initial).pieceId).toBe(id);
    expect(canFitInArena(p(), 0, 72 * UNIT, arena, initial)).toBe(false);
    expect(availableTraversalLinks(arena, initial)).toHaveLength(0);
    const opened = useEnvironmentPiece(arena, initial, id, eye);
    expect(opened.changed).toBe(true); expect(opened.state.revision).toBe(1);
    expect(opened.state.pieces[id].open).toBe(true); expect(initial.pieces[id].open).toBe(false);
    expect(clearSegment(from, to, arena, opened.state)).toBe(true);
    expect(canFitInArena(p(), 0, 72 * UNIT, arena, opened.state)).toBe(true);
    expect(moveInArena(from, to, 0, 72 * UNIT, arena, opened.state)).toEqual(to);
    expect(traceSolid(eye, p(0, 0, 1), arena, 1.7, opened.state).distance).toBe(Infinity);
    expect(traceEnvironmentUse(eye, p(0, 0, 1), arena, opened.state).pieceId).toBe(id);
    expect(availableTraversalLinks(arena, opened.state)).toHaveLength(1);
    const body = {center: p(0, .9), size: p(32 * UNIT, 72 * UNIT, 32 * UNIT)};
    expect(useEnvironmentPiece(arena, opened.state, id, eye, [body]).changed).toBe(false);
    const closed = useEnvironmentPiece(arena, opened.state, id, eye);
    expect(closed.state.pieces[id].open).toBe(false); expect(closed.events[0].kind).toBe('closed');
    expect(JSON.stringify(arena)).toBe(before);
  });
  it('rejects distant/occluded use and invalid damage rather than changing revisions', () => {
    const arena = doorArena(), state = createEnvironmentState(arena);
    expect(useEnvironmentPiece(arena, state, 'fixture/panel', p(0, 1.6, -10)).state).toBe(state);
    const blocker: Solid = {id: 'occluder', center: p(0, 1.2, -.6), size: p(2, 2.4, .15)};
    const blocked = {...arena, solids: [...arena.solids, blocker]}, blockedState = createEnvironmentState(blocked);
    expect(useEnvironmentPiece(blocked, blockedState, 'fixture/panel', p(0, 1.6, -1)).changed).toBe(false);
    for (const damage of [-1, NaN, Infinity]) expect(damageEnvironmentPiece(arena, state, 'fixture/panel', damage).state).toBe(state);
    expect(damageEnvironmentPiece(arena, state, 'missing', 10).state).toBe(state);
  });
  it('honors initially open/disabled authored pieces with or without explicit initial state', () => {
    const arena = doorArena(), panel = arena.solids.find(s => s.id === 'fixture/panel')!;
    if (panel.interaction?.kind !== 'door') throw new Error('Expected door');
    const interaction = panel.interaction;
    const openArena: Arena = {...arena, solids: arena.solids.map(s => s === panel ? {...panel, interaction: {...interaction, initiallyOpen: true}} : s)};
    const state = createEnvironmentState(openArena);
    expect(canFitInArena(p(), 0, 72 * UNIT, openArena)).toBe(true);
    expect(traceSolid(p(0, 1.6, -.9), p(0, 0, 1), openArena, 1.7).distance).toBe(Infinity);
    expect(availableTraversalLinks(openArena)).toHaveLength(1);
    expect(availableTraversalLinks(openArena, state)).toEqual(availableTraversalLinks(openArena));
  });
  it.each(['loading-receiving-glass', 'workshop-crawl-vent'])('%s takes persistent health damage and opens exactly once', template => {
    const arena = fixture(template), initial = createEnvironmentState(arena), id = 'fixture/panel';
    const partial = damageEnvironmentPiece(arena, initial, id, 5);
    expect(partial.events[0].kind).toBe('damaged'); expect(partial.state.pieces[id].health).toBe(initial.pieces[id].health! - 5);
    const broken = damageEnvironmentPiece(arena, partial.state, id, 100);
    expect(broken.events[0].kind).toBe('destroyed'); expect(broken.state.pieces[id].active).toBe(false);
    expect(damageEnvironmentPiece(arena, broken.state, id, 100).state).toBe(broken.state);
    expect(traceSolid(p(0, .8, -1), p(0, 0, 1), arena, 1.85, broken.state).distance).toBe(Infinity);
    const height = template.includes('vent') ? 54 * UNIT : 72 * UNIT;
    expect(canFitInArena(p(), 0, height, arena, broken.state)).toBe(true);
    expect(availableTraversalLinks(arena, broken.state)[0].requiresCrouch).toBe(template.includes('vent'));
    if (template.includes('vent')) expect(canFitInArena(p(), 0, 72 * UNIT, arena, broken.state)).toBe(false);
    expect(arena.solids.find(s => s.id === id)!.health).toBe(initial.pieces[id].health);
  });
  it('moves props with bounded swept collision, damping, actor occupancy and immutable authored positions', () => {
    const arena = fixture('workshop-loose-cargo'), initial = createEnvironmentState(arena), id = 'fixture/light-case';
    const pushed = damageEnvironmentPiece(arena, initial, id, 1, p(0, 0, 1000));
    expect(pushed.state.pieces[id].velocity.z).toBe(3);
    let state = pushed.state;
    for (let n = 0; n < 100; n++) state = advanceEnvironment(arena, state, .1).state;
    const solids = environmentSolids(arena, state), prop = solids.find(s => s.id === id)!;
    expect(prop.center.z).toBeGreaterThan(-.25);
    expect(solidsOverlap(prop, solids.find(s => s.id === 'fixture/fixed-rack')!)).toBe(false);
    expect(arena.solids.find(s => s.id === id)!.center.z).toBe(-.25);
    expect(state.pieces[id].velocity.z).toBe(0);
    const body = {center: p(-1.25, .9, .7), size: p(.82, 1.8, .82)};
    const withActor = advanceEnvironment(arena, pushed.state, .25, [body]);
    expect(solidsOverlap(environmentSolids(arena, withActor.state)[0], body)).toBe(false);
    expect(advanceEnvironment(arena, initial, NaN).state).toBe(initial);
  });
  it('updates navigation when a low movable blocker leaves a narrow corridor', () => {
    const prop: Solid = {id: 'prop', center: p(0, .3), size: p(1, .6, 1), kind: 'crate',
      interaction: {kind: 'movable', mass: 10, damping: 0, maxSpeed: 3}};
    const arena: Arena = {minX: -1, maxX: 1, minZ: -4, maxZ: 4, solids: [prop]}, state = createEnvironmentState(arena);
    expect(routeTo(p(0, 0, -3), p(0, 0, 3), arena, state)).toEqual([]);
    const inactive = {...state, pieces: {prop: {...state.pieces.prop, active: false, passable: true}}};
    expect(clearSegment(p(0, 0, -3), p(0, 0, 3), arena, inactive)).toBe(true);
  });
  it('invalidates cached ground occupancy when main replaces its resolved solid view', () => {
    const prop: Solid = {id: 'blocker', center: p(0, .5), size: p(.3, 1, 8)};
    const arena: Arena = {minX: -3, maxX: 3, minZ: -4, maxZ: 4, solids: [prop]};
    expect(routeTo(p(-2, 0, 0), p(2, 0, 0), arena)).toEqual([]);
    // Keep a shorter centre screen so the second query still takes the grid path.
    arena.solids = [{...prop, size: p(.3, 1, 2)}];
    const route = routeTo(p(-2, 0, 0), p(2, 0, 0), arena);
    expect(route.length).toBeGreaterThan(0);
    let previous = p(-2, 0, 0);
    for (const next of route) {expect(clearSegment(previous, next, arena)).toBe(true); previous = next;}
  });
});

describe('authored traversal bundles', () => {
  it.each(environmentPOIs)('$id has physical pieces, stable references, no interpenetration and mirrored metadata', template => {
    const before = JSON.stringify(template);
    for (const mx of [-1, 1] as const) for (const mz of [-1, 1] as const) {
      const placed = placePOI(template, p(8, 2, -7), mx, mz, 'authored', 10);
      const ids = new Set(placed.solids.map(s => s.id));
      expect(ids.size).toBe(template.parts.length);
      for (const [index, solid] of placed.solids.entries()) {
        expect(solid.material).toBeTruthy(); expect(solid.center.y).toBe(2 + template.parts[index].center.y);
        for (const other of placed.solids.slice(index + 1)) expect(solidsOverlap(solid, other)).toBe(false);
      }
      for (const l of placed.links) {
        for (const surfaceId of l.surfaceIds) expect(ids.has(surfaceId)).toBe(true);
        if (l.volumeId) expect(placed.volumes.some(v => v.id === l.volumeId)).toBe(true);
        expect(l.from.z).toBe(-7 + mz * template.links!.find(t => `authored/${t.id}` === l.id)!.from.z);
      }
      for (const volume of placed.volumes) if (volume.ladder) {
        expect(volume.ladder.bottom).toBe(2); expect(volume.ladder.top).toBe(4.4);
        expect(volume.ladder.facing).toBe(-mz);
      }
    }
    expect(JSON.stringify(template)).toBe(before);
  });
  it('provides native-scale steps, true slopes, water contacts, ladder dismounts and gated partner boosts', () => {
    const stair = environmentPOIs.find(t => t.id === 'freight-inspection-stairs')!;
    const treads = stair.parts.filter(part => part.label.startsWith('tread-'));
    let top = 0;
    for (const tread of treads) {expect(tread.size.y - top).toBeLessThanOrEqual(18 * UNIT); top = tread.size.y; expect(tread.size.x).toBeGreaterThan(32 * UNIT + .6);}
    const wet = fixture('service-drainage-channel');
    expect(traversalAt(wet, p(), 72 * UNIT)[0].water!.surfaceY).toBe(.32);
    expect(traversalAt(wet, p(0, 1), 72 * UNIT)).toHaveLength(0);
    const loft = fixture('freight-container-loft'), state = createEnvironmentState(loft);
    expect(availableTraversalLinks(loft, state).some(l => l.requiresPartner)).toBe(false);
    expect(availableTraversalLinks(loft, state, true).some(l => l.requiresPartner)).toBe(true);
    const ladder = loft.traversalVolumes![0];
    expect(canFitInArena(loft.traversalLinks![0].from, 0, 72 * UNIT, loft)).toBe(true);
    expect(canFitInArena(ladder.ladder!.dismount, ladder.ladder!.top, 72 * UNIT, loft)).toBe(true);
  });
  it.each(['freight-inspection-stairs', 'service-access-ramp'])('%s has a physically walkable ascent with the shared terrain helper', id => {
    const template = environmentPOIs.find(t => t.id === id)!;
    for (const mirrorZ of [-1, 1] as const) {
      const placed = placePOI(template, p(), 1, mirrorZ, 'walk', 0), arena = {...testArena(), solids: placed.solids};
      const world = environmentTerrainWorld(arena), ascent = placed.links[0];
      let at = {...ascent.from};
      for (let step = 1; step <= 128; step++) {
        const desired = {...at, x: ascent.from.x + (ascent.to.x - ascent.from.x) * step / 128,
          z: ascent.from.z + (ascent.to.z - ascent.from.z) * step / 128};
        const moved = moveOnTerrain(at, desired, 72 * UNIT, world, true);
        expect(moved.grounded).toBe(true);
        expect(moved.position.y - at.y).toBeLessThanOrEqual(18 * UNIT + 1e-6);
        at = moved.position;
      }
      expect(at.x).toBeCloseTo(ascent.to.x, 5); expect(at.z).toBeCloseTo(ascent.to.z, 5); expect(at.y).toBeCloseTo(ascent.to.y, 5);
    }
  });
  it('derives stable boost POIs and removes opportunities whose supporting pieces are inactive', () => {
    const arena = fixture('freight-container-loft'), state = createEnvironmentState(arena), before = JSON.stringify(arena);
    const boosts = boostPOIs(arena, state);
    expect(boosts.map(b => b.id)).toEqual(['fixture/partner-boost']);
    expect(boosts[0]).toMatchObject({poiId: 'fixture', rise: 1.45, requiresPartner: true});
    expect(boosts[0].base).toEqual(p(3, .95, .75)); expect(boosts[0].landing).toEqual(p(.35, 2.4, .75));
    const disabled = {...state, pieces: {...state.pieces, 'fixture/loft': {...state.pieces['fixture/loft'], active: false}}};
    expect(boostPOIs(arena, disabled).some(b => b.requiresPartner)).toBe(false);
    boosts[0].base.x = 100;
    expect(JSON.stringify(arena)).toBe(before);
  });
  it('authors a full-hull two-actor assembly platform with walkable stairs and mirrored mount/perch/dismount points', () => {
    const template = environmentPOIs.find(t => t.id === 'freight-container-loft')!;
    for (const mx of [-1, 1] as const) for (const mz of [-1, 1] as const) {
      const placed = placePOI(template, p(), mx, mz, 'boost', 0);
      const arena = {...testArena(), solids: placed.solids, traversalLinks: placed.links, traversalVolumes: placed.volumes};
      const boost = arenaBoostPOIs(arena)[0], world = environmentTerrainWorld(arena);
      expect(boost).toBeDefined(); expect(boost.partnerStance).toBe('crouch');
      expect(Math.hypot(boost.base.x - boost.mount.x, boost.base.z - boost.mount.z)).toBeGreaterThanOrEqual(.82);
      const platform = arena.solids.find(s => s.id === boost.platformId)!;
      for (const at of [boost.base, boost.mount]) {
        expect(Math.abs(at.x - platform.center.x) + 16 * UNIT).toBeLessThanOrEqual(platform.size.x / 2);
        expect(Math.abs(at.z - platform.center.z) + 16 * UNIT).toBeLessThanOrEqual(platform.size.z / 2);
        expect(fitsTerrain(at, at.y, 72 * UNIT, world)).toBe(true);
      }
      expect(boost.partnerTop.y).toBeCloseTo(boost.base.y + 54 * UNIT);
      expect(fitsTerrain(boost.perch, boost.perch.y, 72 * UNIT, world)).toBe(true);
      expect(fitsTerrain(boost.dismount, boost.dismount.y, 72 * UNIT, world)).toBe(true);
      const approach = placed.links.find(l => l.id === boost.approachLinkId)!;
      let at = {...approach.from};
      for (let step = 1; step <= 128; step++) {
        const desired = {...at, x: approach.from.x + (approach.to.x - approach.from.x) * step / 128,
          z: approach.from.z + (approach.to.z - approach.from.z) * step / 128};
        const moved = moveOnTerrain(at, desired, 72 * UNIT, world, true);
        expect(moved.grounded).toBe(true); expect(moved.position.y - at.y).toBeLessThanOrEqual(18 * UNIT + 1e-6);
        at = moved.position;
      }
      expect(at.y).toBeCloseTo(boost.mount.y, 5); expect(at.z).toBeCloseTo(boost.mount.z, 5);
    }
  });
  it('can jump onto the crouched partner and reach the loft using actual shared actor input and contact', () => {
    const arena = fixture('freight-container-loft'), boost = arenaBoostPOIs(arena)[0], world = environmentTerrainWorld(arena);
    const base = {id: 'base', position: {...boost.base}, feet: boost.base.y, duckAmount: 1, grounded: true, alive: true};
    let rider: ActorKinematics = {position: {...boost.mount, y: boost.mount.y + 64 * UNIT}, feet: boost.mount.y,
      eyeHeight: 64 * UNIT, yaw: Math.PI, velocity: {x: 0, z: 0}, verticalVelocity: 0, jumpHeld: false, grounded: true};
    let mounted = false;
    for (let tick = 0; tick < 128; tick++) {
      rider = advanceActor(rider, {...idleInput(), forward: 1, jump: true}, 250 * UNIT, STEP,
        undefined, undefined, undefined, {...world, actors: [base], selfId: 'rider'});
      if (rider.supportId === 'base') {mounted = true; break;}
    }
    expect(mounted, `mount failed at ${JSON.stringify(rider.position)}`).toBe(true);
    expect(rider.feet).toBeCloseTo(boost.partnerTop.y);
    const yaw = Math.atan2(rider.position.x - boost.perch.x, rider.position.z - boost.perch.z);
    rider = {...rider, yaw};
    // A short run-up stays on the head support before the second physical jump.
    for (let tick = 0; tick < 16; tick++) rider = advanceActor(rider, {...idleInput(), forward: 1}, 250 * UNIT, STEP,
      undefined, undefined, undefined, {...world, actors: [base], selfId: 'rider'});
    expect(rider.supportId).toBe('base');
    let reached = false;
    for (let tick = 0; tick < 160; tick++) {
      rider = advanceActor(rider, {...idleInput(), forward: 1, jump: tick === 0}, 250 * UNIT, STEP,
        undefined, undefined, undefined, {...world, actors: [base], selfId: 'rider'});
      if (rider.grounded && Math.abs(rider.feet - boost.perch.y) < 1e-5 && Math.abs(rider.position.x) < .9) {reached = true; break;}
    }
    expect(reached, `perch failed at ${JSON.stringify(rider.position)}`).toBe(true);
  });
  it('keeps structural spawn cover noninteractive and shadow proxies deterministic', () => {
    expect(arenaPOIs.filter(t => t.spawnCover).every(t => t.parts.every(s => !s.interaction))).toBe(true);
    const arena = doorArena(), state = createEnvironmentState(arena), sun = p(1, 2, 1);
    const shadows = shadowFootprints(arena, sun, state);
    expect(shadowFootprints(arena, sun, state)).toEqual(shadows);
    expect(shadowFootprints(arena, p(1, 0, 1), state)).toEqual([]);
    for (const shadow of shadows) {expect(shadow.points.length).toBeGreaterThanOrEqual(4); expect(shadow.points.every(v => Number.isFinite(v.x + v.z))).toBe(true);}
    const glass = fixture('loading-receiving-glass');
    expect(shadowFootprints(glass, sun).some(s => s.id === 'fixture/panel')).toBe(false);
  });
  it.each([.65, 1, 1.5])('replaces a flank pair without adding POIs or losing ground connectivity at scale %s', scale => {
    for (let seed = 0; seed < 24; seed++) {
      const arena = duelArena(seed, scale);
      expect(arena.pois).toHaveLength(scale < 1 ? 4 : 6);
      expect(arena.pois!.filter(poi => environmentPOIs.some(t => t.id === poi.templateId))).toHaveLength(2);
      expect(routeTo(p(0, 0, -8 * scale), p(0, 0, 8 * scale), arena).length).toBeGreaterThan(0);
      expect(arena.solids.length).toBeLessThanOrEqual(40);
    }
  }, 30000);
});
