import {describe, expect, it} from 'vitest';
import {STEP, idleInput} from '../actor-physics';
import {defaults, type Weapon} from '../config';
import {Simulation} from '../simulation';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';

describe('all-mode movement parity', () => {
  for (const weapon of ['ak47', 'm4a4', 'mp9'] as Weapon[]) it(`${weapon}: shares acceleration, braking, walk, duck and air control`, () => {
    const range = new Simulation({...defaults, mode: 'guided', weapon});
    range.position.z = -60; range.active = true;
    const duel = new DuelSimulation(sanitizeDuelConfig({}), 1, undefined, weapon);
    duel.command(1, {}); duel.start();
    for (let tick = 0; tick < 600; tick++) {
      const input = {...idleInput(), side: tick < 110 ? 1 : tick < 135 ? -1 : 0,
        forward: tick >= 160 && tick < 450 ? 1 : 0, walk: tick >= 160 && tick < 250,
        crouch: tick >= 320 && tick < 430, jump: tick >= 300 && tick < 400};
      range.input = input; duel.command(0, input);
      range.step(STEP); duel.step();
      const player = duel.actors[0];
      expect(player.position.x).toBeCloseTo(range.position.x, 7);
      expect(player.position.z - 8).toBeCloseTo(range.position.z + 60, 7);
      expect(player.position.y).toBeCloseTo(range.position.y, 7);
      expect(player.velocity).toEqual(range.velocity);
      expect(player.duckAmount).toBe(range.duckAmount);
      expect(player.grounded).toBe(range.grounded);
    }
  });
});
