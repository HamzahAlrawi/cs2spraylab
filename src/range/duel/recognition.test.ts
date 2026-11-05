import {expect, it} from 'vitest';
import {ExposureRecognition} from './recognition';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';

it('recognizes a sustained clear body sooner than a small confirmed sliver, without additional rays', () => {
  const self = new DuelSimulation(sanitizeDuelConfig({}), 1, testArena()).snapshot()[1];
  const run = (margin: number) => {
    const recognition = new ExposureRecognition();
    const point = {...self.position, z: self.position.z + 10};
    for (let tick = 0; tick < 32; tick++) {
      const time = tick / 32;
      recognition.update({time, self, visible: {id: 0, generation: 0, position: point, aimPoint: point,
        candidates: [{group: 'head', observedAt: time, point, exposure: .01, sampleCoverage: 1,
          exposureMargin: margin}]}});
      if (recognition.ready(time)) return time;
    }
    return Infinity;
  };
  expect(run(.12)).toBeLessThan(run(.002));
  expect(run(.002)).toBeLessThan(.3);
});

it('cannot accumulate recognition through smoke, sensor gaps or recycled actor identities', () => {
  const self = new DuelSimulation(sanitizeDuelConfig({}), 1, testArena()).snapshot()[1];
  const recognition = new ExposureRecognition(), point = {x: 0, y: 1.6, z: 0};
  const visible = {id: 0, generation: 0, position: point, aimPoint: point,
    candidates: [{group: 'head' as const, observedAt: 0, point, exposure: 1, exposureMargin: .12}]};
  for (let tick = 0; tick < 5; tick++) recognition.update({time: tick / 32, self, visible});
  expect(recognition.ready(.125)).toBe(true);
  recognition.update({time: .16, self, visible: null}); expect(recognition.ready(.16)).toBe(false);
  recognition.update({time: .19, self, visible}); expect(recognition.ready(.19)).toBe(true);
  recognition.update({time: .5, self, visible}); expect(recognition.ready(.5)).toBe(false);
  recognition.update({time: .53, self, visible: {...visible, generation: 1}});
  expect(recognition.ready(.53)).toBe(false);
});

it('leaves legacy observations without exposure data to the existing skill reaction gate', () => {
  const self = new DuelSimulation(sanitizeDuelConfig({}), 1, testArena()).snapshot()[1];
  const recognition = new ExposureRecognition(), point = {x: 0, y: 1.6, z: 0};
  recognition.update({time: 1, self, visible: {id: 0, generation: 0, position: point, aimPoint: point}});
  expect(recognition.ready(1)).toBe(true);
});
