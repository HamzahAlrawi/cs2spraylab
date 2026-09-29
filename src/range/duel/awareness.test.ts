import {expect, it} from 'vitest';
import {AngleAwareness} from './awareness';
import {testArena} from './geometry';
import type {SkillLevel} from './config';

const self = {x: 0, y: 1.6, z: 8}, expected = {x: 0, y: 1.6, z: -4};
const angles = [-8, -4, 4, 8].map(x => ({x, y: 1.6, z: -5}));
it('checks alternate angles and returns to the expected angle, more frequently at high skill', () => {
  const run = (level: SkillLevel) => {
    const awareness = new AngleAwareness(level, () => .5), seen = new Set<number>();
    let checks = 0, previous = expected, holds = 0;
    for (let i = 0; i < 60 * 32; i++) {
      const point = awareness.look(self, i / 32, expected, angles, testArena());
      if (point !== expected && point !== previous) checks++;
      if (point === expected) holds++; else seen.add(point.x);
      previous = point;
    }
    expect(seen.size).toBe(4); expect(holds).toBeGreaterThan(60 * 32 * .5);
    return checks;
  };
  expect(run('10+')).toBeGreaterThan(run(1) * 2);
});
it('prioritizes a fresh cue and handles arenas without useful alternate angles', () => {
  const awareness = new AngleAwareness(10, () => .5);
  expect(awareness.look(self, 0, expected, angles, testArena(), true)).toBe(expected);
  expect(awareness.look(self, .2, expected, angles, testArena())).toBe(expected);
  expect(awareness.look(self, 1, expected, [], testArena())).toBe(expected);
});
