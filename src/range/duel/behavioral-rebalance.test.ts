import {describe, expect, it, vi} from 'vitest';
import {advanceActor, STEP, UNIT, type ActorKinematics} from '../actor-physics';
import {gameData} from '../config';
import {TeamTacticsPlanner, type TacticalPeer, type TeamContact} from './coordination';
import type {SkillLevel} from './config';
import * as geometry from './geometry';
import {testArena, type Arena, type CoverLane} from './geometry';
import {coordinationTiming, createBotTraits} from './skill';
import {TacticalBrain} from './tactics';
import {idleCommand, type DuelActorSnapshot} from './types';

const levels: SkillLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, '10+'];
const actor = (id = 2): DuelActorSnapshot & ActorKinematics => ({id, generation: 1, side: 'enemy',
  position: {x: id === 1 ? 2.4 : 1.6, y: 64 * UNIT, z: -1.6}, feet: 0, grounded: true,
  velocity: {x: 0, z: 0}, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false,
  yaw: Math.PI, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const lane: CoverLane = {side: 1, role: 'camp', axis: {x: 1, z: 0},
  anchor: {x: 1.6, y: 0, z: -1.6}, edge: {x: 2.4, y: 0, z: -1.6},
  retreat: {x: 0, y: 0, z: -1.6}, watch: {x: 1.6, y: 64 * UNIT, z: 8}};
const map = (): Arena => ({...testArena(), lanes: [structuredClone(lane)],
  solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 2, y: 3, z: 2}}]});
const peers = (level: SkillLevel): TacticalPeer[] => [1, 2].map(id => ({actor: {...actor(id), health: id === 1 ? 100 : 90}, level, behavior: 'holder'}));
const contact = (time = 0, source: TeamContact['source'] = 'sight'): TeamContact => ({
  reporterId: 1, point: {...lane.watch!}, observedAt: time, source});
const brainFor = (level: SkillLevel, arena = map(), random = () => .5) => new TacticalBrain(
  createBotTraits(level, 19, 2), 'holder', 1, random, arena, level, 'ak47', 2);

describe('contact-coordinated cover responses', () => {
  it.each(levels)('releases a living contact followup at level %s without requiring a shot or death', level => {
    const team = peers(level), planner = new TeamTacticsPlanner();
    // The reporter is fighting at the exposed endpoint, not at a staging anchor.
    team[0].actor.position.x = 2.4;
    const staged = planner.plan(0, team, [lane], [contact(0, 'callout')]);
    const initial = staged.find(assignment => assignment.actorId === 2)!;
    expect(initial).toMatchObject({role: 'trade', waitForPartner: true});
    team[0].contactAt = .05;
    const released = planner.plan(.05, team, [lane], [contact(.05)]);
    const followup = released.find(assignment => assignment.actorId === 2)!;
    expect(team.every(peer => peer.actor.alive && peer.lastShotAt === undefined)).toBe(true);
    expect(released.every(assignment => !assignment.waitForPartner)).toBe(true);
    expect(followup.peekAt).toBeCloseTo(.05 + coordinationTiming(level, 2, 1).followupDelay, 12);
    expect(followup.peekAt).toBeLessThan(initial.peekAt);
    expect(followup.point).toEqual(contact().point);
    const again = planner.plan(.1, team, [lane], [contact(.05)]).find(assignment => assignment.actorId === 2)!;
    expect(again.peekAt).toBe(followup.peekAt);
  });

  it('requires a recognized sight report, not a raw contact timestamp, sound, or shadow', () => {
    for (const source of ['callout', 'sound', 'shadow'] as const) {
      const team = peers(3), planner = new TeamTacticsPlanner();
      const first = planner.plan(0, team, [lane], [contact(0, source)]);
      team[0].contactAt = .05;
      const next = planner.plan(.05, team, [lane], [contact(.05, source)]);
      expect(next.map(assignment => assignment.peekAt)).toEqual(first.map(assignment => assignment.peekAt));
    }
    const team = peers(3), planner = new TeamTacticsPlanner();
    team[0].contactAt = .5;
    expect(planner.plan(.5, team, [lane], [])).toEqual([]);
  });

  it('does not accelerate contact followups when trading is disabled', () => {
    const team = peers(3); team[0].contactAt = 0;
    const result = new TeamTacticsPlanner().plan(0, team, [lane], [contact()], false);
    expect(result.map(assignment => assignment.role)).toEqual(['entry', 'crossfire']);
    expect(result.every(assignment => !assignment.waitForPartner)).toBe(true);
  });

  it('uses only certified endpoints and reserves separate nearby openings when available', () => {
    const second = {...structuredClone(lane), anchor: {...lane.anchor, x: 4}, edge: {...lane.edge, x: 4.8}};
    const team = peers(3), input = [lane, second]; team[0].contactAt = 0;
    const result = new TeamTacticsPlanner().plan(0, team, input, [contact()]);
    expect(result).toHaveLength(2);
    expect(result[0].lane.edge).not.toEqual(result[1].lane.edge);
    for (const assignment of result) {
      expect(input.some(candidate => JSON.stringify(candidate) === JSON.stringify(assignment.lane))).toBe(true);
    }
    result[0].lane.watch!.x = 99;
    expect(lane.watch!.x).toBe(1.6);
  });

  it('gives novices larger reproducible partner timing variance without changing elite timings', () => {
    const spread = (level: SkillLevel) => {
      const delays = Array.from({length: 50}, (_, id) => coordinationTiming(level, id + 1, 1).followupDelay);
      return Math.max(...delays) - Math.min(...delays);
    };
    expect(coordinationTiming(3, 2, 1)).toEqual(coordinationTiming(3, 2, 1));
    expect(spread(1)).toBeGreaterThan(spread(5) * 1.5);
    expect(spread(5)).toBeGreaterThan(spread(9) * 3);
    expect(coordinationTiming(10, 2, 1)).toEqual({contactDelay: .22, tradeGap: .1, followupDelay: .04});
    expect(coordinationTiming('10+', 2, 1)).toEqual(coordinationTiming(10, 2, 1));
  });

  it.each(levels)('executes the assigned level %s contact peek only after recognition and without blind firing', level => {
    const arena = map(), self = actor(), team = peers(level), brain = brainFor(level, arena);
    team[0].contactAt = 0;
    const assignment = new TeamTacticsPlanner().plan(0, team, arena.lanes!, [contact()])
      .find(assignment => assignment.actorId === self.id)!;
    const ready = Math.max(assignment.peekAt, createBotTraits(level, 19, 2).recognitionMedianMs / 1000 * 1.35);
    brain.coordinate(assignment);
    for (const time of [0, ready - STEP]) {
      brain.perceive({time, self, visible: null});
      expect(brain.command(self, time).fireHeld).toBe(false);
      expect(brain.phase).toBe('setup');
    }
    brain.perceive({time: ready + STEP, self, visible: null});
    const command = brain.command(self, ready + STEP);
    expect(brain.decisionSnapshot()).toMatchObject({phase: 'expose', peek: 'quick'});
    expect(Math.hypot(command.forward ?? 0, command.side ?? 0)).toBeGreaterThan(.5);
    expect(command).toMatchObject({fireHeld: false, jump: false, crouch: false});
    expect(brain.contactReport(ready + STEP)).toBeNull();
    const seenAt = ready + 2 * STEP;
    brain.perceive({time: seenAt, self, visible: {id: 0, position: {...lane.watch!}, aimPoint: {...lane.watch!}}});
    expect(brain.command(self, seenAt).fireHeld).toBe(false);
    // Stale sight cannot grant permission, even with a still-active assignment.
    expect(brain.command(self, seenAt + .2).fireHeld).toBe(false);
  });
});

