import {describe, expect, it, vi} from 'vitest';
import {advanceActor, GRAVITY, idleInput, STEP, UNIT, type ActorKinematics} from './actor-physics';
import {fitsHull, moveOnTerrain, slideHull, sweepHull, verticalContact} from './actor-collision';
import {TERRAIN_RULES as R, surfaceHeight, waterLevel, type TerrainSolid, type TerrainWorld} from './terrain';
import native from './native-terrain-fixture.json';
import * as terrain from './terrain';

const standing = (x = 0, feet = 0): ActorKinematics => ({position: {x, y: feet + 64 * UNIT, z: 0},
  velocity: {x: 0, z: 0}, yaw: 0, feet, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false});
const block = (x: number, height: number): TerrainSolid => ({center: {x, y: height / 2, z: 0}, size: {x: 1, y: height, z: 3}});
const stepWorld = (height: number): TerrainWorld => ({solids: [block(1, height)]});

describe('continuous shared hull collision', () => {
  it('cannot tunnel through a thin wall at high speed', () => {
    const wall = {center: {x: 2, y: 2, z: 0}, size: {x: .01, y: 4, z: 4}};
    const trace = sweepHull({x: 0, y: 0, z: 0}, {x: 10, y: 0, z: 0}, R.standingHeight, [wall]);
    expect(trace.position.x).toBeCloseTo(2 - .005 - R.hullRadius);
    expect(trace.contact?.normal.x).toBe(-1);
  });
  it('rejects distant candidates before allocating convex hull planes', () => {
    const wall = block(1, 3), far = Array.from({length: 30}, (_, i) => block(20 + i, 3));
    const planes = vi.spyOn(terrain, 'hullPlanes');
    try {
      const trace = sweepHull({x: 0, y: 0, z: 0}, {x: 2, y: 0, z: 0}, R.standingHeight, [...far, wall]);
      expect(trace.contact?.solid).toBe(wall); expect(planes).toHaveBeenCalledTimes(1);
      planes.mockClear();
      expect(fitsHull({x: 1, y: 0, z: 0}, 0, R.standingHeight, [...far, wall])).toBe(false);
      expect(planes).toHaveBeenCalledTimes(1);
    } finally { planes.mockRestore(); }
  });
  it('keeps vertical and long-sweep candidates in the broad phase', () => {
    const roof = {center: {x: 0, y: 4, z: 0}, size: {x: 2, y: .2, z: 2}};
    const above = sweepHull({x: 0, y: 0, z: 0}, {x: 0, y: 6, z: 0}, R.standingHeight, [roof]);
    expect(above.position.y).toBeCloseTo(3.9 - R.standingHeight);
    expect(above.contact?.normal.y).toBe(-1);
    const wall = block(50, 3);
    expect(sweepHull({x: 0, y: 0, z: 0}, {x: 100, y: 0, z: 0}, R.standingHeight, [wall])
      .position.x).toBeCloseTo(49.5 - R.hullRadius);
  });
  it('slides tangentially along a wall without losing the free axis', () => {
    const wall = {center: {x: 1, y: 2, z: 0}, size: {x: .2, y: 4, z: 20}};
    const moved = slideHull({x: 0, y: 0, z: 0}, {x: 2, y: 0, z: 3}, R.standingHeight, [wall]);
    expect(moved.position.x).toBeCloseTo(.9 - R.hullRadius);
    expect(moved.position.z).toBeCloseTo(3);
    const tangent = sweepHull(moved.position, {...moved.position, z: 4}, R.standingHeight, [wall]);
    expect(tangent.fraction).toBe(1);
  });
  it('clips inward movement starting exactly at contact', () => {
    const wall = block(1, 3), start = {x: .5 - R.hullRadius, y: 0, z: 0};
    expect(sweepHull(start, {...start, x: 1}, R.standingHeight, [wall]).fraction).toBe(0);
  });
  it('stops both components in an inside corner', () => {
    const walls = [{center: {x: 1, y: 2, z: 0}, size: {x: .2, y: 4, z: 5}},
      {center: {x: 0, y: 2, z: 1}, size: {x: 5, y: 4, z: .2}}];
    const moved = slideHull({x: 0, y: 0, z: 0}, {x: 2, y: 0, z: 2}, R.standingHeight, walls);
    expect(moved.position.x).toBeCloseTo(.9 - R.hullRadius);
    expect(moved.position.z).toBeCloseTo(.9 - R.hullRadius);
  });
  it('accepts a tangent standing hull and rejects an overlapping ceiling', () => {
    const roof = {center: {x: 0, y: R.standingHeight + .1, z: 0}, size: {x: 3, y: .2, z: 3}};
    expect(fitsHull({x: 0, y: 0, z: 0}, 0, R.standingHeight, [roof])).toBe(true);
    expect(fitsHull({x: 0, y: 0, z: 0}, .001, R.standingHeight, [roof])).toBe(false);
  });
  it('honors full hull width at arena boundaries', () => {
    const world = {solids: [], bounds: {minX: -1, maxX: 1, minZ: -1, maxZ: 1}};
    const moved = moveOnTerrain({x: 0, y: 0, z: 0}, {x: 3, y: 0, z: 3}, R.standingHeight, world, true);
    expect(moved.position.x).toBeCloseTo(1 - R.hullRadius);
    expect(moved.position.z).toBeCloseTo(1 - R.hullRadius);
  });
  it('supports negative-elevation geometry without an implicit ground plane', () => {
    const floor = {center: {x: 0, y: -2.1, z: 0}, size: {x: 10, y: .2, z: 10}};
    const moved = moveOnTerrain({x: 0, y: 0, z: 0}, {x: 0, y: -3, z: 0}, R.standingHeight, {solids: [floor], floor: null});
    expect(moved.position.y).toBeCloseTo(-2); expect(moved.grounded).toBe(true);
  });
});

