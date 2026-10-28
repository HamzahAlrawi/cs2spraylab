import {describe, expect, it, vi} from 'vitest';
import type {Vec} from '../actor-physics';
import type {ActorHitPose} from './actor-hitboxes';
import {actorVisibilitySamples, MAX_VISIBILITY_RAYS, visibleActorPoints} from './actor-visibility';
import {testArena, type Arena} from './geometry';
import {botSensorView, pointInView} from './shadows';
import type {DuelActorSnapshot, Hitgroup} from './types';

const self: DuelActorSnapshot = {id: 0, generation: 0, side: 'player', position: {x: 0, y: 1.62, z: 0},
  feet: 0, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false};
const enemy = {...self, id: 1, side: 'enemy' as const, position: {x: 0, y: 1.62, z: -8}};
const capsule = (group: Hitgroup, y = 1.62, x = 0, radius = .12) =>
  ({group, point0: {x, y, z: -8}, point1: {x, y, z: -8}, radius});
const pose = (): ActorHitPose => ({capsules: [capsule('head'),
  ...Array.from({length: 4}, () => capsule('chest', 1.3, 0, .2)),
  ...Array.from({length: 2}, () => capsule('stomach', .9, 0, .18)),
  ...Array.from({length: 6}, () => capsule('arm', 1.2)),
  ...Array.from({length: 6}, () => capsule('leg', .4))]});
function nativeArena(blocked = false) {
  const ray = vi.fn(() => blocked ? {distance: 1, surfaceId: 0, normal: {x: 0, y: 0, z: 1}} : undefined);
  const arena: Arena = {...testArena(), native: {ray, fits: () => true,
    sweep: () => {throw Error('unused');}, vertical: () => {throw Error('unused');}}};
  return {arena, ray};
}

describe('adaptive actor visibility work budget', () => {
  it('uses one ray per hitgroup in open native sight instead of tracing the full pose', () => {
    const {arena, ray} = nativeArena(), input = pose();
    expect(actorVisibilitySamples(enemy, self.position, input).length).toBeGreaterThan(50);
    const points = visibleActorPoints(self, enemy, arena, botSensorView(), input)!;
    expect(ray).toHaveBeenCalledTimes(5);
    expect(points.candidates.map(c => c.group)).toEqual(['head', 'chest', 'stomach', 'arm', 'leg']);
    expect(points.candidates.every(c => c.sampleCoverage! < 1 && c.exposure <= c.sampleCoverage!)).toBe(true);
  });

  it('never exceeds 24 native traces for a completely occluded full pose', () => {
    const {arena, ray} = nativeArena(true), input = pose();
    expect(visibleActorPoints(self, enemy, arena, botSensorView(), input)).toBeNull();
    expect(ray).toHaveBeenCalledTimes(MAX_VISIBILITY_RAYS);
  });

  it('also bounds smoke/flash predicates, without tracing obscured probes', () => {
    const {arena, ray} = nativeArena(), filter = vi.fn(() => false);
    expect(visibleActorPoints(self, enemy, arena, botSensorView(), pose(), filter)).toBeNull();
    expect(filter).toHaveBeenCalledTimes(MAX_VISIBILITY_RAYS);
    expect(ray).not.toHaveBeenCalled();
  });

  it('does not treat unchecked duplicate centers as blocked or claim full exposure', () => {
    const {arena, ray} = nativeArena();
    const input = {capsules: Array.from({length: 19}, () => capsule('head', 1.62, 0, .2))};
    const candidate = visibleActorPoints(self, enemy, arena, botSensorView(), input)!.candidates[0];
    expect(ray).toHaveBeenCalledOnce();
    expect(candidate.exposureMargin).toBe(.2);
    expect(candidate.exposure).toBe(1 / 64);
    expect(candidate.sampleCoverage).toBe(1 / 64);
  });

  it('still constrains clearance using checked blocked centers, not unchecked duplicates', () => {
    const input = {capsules: [capsule('head', 1.62, 0, .2), capsule('head', 1.62, .1),
      capsule('head', 1.62, .1)]};
    const candidate = visibleActorPoints(self, enemy, testArena(), botSensorView(), input,
      (_from, to) => to.x > .05)!.candidates[0];
    expect(candidate.exposureMargin).toBeCloseTo(.05);
    expect(candidate.sampleCoverage).toBeCloseTo(2 / 15);
    expect(candidate.exposure).toBeCloseTo(1 / 15);
  });

  it.each([-1, 1])('retains head-only edge exposure on side %s with competing blocked groups', side => {
    const input = pose(), {arena, ray} = nativeArena();
    const points = visibleActorPoints(self, enemy, arena, botSensorView(), input,
      (_from, to) => to.x * side > .1 && to.y > 1.5)!;
    expect(points.aimPoint.x * side).toBeGreaterThan(.1);
    expect(points.headPoint).toBeDefined(); expect(points.bodyPoint).toBeUndefined();
    expect(ray.mock.calls.length).toBeLessThanOrEqual(MAX_VISIBILITY_RAYS);
  });

  it.each(['arm', 'leg'] as const)('retains a %s-only native capsule endpoint when its first probe is blocked', group => {
    const input = capsule(group, 1.2); input.point0.x = -.3; input.point1.x = .3;
    const points = visibleActorPoints(self, enemy, testArena(), botSensorView(), {capsules: [input]},
      (_from, to) => to.x > .1)!;
    expect(points.candidates[0].group).toBe(group); expect(points.aimPoint.x).toBeGreaterThan(.1);
  });

  it('accepts structural prefire view inputs without casting or actor-only fields', () => {
    const camera: {position: Vec; yaw: number; pitch: number} = {position: self.position, yaw: 0, pitch: 0};
    expect(pointInView(camera, enemy.position, botSensorView())).toBe(true);
  });
});
