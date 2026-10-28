import {describe, expect, it, vi} from 'vitest';
import {DEG, type Vec} from '../actor-physics';
import type {ActorHitPose} from './actor-hitboxes';
import {MAX_VISIBLE_CANDIDATES, visibleActorPoints} from './actor-visibility';
import {SightingMemory} from './awareness';
import {testArena} from './geometry';
import {copyVisibleEnemy, currentVisible, observeBot, selectVisibleAimCandidate,
  type BotObservation, type VisibleAimCandidate, type VisibilityFilter} from './perception';
import {botSensorView, pointInView, type EnemyShadowProxy} from './shadows';
import type {DuelActorSnapshot} from './types';

const p = (x = 0, y = 1.62, z = 0): Vec => ({x, y, z});
const actor = (id = 0): DuelActorSnapshot => ({id, generation: 0, side: id ? 'enemy' : 'player',
  position: p(0, 1.62, id ? -8 : 0), feet: 0, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0,
  crouched: false, duckAmount: 0, health: 100, armor: 100, helmet: true, alive: true,
  equipment: 'ak47', ammo: 30, reloading: false});
const sphere = (point: Vec, group: VisibleAimCandidate['group'] = 'head', radius = .12) =>
  ({point0: point, point1: {...point}, radius, group});
const targetAt = (point: Vec) => ({...actor(1), feet: point.y - 1.62, position: {...point}});
const candidate = (group: VisibleAimCandidate['group'], margin: number, point = p(0, 1.62, -8)): VisibleAimCandidate =>
  ({group, point, exposureMargin: margin, exposure: 1, observedAt: 1});
const proxy = (point: Vec): EnemyShadowProxy => ({id: 'surface', side: 'enemy', samples: [point], contrast: .5});

describe('canonical bot camera sensing', () => {
  it('uses a fixed 16:9 full frustum with CS 90-degree 4:3-reference FOV', () => {
    const view = botSensorView();
    expect(view.aspect).toBe(16 / 9);
    expect(view.verticalFov).toBeCloseTo(2 * Math.atan(.75));
    const self = actor(), provider = vi.fn((enemy: DuelActorSnapshot): ActorHitPose =>
      ({capsules: [sphere(enemy.position)]}));
    const see = (point: Vec) => observeBot(1, self, [targetAt(point)], testArena(), undefined, [], provider);
    expect(see(p(0, self.position.y + 5.7, -8)).visible).not.toBeNull();
    provider.mockClear();
    expect(see(p(0, self.position.y + 12, -8)).visible).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    expect(see(p(0, self.position.y - 6.3, -8)).visible).toBeNull();
    expect(see(p(10.3, self.position.y, -8)).visible).not.toBeNull();
    expect(see(p(11, self.position.y, -8)).visible).toBeNull();
    expect(see(p(0, self.position.y, 8)).visible).toBeNull();
    expect(see(p(0, self.position.y, -8)).view).toEqual(view);
  });

  it.each([-.7, .7])('rotates vertical vision with actual eye position and pitch %s', pitch => {
    const self = {...actor(), pitch, yaw: .6, position: p(2, 5, 1)};
    const world = (up: number): Vec => ({
      x: self.position.x - Math.sin(self.yaw) * Math.cos(pitch) * 8 + Math.sin(self.yaw) * Math.sin(pitch) * up,
      y: self.position.y + Math.sin(pitch) * 8 + Math.cos(pitch) * up,
      z: self.position.z - Math.cos(self.yaw) * Math.cos(pitch) * 8 + Math.cos(self.yaw) * Math.sin(pitch) * up,
    });
    for (const [up, expected] of [[5.7, true], [6.3, false], [-6.3, false]] as const) {
      const point = world(up);
      const observed = observeBot(1, self, [targetAt(point)], testArena(), undefined, [],
        () => ({capsules: [sphere(point)]}));
      expect(!!observed.visible).toBe(expected);
    }
  });

  it('narrows actor and shadow sight with scopeFov, but preserves an explicit player view', () => {
    const self = {...actor(), equipment: 'awp' as const, scopeFov: 40}, point = p(3, 1.62, -8);
    const see = (scopeFov: number) => observeBot(1, {...self, scopeFov}, [targetAt(point)],
      testArena(), undefined, [proxy(point)]);
    expect(see(90).visible).not.toBeNull(); expect(see(40).visible).not.toBeNull();
    expect(see(10).visible).toBeNull(); expect(see(10).shadowCues).toEqual([]);
    expect(see(40).shadowCues).toHaveLength(1);
    const explicit = {aspect: 1, verticalFov: 60 * DEG};
    const observed = observeBot(1, {...self, scopeFov: 10}, [targetAt(point)], testArena(), explicit);
    expect(observed.visible).not.toBeNull(); expect(observed.view).toEqual(explicit);
    observed.view!.aspect = 9; expect(explicit.aspect).toBe(1);
    expect(observeBot(1, actor(), [targetAt(point)], testArena(), {aspect: .1, verticalFov: 20 * DEG}).visible).toBeNull();
  });

  it('fails closed on malformed explicit views and leaves legacy low-level yaw fallback intact', () => {
    for (const view of [{aspect: Infinity, verticalFov: 1}, {aspect: 1, verticalFov: NaN},
      {aspect: 0, verticalFov: 1}, {aspect: 1, verticalFov: Math.PI}])
      expect(observeBot(1, actor(), [actor(1)], testArena(), view).visible).toBeNull();
    const highPoint = p(0, 40, -8);
    expect(pointInView(actor(), highPoint)).toBe(true);
    expect(pointInView(actor(), highPoint, botSensorView())).toBe(false);
  });
});

