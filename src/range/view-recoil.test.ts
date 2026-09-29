import {describe, expect, it} from 'vitest';
import {DEG, STEP} from './actor-physics';
import {defaults} from './config';
import {Simulation} from './simulation';
import {recoilView} from './view-recoil';
import {direction} from './shot-model';

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
