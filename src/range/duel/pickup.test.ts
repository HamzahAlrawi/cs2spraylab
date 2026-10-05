import {describe, expect, it} from 'vitest';
import {STEP} from '../actor-physics';
import {gameData} from '../config';
import {duelDefaults} from './config';
import {testArena} from './geometry';
import {DuelSimulation} from './simulation';
import {idleCommand} from './types';

function fixture() {
  const sim = new DuelSimulation({...duelDefaults, botCount: 2}, 3, {...testArena(), solids: []});
  sim.start(); sim.command(1, idleCommand()); sim.command(2, idleCommand());
  return sim;
}
describe('dropped weapon pickups', () => {
  it('drops a killed bot weapon with remaining ammunition', () => {
    const sim = fixture(), bot = sim.actors[1];
    bot.position = {x: 0, y: 1.6256, z: 6.5}; bot.health = 1; bot.weapon.ammo = 9;
    sim.command(0, {firePressed: true}); sim.advance(STEP);
    expect(bot.alive).toBe(false); expect(sim.phase).toBe('fighting');
    expect(sim.drops[0]).toMatchObject({id: 1, equipment: 'ak47', ammo: 9, picked: false});
    expect(sim.nearestPickup()?.id).toBe(1);
  });
  it('replaces the correct slot, preserves ammunition, gates draw time and never awards a second pickup', () => {
    const sim = fixture();
    sim.drops.push({id: 1, equipment: 'awp', ammo: 4, position: {x: 0, y: .08, z: 7}, picked: false});
    expect(sim.pickupPlayer()).toBe(true);
    expect(sim.loadout).toEqual({primary: 'awp', sidearm: 'usp'});
    expect(sim.actors[0].weapon.ammo).toBe(4);
    expect(sim.actors[0].equipReadyAt).toBe(sim.time + gameData.weapons.awp.deploy);
    expect(sim.drainEvents()).toContainEqual({kind: 'pickup', tick: 0, actorId: 0, dropId: 1, equipment: 'awp'});
    expect(sim.drops.find(drop=>drop.id===1)?.picked).toBe(true);
    expect(sim.drainEvents().some(event=>event.kind==='pickup'&&event.dropId===1)).toBe(false);
    expect(sim.drops.some(drop=>drop.id!==1&&drop.equipment==='ak47'&&!drop.picked)).toBe(true);
    for(const drop of sim.drops)if(drop.equipment==='ak47')drop.position.x=8;
    expect(sim.pickupPlayer()).toBe(false);
    sim.equipPlayer(2); expect(sim.actors[0].weapon.id).toBe('usp');
    sim.equipPlayer(1); expect(sim.actors[0].weapon.ammo).toBe(4);
    sim.drops.push({id: 2, equipment: 'deagle', ammo: 3, position: {x: 0, y: .08, z: 7}, picked: false});
    for(const drop of sim.drops)if(drop.equipment==='ak47')drop.position.x=8;
    expect(sim.pickupPlayer()).toBe(true);
    expect(sim.loadout).toEqual({primary: 'awp', sidearm: 'deagle'});
    expect(sim.actors[0].weapon.ammo).toBe(3);
  });
  it('does not pick up through cover, outside reach, when dead or after a round', () => {
    for (const blocked of ['cover', 'distance', 'dead', 'round'] as const) {
      const sim = fixture();
      sim.drops.push({id: 1, equipment: 'awp', ammo: 4, position: {x: 0, y: .08, z: blocked === 'distance' ? 5 : 7}, picked: false});
      if (blocked === 'cover') sim.arena.solids.push({center: {x: 0, y: 1, z: 7.5}, size: {x: 2, y: 2, z: .1}, kind: 'concrete'});
      if (blocked === 'dead') sim.actors[0].alive = false;
      if (blocked === 'round') sim.phase = 'result';
      expect(sim.pickupPlayer(), blocked).toBe(false);
      expect(sim.loadout.primary).toBe('ak47'); expect(sim.drops[0].picked).toBe(false);
    }
  });
  it('cannot bypass a pickup draw delay with revolver secondary fire', () => {
    const sim = fixture();
    sim.drops.push({id: 1, equipment: 'revolver', ammo: 4, position: {x: 0, y: .08, z: 7}, picked: false});
    expect(sim.pickupPlayer()).toBe(true);
    sim.command(0, {secondaryPressed: true, secondaryHeld: true}); sim.advance(STEP);
    expect(sim.actors[0].weapon.ammo).toBe(4);
    expect(sim.drainEvents().some(event => event.kind === 'fire' && event.actorId === 0)).toBe(false);
    while (sim.time <= sim.actors[0].equipReadyAt + STEP) sim.step();
    expect(sim.actors[0].weapon.ammo).toBeLessThan(4);
  });
});
