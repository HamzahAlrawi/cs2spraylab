import {describe, expect, it} from 'vitest';
import {STEP} from '../actor-physics';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {UTILITY_RULES} from './utilities';
import {observeBot} from './perception';
import type {DuelEvent} from './types';

function fixture(loadout: string[] = ['he', 'flash', 'smoke', 'molotov']) {
  const sim = new DuelSimulation(sanitizeDuelConfig({botUtilities: false, utilityLoadout: loadout,
    health: 500, playerHealth: 500}), 40, testArena());
  sim.command(1, {});
  return sim;
}
function advance(sim: DuelSimulation, seconds: number) {
  const events: DuelEvent[] = [];
  const end = sim.time + seconds;
  while (sim.time + STEP / 2 < end && sim.phase === 'fighting') {sim.step(); events.push(...sim.drainEvents());}
  return events;
}
function drop(sim: DuelSimulation, kind: 'he' | 'flash' | 'smoke' | 'molotov', x = 0, z = 0, owner = 0) {
  sim.utilities.throw({actorId: owner, side: owner ? 'enemy' : 'player', kind,
    origin: {x, y: .08, z}, direction: {x: 0, y: -1, z: 0},
    velocity: {x: 0, y: UTILITY_RULES.throwSpeed * .3 / 1.25, z: 0}, strength: 0, time: sim.time});
}

