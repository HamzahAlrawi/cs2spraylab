import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import type {DuelEvent} from './types';

function advance(sim: DuelSimulation, seconds: number) {
  const events: DuelEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds / STEP); i++) {sim.advance(STEP); events.push(...sim.drainEvents());}
  return events;
}
function fixture() {
  const sim = new DuelSimulation(sanitizeDuelConfig({playerHealth: 1, botUtilities: false, utilityLoadout: ['he']}), 42, testArena());
  sim.command(1, {}); sim.start();
  sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 2};
  sim.actors[1].position = {x: 0, y: 64 * UNIT, z: 0};
  sim.actors[1].yaw = Math.PI;
  sim.actors[1].weapon = new DuelWeaponState('ak47', () => 0);
  return sim;
}

describe('post-round utility world', () => {
  it.each(['primed', 'airborne'] as const)('keeps a %s HE moving and detonating after an actual lethal shot', state => {
    const sim = fixture();
    if (state === 'primed') {
      sim.selectUtility('he'); sim.command(0, {fireHeld: true}); advance(sim, 1.3);
      expect(sim.utilities.projectiles).toHaveLength(0);
    } else {
      sim.utilities.throw({actorId: 0, side: 'player', kind: 'he', origin: {x: 0, y: 2, z: 2},
        direction: {x: 1, y: .1, z: 0}, velocity: {x: 0, y: 0, z: 0}, strength: .5, time: sim.time});
    }
    sim.command(1, {fireHeld: true, firePressed: true});
    advance(sim, STEP);
    expect(sim.phase).toBe('result'); expect(sim.outcome).toBe('lost');
    expect(sim.actors[0].alive).toBe(false); expect(sim.utilities.projectiles).toHaveLength(1);
    const at = sim.completedAt, outcome = sim.outcome, point = {...sim.utilities.projectiles[0].position};
    const events = advance(sim, .15);
    expect(sim.utilities.projectiles[0].position).not.toEqual(point);
    events.push(...advance(sim, 2.1));
    expect(events.some(event => event.kind === 'utility' && event.utility === 'he' && event.action === 'detonate')).toBe(true);
    expect(events.some(event => event.kind === 'round' || event.kind === 'fire')).toBe(false);
    expect(sim.utilities.projectiles).toHaveLength(0);
    expect(sim.completedAt).toBe(at); expect(sim.outcome).toBe(outcome);
  });
  it('still respects explicit pause and does not accept result-screen fire or movement', () => {
    const sim = fixture(); sim.command(1, {firePressed: true}); advance(sim, STEP);
    const time = sim.time; sim.pause(); advance(sim, 1); expect(sim.time).toBe(time);
    sim.resume(); const point = {...sim.actors[1].position};
    sim.command(1, {fireHeld: true, forward: 1});
    expect(advance(sim, .5).some(event => event.kind === 'fire')).toBe(false);
    expect(sim.actors[1].position).toEqual(point);
    expect(sim.time).toBeGreaterThan(time);
  });
});
