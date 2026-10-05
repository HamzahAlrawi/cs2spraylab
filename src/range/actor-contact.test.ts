import {describe, expect, it} from 'vitest';
import {advanceActor, idleInput, STEP, UNIT, type ActorKinematics} from './actor-physics';
import {actorHeight, actorHull, actorContactSolids, classifyActorContact, findActorSupport, separateActorPair,
  supportedActorStack, resizeSupportedStack, supportDisplacement, type ContactActor} from './actor-contact';
import {TERRAIN_RULES as R} from './terrain';

const body = (id: number, x = 0, feet = 0, duckAmount = 0): ContactActor & ActorKinematics => ({
  id, position: {x, y: feet + (64 - 18 * duckAmount) * UNIT, z: 0}, feet, duckAmount,
  eyeHeight: (64 - 18 * duckAmount) * UNIT, velocity: {x: 0, z: 0}, verticalVelocity: 0, jumpHeld: false, yaw: 0, grounded: true});

describe('three-dimensional player contact', () => {
  it('creates matching native-width standing/crouched collision hulls', () => {
    expect(actorHull(body(1)).size).toEqual({x: 32 * UNIT, y: 72 * UNIT, z: 32 * UNIT});
    expect(actorHeight(body(1, 0, 0, 1))).toBeCloseTo(54 * UNIT);
  });
  it('ignores dead actors and excludes self from collision snapshots', () => {
    expect(actorContactSolids([body(1), {...body(2), alive: false}, body(3)], 1)).toHaveLength(1);
  });
  it('rebuilds contact snapshots after in-place stance, position, and life changes', () => {
    const actor = body(1), actors = [actor], before = actorContactSolids(actors);
    actor.duckAmount = 1; actor.feet = .5; actor.position.x = 2;
    const after = actorContactSolids(actors);
    expect(after[0].size.y).toBeCloseTo(R.crouchingHeight);
    expect(after[0].center).toEqual({x: 2, y: .5 + R.crouchingHeight / 2, z: 0});
    expect(before[0].size.y).toBeCloseTo(R.standingHeight); expect(before[0].center.x).toBe(0);
    actor.alive = false; expect(actorContactSolids(actors)).toEqual([]);
  });
  it('preserves string support IDs through movement', () => {
    const base = {...body(1), id: 'base'}, rider = body(2, 0, R.standingHeight);
    const next = advanceActor(rider, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined,
      {solids: [], actors: [base], selfId: rider.id});
    expect(next.supportId).toBe('base'); expect(next.grounded).toBe(true);
  });
  it('preserves one-second open-world movement with six living actors', () => {
    let actors = Array.from({length: 6}, (_, id) => body(id, id * 3)), solo: ActorKinematics = body(0);
    const input = {...idleInput(), forward: 1};
    for (let tick = 0; tick < 128; tick++) {
      const previous = actors;
      actors = previous.map(actor => ({...actor, ...advanceActor(actor, input, 250 * UNIT, STEP,
        undefined, undefined, undefined, {solids: [], actors: previous, selfId: actor.id})}));
      solo = advanceActor(solo, input, 250 * UNIT, STEP);
    }
    for (const actor of actors) {
      expect(actor.position.z).toBeCloseTo(solo.position.z, 12);
      expect(actor.velocity).toEqual(solo.velocity); expect(actor.feet).toBe(0); expect(actor.grounded).toBe(true);
    }
  });
  it('allows actors to pass underneath a vertically separate actor', () => {
    const a = body(1), b = body(2, 0, 2.5);
    expect(classifyActorContact(a, b).kind).toBe('none');
    expect(separateActorPair(a, b).a).toBe(a);
  });
  it('separates side overlap without changing feet or mutating inputs', () => {
    const a = body(1), b = body(2, .4), result = separateActorPair(a, b);
    expect(result.separated).toBe(true);
    expect(Math.abs(result.a.position.x - result.b.position.x)).toBeCloseTo(32 * UNIT);
    expect(result.a.feet).toBe(0); expect(result.b.feet).toBe(0); expect(a.position.x).toBe(0);
  });
  it('moves only the free partner when the other one is wall-pinned', () => {
    const result = separateActorPair(body(1), body(2, .4), {canOccupy: (pose, id) => id !== 1 || pose.position.x >= 0});
    expect(result.a.position.x).toBe(0); expect(result.b.position.x).toBeCloseTo(32 * UNIT);
  });
  it('reports unresolved contact when both partners are pinned', () => {
    expect(separateActorPair(body(1), body(2, .4), {immovableA: true, immovableB: true}).separated).toBe(false);
  });
  it('retains head support instead of applying planar separation', () => {
    const base = body(1, 0, 0, 1), rider = body(2, .1, actorHeight(base));
    expect(classifyActorContact(rider, base).kind).toBe('a-on-b');
    expect(separateActorPair(base, rider).b).toBe(rider);
    expect(findActorSupport(rider, [base])?.id).toBe(1);
  });
  it('does not report support while a rider is jumping away', () => {
    const base = body(1), rider = {...body(2, 0, actorHeight(base)), verticalVelocity: 2};
    expect(findActorSupport(rider, [base])).toBeUndefined();
  });
  it('lands on a crouched actor and jumps from its head', () => {
    const base = body(1, 0, 0, 1);
    let rider = {...body(2, 0, actorHeight(base) + .02), grounded: false, verticalVelocity: -1};
    for (let i = 0; i < 8; i++) rider = {...rider, ...advanceActor(rider, idleInput(), 250 * UNIT, STEP,
      undefined, undefined, undefined, {solids: [], actors: [base], selfId: rider.id})};
    expect(rider.feet).toBeCloseTo(actorHeight(base)); expect(rider.supportId).toBe(1); expect(rider.grounded).toBe(true);
    const jumped = advanceActor(rider, {...idleInput(), jump: true}, 250 * UNIT, STEP,
      undefined, undefined, undefined, {solids: [], actors: [base], selfId: rider.id});
    expect(jumped.verticalVelocity).toBeGreaterThan(0); expect(jumped.supportId).toBeUndefined();
  });
  it('falls after a supporting actor dies', () => {
    const base = {...body(1), alive: false}, rider = {...body(2, 0, R.standingHeight), supportId: 1};
    const next = advanceActor(rider, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined,
      {solids: [], actors: [base], selfId: 2});
    expect(next.grounded).toBe(false); expect(next.feet).toBeLessThan(rider.feet);
  });
  it('does not let an actor use a nearby player as a stair', () => {
    const base = body(1, 1, -.4, 1), rider = body(2);
    const next = advanceActor({...rider, velocity: {x: 6, z: 0}}, {...idleInput(), side: 1}, 250 * UNIT,
      .15, undefined, undefined, undefined, {solids: [], actors: [base], selfId: 2});
    expect(next.feet).toBe(0); expect(next.position.x).toBeLessThan(.3);
  });
});