describe('active defensive cover rechecks', () => {
  it('physically rechecks and returns to a useful pocket repeatedly instead of freezing or roaming', () => {
    const run = () => {
      const arena = map(), brain = brainFor(3, arena);
      let self = actor(), prior = '', exposures = 0, returns = 0, coveredArrivals = 0, travel = 0;
      const phases: string[] = [];
      for (let tick = 0; tick < 24 / STEP; tick++) {
        const time = tick * STEP;
        if (tick % 256 === 0) brain.teammateCallout(lane.watch!, time);
        brain.perceive({time, self, visible: null});
        const command = {...idleCommand(), ...brain.command(self, time)};
        expect(command.fireHeld).toBe(false);
        if (brain.phase !== prior) {
          phases.push(brain.phase); exposures += +(brain.phase === 'expose'); returns += +(brain.phase === 'return');
          coveredArrivals += +(prior === 'return' && Math.abs(self.position.x) < .4);
        }
        prior = brain.phase;
        const before = self.position;
        self.yaw += command.yawDelta; self.pitch += command.pitchDelta;
        self = {...self, ...advanceActor(self, command, gameData.weapons.ak47.speed * UNIT, STEP,
          undefined, undefined, undefined, {solids: arena.solids, floor: 0, time})};
        travel += Math.hypot(self.position.x - before.x, self.position.z - before.z);
        expect(self.position.z).toBeLessThan(-1.4);
      }
      return {exposures, returns, coveredArrivals, travel, phases};
    };
    const result = run();
    expect(result).toEqual(run());
    expect(result.exposures).toBeGreaterThanOrEqual(3);
    expect(result.returns).toBeGreaterThanOrEqual(3);
    expect(result.coveredArrivals).toBeGreaterThanOrEqual(3);
    expect(result.travel).toBeGreaterThan(8);
    expect(result.phases).not.toContain('push');
  });

  it('caches useful-angle geometry at 5 Hz instead of querying at motor frequency', () => {
    const brain = brainFor(3), self = actor(), trace = vi.spyOn(geometry, 'traceSolid');
    try {
      brain.command(self, 0); trace.mockClear();
      for (let tick = 1; tick < 128; tick++) brain.command(self, tick * STEP);
      expect(brain.phase).toBe('setup');
      expect(trace.mock.calls.length).toBeGreaterThan(0);
      expect(trace.mock.calls.length).toBeLessThanOrEqual(25);
    } finally {trace.mockRestore();}
  });

  it('does not invent an excursion for a certified native static hold', () => {
    const arena = map(); arena.lanes![0].edge = {...lane.anchor};
    // These motor-only checks must never need native navigation/trace queries.
    arena.native = {fits: () => true, ray: () => undefined,
      sweep: () => {throw new Error('Static hold must not plan a native excursion');},
      vertical: () => {throw new Error('Static hold must not plan a native excursion');}};
    const self = actor(), brain = brainFor(3, arena);
    vi.spyOn(geometry, 'traceSolid').mockReturnValue({distance: Infinity} as ReturnType<typeof geometry.traceSolid>);
    try {
      for (const time of [0, 3, 6]) {
        brain.perceive({time, self, visible: null});
        const command = brain.command(self, time);
        expect(command).toMatchObject({forward: 0, side: 0, fireHeld: false});
        expect(brain.decisionSnapshot()).toMatchObject({phase: 'setup', peek: 'hold'});
      }
    } finally {vi.restoreAllMocks();}
  });
});
