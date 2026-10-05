import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {botConfig, sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';

const legacyPreferences = {
  playerPing: 300, botPing: 300, interpolationMs: 62.5,
  overrides: [{ping: 300}],
};

function combat(weapon: 'ak47' | 'awp' = 'ak47', health = 500) {
  const sim = new DuelSimulation(sanitizeDuelConfig({...legacyPreferences, health, playerHealth: 500}));
  sim.actors[0].weapon = new DuelWeaponState(weapon, () => 0);
  sim.actors[1].weapon = new DuelWeaponState('ak47', () => 0);
  sim.command(1, {});
  sim.start();
  return sim;
}

describe('immediate offline combat', () => {
  it('discards old global and individual latency preferences without losing unrelated settings', () => {
    const config = sanitizeDuelConfig({...legacyPreferences, skill: 8, playerArmorPoints: 35,
      helmet: false, armorPoints: 50, radarEnabled: false,
      overrides: [{ping: 300, weapon: 'mag7', armorPoints: 27}]});
    for (const key of ['playerPing', 'botPing', 'interpolationMs']) expect(config).not.toHaveProperty(key);
    expect(config.overrides[0]).not.toHaveProperty('ping');
    expect(botConfig(config, 0)).not.toHaveProperty('ping');
    expect(config).toMatchObject({skill: 8, playerArmorPoints: 35, radarEnabled: false});
    const sim = new DuelSimulation(config);
    expect(sim.actors.map(actor => actor.armor)).toEqual([35, 27]);
    expect(sim.actors.map(actor => actor.helmet)).toEqual([true, false]);
    expect(sim.actors[1].weapon.id).toBe('mag7');
  });

  it('applies player input immediately and mouse look before the next fixed tick', () => {
    const sim = combat();
    sim.command(0, {side: 1, yawDelta: .1, pitchDelta: .05});
    expect(sim.actors[0].command.side).toBe(1);
    expect(sim.renderSnapshot()[0]).toMatchObject({yaw: .1, pitch: .05});
    expect(sim.tick).toBe(0);
    const x = sim.actors[0].position.x;
    sim.advance(STEP);
    expect(sim.actors[0].position.x).toBeGreaterThan(x);
    expect(sim.actors[0].yaw).toBeCloseTo(.1);
    expect(sim.actors[0].pitch).toBeCloseTo(.05);
  });

  it('preserves a quick press/release and emits one real discharge on the next tick', () => {
    const sim = combat();
    sim.command(0, {fireHeld: true, firePressed: true});
    sim.command(0, {fireHeld: false});
    sim.advance(STEP);
    expect(sim.actors[0].weapon.ammo).toBe(29);
    expect(sim.renderSnapshot()[0].ammo).toBe(29);
    expect(sim.drainEvents().filter(event => event.kind === 'fire')).toHaveLength(1);
    sim.renderSnapshot();
    expect(sim.drainEvents()).toEqual([]);
  });

  it('publishes damage, lethal state and the round result together on the firing tick', () => {
    const sim = combat('ak47', 1);
    sim.command(0, {side: 1, firePressed: true});
    sim.advance(STEP);
    const events = sim.drainEvents();
    expect(events.map(event => event.kind)).toEqual(['fire', 'hit', 'round']);
    expect(events.every(event => event.tick === 1)).toBe(true);
    expect(sim.renderSnapshot()[1]).toMatchObject({alive: false, health: 0});
    expect(sim.renderSnapshot()[0].position).toEqual(sim.actors[0].position);
    expect(sim.phase).toBe('result');
    expect(sim.outcome).toBe('won');
  });

  it('applies bot commands and damage with no separate input or presentation queue', () => {
    const sim = combat();
    sim.command(1, {firePressed: true});
    sim.advance(STEP);
    expect(sim.actors[1].weapon.ammo).toBe(29);
    expect(sim.actors[0].health).toBeLessThan(500);
    expect(sim.renderSnapshot()[0].health).toBe(sim.actors[0].health);
    expect(sim.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({kind: 'fire', actorId: 1, tick: 1}),
      expect.objectContaining({kind: 'hit', victim: 0, tick: 1}),
    ]));
  });

  it('uses current target geometry rather than rewinding to a past position', () => {
    const sim = combat();
    sim.advance(.1);
    sim.actors[1].position.x = 5;
    sim.command(0, {firePressed: true});
    sim.advance(STEP);
    expect(sim.drainEvents().filter(event => event.kind === 'hit')).toEqual([]);
    expect(sim.actors[1].health).toBe(500);
  });

  it('shares the actual weapon state for scope and reload feedback', () => {
    const sim = combat('awp');
    sim.command(0, {secondaryPressed: true});
    sim.advance(STEP);
    expect(sim.actors[0].weapon.actions.zoom).toBe(1);
    sim.actors[0].weapon.ammo = 2;
    sim.command(0, {reloadPressed: true});
    sim.advance(STEP);
    expect(sim.renderSnapshot()[0]).toMatchObject({reloading: true, ammo: 2});
    expect(sim.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({kind: 'action', actorId: 0, action: 'reload-start', tick: 2}),
    ]));
  });

  it('rendering does not advance combat, consume RNG, or synthesize shots', () => {
    const a = combat(), b = combat();
    for (const sim of [a, b]) sim.actors[1].position = {x: 5, y: 64 * UNIT, z: -8};
    a.command(0, {fireHeld: true}); b.command(0, {fireHeld: true});
    for (let tick = 0; tick < 24; tick++) {
      a.advance(STEP); b.advance(STEP);
      for (let frame = 0; frame < 8; frame++) a.renderSnapshot();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.drainEvents()).toEqual(b.drainEvents());
  });
});