describe('bounded visible hitgroup selection', () => {
  it('returns timestamped native candidates for every exposed group, without pose aliases', () => {
    const pose: ActorHitPose = {capsules: [sphere(p(0, 1.7, -8)), sphere(p(0, 1.3, -8), 'chest', .2),
      sphere(p(0, .9, -8), 'stomach', .18), sphere(p(.4, 1.2, -8), 'arm'), sphere(p(0, .4, -8), 'leg')]};
    const seen = observeBot(1, actor(), [actor(1)], testArena(), undefined, [], () => pose).visible!;
    expect(seen.candidates!.length).toBeLessThanOrEqual(MAX_VISIBLE_CANDIDATES);
    expect(new Set(seen.candidates!.map(c => c.group))).toEqual(new Set(['head', 'chest', 'stomach', 'arm', 'leg']));
    expect(seen.candidates!.every(c => c.observedAt === 1 && c.exposure > 0 && c.exposureMargin > 0)).toBe(true);
    const remembered = copyVisibleEnemy(seen), before = structuredClone(remembered);
    pose.capsules[0].point0.x = 99;
    seen.candidates![0].point.x = 88; seen.aimCandidate!.point.y = 77;
    expect(remembered).toEqual(before);
    expect(currentVisible({time: 1, self: actor(), visible: remembered}, 1.08)).toBeNull();
  });

  it('bounds sensor work and candidate output for oversized pose providers', () => {
    const pose = {capsules: Array.from({length: 300}, () => sphere(p(0, 1.62, -8)))};
    const filter = vi.fn(() => true);
    const seen = observeBot(1, actor(), [actor(1)], testArena(), undefined, [], () => pose, filter).visible!;
    expect(filter.mock.calls.length).toBeLessThanOrEqual(64);
    expect(seen.candidates!.length).toBeLessThanOrEqual(MAX_VISIBLE_CANDIDATES);
  });

  it('keeps head-only and limb-only openings hittable, never aiming at a hidden center', () => {
    const arena = testArena();
    arena.solids = [{center: p(-5, 1.5, -4), size: p(10, 3, .1)}];
    for (const group of ['head', 'arm', 'leg'] as const) {
      const capsule = sphere(p(0, 1.62, -8), group);
      if (group !== 'head') {capsule.point0.x = -.2; capsule.point1.x = .2;}
      const pose = {capsules: [capsule]};
      const seen = observeBot(1, {...actor(), equipment: 'awp'}, [actor(1)], arena, undefined, [], () => pose).visible!;
      expect(seen.aimPoint.x).toBeGreaterThan(0);
      expect(seen.aimCandidate!.group).toBe(group);
      expect(seen.candidates!.every(c => c.point.x > 0 && c.exposure < 1)).toBe(true);
    }
  });

  it('prefers rifle head damage, AWP torso, and shotgun exposed area with identical sight', () => {
    const candidates = [candidate('head', .135), candidate('chest', .23)];
    expect(selectVisibleAimCandidate(actor(), candidates)!.group).toBe('head');
    expect(selectVisibleAimCandidate({...actor(), equipment: 'awp', scopeFov: 40}, candidates)!.group).toBe('chest');
    expect(selectVisibleAimCandidate({...actor(), equipment: 'nova'}, candidates)!.group).toBe('chest');
  });

  it('uses range and own accuracy uncertainty, not hidden target health, armor or helmet', () => {
    const candidates = [candidate('head', .1), candidate('stomach', .25)];
    expect(selectVisibleAimCandidate(actor(), candidates, {angularUncertainty: .001})!.group).toBe('head');
    expect(selectVisibleAimCandidate(actor(), candidates, {angularUncertainty: .08})!.group).toBe('stomach');
    const far = candidates.map(c => ({...c, point: {...c.point, z: -60}}));
    expect(selectVisibleAimCandidate(actor(), candidates, {angularUncertainty: .01})!.group).toBe('head');
    expect(selectVisibleAimCandidate(actor(), far, {angularUncertainty: .01})!.group).toBe('stomach');
    const enemy = actor(1), reference = observeBot(1, actor(), [enemy], testArena());
    for (const [health, armor, helmet] of [[1, 0, false], [100, 100, true]] as const) {
      const hidden = {...enemy};
      Object.defineProperties(hidden, {health: {get: () => {throw new Error(`hidden ${health}`);}},
        armor: {get: () => {throw new Error(`hidden ${armor}`);}}, helmet: {get: () => {throw new Error(`hidden ${helmet}`);}}});
      expect(observeBot(1, actor(), [hidden], testArena())).toEqual(reference);
    }
  });

  it('retains a recent near-equivalent choice but never a stale or newly hidden candidate', () => {
    const self = {...actor(), equipment: 'awp' as const};
    const head = candidate('head', .2), chest = candidate('chest', .205);
    const previousVisible = {id: 1, position: p(), aimPoint: head.point, aimCandidate: {...head, observedAt: .97}};
    expect(selectVisibleAimCandidate(self, [head, chest])!.group).toBe('chest');
    expect(selectVisibleAimCandidate(self, [head, chest], {previousVisible})!.group).toBe('head');
    expect(selectVisibleAimCandidate(self, [chest], {previousVisible})!.group).toBe('chest');
    expect(selectVisibleAimCandidate(self, [head, chest], {previousVisible: {...previousVisible,
      aimCandidate: {...head, observedAt: .8}}})!.group).toBe('chest');
  });
});

