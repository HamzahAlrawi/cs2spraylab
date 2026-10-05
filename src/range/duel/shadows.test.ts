import {describe, expect, it} from 'vitest';
import {DEG} from '../actor-physics';
import {testArena} from './geometry';
import {observeBot} from './perception';
import {observeShadows, type EnemyShadowProxy} from './shadows';
import type {DuelActorSnapshot} from './types';

const self = (): DuelActorSnapshot => ({id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 1.62, z: 6},
  feet: 0, grounded: true, velocity: {x: 0, z: 0}, yaw: 0, pitch: -.2, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const proxy = (x = 1, z = 0): EnemyShadowProxy => ({id: 'exposed-surface', side: 'player',
  contrast: .5, samples: [{x, y: .01, z}]});

describe('surface-only enemy shadow evidence', () => {
  it('returns the exposed surface point with bounded uncertainty, not the caster origin', () => {
    const input = proxy(), cues = observeShadows(1, self(), [input], testArena());
    expect(cues).toEqual([{id: input.id, point: input.samples[0], observedAt: 1,
      uncertainty: 1 + Math.hypot(1, 1.61, 6) * .035}]);
    expect(Object.keys(cues[0]).sort()).toEqual(['id', 'observedAt', 'point', 'uncertainty']);
    input.samples[0].x = 99;
    expect(cues[0].point.x).toBe(1);
  });

  it('rejects shadows behind cover, behind the observer, outside vertical FOV, faint, or allied', () => {
    const map = testArena();
    map.solids.push({center: {x: 0, y: 1.5, z: 3}, size: {x: 4, y: 3, z: 1}});
    expect(observeShadows(0, self(), [proxy()], map)).toEqual([]);
    expect(observeShadows(0, self(), [proxy(0, 10)], testArena())).toEqual([]);
    const lookingUp = {...self(), pitch: Math.PI / 3};
    expect(observeShadows(0, lookingUp, [proxy()], testArena())).toEqual([]);
    expect(observeShadows(0, self(), [{...proxy(), contrast: .01}], testArena())).toEqual([]);
    expect(observeShadows(0, self(), [{...proxy(), side: 'enemy'}], testArena())).toEqual([]);
    expect(observeShadows(0, self(), [proxy(100)], testArena())).toEqual([]);
  });

  it('checks real exposed samples rather than an occluded shadow centroid', () => {
    const map = testArena();
    map.solids.push({center: {x: 0, y: 1.5, z: 3}, size: {x: 2, y: 3, z: 1}});
    const samples = [proxy(0).samples[0], proxy(4).samples[0]];
    expect(observeShadows(0, self(), [{...proxy(), samples}], map)[0].point.x).toBe(4);
  });

  it('respects the supplied camera frustum and rejects nonfinite samples', () => {
    const view = {aspect: 1, verticalFov: 35 * DEG};
    expect(observeShadows(0, self(), [proxy(4)], testArena(), view)).toEqual([]);
    expect(observeShadows(0, self(), [proxy(.5)], testArena(), view)).toHaveLength(1);
    expect(observeShadows(0, self(), [{...proxy(), samples: [{x: NaN, y: 0, z: 0}]}], testArena())).toEqual([]);
  });

  it('observes a shadow without revealing a hidden actor, and keeps identical clues for divergent hidden poses', () => {
    const map = testArena();
    map.solids.push({center: {x: 0, y: 1.5, z: 3}, size: {x: 2, y: 3, z: 1}});
    const opponent = {...self(), id: 0, side: 'player' as const, position: {x: 0, y: 1.62, z: 0}};
    const hiddenOther = {...opponent, position: {x: .3, y: 1.1, z: -2}, velocity: {x: 6, z: 1}, duckAmount: 1};
    const a = observeBot(0, self(), [opponent], map, undefined, [proxy(4)]);
    const b = observeBot(0, self(), [hiddenOther], map, undefined, [proxy(4)]);
    expect(a.visible).toBeNull(); expect(b.visible).toBeNull();
    expect(a.shadowCues).toHaveLength(1); expect(a).toEqual(b);
    expect(observeBot(0, self(), [opponent], map).shadowCues).toBeUndefined();
  });

  it('bounds per-scan sample and proxy work', () => {
    const tooLate = {...proxy(), samples: [...Array.from({length: 12}, () => ({x: 100, y: 0, z: 0})), proxy().samples[0]]};
    expect(observeShadows(0, self(), [tooLate], testArena())).toEqual([]);
    expect(observeShadows(0, self(), Array.from({length: 50}, () => proxy()), testArena())).toHaveLength(24);
  });
});
