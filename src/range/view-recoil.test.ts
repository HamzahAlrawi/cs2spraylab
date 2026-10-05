import {describe, expect, it} from 'vitest';
import {DEG, STEP} from './actor-physics';
import {defaults} from './config';
import {Simulation} from './simulation';
import {recoilView} from './view-recoil';
import {direction, shotDirection} from './shot-model';
import {WeaponRecovery} from './ballistics';
import {gameData} from './config';

describe('shared camera presentation', () => {
  it('renders recoil without feeding it back into physical aim or mouse sensitivity', () => {
    const recoil = {yaw: 2, pitch: 7};
    const shot = direction(.3 - recoil.yaw * DEG, .1 + recoil.pitch * DEG);
    const view = recoilView(.3, .1, recoil);
    expect(view.pitch).toBeGreaterThan(.1); expect(view.pitch).toBeLessThan(.1 + 7 * DEG);
    expect(view.yaw).toBeLessThan(.3);
    expect(recoil).toEqual({yaw: 2, pitch: 7});
    expect(direction(.3 - recoil.yaw * DEG, .1 + recoil.pitch * DEG)).toEqual(shot);
    expect(recoilView(.4, .2, recoil).yaw - view.yaw).toBeCloseTo(.1);
  });
  it('applies full physical recoil and punch once while the view remains presentation only', () => {
    const weapon = gameData.weapons.ak47, recovery = new WeaponRecovery(weapon), recoil = {yaw: 2, pitch: 7};
    const punch = {yaw: -.3, pitch: 1, roll: 2}, yaw = .3, pitch = .1;
    const aim = {yaw, pitch, recoil, punch, weapon, recovery, speedRatio: 0, walking: false,
      airborne: false, verticalSpeedUnits: 0, spread: false};
    const before = JSON.stringify(aim);
    const view = recoilView(yaw, pitch, recoil), shot = shotDirection(aim);
    expect(shot).toEqual(direction(yaw - (recoil.yaw + punch.yaw) * DEG, pitch + (recoil.pitch + punch.pitch) * DEG));
    expect(shot).not.toEqual(direction(view.yaw, view.pitch));
    expect(shotDirection(aim)).toEqual(shot); expect(JSON.stringify(aim)).toBe(before);
  });

  it('interpolates range movement at 240 Hz without moving the authoritative shot origin', () => {
    const sim = new Simulation({...defaults, mode: 'guided'});
    sim.position.z = -60; sim.active = true; sim.input.forward = 1;
    for (let tick = 0; tick < 128; tick++) sim.step(STEP);
    const positions: number[] = [];
    for (let frame = 0; frame < 30; frame++) {
      sim.advance(1 / 240);
      const before = {...sim.position};
      positions.push(sim.renderPosition().z);
      expect(sim.position).toEqual(before);
    }
    const steps = positions.slice(1).map((z, i) => Math.abs(z - positions[i]));
    expect(Math.min(...steps)).toBeGreaterThan(.02);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(.00001);
    sim.cancel(); expect(sim.renderPosition()).toEqual(sim.position);
  });
});