describe('smoke and flash visibility predicates', () => {
  it('filters each probe before selection, not just the preferred aimPoint, and filters shadows', () => {
    const filter = vi.fn((from: Vec, to: Vec) => from.z === 0 && to.x > 0);
    const pose = {capsules: [sphere(p(0, 1.62, -8)), sphere(p(.5, 1.2, -8), 'arm')]};
    const observed = observeBot(1, actor(), [actor(1)], testArena(), undefined,
      [proxy(p(-1, 0, -8)), proxy(p(1, 0, -8))], () => pose, filter);
    expect(observed.visibilityFilter).toBe(filter);
    expect(observed.visible!.candidates!.every(c => c.point.x > 0)).toBe(true);
    expect(observed.visible!.aimPoint.x).toBeGreaterThan(0);
    expect(observed.shadowCues).toHaveLength(1); expect(observed.shadowCues![0].point.x).toBe(1);
    expect(filter.mock.calls.length).toBeLessThanOrEqual(66);
    const bodyOnly = observeBot(1, actor(), [actor(1)], testArena(), undefined, [], () => pose,
      (_from, to) => to.y < 1.4).visible!;
    expect(bodyOnly.headPoint).toBeUndefined(); expect(bodyOnly.aimCandidate!.group).toBe('arm');
    expect(visibleActorPoints(actor(), actor(1), testArena(), undefined, pose, () => false)).toBeNull();
    const blinded = observeBot(1, actor(), [actor(1)], testArena(), undefined, [proxy(p(1, 0, -8))], () => pose, () => false);
    expect(blinded.visible).toBeNull(); expect(blinded.shadowCues).toEqual([]);
  });

  it.each(['flash', 'partial-smoke'] as const)('does not clear remembered openings through %s, including cached clear geometry', mode => {
    const arena = testArena();
    arena.solids = [{center: p(0, 1.5, 0), size: p(6, 3, 1.2)}];
    const self = {...actor(), position: p(0, 1.62, -8), yaw: Math.PI};
    const memory = new SightingMemory(10, arena);
    const observe = (time: number, visibilityFilter?: VisibilityFilter): BotObservation =>
      ({time, self, visible: null, visibilityFilter});
    memory.observe({...observe(0), visible: {id: 1, position: p(4.4, 1.62, 1.4), aimPoint: p(4.4, 1.62, 1.4)}});
    memory.observe(observe(.5));
    const focus = memory.focus(.5)!;
    self.yaw = Math.atan2(-(focus.x - self.position.x), -(focus.z - self.position.z));
    memory.observe(observe(.625));
    const before = memory.hypotheses(.625).map(c => c.cleared);
    const filter: VisibilityFilter = mode === 'flash' ? () => false : (_from, to) => Math.abs(to.x - focus.x) < .01;
    // This frame falls inside the .12-second geometry cache window.
    memory.observe(observe(.65625, filter));
    expect(memory.hypotheses(.65625).map(c => c.cleared)).toEqual(before);
    for (let tick = 22; tick <= 80; tick++) memory.observe(observe(tick / 32, filter));
    expect(memory.hypotheses(2.5).find(c => c.point.x > 0)!.cleared).toBe(before[0]);
  });
});
