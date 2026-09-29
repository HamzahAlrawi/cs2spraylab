import {describe, expect, it} from 'vitest';
import {STEP} from '../actor-physics';
import {sanitizeDuelConfig, type SkillLevel} from './config';
import {testArena} from './geometry';
import {DuelSimulation} from './simulation';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';
import {randomStream} from './rng';

const arena = () => ({...testArena(), lanes: [{side: 1 as const, role: 'entry' as const,
  anchor: {x: 0, y: 0, z: -8}, edge: {x: 1.3, y: 0, z: -8}, retreat: {x: 0, y: 0, z: -8}}]});

describe('bounded human-style combat control', () => {
  it('corrects and tracks more effectively at high skill, with imperfect shots and varied reaction delays', () => {
    const cohort = (skill: SkillLevel) => {
      let hits = 0, shots = 0;
      const reactions: number[] = [];
      for (let seed = 1; seed <= 16; seed++) {
        const sim = new DuelSimulation(sanitizeDuelConfig({skill, behavior: 'aggressive'}), seed, arena());
        sim.actors[0].health = 10000; sim.start();
        let side = 1, fired = false;
        for (let tick = 0; tick < 5 / STEP; tick++) {
          if (sim.actors[0].position.x > 1.6) side = -1;
          if (sim.actors[0].position.x < -1.6) side = 1;
          sim.command(0, {side}); sim.step();
          for (const event of sim.drainEvents()) {
            if (event.kind === 'fire' && event.actorId === 1) {
              shots++;
              if (!fired) {reactions.push(sim.time); fired = true;}
            }
            if (event.kind === 'hit' && event.shooter === 1) hits++;
          }
        }
      }
      return {rate: hits / shots, reactions};
    };
    const low = cohort(1), middle = cohort(5), high = cohort(10), elite = cohort('10+');
    expect(middle.rate).toBeGreaterThan(low.rate);
    expect(high.rate).toBeGreaterThan(middle.rate * 2);
    expect(high.rate).toBeGreaterThan(.18);
    expect(elite.rate).toBeGreaterThan(high.rate);
    expect(elite.rate).toBeLessThan(.7);
    expect(Math.min(...elite.reactions)).toBeGreaterThan(.2);
    expect(Math.max(...elite.reactions) - Math.min(...elite.reactions)).toBeGreaterThan(.05);
  });

  it('uses only visible samples for motion prediction and clears it on occlusion', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({}), 1, arena());
    const [player, bot] = sim.snapshot();
    const brain = new TacticalBrain({...createBotTraits(10, 1, 1), recognitionMedianMs: 0}, 'aggressive', 1,
      randomStream(1, 'test'), arena(), 10, 'ak47', 1);
    for (let frame = 0; frame < 10; frame++) {
      const position = {...player.position, x: frame * .12};
      brain.perceive({time: frame / 32, self: bot, visible: {id: 0, position, aimPoint: position}});
    }
    // Inspect the estimator rather than relying on downstream random tactical choices.
    expect((brain as any).targetVelocity.x).toBeGreaterThan(3);
    brain.perceive({time: .4, self: bot, visible: null});
    expect((brain as any).targetVelocity).toEqual({x: 0, z: 0});
    const position = {...player.position, x: -8};
    brain.perceive({time: 1, self: bot, visible: {id: 0, position, aimPoint: position}});
    expect((brain as any).targetVelocity).toEqual({x: 0, z: 0});
  });

  it('does not abandon every favorable duel on one body hit, but retreats when critically hurt', () => {
    const [player, bot] = new DuelSimulation(sanitizeDuelConfig({}), 1, arena()).snapshot();
    const brain = new TacticalBrain({...createBotTraits(10, 1, 1), recognitionMedianMs: 0}, 'aggressive', 1,
      () => .5, arena(), 10, 'ak47', 1);
    brain.perceive({time: 1, self: bot, visible: {id: 0, position: player.position, aimPoint: player.position}});
    brain.command(bot, 1);
    expect(brain.phase).toBe('attack');
    brain.hurt(1.2, 72);
    expect(brain.phase).toBe('attack');
    brain.hurt(1.3, 23);
    expect(brain.phase).toBe('return');
  });
});
