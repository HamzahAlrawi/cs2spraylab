import {describe, expect, it, vi} from 'vitest';
import {Bone, Group} from 'three';
import {UNIT, type Vec} from '../actor-physics';
import {NativeActorHitboxes, nativeActorCapsules, type ActorHitPose} from './actor-hitboxes';
import {actorInSensorView, actorVisibilitySamples, MAX_VISIBILITY_SAMPLES} from './actor-visibility';
import {testArena, traceActor, traceSolid, type Arena} from './geometry';
import {currentVisible, observeBot} from './perception';
import type {DuelActorSnapshot} from './types';

const p = (x = 0, y = 0, z = 0): Vec => ({x, y, z});
const actor = (id = 0): DuelActorSnapshot => ({id, generation: 0, side: id ? 'enemy' : 'player',
  position: p(0, 64 * UNIT, id ? -8 : 0), feet: 0, velocity: {x: 0, z: 0}, yaw: id ? Math.PI : 0,
  pitch: 0, crouched: false, duckAmount: 0, health: 100, armor: 100, helmet: true, alive: true,
  equipment: 'ak47', ammo: 30, reloading: false});
const direction = (a: Vec, b: Vec) => {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return {x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length};
};
const sphere = (center = p(0, 1.6, -8), group: 'head' | 'arm' = 'head'): ActorHitPose =>
  ({capsules: [{point0: center, point1: {...center}, radius: .12, group}]});
const observe = (self: DuelActorSnapshot, enemy: DuelActorSnapshot, arena = testArena(), pose?: ActorHitPose) =>
  observeBot(0, self, [enemy], arena, undefined, [], pose ? () => pose : undefined);

