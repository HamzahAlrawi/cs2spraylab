import {describe, expect, it, vi} from 'vitest';
import {prefireLineup, sourcePoint} from './route-helpers';
import type {PrefireRoute} from './schema';

vi.mock('./routes', () => {throw new Error('Pure helpers must not import a map catalog.');});

describe('map-independent Prefire route helpers', () => {
  it('preserves the existing Source-to-trainer coordinate transform', () => {
    expect(sourcePoint([100, 200, 300])).toEqual({x: 2.54, y: 7.62, z: -5.08});
  });
  it('caches lineups by route object without collisions across maps', () => {
    const a = {id: 'a', name: 'A', position: [0, 100, 0] as const};
    const b = {id: 'b', name: 'B', position: [100, 100, 0] as const};
    const route: PrefireRoute = {id: 'entry', name: 'Entry', spawn: [0, 0, 0], look: [0, 100, 0], path: [],
      angles: [a], alternatives: [b], lineups: [{id: 'focus', name: 'Focus', angles: [b]}]};
    const second: PrefireRoute = {...route, name: 'Second map', lineups: [{id: 'focus', name: 'Other focus', angles: [a]}]};
    expect(prefireLineup(route, 'focus')).toBe(prefireLineup(route, 'focus'));
    expect(prefireLineup(route, 'focus').angles).toEqual([b]);
    expect(prefireLineup(route, 'focus').alternatives).toEqual([a]);
    expect(prefireLineup(second, 'focus').angles).toEqual([a]);
    expect(prefireLineup(second, 'focus')).not.toBe(prefireLineup(route, 'focus'));
    expect(prefireLineup(route, 'unknown')).toBe(route);
  });
});
