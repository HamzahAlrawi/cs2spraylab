import {describe, expect, it} from 'vitest';
import {rayBox, rayBoxInterval, raySolidInterval, traceSolid, testArena, type Solid} from './geometry';
import {blocksShots} from './environment';
import {randomStream} from './rng';

describe('allocation-light cover queries', () => {
  it('matches full slab intervals over seeded boxes, parallel axes, inside starts and finite limits', () => {
    const random = randomStream(431, 'ray-parity');
    const coordinate = () => (random() - .5) * 40;
    for (let index = 0; index < 3000; index++) {
      const min = {x: coordinate(), y: coordinate(), z: coordinate()};
      const max = {x: min.x + random() * 8, y: min.y + random() * 8, z: min.z + random() * 8};
      const origin = index % 4 ? {x: coordinate(), y: coordinate(), z: coordinate()} : {...min};
      const direction = {x: index % 3 ? coordinate() : 0, y: index % 5 ? coordinate() : 0, z: index % 7 ? coordinate() : 0};
      const limit = index % 2 ? random() * 20 : Infinity;
      expect(rayBox(origin, direction, min, max, limit)).toBe(rayBoxInterval(origin, direction, min, max, limit)?.entryDistance ?? Infinity);
    }
  });

  it('keeps complete nearest contact data and wedge clipping identical to a full scan', () => {
    const random = randomStream(431, 'solid-parity'), arena = testArena();
    for (let i = 0; i < 40; i++) arena.solids.push({
      center: {x: (random() - .5) * 20, y: random() * 3, z: (random() - .5) * 24},
      size: {x: .1 + random() * 3, y: .1 + random() * 4, z: .1 + random() * 3},
      active: i % 9 ? true : false,
      shape: i % 4 ? undefined : {kind: 'ramp', axis: i % 8 ? 'x' : 'z', highSide: i % 3 ? 1 : -1},
    });
    for (let i = 0; i < 800; i++) {
      const origin = {x: (random() - .5) * 24, y: random() * 4, z: (random() - .5) * 24};
      const direction = {x: random() - .5, y: random() - .5, z: random() - .5};
      const limit = i % 2 ? random() * 20 : Infinity;
      let expected: {index: number; solid: Solid; interval: NonNullable<ReturnType<typeof raySolidInterval>>} | undefined;
      arena.solids.forEach((solid, index) => {
        if (!blocksShots(solid)) return;
        const interval = raySolidInterval(origin, direction, solid, limit);
        if (interval && (!expected || interval.entryDistance < expected.interval.entryDistance)) expected = {index, solid, interval};
      });
      const actual = traceSolid(origin, direction, arena, limit);
      expect(actual.surfaceId).toBe(expected?.index ?? -1);
      expect(actual.distance).toBe(expected?.interval.entryDistance ?? Infinity);
      expect(actual.exitDistance).toBe(expected?.interval.exitDistance ?? Infinity);
      expect(actual.normal).toEqual(expected?.interval.entryNormal);
      expect(actual.exitNormal).toEqual(expected?.interval.exitNormal);
    }
  });

  it('rejects malformed rays and bounds without accepting NaN or zero directions', () => {
    const min = {x: -1, y: -1, z: -1}, max = {x: 1, y: 1, z: 1};
    const origin = {x: 0, y: 0, z: 3}, direction = {x: 0, y: 0, z: -1};
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(rayBox({...origin, x: invalid}, direction, min, max)).toBe(Infinity);
      expect(rayBox(origin, {...direction, y: invalid}, min, max)).toBe(Infinity);
      expect(rayBox(origin, direction, {...min, z: invalid}, max)).toBe(Infinity);
    }
    for (const limit of [-1, NaN]) expect(rayBox(origin, direction, min, max, limit)).toBe(Infinity);
    expect(rayBox(origin, {x: 0, y: 0, z: 0}, min, max)).toBe(Infinity);
    expect(rayBox(origin, direction, max, min)).toBe(Infinity);
    expect(rayBox(origin, direction, min, max, 2)).toBe(2);
  });
});
