import {describe, expect, it} from 'vitest';
import {DEG, STEP} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {observeBot} from './perception';
import {randomStream} from './rng';
import {createBotTraits, type PeekType} from './skill';
import {DuelSimulation} from './simulation';
import {TacticalBrain} from './tactics';

function encounter(peek: PeekType, seed = 1) {
  const arena = {...testArena(), lanes: [{side: 1 as const, role: 'entry' as const,
    anchor: {x: 0, y: 0, z: -8}, edge: {x: 6, y: 0, z: -8}, retreat: {x: 0, y: 0, z: -8}}]};
  const sim = new DuelSimulation(sanitizeDuelConfig({skill: '10+', behavior: 'aggressive'}), seed, arena);
  sim.actors[0].health = 10000;
  const brain = new TacticalBrain(createBotTraits('10+', seed, 1), 'aggressive', 1,
    randomStream(seed, 'engagement'), arena, '10+', 'ak47', 1);
  brain.phase = 'expose'; brain.activePeek = peek;
  sim.start();
  const step = () => {
    const [player, bot] = sim.snapshot();
    if (sim.tick % 4 === 0) brain.perceive(observeBot(sim.time, bot, [player], arena));
    sim.command(1, brain.command(bot, sim.time, sim.actors[1].weapon.recovery.recoil));
    sim.step();
    return sim.drainEvents().some(event => event.kind === 'fire' && event.actorId === 1);
  };
  return {sim, brain, step};
}

describe('visible engagements during peeks', () => {
  it.each(['quick', 'wide', 'ferrari', 'crouch', 'prefire', 'slice', 'run', 'crouchWide'] as const)(
    'engages from a %s peek without waiting to reach a distant waypoint', peek => {
      for (const seed of [1, 4, 12]) {
        const {sim, step} = encounter(peek, seed);
        let firedAt = Infinity;
        while (sim.time < 1) if (step()) {firedAt = sim.time; break;}
        expect(firedAt, `${peek}, seed ${seed}`).toBeLessThan(.85);
        expect(firedAt).toBeGreaterThan(.15);
      }
    });

  it.each(['shoulder', 'jump'] as const)('keeps %s peeks as information gathering', peek => {
    const {sim, brain, step} = encounter(peek);
    let shots = 0;
    while (sim.time < 3 && brain.phase !== 'return') shots += +step();
    expect(brain.phase).toBe('return');
    expect(shots).toBe(0);
  });

  it('finishes aiming at a visible opponent instead of abandoning an unfired burst', () => {
    const {sim, brain, step} = encounter('wide');
    const bot = sim.actors[1];
    bot.yaw = Math.PI - 55 * DEG;
    // A decaying punch left by a previous magazine can delay the first accurate shot.
    for (let n = 0; n < 16; n++) {bot.weapon.recovery.fire(); bot.weapon.recovery.advance(.1);}
    let fired = false, abandoned = false;
    while (sim.time < 2 && !fired) {
      fired = step();
      abandoned ||= brain.phase === 'return';
    }
    expect(fired).toBe(true);
    expect(abandoned).toBe(false);
  });

  it('reengages when a combat retreat stays exposed, but preserves a deliberate low-health retreat', () => {
    for (const injured of [false, true]) {
      const {sim, brain, step} = encounter('wide');
      sim.actors[1].position.x = 5;
      sim.actors[1].yaw = Math.atan2(5, -16);
      brain.phase = 'return';
      if (injured) brain.hurt(0, 20);
      let shots = 0;
      while (sim.time < .85) shots += +step();
      expect(shots > 0).toBe(!injured);
    }
  });
});
