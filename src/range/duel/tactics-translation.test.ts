import {describe, expect, it} from 'vitest';
import type {Vec} from '../actor-physics';
import {testArena, type Arena, type CoverLane} from './geometry';
import {createBotTraits} from './skill';
import {TacticalBrain} from './tactics';
import type {DuelActorSnapshot} from './types';
import rounds from './real-map-round-data.json';
import type {RoundCatalog} from './real-map-rounds';
import {nativeLaneRole} from './tactical-geometry';

// Exercise the two action-boundary selectors without aim/hearing noise or
// unrelated navigation and combat phase transitions obscuring the regression.
type Selection = {
  lane: CoverLane; heard: Vec; heardAt: number; heardReadyAt: number;
  laneForSound(point: Vec, role: CoverLane['role']): CoverLane | undefined;
  chooseLane(self: DuelActorSnapshot, teammates: DuelActorSnapshot[], time: number): void;
};
const point = (x: number, z: number): Vec => ({x, y: 0, z});
const lanes: CoverLane[] = [
  {side: -1, role: 'camp', anchor: point(-4, -1), edge: point(-2, -1), retreat: point(-4, -1), watch: point(8, 0)},
  {side: -1, role: 'camp', anchor: point(3, 1), edge: point(2, 1), retreat: point(3, 1), watch: point(-8, 0)},
];
const self: DuelActorSnapshot = {id: 1, generation: 1, side: 'enemy', position: point(0, 0), feet: 0,
  velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false};
function brain(arena: Arena, roll = .4): TacticalBrain {
  return new TacticalBrain(createBotTraits(8, 17, 1), 'holder', 1, () => roll, arena, 8, 'ak47', 1);
}
function movedFixture(angle: number, x: number, z: number) {
  const move = (p: Vec): Vec => ({x: p.x * Math.cos(angle) - p.z * Math.sin(angle) + x,
    y: p.y, z: p.x * Math.sin(angle) + p.z * Math.cos(angle) + z});
  return {move, arena: {...testArena(), minX: x - 100, maxX: x + 100, minZ: z - 100, maxZ: z + 100,
    lanes: lanes.map(lane => ({...lane, anchor: move(lane.anchor), edge: move(lane.edge),
      retreat: move(lane.retreat), watch: move(lane.watch!)}))}};
}

describe('tactical selection under translations and rotations', () => {
  it.each([[0, 0, 0], [0, 300, -200], [Math.PI / 2, -300, 200], [2.37, 500, 500]])(
    'selects the watch-facing opening at rotation %s and offset (%s, %s)', (angle, x, z) => {
      const {arena, move} = movedFixture(angle, x, z), selection = brain(arena) as unknown as Selection;
      const threat = move(point(10, 0));
      // The nearer second lane faces away. Both lanes deliberately share side.
      expect(selection.laneForSound(threat, 'camp')).toBe(arena.lanes![0]);
      selection.heard = threat; selection.heardAt = selection.heardReadyAt = 1;
      selection.chooseLane({...self, position: move(self.position)}, [], 2);
      expect(selection.lane.anchor).toEqual(arena.lanes![0].anchor);
    });

  it('preserves seeded weighted choices across rigid transforms for many rolls', () => {
    for (let i = 1; i < 100; i++) {
      const choices = [[0, 0, 0], [0, 300, -200], [1.9, -200, 500]].map(([angle, x, z]) => {
        const {arena, move} = movedFixture(angle, x, z), selection = brain(arena, i / 100) as unknown as Selection;
        selection.heard = move(point(10, 0)); selection.heardAt = selection.heardReadyAt = 1;
        selection.chooseLane({...self, position: move(self.position)}, [], 2);
        return arena.lanes!.findIndex(lane => lane.anchor.x === selection.lane.anchor.x && lane.anchor.z === selection.lane.anchor.z);
      });
      expect(choices).toEqual([choices[0], choices[0], choices[0]]);
    }
  });

  it.each(['holder', 'patient'] as const)('lets a %s act on a new opening with the same side label', behavior => {
    const role: 'flank'|'camp' = behavior === 'patient' ? 'flank' : 'camp';
    const arena = {...testArena(), lanes: lanes.map(lane => ({...lane, role}))};
    const tactical = new TacticalBrain(createBotTraits(8, 17, 1), behavior, 1, () => .4, arena, 8, 'ak47', 1);
    const selection = tactical as unknown as Selection;
    expect(selection.lane.anchor).toEqual(arena.lanes[1].anchor);
    selection.heard = point(10, 0); selection.heardAt = selection.heardReadyAt = 1;
    tactical.command(self, 2);
    expect(selection.lane.anchor).toEqual(arena.lanes[0].anchor);
  });

  it('handles missing roles and all rear-facing candidates without dropping every lane', () => {
    const {arena} = movedFixture(0, 100, 100), selection = brain(arena) as unknown as Selection;
    expect(selection.laneForSound(point(110, 100), 'entry')).toBeUndefined();
    arena.lanes = [arena.lanes![1]];
    const rear = brain(arena) as unknown as Selection;
    expect(rear.laneForSound(point(110, 100), 'camp')).toBe(arena.lanes[0]);
  });

  it('classifies legacy native spawn and team-assigned lanes without mutating the catalog', () => {
    const course = Object.values((rounds as unknown as RoundCatalog).chunks).flatMap(chunk => chunk.courses)
      .find(course => course.holds.some(hold => nativeLaneRole(hold.lane, course.views) === 'offAngle'))!;
    const lane = course.holds.find(hold => nativeLaneRole(hold.lane, course.views) === 'offAngle')!.lane;
    const before = JSON.stringify(lane);
    // Constructor-only fixture: no collision queries are needed for metadata.
    const arena: Arena = {...testArena(), lanes: [lane], native: {} as Arena['native'],
      tactical: {entry: course.views[0], watchPoints: course.views, searchPoints: []},
      spawns: {player: {feet: point(0, 0), yaw: 0}, bots: [{feet: lane.anchor, yaw: 0, lane: 0}]}};
    const tactical = brain(arena);
    expect(tactical.decisionSnapshot().role).toBe('offAngle');
    const assigned = (tactical as unknown as {makeLane(lane: CoverLane): CoverLane}).makeLane(lane);
    expect(assigned.role).toBe('offAngle');
    expect(assigned.anchor).toEqual(lane.anchor);
    expect(assigned.edge).toEqual(lane.edge);
    expect(assigned.retreat).toEqual(lane.retreat);
    expect(JSON.stringify(lane)).toBe(before);
  });
});