describe('shared pose-aware visibility', () => {
  it.each([0, Math.PI / 2, Math.PI])('keeps analytic probes inside rotated shot geometry at yaw %s', yaw => {
    for (const duck of [0, .4, 1]) {
      const self = actor(), enemy = {...actor(1), yaw, duckAmount: duck, feet: 3, position: p(2, 4.2, -8)};
      const samples = actorVisibilitySamples(enemy, self.position);
      expect(samples.length).toBeLessThanOrEqual(MAX_VISIBILITY_SAMPLES);
      expect(new Set(samples.map(sample => sample.group))).toEqual(new Set(['head', 'chest', 'stomach', 'arm', 'leg']));
      for (const {point} of samples) expect(Number.isFinite(traceActor(self.position, direction(self.position, point),
        {...enemy.position, y: enemy.feet}, duck, Infinity, yaw).distance)).toBe(true);
    }
  });

  it('rotates analytic body hitboxes as well as shoulder samples', () => {
    const feet = p(0, 0, -8), origin = p(.38, 1.2), forward = p(0, 0, -1);
    expect(traceActor(origin, forward, feet, 0, 10, 0).group).toBe('arm');
    expect(traceActor(origin, forward, feet, 0, 10, Math.PI / 2).group).toBeUndefined();
    const widths = [0, Math.PI / 2].map(yaw => Math.max(...actorVisibilitySamples({...actor(1), yaw}, origin)
      .filter(sample => sample.group !== 'head').map(sample => Math.abs(sample.point.x))));
    expect(widths[0]).toBeGreaterThan(.38); expect(widths[1]).toBeLessThan(.18);
  });

  it.each([-1, 1])('detects a native head sliver on cover side %s without aiming at its blocked center', side => {
    const self = actor(), enemy = actor(1), pose = sphere();
    const arena: Arena = {...testArena(), solids: [{center: p(-side * 5, 1.5, -4), size: p(10, 3, .1)}]};
    const seen = observe(self, enemy, arena, pose).visible!;
    expect(seen).not.toBeNull(); expect(seen.aimPoint.x * side).toBeGreaterThan(0);
    const ray = direction(self.position, seen.aimPoint);
    expect(traceActor(self.position, ray, p(0, 0, -8), 0, 10, enemy.yaw, pose).group).toBe('head');
    expect(traceSolid(self.position, ray, arena, 10).distance).toBeGreaterThan(8);
  });

  it('does not see a crouched pose through low cover after seeing the standing head', () => {
    const self = actor(), enemy = actor(1), arena = testArena();
    arena.solids = [{center: p(0, .7, -7.7), size: p(8, 1.4, .1)}];
    expect(observe(self, enemy, arena).visible?.headPoint).toBeDefined();
    expect(observe(self, {...enemy, duckAmount: 1, crouched: true}, arena).visible).toBeNull();
  });

  it.each(['fire', 'reload'] as const)('uses the supplied %s pose, never an invented analytic head', action => {
    const self = actor(), enemy = {...actor(1), action}, arena = testArena();
    arena.solids = [{center: p(-4.85, 1.5, -4), size: p(10, 3, .1)}];
    const pose = sphere(p(.7, 1.05, -8), 'arm');
    const seen = observe(self, enemy, arena, pose).visible!;
    expect(seen?.bodyPoint).toBeDefined(); expect(seen.headPoint).toBeUndefined();
    expect(traceActor(self.position, direction(self.position, seen.aimPoint), p(0, 0, -8), 0, 10, enemy.yaw, pose).group).toBe('arm');
    expect(observe(self, enemy, arena, {capsules: []}).visible).toBeNull();
  });

  it('samples native bone captures without mutating shot poses or aliasing observations', () => {
    const root = new Group(); root.position.z = -8;
    for (const definition of nativeActorCapsules) {
      const bone = new Bone(); bone.name = definition.bone; bone.position.y = 1.6; root.add(bone);
    }
    root.updateMatrixWorld(true);
    const native = new NativeActorHitboxes(root), self = actor(), enemy = actor(1);
    const before = JSON.stringify(native.pose);
    const samples = actorVisibilitySamples(enemy, self.position, native.pose);
    expect(samples.length).toBeLessThanOrEqual(MAX_VISIBILITY_SAMPLES);
    expect(JSON.stringify(native.pose)).toBe(before);
    const observation = observe(self, enemy, testArena(), native.pose), remembered = {...observation.visible!.aimPoint};
    root.position.x = 4; root.position.y = -.5; root.updateMatrixWorld(true); native.capture();
    expect(observation.visible!.aimPoint).toEqual(remembered);
    expect(currentVisible(observation, .1)).toBeNull();
  });

  it('broadphases dead/friendly/rear actors before pose capture and invokes a provider only at caller cadence', () => {
    const self = actor(), enemy = actor(1), provider = vi.fn(() => sphere());
    expect(actorInSensorView(self, {...enemy, position: p(0, 1.6, 20)})).toBe(false);
    observeBot(0, self, [{...enemy, alive: false}, {...enemy, side: 'player'},
      {...enemy, position: p(0, 1.6, 20)}], testArena(), undefined, [], provider);
    expect(provider).not.toHaveBeenCalled();
    for (let tick = 0; tick < 128; tick++) if (tick % 4 === 0)
      observeBot(tick / 128, self, [enemy], testArena(), undefined, [], provider);
    expect(provider).toHaveBeenCalledTimes(32);
  });
  it('skips native pose work only when one convex wall covers the full shot-query envelope', () => {
    const self = actor(), enemy = actor(1), provider = vi.fn(() => sphere());
    const arena: Arena = {...testArena(), solids: [{center: p(0, 1.5, -3), size: p(8, 5, .5)}]};
    expect(observeBot(0, self, [enemy], arena, undefined, [], provider).visible).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    arena.solids[0].size.x = .15;
    observeBot(.04, self, [enemy], arena, undefined, [], provider);
    expect(provider).toHaveBeenCalledOnce();
  });

  it('returns identical null observations for different fully hidden native poses and malformed probes', () => {
    const self = actor(), enemy = actor(1), arena = testArena();
    arena.solids = [{center: p(0, 1.5, -4), size: p(6, 3, .1)}];
    expect(observe(self, enemy, arena, sphere(p(-.8, 1.6, -8)))).toEqual(observe(self, enemy, arena, sphere(p(.8, .8, -8))));
    expect(observe(self, enemy, testArena(), sphere(p(NaN, 1.6, -8))).visible).toBeNull();
  });
});
