import {expect, it, vi} from 'vitest';
import {buildSmokeVolume, smokeVolumeSteps} from './smoke-volume';
import {UtilitySimulation, UTILITY_RULES} from './utilities';
import {testArena} from './geometry';

it('paced volume work produces exactly the same authoritative cells as the synchronous fill', () => {
  const arena = testArena(); arena.solids.push({center: {x: .8, y: 2, z: 0}, size: {x: .2, y: 4, z: 5}});
  const position = {x: 0, y: .06, z: 0}, steps = smokeVolumeSteps(position, 4.2, arena);
  let next = steps.next(), queries = 0;
  while (!next.done) {queries++; next = steps.next();}
  expect(queries).toBeGreaterThan(100);
  expect(next.value).toEqual(buildSmokeVolume(position, 4.2, arena));
});

it('prepares a resting smoke before its minimum-age gate without a detonation-time query burst', () => {
  const ray = vi.fn(() => undefined), arena = testArena();
  Object.assign(arena, {native: {ray, sweepGrenade: (from: {x: number; y: number; z: number}, to: typeof from) => ({
    position: {...from}, fraction: 0, startSolid: false, contact: {normal: {x: 0, y: 1, z: 0}}})}});
  const simulation = new UtilitySimulation();
  simulation.throw({actorId: 0, side: 'player', kind: 'smoke', origin: {x: 0, y: .06, z: 0},
    direction: {x: 0, y: -1, z: 0}, strength: 0, time: 0});
  let detonationQueries = Infinity;
  for (let tick = 1; tick < 256; tick++) {
    ray.mockClear();
    const events = simulation.advance(UTILITY_RULES.step, tick * UTILITY_RULES.step, arena, []);
    if (events.some(event => event.type === 'detonate')) {detonationQueries = ray.mock.calls.length; break;}
  }
  expect(detonationQueries).toBeLessThanOrEqual(16);
  expect(simulation.effects[0].cells.length).toBeGreaterThan(100);
});
