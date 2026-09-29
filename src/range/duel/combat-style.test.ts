import {describe, expect, it} from 'vitest';
import {combatStyle} from './skill';
import {coveredSpawns} from './spawns';
import {duelArena, canFitInArena} from './geometry';
import {observeBot} from './perception';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {UNIT} from '../actor-physics';

describe('requested combat habits', () => {
  it.each([[1, .6, 0], [2, .6, 0], [3, .51, 0], [5, .33, .1], [10, .02, .33]] as const)(
    'uses the requested level %s encounter probabilities', (level, spray, tap) => {
      expect(combatStyle(level).crouchSpray).toBeCloseTo(spray);
      expect(combatStyle(level).crouchTap).toBeCloseTo(tap);
    });
  it('improves control and consistency gradually, without perfect aim', () => {
    for (const level of [2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
      const a = combatStyle((level - 1) as 1), b = combatStyle(level);
      expect(b.recoilControl).toBeGreaterThan(a.recoilControl);
      expect(b.recoilVariation).toBeLessThan(a.recoilVariation);
      expect(b.crouchSpray).toBeLessThanOrEqual(a.crouchSpray);
      expect(b.crouchTap).toBeGreaterThanOrEqual(a.crouchTap);
      expect(b.recoilControl).toBeLessThan(1);
    }
  });
});

describe('covered randomized starts', () => {
  it('starts five separated bots and the player behind reachable cover at every arena size', () => {
    const starts = new Set<string>();
    for (const scale of [1, 1.25, 1.5]) for (let seed = 1; seed <= 30; seed++) {
      const arena = duelArena(seed, scale), spawns = coveredSpawns(arena, seed, 5);
      expect(spawns, `seed ${seed}, scale ${scale}`).toBeDefined();
      expect(coveredSpawns(arena, seed, 5)).toEqual(spawns);
      starts.add(JSON.stringify(spawns!.player));
      const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 5, arenaScale: scale}), seed, arena);
      const [player, ...bots] = sim.snapshot();
      expect(Math.abs(player.position.x)).toBeGreaterThan(1);
      for (const actor of sim.snapshot()) expect(canFitInArena(actor.position, 0, 72 * UNIT, arena)).toBe(true);
      for (const bot of bots) {
        expect(observeBot(0, player, [bot], arena).visible).toBeNull();
        expect(observeBot(0, bot, [player], arena).visible).toBeNull();
        for (const other of bots) if (bot.id !== other.id)
          expect(Math.hypot(bot.position.x - other.position.x, bot.position.z - other.position.z)).toBeGreaterThan(32 * UNIT);
      }
    }
    expect(starts.size).toBeGreaterThan(50);
  });
});
