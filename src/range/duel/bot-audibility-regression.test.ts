import {describe, expect, it, vi} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {FOOTSTEP_RANGE} from '../sound-model';
import {sanitizeDuelConfig} from './config';
import {duelArena, testArena} from './geometry';
import {observeBot} from './perception';
import {DuelSimulation} from './simulation';
import {TacticalBrain} from './tactics';

describe('sound emission and sensor boundary regressions', () => {
  it('hears a nearby suppressed shot but not one beyond its native radius', () => {
    for (const weapon of ['m4a1s', 'ak47'] as const) {
      const arena = duelArena(1, 1.5);
      arena.solids = [];
      const simulation = new DuelSimulation(sanitizeDuelConfig({skill: 10}), 1, arena, weapon);
      simulation.actors[1].position = {x: 0, y: 64 * UNIT, z: 0};
      const hear = vi.spyOn(TacticalBrain.prototype, 'hear');
      try {
        simulation['informHearing'](simulation.actors[0], {x: 0, y: 64 * UNIT, z: 40}, 'gunshot');
        expect(hear).toHaveBeenCalledTimes(weapon === 'ak47' ? 1 : 0);
        hear.mockClear();
        simulation['informHearing'](simulation.actors[0], {x: 0, y: 64 * UNIT, z: 10}, 'gunshot');
        expect(hear).toHaveBeenCalledOnce();
        expect(hear.mock.calls[0][3]).toBe(false);
      } finally {hear.mockRestore();}
    }
  });

  it('cannot react to footsteps beyond FOOTSTEP_RANGE, including low-skill and occluded cases', () => {
    for (const skill of [1, 5, 8, 10, '10+'] as const) for (const seed of [17, 42, 431]) {
      const simulation = new DuelSimulation(sanitizeDuelConfig({skill}), seed, duelArena(seed, 1.5));
      simulation.actors[1].position = {x: 0, y: 64 * UNIT, z: -12};
      const hear = vi.spyOn(TacticalBrain.prototype, 'hear');
      try {
        simulation['informHearing'](simulation.actors[0], {x: 0, y: 64 * UNIT, z: -12 + FOOTSTEP_RANGE + .01}, 'footstep');
        expect(hear).not.toHaveBeenCalled();
        simulation['informHearing'](simulation.actors[0], {x: 0, y: 64 * UNIT, z: 6}, 'footstep');
        expect(hear).toHaveBeenCalledOnce();
      } finally {hear.mockRestore();}
    }
  });

  it('walking and crouch movement emit no footstep cues, while running does', () => {
    for (const seed of [17, 42, 431]) for (const stance of ['walk', 'crouch', 'run'] as const) {
      const simulation = new DuelSimulation(sanitizeDuelConfig({}), seed, testArena());
      simulation.command(1, {}); simulation.start();
      simulation.command(0, {side: 1, walk: stance === 'walk', crouch: stance === 'crouch'});
      for (let tick = 0; tick < 1.5 / STEP; tick++) simulation.step();
      const steps = simulation.drainEvents().filter(event => event.kind === 'sound' && event.actorId === 0 && event.sound === 'footstep');
      if (stance === 'run') expect(steps.length).toBeGreaterThan(0);
      else expect(steps).toHaveLength(0);
    }
  });

  it('does not infer new hidden coordinates after the last audible cue', () => {
    const first = new DuelSimulation(sanitizeDuelConfig({behavior: 'aggressive', skill: 8}), 63, duelArena(63));
    const second = new DuelSimulation(sanitizeDuelConfig({behavior: 'aggressive', skill: 8}), 63, duelArena(63));
    for (const simulation of [first, second]) {
      simulation.actors[0].health = 10000;
      simulation.actors[0].position = {x: 0, y: 64 * UNIT, z: 6};
      simulation.actors[1].position = {x: 0, y: 64 * UNIT, z: -10};
      simulation['informHearing'](simulation.actors[0], simulation.actors[0].position, 'gunshot');
      simulation.start();
    }
    first.actors[0].position.x = -.5; second.actors[0].position.x = .5;
    for (let tick = 0; tick < .6 / STEP; tick++) {
      const a = first.snapshot(), b = second.snapshot();
      expect(observeBot(first.time, a[1], [a[0]], first.arena).visible).toBeNull();
      expect(observeBot(second.time, b[1], [b[0]], second.arena).visible).toBeNull();
      first.step(); second.step();
      expect(first.snapshot()[1]).toEqual(second.snapshot()[1]);
    }
  });

  it('emits fewer footsteps per bot in one/two-bot patient rosters than full rosters', () => {
    const stepsPerBot = (botCount: number) => {
      let steps = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const simulation = new DuelSimulation(sanitizeDuelConfig({botCount, skill: 8, behavior: 'patient'}), seed, duelArena(seed));
        simulation.actors[0].health = 10000; simulation.start();
        for (let tick = 0; tick < 5 / STEP; tick++) {
          simulation.step();
          steps += simulation.drainEvents().filter(event => event.kind === 'sound' && event.actorId > 0 && event.sound === 'footstep').length;
        }
      }
      return steps / (24 * botCount);
    };
    const one = stepsPerBot(1), two = stepsPerBot(2), five = stepsPerBot(5);
    expect(one, JSON.stringify({one, two, five})).toBeLessThan(five * .75);
    expect(two, JSON.stringify({one, two, five})).toBeLessThan(five * .85);
  }, 30000);
});

describe('seeded route diversity after contact', () => {
  it('preserves varied cover roles and engages an idle player across the existing population', () => {
    const records = [1, 2, 3, 4, 5, 6, 19, 42, 101, 208, 431, 9001].map(seed => {
      const simulation = new DuelSimulation(sanitizeDuelConfig({roundSeconds: 25, skill: 5}), seed, duelArena(seed));
      simulation.actors[0].health = 10000; simulation.start();
      const roles = new Set<string>(), phases = new Set<string>(), peeks = new Set<string>();
      let shots = 0;
      for (let tick = 0; tick < 25 / STEP; tick++) {
        simulation.step();
        const decision = simulation.botDecision(1);
        if (decision?.role) roles.add(decision.role);
        if (decision?.phase) phases.add(decision.phase);
        if (decision?.phase === 'expose') peeks.add(decision.peek);
        shots += simulation.drainEvents().filter(event => event.kind === 'fire' && event.actorId === 1).length;
      }
      return {seed, roles: [...roles], phases: [...phases], peeks: [...peeks], shots, final: simulation.snapshot()[1].position,
        decision: simulation.botDecision(1)};
    });
    expect(records.every(record => record.shots > 0), JSON.stringify(records)).toBe(true);
    expect(records.filter(record => record.roles.length > 1).length, JSON.stringify(records)).toBeGreaterThanOrEqual(10);
    expect(records.filter(record => record.peeks.length > 1 || record.phases.includes('microstrafe')).length,
      JSON.stringify(records)).toBeGreaterThanOrEqual(8);
    expect(records.filter(record => record.phases.includes('microstrafe')).length, JSON.stringify(records)).toBeGreaterThanOrEqual(4);
  }, 30000);
});
