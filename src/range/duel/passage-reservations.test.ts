import {describe, expect, it, vi} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {PassageReservations} from './coordination';
import {testArena, type Arena, type CoverLane} from './geometry';
import {narrowPassage, type NarrowPassage} from './narrow-passage';
import {createBotTraits} from './skill';
import {randomStream} from './rng';
import {TacticalBrain} from './tactics';
import {TravelProgress} from './travel-progress';
import type {DuelActorSnapshot} from './types';

const actor = (id: number, x = 0): DuelActorSnapshot => ({id, generation: 1, side: 'enemy',
  position: {x, y: 64 * UNIT, z: 0}, feet: 0, grounded: true, velocity: {x: 0, z: 0},
  yaw: 0, pitch: 0, crouched: false, duckAmount: 0, health: 100, armor: 100, helmet: true,
  alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const throat = (direction = 1, y = 0): NarrowPassage => ({center: {x: 0, y, z: 0}, axis: {x: direction, z: 0}});
const corridor = (): Arena => ({...testArena(), solids: [-1, 1].map(side => ({
  center: {x: 0, y: 1.5, z: side * 1.1}, size: {x: 3, y: 3, z: .8},
}))});

describe('short lived allied passage leases', () => {
  it('excludes conflicting entrants and hands a stationary owner to the oldest waiter at expiry', () => {
    const board = new PassageReservations(), peers = [actor(1, -.5), actor(2, .5), actor(3, 1.5)];
    expect(board.request(0, peers[0], throat(), peers).waiting).toBe(false);
    for (let tick = 1; tick <= 90; tick++) {
      const time = tick * STEP;
      const first = board.request(time, peers[0], throat(), peers);
      const second = board.request(time, peers[1], throat(-1), peers);
      const third = board.request(time, peers[2], throat(-1), peers);
      if (time < .65) expect([first.ownerId, second.ownerId, third.ownerId]).toEqual([1, 1, 1]);
      else expect([first.ownerId, second.ownerId, third.ownerId]).toEqual([2, 2, 2]);
    }
  });

  it('renews only forward progress, not lateral oscillation or repeated requests', () => {
    for (const forward of [false, true]) {
      const board = new PassageReservations(), peers = [actor(1, -.5), actor(2, .5)];
      board.request(0, peers[0], throat(), peers);
      let decision;
      for (let tick = 1; tick <= 10; tick++) {
        peers[0].position.x = -.5 + (forward ? tick * .13 : 0);
        peers[0].position.z = forward ? 0 : Math.sin(tick) * .1;
        board.request(tick * .1, peers[0], throat(), peers);
        decision = board.request(tick * .1, peers[1], throat(-1), peers);
      }
      expect(decision?.ownerId).toBe(forward ? 1 : 2);
    }
  });

  it('cleans stopped, dead, respawned, absent and stale owners; isolates side/floor/clock and copies geometry', () => {
    for (const invalidation of ['release', 'death', 'generation', 'absent', 'stale'] as const) {
      const board = new PassageReservations(), peers = [actor(1), actor(2)];
      const passage = throat(); board.request(0, peers[0], passage, peers); passage.center.x = 100;
      expect(board.request(.01, peers[1], throat(-1), peers).ownerId).toBe(1);
      if (invalidation === 'release') board.release(1, 1, 'enemy');
      if (invalidation === 'death') peers[0].alive = false;
      if (invalidation === 'generation') peers[0].generation++;
      const result = board.request(invalidation === 'stale' ? .4 : .02, peers[1], throat(-1),
        invalidation === 'absent' ? [peers[1]] : peers);
      expect(result.ownerId, invalidation).toBe(2);
    }
    const board = new PassageReservations(), a = actor(1), b = actor(2), enemy = {...actor(3), side: 'player' as const};
    board.request(1, a, throat(), [a, b, enemy]);
    expect(board.request(1, enemy, throat(), [a, b, enemy]).ownerId).toBe(3);
    expect(board.request(1, b, throat(1, 3), [a, b, enemy]).ownerId).toBe(2);
    expect(board.request(0, b, throat(), [a, b]).ownerId).toBe(2);
  });

  it('detects a two-sided throat, not open space, a single wall or a stacked traversal waypoint', () => {
    const self = actor(1), waypoint = {x: 3, y: 0, z: 0};
    expect(narrowPassage(self, waypoint, corridor())).not.toBeNull();
    expect(narrowPassage(self, waypoint, testArena())).toBeNull();
    const oneWall = corridor(); oneWall.solids.pop();
    expect(narrowPassage(self, waypoint, oneWall)).toBeNull();
    expect(narrowPassage(self, {...waypoint, y: 2}, corridor())).toBeNull();
  });

  it('does not convert a legitimate reservation wait into endless stuck replans', () => {
    const progress = new TravelProgress(), home = {x: 0, y: 0, z: 0}, goal = {...home, x: 5};
    for (let tick = 0; tick < 500; tick++) {
      const state = progress.update(tick * STEP, home, goal, goal, true, true, true);
      expect(state.stage).toMatch(/yield|backoff/); expect(state.stalledFor).toBe(0);
    }
    expect(progress.update(4, home, goal, goal, true, true, false)).toMatchObject({stage: 'travel', stalledFor: 0});
    expect(progress.update(4.1, home, goal, goal, false, true, true).stage).toBe('idle');
  });

  it('resets replan cooldowns on a round clock reset and timestamps a first passage wait', () => {
    const progress = new TravelProgress(), home = {x: 0, y: 0, z: 0}, goal = {...home, x: 5};
    expect(progress.update(10, home, goal, goal, true, false, true).intentSince).toBe(10);
    progress.update(20, home, goal, goal, true, false);
    expect(progress.update(23, home, goal, goal, true, false).stage).toBe('replan');
    progress.update(0, home, goal, goal, true, false);
    expect(progress.update(2.5, home, goal, goal, true, false).stage).toBe('replan');
  });
});

function passageFixture() {
  const arena = corridor(), peers = [actor(1, -.5), actor(2, .5)];
  arena.lanes = peers.map((self, index): CoverLane => ({side: index ? -1 : 1, role: 'entry',
    anchor: {...self.position, y: 0}, edge: {x: index ? -3 : 3, y: 0, z: 0},
    retreat: {...self.position, y: 0}, axis: {x: index ? -1 : 1, z: 0}, watch: {x: 0, y: 1.6, z: -8}}));
  arena.spawns = {player: {feet: {x: 0, y: 0, z: -8}, yaw: 0},
    bots: peers.map((self, lane) => ({feet: {...self.position, y: 0}, yaw: 0, lane}))};
  const brains = peers.map(self => new TacticalBrain({...createBotTraits(8, 4, self.id),
    recognitionMedianMs: 200, motorSettlingMs: 150}, 'patient', 1, randomStream(4, `lease:${self.id}`), arena, 8, 'ak47', self.id));
  for (const brain of brains) {brain.phase = 'expose'; brain.activePeek = 'shoulder';}
  return {arena, peers, brains};
}
const worldX = (self: DuelActorSnapshot, command: ReturnType<TacticalBrain['command']>) => {
  const yaw = self.yaw + (command.yawDelta ?? 0);
  return (command.side ?? 0) * Math.cos(yaw) - (command.forward ?? 0) * Math.sin(yaw);
};

describe('TacticalBrain passage integration', () => {
  it('reserves, brakes, backs off, expires and resumes the original peek without changing actor physics or threat gaze', () => {
    const {peers, brains} = passageFixture(), before = structuredClone(peers);
    let backedOff = false, resumed = false;
    for (let tick = 0; tick < 100; tick++) {
      const time = tick * STEP;
      for (let index = 0; index < 2; index++) {
        const self = peers[index], brain = brains[index];
        brain.perceive({time, self, visible: {id: 0, position: {x: 0, y: 1.6, z: -8}, aimPoint: {x: 0, y: 1.6, z: -8}}});
        const command = brain.command(self, time, undefined, peers);
        const state = brain.decisionSnapshot(time);
        expect(state.gazeOwner).toBe('combat'); expect(command.fireHeld).toBe(false);
        expect(brain.phase).toBe('expose'); expect(brain.activePeek).toBe('shoulder');
        if (index === 1 && time < .35) {
          expect(state.passage).toMatchObject({ownerId: 1, waiting: true});
          expect(worldX(self, command)).toBeCloseTo(0);
        }
        backedOff ||= index === 1 && state.routeProgress.stage === 'backoff' && worldX(self, command) > .5;
        resumed ||= index === 1 && time > .65 && state.routeProgress.stage === 'travel' && worldX(self, command) < -.25;
      }
    }
    expect(backedOff).toBe(true); expect(resumed).toBe(true); expect(peers).toEqual(before);
  });

  it('bounds hull probes below motor frequency and releases intentional holds immediately', () => {
    const {arena, peers, brains: policies} = passageFixture();
    const fits = vi.fn(() => true);
    arena.native = {fits, ray: () => undefined, sweep: () => {throw Error('No physics injection');},
      vertical: (_point, from) => ({feet: from, grounded: true, ceiling: false})};
    const goal = {x: 3, y: 0, z: 0};
    for (let tick = 0; tick < 128; tick++) policies[0]['recoverTravel'](peers[0], goal, goal, tick * STEP, true, peers);
    expect(fits.mock.calls.length).toBeLessThanOrEqual(45);
    policies[0]['recoverTravel'](peers[0], goal, goal, 1, false, peers);
    expect(policies[0].decisionSnapshot(1)).toMatchObject({passage: null, routeProgress: {stage: 'idle'}});
  });

  it('counterstrafes a moving queued entrant and keeps the reservation when it draws a knife', () => {
    const {peers, brains} = passageFixture();
    brains[0].command(peers[0], 0, undefined, peers);
    peers[1].velocity.x = -2;
    const before = structuredClone(peers[1]);
    const command = brains[1].command(peers[1], 0, undefined, peers);
    expect(worldX(peers[1], command)).toBeGreaterThan(.9);
    expect(brains[1].decisionSnapshot(0).passage?.waiting).toBe(true);
    expect(peers[1]).toEqual(before);
    peers[1].equipment = 'knife';
    const knife = brains[1].command(peers[1], STEP, undefined, peers, {weaponReadyAt: 1});
    expect(worldX(peers[1], knife)).toBeGreaterThan(.9);
    expect(brains[1].decisionSnapshot(STEP)).toMatchObject({equipment: 'knife', passage: {waiting: true}});
    expect(knife.fireHeld).toBe(false);
  });

  it('reproduces commands and contention diagnostics for the same seeded inputs', () => {
    const run = () => {
      const {peers, brains} = passageFixture();
      return Array.from({length: 100}, (_, tick) => brains.map((brain, index) => {
        const time = tick * STEP;
        return {command: brain.command(peers[index], time, undefined, peers), decision: brain.decisionSnapshot(time)};
      }));
    };
    expect(run()).toEqual(run());
  });
});
