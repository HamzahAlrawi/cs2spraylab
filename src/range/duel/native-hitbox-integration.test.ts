import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';
import {resolveBulletRay} from './penetration';
import {testArena} from './geometry';
import type {ActorHitPose} from './actor-hitboxes';

describe('authoritative animated actor hitboxes', () => {
  it('samples sensor poses once per target per sensor cycle and keeps firing queries separate', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({behavior: 'holder'}), 44, testArena());
    sim.command(1, {});
    let sensors = 0, shots = 0;
    sim.actorSensorPose = actor => {sensors++; return {capsules: [{point0: {x: 0, y: 1.6, z: -5}, point1: {x: 0, y: 1.7, z: -5}, radius: .10922, group: 'head'}]};};
    sim.actorHitPose = () => {shots++; return {capsules: []};};
    sim.start(); for (let tick = 0; tick < 12; tick++) sim.step();
    expect(sensors).toBe(3); expect(shots).toBe(0);
  });
  it('radar reuses authoritative visible contacts instead of spotting an absent native pose through analytic fallback', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({behavior: 'holder', radarEnabled: true}), 44, testArena());
    sim.command(1, {}); let calls = 0;
    sim.actorSensorPose = () => {calls++; return {capsules: []};};
    sim.start(); sim.step();
    expect(calls).toBe(1); expect(sim.radar.snapshot(sim.time)).toEqual([]);
  });
  it('uses the supplied capsule in flesh entry/exit, respecting cover and fixed world impact points', () => {
    const pose: ActorHitPose = {capsules: [{point0: {x: .4, y: 1.5, z: -10}, point1: {x: .4, y: 1.6, z: -10}, radius: .10922, group: 'head'}]};
    const input = {origin: {x: .4, y: 1.55, z: 0}, direction: {x: 0, y: 0, z: -1}, range: 20, equipment: 'ak47' as const,
      arena: {solids: []}, actors: [{id: 1, side: 'enemy', alive: true, feet: 0, position: {x: 0, y: 1.6256, z: -10}, hitPose: pose}]};
    const hit = resolveBulletRay(input).hits[0], point = {...hit.point};
    expect(hit.group).toBe('head'); expect(hit.thickness).toBeCloseTo(.21844, 8);
    expect(resolveBulletRay({...input, actors: input.actors.map(a => ({...a, hitPose: undefined}))}).hits).toHaveLength(0);
    const covered = resolveBulletRay({...input, arena: {solids: [],
      native: {ray: () => ({distance: 5, normal: {x: 0, y: 0, z: 1}})}}});
    expect(covered.hits).toHaveLength(0); expect(covered.stopped).toBe('surface');
    expect(covered.endPoint).toEqual({x: .4, y: 1.55, z: -5});
    pose.capsules[0].point0.x += 5; pose.capsules[0].point1.x += 5;
    expect(hit.point).toEqual(point); expect(resolveBulletRay(input).hits).toHaveLength(0);
  });
  it('samples current post-movement state on the real firing tick, without modifying the shot ray', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({health: 100, behavior: 'holder'}), 42, testArena());
    sim.command(1, {});
    const p = sim.actors[0], b = sim.actors[1];
    Object.assign(p, {position: {x: 0, y: 64 * UNIT, z: 8}, feet: 0, grounded: true, yaw: 0, pitch: 0});
    Object.assign(b, {position: {x: 0, y: 64 * UNIT, z: -5}, feet: 0, grounded: true});
    p.weapon = new DuelWeaponState('ak47', () => 0, {spread: false});
    let calls = 0;
    sim.actorHitPose = actor => {
      calls++; expect(sim.time).toBe(STEP); expect(actor.id).toBe(1); expect(actor.position).toEqual(b.position);
      return {capsules: [{point0: {x: 0, y: 1.6, z: -5}, point1: {x: 0, y: 1.7, z: -5}, radius: .10922, group: 'head'}]};
    };
    sim.start(); sim.command(0, {firePressed: true}); sim.step();
    const events = sim.drainEvents();
    expect(events.find(e => e.kind === 'fire')).toMatchObject({origin: p.position, direction: {x: -0, y: 0, z: -1}});
    expect(events.find(e => e.kind === 'hit')).toMatchObject({victim: 1, group: 'head', tick: 1});
    expect(calls).toBe(1);
  });
});
