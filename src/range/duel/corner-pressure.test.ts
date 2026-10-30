import {describe, expect, it} from 'vitest';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';
import {testArena, type CoverLane} from './geometry';
import type {DuelActorSnapshot} from './types';

const point = (x: number, z: number) => ({x, y: 0, z});
const lanes: CoverLane[] = [-4, 4, 0].map((x, index) => ({side: 1, role: 'camp', anchor: point(x, index === 2 ? 5 : 2),
  edge: point(x + 1, index === 2 ? 5 : 2), retreat: point(x, index === 2 ? 5 : 2), watch: {x: 0, y: 1.6, z: -8}}));
const self: DuelActorSnapshot = {id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 1.6256, z: 0}, feet: 0,
  velocity: point(0, 0), yaw: 0, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false};
type Selection = {lane: CoverLane; cornerPressure: Map<string, unknown>; chooseLane(self: DuelActorSnapshot, peers: DuelActorSnapshot[], time: number): void};
function choose(roll: number, wounded: boolean, time = 2, level: 1 | 10 = 10) {
  const brain = new TacticalBrain(createBotTraits(level, 17, 1), 'holder', 1, () => roll,
    {...testArena(), lanes}, level, 'ak47', 1), selection = brain as unknown as Selection;
  const punished = {...selection.lane.anchor};
  if (wounded) for (const at of [1, 1.1, 1.2]) brain.hurt(at, 50);
  selection.chooseLane(self, [], time);
  return {same: selection.lane.anchor.x === punished.x && selection.lane.anchor.z === punished.z, brain, selection};
}

describe('bounded, own-evidence corner pressure', () => {
  it('makes an experienced bot less likely to return to a repeatedly punished corner', () => {
    let normal = 0, punished = 0, beginnerPunished = 0;
    for (let index = 1; index < 1000; index++) {
      const roll = index / 1000;
      normal += +choose(roll, false).same; punished += +choose(roll, true).same;
      beginnerPunished += +choose(roll, true, 2, 1).same;
    }
    expect(normal).toBeGreaterThan(0); expect(punished).toBeLessThan(normal * .7);
    expect(beginnerPunished).toBeGreaterThan(punished);
  });
  it('decays the learned pressure instead of permanently blacklisting useful cover', () => {
    for (const roll of [.05, .2, .4, .6, .8, .95]) expect(choose(roll, true, 10).same).toBe(choose(roll, false, 10).same);
  });
  it('does not change a current firing phase, aim or peek merely because damage was recorded', () => {
    const {brain, selection} = choose(.9, false);
    brain.phase = 'attack'; brain.activePeek = 'quick';
    const before = brain.decisionSnapshot(1);
    // A single ordinary hit while already contesting need not abandon the fight.
    brain.hurt(1, 90);
    const after = brain.decisionSnapshot(1);
    expect(after.phase).toBe(before.phase); expect(after.peek).toBe(before.peek);
    expect(after.aimIntent).toEqual(before.aimIntent); expect(selection.cornerPressure.size).toBe(1);
  });
});
