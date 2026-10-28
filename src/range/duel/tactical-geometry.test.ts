import {describe, expect, it} from 'vitest';
import type {Vec} from '../actor-physics';
import type {CoverLane} from './geometry';
import rounds from './real-map-round-data.json';
import type {RoundCatalog} from './real-map-rounds';
import {laneThreatAlignment, nativeLaneRole} from './tactical-geometry';

const point = (x: number, z: number): Vec => ({x, y: 0, z});
const lane = (anchor: Vec, edge: Vec, watch?: Vec): CoverLane =>
  ({side: 1, role: 'camp', anchor, edge, retreat: anchor, watch});
const transforms = [
  {angle: 0, offset: point(300, -700)},
  {angle: Math.PI / 2, offset: point(-120, 80)},
  {angle: 2.37, offset: point(930, 470)},
];
function transform(p: Vec, angle: number, offset: Vec): Vec {
  return {x: p.x * Math.cos(angle) - p.z * Math.sin(angle) + offset.x,
    y: p.y + 13, z: p.x * Math.sin(angle) + p.z * Math.cos(angle) + offset.z};
}
function transformLane(value: CoverLane, move: (p: Vec) => Vec): CoverLane {
  return {...value, anchor: move(value.anchor), edge: move(value.edge), retreat: move(value.retreat),
    watch: value.watch && move(value.watch)};
}

describe('cover-relative threat alignment', () => {
  it('uses the watch-facing hemisphere, not a shared peek label or absolute X', () => {
    const lanes = [lane(point(0, 0), point(1, 0), point(8, 0)),
      lane(point(4, 0), point(3, 0), point(-8, 0))];
    for (const {angle, offset} of transforms) {
      const move = (p: Vec) => transform(p, angle, offset), moved = lanes.map(value => transformLane(value, move));
      expect(moved.map(value => laneThreatAlignment(value, move(point(10, 0)), moved))).toEqual([1, -1]);
    }
  });

  it.each(['entry', 'camp', 'flank', 'offAngle'] as const)('retains opposite generated %s openings around their cover center', role => {
    // Both openings are on positive world X. Flank travel is longitudinal;
    // off-angle travel points inward, so neither travel axis nor X sign suffices.
    const lanes = role === 'flank'
      ? [lane(point(97, -5), point(97, 0)), lane(point(103, -5), point(103, 0))]
      : [lane(point(98, 0), point(97, 0)), lane(point(102, 0), point(103, 0))];
    lanes.forEach(value => {value.role = role;});
    for (const {angle, offset} of transforms) {
      const move = (p: Vec) => transform(p, angle, offset), moved = lanes.map(value => transformLane(value, move));
      expect(moved.map(value => laneThreatAlignment(value, move(point(110, 4)), moved))).toEqual([-1, 1]);
      expect(moved.map(value => laneThreatAlignment(value, move(point(90, 4)), moved))).toEqual([1, -1]);
    }
  });

  it('treats coincident, perpendicular and singleton geometry as neutral', () => {
    const value = lane(point(0, 0), point(0, 0), point(1, 0));
    expect(laneThreatAlignment(value, point(0, 0), [value])).toBe(0);
    expect(laneThreatAlignment(value, point(0, 5), [value])).toBe(0);
    expect(laneThreatAlignment({...value, watch: undefined}, point(10, 0), [value])).toBe(0);
    expect(laneThreatAlignment({...value, watch: point(0, 0)}, point(10, 0), [value])).toBe(0);
  });
});

describe('native roles from authored approach geometry', () => {
  const route = [point(0, -10), point(0, 0), point(0, 10)];
  const fixtures: {role: CoverLane['role']; value: CoverLane}[] = [
    {role: 'camp', value: lane(point(1, 8), point(2, 8), point(0, 0))},
    {role: 'camp', value: lane(point(0, 8), point(0, 8), point(0, 0))},
    {role: 'entry', value: lane(point(0, 9), point(0, 7), point(0, 0))},
    {role: 'offAngle', value: lane(point(8, 1), point(8, 1), point(0, 0))},
    {role: 'flank', value: lane(point(3, -6), point(3, -5), point(0, 0))},
  ];
  it.each(fixtures)('recognizes $role and preserves it after rigid transforms', ({role, value}) => {
    expect(nativeLaneRole(value, route)).toBe(role);
    for (const {angle, offset} of transforms) {
      const move = (p: Vec) => transform(p, angle, offset);
      expect(nativeLaneRole(transformLane(value, move), route.map(move))).toBe(role);
    }
  });

  it('uses the local incoming tangent on a bent route, not its end-to-end heading', () => {
    const bent = [point(0, -10), point(0, 0), point(10, 0), point(10, 10)];
    const value = lane(point(5, 8), point(5, 8), point(5, 0));
    expect(nativeLaneRole(value, bent)).toBe('offAngle');
    expect(nativeLaneRole(value, [bent[0], bent[0], ...bent.slice(1)])).toBe('offAngle');
    expect(nativeLaneRole(lane(point(0, 8), point(0, 8), point(0, 0)), bent)).toBe('camp');
  });

  it('falls back to camp without a usable approach or watch', () => {
    for (const route of [[], [point(0, 0)], [point(0, 0), point(0, 0)]])
      expect(nativeLaneRole(fixtures[2].value, route)).toBe('camp');
    expect(nativeLaneRole({...fixtures[2].value, watch: undefined}, route)).toBe('camp');
  });

  it('derives all four useful roles from the existing pinned courses without changing positions', () => {
    const counts = {camp: 0, entry: 0, offAngle: 0, flank: 0};
    for (const chunk of Object.values((rounds as unknown as RoundCatalog).chunks)) for (const course of chunk.courses) {
      const before = JSON.stringify(course);
      const {angle, offset} = transforms[2], move = (p: Vec) => transform(p, angle, offset);
      const movedRoute = course.views.map(move);
      for (const hold of course.holds) {
        const role = nativeLaneRole(hold.lane, course.views);
        counts[role]++;
        expect(nativeLaneRole(transformLane(hold.lane, move), movedRoute),
          JSON.stringify({course: course.id, lane: hold.lane})).toBe(role);
      }
      expect(JSON.stringify(course)).toBe(before);
    }
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(0);
  });
});
