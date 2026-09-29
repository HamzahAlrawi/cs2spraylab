import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {equipmentStats} from '../equipment';
import {applyTagging} from '../tagging';
import {sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';
import {testArena} from './geometry';

function duel() {
  const sim = new DuelSimulation(sanitizeDuelConfig({health: 500, playerHealth: 500}), 42);
  sim.command(1, {}); sim.start();
  return sim;
}

describe('resolved combat tagging', () => {
  for (const victimId of [0, 1]) it(`slows ${victimId ? 'the bot' : 'the player'} from a real non-lethal hit`, () => {
    const sim = duel(), victim = sim.actors[victimId];
    const speed = equipmentStats(victim.weapon.id).speed * UNIT;
    victim.velocity.x = speed;
    sim.command(victimId, {side: victimId ? -1 : 1});
    sim.command(1 - victimId, {firePressed: true}); sim.step();
    expect(sim.drainEvents().some(event => event.kind === 'hit' && event.victim === victimId)).toBe(true);
    expect(victim.alive).toBe(true);
    expect(victim.velocityModifier).toBeLessThan(.4);
    const modifier = victim.velocityModifier;
    sim.step();
    expect(Math.hypot(victim.velocity.x, victim.velocity.z)).toBeCloseTo(speed * (modifier + .4 * STEP));
    expect(sim.snapshot()[victimId].velocity).toEqual(victim.velocity);
  });

  it('does not tag on a miss or a shot blocked by cover', () => {
    const arena = testArena();
    arena.solids.push({center: {x: 0, y: 1.5, z: 0}, size: {x: 3, y: 3, z: .4}});
    const sim = new DuelSimulation(sanitizeDuelConfig({health: 500}), 42, arena);
    sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 8};
    sim.actors[1].position = {x: 0, y: 64 * UNIT, z: -8};
    sim.command(1, {}); sim.start(); sim.command(0, {firePressed: true}); sim.step();
    expect(sim.drainEvents().some(event => event.kind === 'surface')).toBe(true);
    expect(sim.actors[1].velocityModifier).toBe(1);
    const miss = duel(); miss.command(0, {yawDelta: Math.PI / 2, firePressed: true}); miss.step();
    expect(miss.drainEvents().some(event => event.kind === 'hit')).toBe(false);
    expect(miss.actors[1].velocityModifier).toBe(1);
  });

  it('uses the victim held weapon and actual fired weapon, including the USP and knife', () => {
    const sim = duel(); sim.equipPlayer(2); sim.actors[0].equipReadyAt = 0;
    sim.command(0, {firePressed: true}); sim.step();
    expect(sim.drainEvents().some(event => event.kind === 'hit')).toBe(true);
    const expected = {flinchStack: 1, velocityModifier: 1};
    applyTagging(expected, 'usp', 'ak47');
    expect(sim.actors[1].velocityModifier).toBeCloseTo(expected.velocityModifier);
    const melee = duel(); melee.equipPlayer(3); melee.actors[0].equipReadyAt = 0;
    melee.actors[1].position.z = 7;
    melee.command(0, {firePressed: true}); melee.step();
    expect(melee.drainEvents().some(event => event.kind === 'hit')).toBe(true);
    const knifeExpected = {flinchStack: 1, velocityModifier: 1};
    applyTagging(knifeExpected, 'knife', 'ak47');
    expect(melee.actors[1].velocityModifier).toBeCloseTo(knifeExpected.velocityModifier);
    const knifeHolder = duel(); knifeHolder.equipPlayer(3);
    knifeHolder.command(1, {firePressed: true}); knifeHolder.step();
    const heldExpected = {flinchStack: 1, velocityModifier: 1};
    applyTagging(heldExpected, 'ak47', 'knife');
    expect(knifeHolder.actors[0].velocityModifier).toBeCloseTo(heldExpected.velocityModifier);
  });

  it('does not clear tagging on equipment changes and freezes it on pause', () => {
    const sim = duel(); sim.command(1, {firePressed: true}); sim.step();
    const player = sim.actors[0], tagged = {stack: player.flinchStack, modifier: player.velocityModifier};
    expect(tagged.modifier).toBeLessThan(1);
    sim.equipPlayer(3);
    expect(player.velocityModifier).toBe(tagged.modifier);
    sim.pause(); sim.advance(2); sim.step();
    expect(player.flinchStack).toBe(tagged.stack);
    expect(player.velocityModifier).toBe(tagged.modifier);
    sim.resume(); sim.step();
    expect(player.velocityModifier).toBeCloseTo(tagged.modifier + .4 * STEP);
    expect(duel().actors.every(actor => actor.velocityModifier === 1 && actor.flinchStack === 1)).toBe(true);
  });

  it('ignores armor and body region when computing a successful bullet tag', () => {
    const results: number[] = [];
    for (const height of [64, 47, 22]) for (const armored of [false, true]) {
      const sim = duel();
      sim.actors[1].armor = armored ? 100 : 0; sim.actors[1].helmet = armored;
      sim.actors[0].pitch = Math.atan2((height - 64) * UNIT, 16);
      sim.command(0, {firePressed: true}); sim.step();
      expect(sim.drainEvents().some(event => event.kind === 'hit')).toBe(true);
      results.push(sim.actors[1].velocityModifier);
    }
    expect(new Set(results).size).toBe(1);
  });
});