describe('playable utility integration', () => {
  it('holds a grenade until release, consumes one stock and never fires the hidden gun', () => {
    const sim = fixture(); sim.selectUtility('he'); sim.start();
    const ammo = sim.actors[0].weapon.ammo;
    sim.command(0, {fireHeld: true, firePressed: true});
    expect(advance(sim, .25).some(e => e.kind === 'fire')).toBe(false);
    expect(sim.utilities.projectiles).toHaveLength(0);
    sim.command(0, {fireHeld: false});
    const events = advance(sim, .8);
    expect(events.filter(e => e.kind === 'utility' && e.action === 'throw')).toHaveLength(1);
    expect(sim.utilityInventory().he).toBe(0);
    expect(sim.selectedUtility).toBeUndefined();
    expect(sim.actors[0].weapon.ammo).toBe(ammo);
    expect(sim.selectUtility('he')).toBe(false);
  });
  it('supports all types through loadout selection, respects draw time and returns to the gun', () => {
    const sim = fixture(['incendiary', 'decoy']); sim.start();
    expect(sim.selectUtility('incendiary')).toBe(true);
    expect(sim.throwUtility(0, 'incendiary')).toBe(false);
    advance(sim, 1.01);
    expect(sim.throwUtility(0, 'incendiary')).toBe(true);
    expect(sim.actors[0].equipReadyAt).toBeGreaterThan(sim.time);
    expect(sim.selectUtility('decoy')).toBe(true);
    sim.equipPlayer(1); expect(sim.selectedUtility).toBeUndefined();
    expect(sim.actors[0].equipReadyAt).toBeGreaterThan(sim.time);
  });
  it('queues a touch/HUD throw during draw instead of dropping the input or bypassing deploy', () => {
    const sim = fixture(); sim.start(); sim.selectUtility('he');
    expect(sim.queueUtilityThrow(0, 0)).toBe(true);
    advance(sim, .2); expect(sim.utilityInventory().he).toBe(1);
    const events = advance(sim, 1.9);
    expect(events.filter(event => event.kind === 'utility' && event.action === 'throw')).toHaveLength(1);
    expect(sim.utilityInventory().he).toBe(0);
  });
  it('does not accidentally release a primed grenade on resume or while paused', () => {
    const sim = fixture(); sim.selectUtility('flash'); sim.start(); sim.command(0, {fireHeld: true});
    advance(sim, .2); sim.pause(); const time = sim.time;
    sim.advance(2); expect(sim.time).toBe(time); sim.resume();
    advance(sim, .3);
    expect(sim.utilities.projectiles).toHaveLength(0); expect(sim.utilityInventory().flash).toBe(1);
  });
  it('does not drop the hidden rifle when G is pressed while holding a grenade', () => {
    const sim = fixture(); sim.selectUtility('smoke'); sim.start(); sim.command(0, {dropPressed: true});
    advance(sim, .1); expect(sim.drops).toHaveLength(0);
    expect(sim.loadout.primary).toBe('ak47'); expect(sim.selectedUtility).toBeUndefined();
    expect(sim.utilityDrops).toHaveLength(1);expect(sim.utilityDrops[0].utility).toBe('smoke');
    expect(sim.utilityInventory().smoke).toBe(0);
    expect(sim.queueUtilityThrow(0, NaN)).toBe(false);
  });
  it('honors disabled utilities and legal empty loadouts', () => {
    const disabled = new DuelSimulation(sanitizeDuelConfig({utilitiesEnabled: false}));
    expect(disabled.selectUtility('he')).toBe(false);
    expect(Object.values(disabled.utilityInventory()).every(n => n === 0)).toBe(true);
    expect(fixture([]).selectUtility('smoke')).toBe(false);
  });
  it('applies scenario utility preferences only at a fresh round boundary', () => {
    const sim = fixture();
    expect(sim.configureUtilities({utilitiesEnabled: true, botUtilities: false, utilityLoadout: ['decoy', 'incendiary']})).toBe(true);
    expect(sim.utilityInventory()).toMatchObject({he: 0, decoy: 1, incendiary: 1});
    sim.start(); expect(sim.configureUtilities({utilitiesEnabled: true, botUtilities: true, utilityLoadout: ['he']})).toBe(false);
    expect(sim.utilityInventory().he).toBe(0);
  });
  it('applies immediate detonation damage with correct utility attribution and no aim-score inflation', () => {
    const sim = fixture(); sim.actors[1].position = {x: 0, y: 1.6256, z: 0}; sim.start();
    drop(sim, 'he'); const hits = advance(sim, 1.75).filter(e => e.kind === 'hit');
    expect(hits.some(e => e.kind === 'hit' && e.victim === 1 && e.utility === 'he' && e.shooter === 0)).toBe(true);
    expect(sim.actors[1].health).toBeLessThan(500);
    expect(sim.coach.review()).toMatchObject({shots: 0, hits: 0, heads: 0});
    expect(sim.coach.review().damage).toBeGreaterThan(0);
  });
  it('does not award damage or kills for a self-inflicted grenade', () => {
    const sim = fixture(); sim.start(); drop(sim, 'he', sim.actors[0].position.x, sim.actors[0].position.z);
    advance(sim, 1.75);
    expect(sim.actors[0].health).toBeLessThan(500);
    expect(sim.coach.review()).toMatchObject({damage: 0, kills: 0, hits: 0});
  });
  it('smoke removes direct contact without changing physical bullets or map geometry', () => {
    const sim = fixture(); sim.actors[0].position.z = 5; sim.actors[1].position.z = -5;
    sim.actors[1].yaw = Math.PI; sim.start(); drop(sim, 'smoke'); advance(sim, 2);
    const snapshots = sim.snapshot();
    expect(observeBot(sim.time, snapshots[1], snapshots, sim.arena).visible).not.toBeNull();
    expect(observeBot(sim.time, snapshots[1], snapshots, sim.arena, undefined, [], undefined,
      (from, to) => sim.canSeeUtility(1, from, to)).visible).toBeNull();
  });
  it('flashes affect the bot as well as the player and suppress accurate fire while blinded', () => {
    const sim = fixture(); sim.actors[0].position.z = 3; sim.actors[1].position.z = -3;
    // A pop flash stays hidden until just before detonation, denying a turn cue.
    sim.arena.solids.push({center: {x: 0, y: 2, z: -1.5}, size: {x: 4, y: 4, z: .1}});
    sim.actors[0].yaw = 0; sim.actors[1].yaw = Math.PI; sim.start(); drop(sim, 'flash');
    advance(sim, 1.48); sim.arena.solids.length = 0; advance(sim, .27);
    expect(sim.flashAmount(0)).toBeGreaterThan(.35); expect(sim.flashAmount(1)).toBeGreaterThan(.35);
    const ammo = sim.actors[1].weapon.ammo;
    sim.command(1, {fireHeld: true}); advance(sim, .1);
    expect(sim.actors[1].weapon.ammo).toBe(ammo);
    advance(sim, 6); expect(sim.flashAmount(0)).toBe(0);
  });
});
