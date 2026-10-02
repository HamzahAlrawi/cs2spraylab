import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {damagePunch} from '../aim-punch';
import {direction} from '../shot-model';
import {sanitizeDuelConfig} from './config';
import {duelArena, testArena} from './geometry';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';
import {BotBrain} from './brain';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';

function fixture() {
  const sim = new DuelSimulation(sanitizeDuelConfig({health: 500, playerHealth: 500}), 42, testArena());
  for (const actor of sim.actors) {
    actor.weapon = new DuelWeaponState('ak47', () => 0);
    actor.pitch = Math.atan2(1.2 - 64 * UNIT, 16);
  }
  sim.command(1, {}); sim.start();
  return sim;
}

describe('shared combat aim punch', () => {
  it.each(['fallback', 'tactical'])('%s aim corrects punch through its finite motor, not instant recoil cancellation', kind => {
    const sim = fixture(), self = sim.snapshot()[1];
    self.yaw = 0; self.pitch = 0;
    const traits = {...createBotTraits(10, 42, 1), recognitionMedianMs: 0, endpointErrorDegrees: 0,
      motorSettlingMs: 180, lowAimTendency: 0};
    const brain = kind === 'fallback' ? new BotBrain(traits, 'holder', 1, () => .5)
      : new TacticalBrain(traits, 'holder', 1, () => .5, duelArena(42), 10, 'ak47', 1);
    const position = {x: self.position.x, y: self.position.y, z: self.position.z - 10};
    self.aimPunch = {yaw: 0, pitch: 12, roll: 0};
    brain.perceive({time: 0, self, visible: {id: 0, position, aimPoint: position}});
    const command = brain.command(self, STEP);
    expect(command.pitchDelta).toBeLessThan(0);
    expect(Math.abs(command.pitchDelta ?? 0)).toBeLessThan((kind === 'fallback' ? 3 : 1) * Math.PI / 180);
    expect(command.firePressed).not.toBe(true);
    expect(self.aimPunch.pitch).toBe(12);
    expect(self.pitch).toBe(0);
  });

  it.each([0, 1])('applies punch to actor %s on the actual hit tick and deflects the next shot', victim => {
    const sim = fixture(), attacker = 1 - victim;
    sim.command(attacker, {firePressed: true}); sim.step();
    const hit = sim.drainEvents().find(event => event.kind === 'hit');
    expect(hit).toMatchObject({victim, shooter: attacker, group: 'chest', lethal: false});
    if (hit?.kind !== 'hit') throw new Error('Missing test hit');
    const expected = damagePunch({rawDamage: hit.healthDamage + hit.armorDamage * 2, group: 'chest', armor: 100, helmet: true}, () => .5);
    expect(sim.actors[victim].punch.angle.pitch).toBeCloseTo(expected.pitch, 5);
    expect(sim.snapshot()[victim].aimPunch?.pitch).toBeGreaterThan(0);
    sim.actors[victim].weapon = new DuelWeaponState('usp', () => 0);
    sim.command(victim, {firePressed: true}); sim.step();
    const fired = sim.drainEvents().find(event => event.kind === 'fire' && event.actorId === victim);
    if (fired?.kind !== 'fire') throw new Error('Missing return shot');
    expect(fired.direction.y).toBeGreaterThan(direction(sim.actors[victim].yaw, sim.actors[victim].pitch).y);
  });

  it('resolves simultaneous fire before adding either victim punch', () => {
    const sim = fixture(); sim.command(0, {firePressed: true}); sim.command(1, {firePressed: true}); sim.step();
    const events = sim.drainEvents(), hits = events.filter(event => event.kind === 'hit');
    expect(hits).toHaveLength(2);
    const shots = events.filter(event => event.kind === 'fire');
    for (const shot of shots) if (shot.kind === 'fire') expect(shot.direction.y).toBe(direction(sim.actors[shot.actorId].yaw, sim.actors[shot.actorId].pitch).y);
    expect(sim.actors[0].punch.angle).toEqual(sim.actors[1].punch.angle);
  });

  it('keeps punch across weapon switches and pause, then resets for new actors', () => {
    const sim = fixture(); sim.command(1, {firePressed: true}); sim.step();
    const angle = {...sim.actors[0].punch.angle};
    sim.equipPlayer(2); expect(sim.actors[0].punch.angle).toEqual(angle);
    sim.pause(); sim.advance(.2); expect(sim.actors[0].punch.angle).toEqual(angle);
    sim.resume(); sim.advance(.2); expect(sim.actors[0].punch.angle.pitch).toBeLessThan(angle.pitch);
    expect(fixture().actors.every(actor => actor.punch.angle.pitch === 0)).toBe(true);
  });

  it('uses armor present at impact even when that hit depletes it', () => {
    const sim = fixture(); sim.actors[1].armor = 1;
    sim.command(0, {firePressed: true}); sim.step();
    const hit = sim.drainEvents().find(event => event.kind === 'hit');
    if (hit?.kind !== 'hit') throw new Error('Missing test hit');
    expect(sim.actors[1].armor).toBe(0);
    const expected = damagePunch({rawDamage: hit.healthDamage + 2 * hit.armorDamage, armor: 1, helmet: true, group: 'chest'}, () => .5);
    expect(sim.actors[1].punch.angle.pitch).toBeCloseTo(expected.pitch);
  });

  it('does not punch an actor behind cover or after a lethal hit', () => {
    const sim = fixture(); sim.arena.solids.push({center: {x: 0, y: 1.5, z: 0}, size: {x: 3, y: 3, z: 1}});
    sim.command(0, {firePressed: true}); sim.step();
    expect(sim.actors[1].punch.angle.pitch).toBe(0);
    const lethal = fixture(); lethal.actors[1].health = 1;
    lethal.command(0, {firePressed: true}); lethal.step();
    expect(lethal.actors[1].alive).toBe(false); expect(lethal.actors[1].punch.angle.pitch).toBe(0);
    expect(lethal.snapshot()[1].deathDirection?.z).toBeLessThan(0);
  });
});
