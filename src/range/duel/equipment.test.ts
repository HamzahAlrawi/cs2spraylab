import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';
import {idleCommand} from './types';

const pose = {position: {x: 0, y: 64 * UNIT, z: 8}, yaw: 0, pitch: 0, velocity: {x: 0, z: 0}, feet: 0, verticalVelocity: 0};
const advance = (sim: DuelSimulation, seconds: number) => {for (let i = 0; i < Math.ceil(seconds / STEP); i++) sim.step();};
describe('Duel sidearm and knife', () => {
  it('gives a semiautomatic 12-round USP and keeps recoil through rapid taps', () => {
    const weapon = new DuelWeaponState('usp', () => 0), command = {...idleCommand(), fireHeld: true, firePressed: true};
    expect(weapon.advance(0, 0, command, pose)).toBeDefined(); command.firePressed = false;
    for (let tick = 1; tick < 24; tick++) expect(weapon.advance(tick * STEP, STEP, command, pose)).toBeUndefined();
    expect(weapon.ammo).toBe(11);
    command.firePressed = true;
    const shot = weapon.advance(24 * STEP, STEP, command, pose)!;
    expect(weapon.ammo).toBe(10); expect(shot.direction.y).toBeGreaterThan(0);
  });
  it('preserves primary ammo/recoil and enforces deploy delay through switching', () => {
    const sim = new DuelSimulation(); sim.command(1, {}); sim.start();
    sim.actors[1].position.x = 4;
    sim.command(0, {firePressed: true}); sim.step();
    const rifle = sim.actors[0].weapon;
    expect(rifle.ammo).toBe(29);
    sim.equipPlayer(2); expect(sim.snapshot()[0]).toMatchObject({equipment: 'usp', ammo: 12});
    sim.command(0, {firePressed: true}); sim.step();
    expect(sim.actors[0].weapon.ammo).toBe(12);
    advance(sim, 1.1); sim.command(0, {firePressed: true}); sim.step();
    expect(sim.actors[0].weapon.ammo).toBe(11);
    sim.equipPlayer(1); expect(sim.actors[0].weapon).toBe(rifle); expect(rifle.ammo).toBe(29);
    expect(rifle.recovery.time).toBeGreaterThan(1);
  });
  it('limits knife damage to close range and records kills without gun accuracy inflation', () => {
    const sim = new DuelSimulation(); sim.command(1, {}); sim.equipPlayer(3); sim.start();
    sim.command(0, {firePressed: true}); sim.step();
    expect(sim.actors[1].health).toBe(100);
    sim.actors[1].position = {x: 0, y: 64 * UNIT, z: 7}; sim.actors[1].health = 10;
    advance(sim, .5); sim.command(0, {firePressed: true}); sim.step();
    expect(sim.actors[1].alive).toBe(false);
    expect(sim.coach.review()).toMatchObject({kills: 1, damage: 10, hits: 0, shots: 0});
  });
  it('uses the knife 250u/s movement cap', () => {
    const sim = new DuelSimulation(); sim.command(1, {}); sim.equipPlayer(3); sim.start();
    sim.command(0, {forward: 1}); advance(sim, .8);
    expect(Math.hypot(sim.actors[0].velocity.x, sim.actors[0].velocity.z) / UNIT).toBeCloseTo(250, 6);
  });
});