describe('terrain stepping and ramps', () => {
  it.each([8, 16, 18])('steps over a %s-unit stair while grounded', height => {
    const moved = moveOnTerrain({x: 0, y: 0, z: 0}, {x: .8, y: 0, z: 0}, R.standingHeight, stepWorld(height * UNIT), true);
    expect(moved.position.x).toBeCloseTo(.8); expect(moved.position.y).toBeCloseTo(height * UNIT);
    expect(moved.grounded).toBe(true);
  });
  it('does not climb above the extracted 18-unit step', () => {
    const moved = moveOnTerrain({x: 0, y: 0, z: 0}, {x: .8, y: 0, z: 0}, R.standingHeight, stepWorld(19 * UNIT), true);
    expect(moved.position.x).toBeLessThan(.2); expect(moved.position.y).toBe(0);
  });
  it('does not use stepping as an airborne lift', () => {
    const moved = moveOnTerrain({x: 0, y: 0, z: 0}, {x: .8, y: 0, z: 0}, R.standingHeight, stepWorld(8 * UNIT), false);
    expect(moved.position.x).toBeLessThan(.2);
  });
  it('rejects a step when the standing hull would hit a ceiling', () => {
    const world = stepWorld(16 * UNIT);
    world.solids = [...world.solids, {center: {x: .8, y: 2.1, z: 0}, size: {x: 2, y: .2, z: 3}}];
    const moved = moveOnTerrain({x: 0, y: 0, z: 0}, {x: .8, y: 0, z: 0}, R.standingHeight, world, true);
    expect(moved.position.x).toBeLessThan(.2);
  });
  it('follows a walkable ramp up and down without hovering', () => {
    const ramp: TerrainSolid = {center: {x: 2, y: .5, z: 0}, size: {x: 4, y: 1, z: 3},
      traversal: {kind: 'ramp', axis: 'x', rise: 1}};
    const world = {solids: [ramp]}, h = surfaceHeight(ramp, .5, 0);
    const up = moveOnTerrain({x: .5, y: h, z: 0}, {x: .8, y: h, z: 0}, R.standingHeight, world, true);
    expect(up.position.y).toBeCloseTo(surfaceHeight(ramp, up.position.x, 0));
    expect(up.grounded).toBe(true);
    const down = moveOnTerrain(up.position, {...up.position, x: .5}, R.standingHeight, world, true);
    expect(down.position.y).toBeCloseTo(h); expect(down.grounded).toBe(true);
  });
  it('does not classify a steep surf plane as standing support', () => {
    const ramp: TerrainSolid = {center: {x: 0, y: 2, z: 0}, size: {x: 2, y: 4, z: 3},
      traversal: {kind: 'ramp', axis: 'x', rise: 4}};
    const top = surfaceHeight(ramp, 0, 0);
    expect(verticalContact({x: 0, y: 0, z: 0}, top + .2, top - .2, R.standingHeight, [ramp]).grounded).toBe(false);
  });
  it('keeps the hull clear through a complete ramp traversal', () => {
    const ramp: TerrainSolid = {center: {x: 2, y: .5, z: 0}, size: {x: 4, y: 1, z: 3},
      traversal: {kind: 'ramp', axis: 'x', rise: 1}};
    let actor = standing(-1);
    for (let i = 0; i < 220; i++) {
      const before = actor;
      actor = advanceActor(actor, {...idleInput(), side: 1}, 250 * UNIT, STEP, undefined, undefined, undefined, {solids: [ramp]});
      expect(fitsHull(actor.position, actor.feet, R.standingHeight, [ramp]), JSON.stringify({tick: i, before, actor})).toBe(true);
      expect(Number.isFinite(actor.position.y)).toBe(true);
    }
    expect(actor.position.x).toBeGreaterThan(4.5);
    expect(actor.feet).toBe(0);
  });
});