describe('boost stack support and clearance', () => {
  it('raises a rider when the base stands, without a manufactured launch velocity', () => {
    const base = body(1, 0, 0, 1), rider = body(2, 0, R.crouchingHeight);
    const raised = resizeSupportedStack(base, body(1), [base, rider], {solids: []});
    expect(raised?.[1].feet).toBeCloseTo(R.standingHeight);
    expect(raised?.[1].verticalVelocity).toBe(0); expect(rider.feet).toBe(R.crouchingHeight);
  });
  it('rejects unducking the whole stack through a ceiling', () => {
    const base = body(1, 0, 0, 1), rider = body(2, 0, R.crouchingHeight);
    const roof = {center: {x: 0, y: 3.6, z: 0}, size: {x: 3, y: .2, z: 3}};
    expect(resizeSupportedStack(base, body(1), [base, rider], {solids: [roof]})).toBeUndefined();
    const next = advanceActor(base, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined,
      {solids: [roof], actors: [rider], selfId: 1});
    expect(next.duckAmount).toBe(1);
  });
  it('finds multi-actor stacks without including unrelated or dead players', () => {
    const base = body(1), rider = body(2, 0, R.standingHeight), top = body(3, 0, R.standingHeight * 2);
    expect(supportedActorStack(base, [base, top, body(4, 4), rider, {...body(5, 0, R.standingHeight), alive: false}])
      .map(actor => actor.id)).toEqual([2, 3]);
  });
  it('carries a support displacement once and preserves height after a stance change', () => {
    const previous = body(1, 0, 0, 1), base = {...body(1), previous};
    const rider = {...body(2, 0, R.crouchingHeight), supportId: 1};
    expect(supportDisplacement(rider, [base]).y).toBeCloseTo(18 * UNIT);
    const next = advanceActor(rider, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined,
      {solids: [], actors: [base], selfId: 2});
    expect(next.feet).toBeCloseTo(R.standingHeight); expect(next.verticalVelocity).toBe(0);
    expect(supportDisplacement(next, [base]).y).toBe(0);
  });
  it('completes a crouched-base stand-up with a rider using successive snapshots', () => {
    let base = body(1, 0, 0, 1);
    let rider: ContactActor & ActorKinematics = {...body(2, 0, R.crouchingHeight), supportId: 1};
    for (let i = 0; i < 40; i++) {
      const previous = {...base, position: {...base.position}};
      base = {...base, ...advanceActor(base, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined,
        {solids: [], actors: [rider], selfId: 1})};
      rider = {...rider, ...advanceActor(rider, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined,
        {solids: [], actors: [{...base, previous}], selfId: 2})};
      expect(rider.feet).toBeCloseTo(base.feet + actorHeight(base));
      expect(rider.verticalVelocity).toBe(0);
    }
    expect(base.duckAmount).toBe(0); expect(rider.feet).toBeCloseTo(R.standingHeight);
  });
  it('does not treat a jumping base as grounded jump support', () => {
    const base = {...body(1), grounded: false, verticalVelocity: 2};
    const rider = body(2, 0, R.standingHeight);
    expect(findActorSupport(rider, [base])?.grounded).toBe(false);
    const next = advanceActor(rider, {...idleInput(), jump: true}, 250 * UNIT, STEP,
      undefined, undefined, undefined, {solids: [], actors: [base], selfId: 2});
    expect(next.verticalVelocity).toBeLessThanOrEqual(0); expect(next.grounded).toBe(false);
  });
  it('falls after the rider moves clear of the base hull', () => {
    const base = body(1), rider = {...body(2, 1, R.standingHeight), supportId: 1};
    const next = advanceActor(rider, idleInput(), 250 * UNIT, STEP, undefined, undefined, undefined,
      {solids: [], actors: [base], selfId: 2});
    expect(next.feet).toBeLessThan(rider.feet); expect(next.grounded).toBe(false);
  });
});
