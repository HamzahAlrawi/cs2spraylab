import {describe, expect, it} from 'vitest';
import {copyTeamAssignment} from './coordination';
import {sanitizeDuelConfig} from './config';
import {testArena, type Arena} from './geometry';
import {DuelSimulation} from './simulation';
import {createBotTraits} from './skill';
import {TacticalBrain} from './tactics';
import {TeamUtilityCoordinator} from './team-utility';

function fixture() {
  const actors = new DuelSimulation(sanitizeDuelConfig({botCount: 3})).snapshot();
  const arena: Arena = {...testArena(), lanes: [{side: 1, role: 'entry',
    anchor: {x: 0, y: 0, z: 0}, edge: {x: 0, y: 0, z: -1}, retreat: {x: 0, y: 0, z: 1}}]};
  const team = new TeamUtilityCoordinator();
  const report = {point: {x: 0, y: 1.6, z: -8}, observedAt: 0, readyAt: 0, source: 'sight' as const};
  const peers = actors.slice(1);
  const claim = (actor = actors[1], point = report.point) =>
    team.claim(0, actor, 'flash', {...report, point}, peers, () => 10);
  return {actors, arena, team, report, peers, claim};
}

describe('utility setup cancellation ownership', () => {
  it('revokes copied waits, frees the area immediately, and never revives an old assignment', () => {
    const {actors, arena, team, claim} = fixture();
    expect(claim()).toBe(true);
    const assignment = team.assignment(.3, actors[2], arena)!;
    const copy = copyTeamAssignment(assignment);
    expect(copy.waitForPartner).toBe(true);
    expect(copy.utilitySetup?.cancelled).toBe(false);
    expect(claim(actors[2])).toBe(false);

    team.cancel(1);
    expect(copy.utilitySetup?.cancelled).toBe(true);
    expect(team.waiting(.3, actors[2])).toBe(false);
    expect(team.assignment(.3, actors[2], arena)).toBeNull();
    expect(team.diagnostics(.3)).toEqual([]);
    expect(claim(actors[2])).toBe(true);
    expect(team.assignment(.3, actors[1], arena)?.utilitySetup?.cancelled).toBe(false);
    expect(copy.utilitySetup?.cancelled).toBe(true);
  });

  it('makes a tactical brain drop its already copied wait on its next command', () => {
    const {actors, arena, team, claim} = fixture();
    const self = actors[2];
    const brain = new TacticalBrain(createBotTraits(10, 1, self.id), 'aggressive', 1, () => .5,
      arena, 10, 'ak47', self.id);
    expect(claim()).toBe(true);
    const assignment = team.assignment(.3, self, arena)!;
    brain.coordinate(assignment);
    const copied = brain['teamAssignment']!;
    expect(copied).not.toBe(assignment);
    expect(copied.waitForPartner).toBe(true);
    team.cancel(1);
    brain.command(self, .31);
    expect(brain['teamAssignment']).toBeNull();
    expect(brain['appliedTeamLane']).toBe('');
  });

  it('does not revoke another setup or an ordinary tactical assignment', () => {
    const {actors, arena, team, claim} = fixture();
    expect(claim()).toBe(true);
    expect(claim(actors[3], {x: 20, y: 1.6, z: -8})).toBe(true);
    const other = team.assignment(.3, actors[1], arena)!;
    const brain = new TacticalBrain(createBotTraits(10, 1, 2), 'aggressive', 1, () => .5,
      arena, 10, 'ak47', 2);
    const ordinary = {...team.assignment(.3, actors[2], arena)!, utilitySetup: undefined};
    brain.coordinate(ordinary);
    team.cancel(1);
    expect(other.utilitySetup?.cancelled).toBe(false);
    expect(team.diagnostics(.3).map(setup => setup.thrower)).toEqual([3]);
    brain.command(actors[2], .31);
    expect(brain['teamAssignment']).toMatchObject({actorId: 2, waitForPartner: true});
  });

  it('preserves a released projectile and its detonation-gated support when cancellation is requested', () => {
    const {actors, arena, team, claim} = fixture();
    expect(claim()).toBe(true);
    const copied = copyTeamAssignment(team.assignment(.3, actors[2], arena)!);
    team.thrown(1, 88, .4);
    team.cancel(1);
    expect(copied.utilitySetup?.cancelled).toBe(false);
    expect(team.waiting(.5, actors[2])).toBe(true);
    expect(team.diagnostics(.5)[0].stage).toBe('flight');
    team.detonated(88, 1);
    expect(team.waiting(1, actors[2])).toBe(false);
    expect(team.assignment(1, actors[2], arena)).toMatchObject({waitForPartner: false, peekAt: 1.12});
    team.cancel(1);
    expect(copied.utilitySetup?.cancelled).toBe(false);
    expect(team.diagnostics(1)[0].stage).toBe('execute');
  });
});