describe('optional ladder and water traversal', () => {
  const ladder: TerrainSolid = {center: {x: 0, y: 2, z: 0}, size: {x: 1, y: 4, z: .2},
    traversal: {kind: 'ladder', normal: {x: 0, y: 0, z: 1}}};
  const water: TerrainSolid = {center: {x: 0, y: 1, z: 0}, size: {x: 10, y: 2, z: 10}, traversal: {kind: 'water'}};
  it('uses trigger volumes without turning water or ladders into walls', () => {
    expect(fitsHull({x: 0, y: 0, z: 0}, 0, R.standingHeight, [ladder, water])).toBe(true);
    expect(waterLevel({x: 0, y: 0, z: 0}, 0, R.standingHeight, [water])).toBe(3);
  });
  it('climbs into the ladder and stops vertical motion on release', () => {
    let actor = standing();
    for (let i = 0; i < 20; i++) actor = advanceActor(actor, {...idleInput(), forward: 1}, 250 * UNIT,
      STEP, undefined, undefined, undefined, {solids: [ladder]});
    expect(actor.moveMode).toBe('ladder'); expect(actor.feet).toBeGreaterThan(.5);
    expect(actor.verticalVelocity).toBeCloseTo(250 * UNIT * .78);
    actor = advanceActor(actor, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined, {solids: [ladder]});
    expect(actor.verticalVelocity).toBe(0);
  });
  it('blocks climbing at a low ceiling', () => {
    const roof = {center: {x: 0, y: 2.2, z: 0}, size: {x: 3, y: .2, z: 3}};
    let actor = standing();
    for (let i = 0; i < 30; i++) actor = advanceActor(actor, {...idleInput(), forward: 1}, 250 * UNIT,
      STEP, undefined, undefined, undefined, {solids: [ladder, roof]});
    expect(actor.feet + R.standingHeight).toBeLessThanOrEqual(2.1 + 1e-7);
  });
  it('does not reattach immediately after a ladder jump edge', () => {
    let actor = standing(0, .3);
    actor = advanceActor(actor, {...idleInput(), jump: true}, 250 * UNIT, STEP, undefined, undefined, undefined, {solids: [ladder]});
    expect(actor.ladderDetached).toBe(true);
    expect(actor.velocity.z).toBeCloseTo(native.constants.ladderDetachSpeed * UNIT);
    actor = advanceActor(actor, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined, {solids: [ladder]});
    expect(actor.moveMode).toBe('air'); expect(actor.verticalVelocity).toBeLessThan(0);
  });
  it('swims upward while jump is held without a ground jump impulse', () => {
    const actor = advanceActor(standing(), {...idleInput(), jump: true}, 250 * UNIT, STEP,
      undefined, undefined, undefined, {solids: [water]});
    expect(actor.moveMode).toBe('water'); expect(actor.verticalVelocity).toBeGreaterThan(0);
    expect(actor.verticalVelocity).toBeLessThan(1);
  });
  it('applies gravity after leaving a water volume', () => {
    const actor = advanceActor({...standing(6, .5), verticalVelocity: -1}, idleInput(), 250 * UNIT,
      STEP, undefined, undefined, undefined, {solids: [water]});
    expect(actor.moveMode).toBe('air'); expect(actor.verticalVelocity).toBeCloseTo(-1 - GRAVITY * STEP);
  });
  it('uses the authored water surface separately from its trigger box', () => {
    const shallow: TerrainSolid = {...water, traversal: {kind: 'water', surfaceY: .3}};
    expect(waterLevel(standing().position, 0, R.standingHeight, [shallow])).toBe(1);
  });
});
