import {describe, expect, it} from 'vitest';
import {DuelSimulation} from './simulation';
import {BotUtilityDefense} from './utility-defense';
import {testArena} from './geometry';
import type {UtilityEffect, UtilityProjectile} from './utilities';

describe('human-limited utility defense', () => {
  const self = () => new DuelSimulation().snapshot()[1];
  const flash: UtilityProjectile = {id: 1, actorId: 0, side: 'player', kind: 'flash',
    position: {x: 0, y: 1.5, z: -7}, velocity: {x: 0, y: 0, z: 0}, radius: .05, thrownAt: 0, resting: false, bounces: 0};
  it('does not react to unseen throws or snap immediately to a visible one', () => {
    const actor = self(), defense = new BotUtilityDefense(1, 1, 10);
    defense.perceive(0, actor, []); expect(defense.command(.3, actor, testArena(), [])).toBeUndefined();
    defense.perceive(.3, actor, [flash]); expect(defense.command(.31, actor, testArena(), [])).toBeUndefined();
  });
  it('keeps flash turning finite, seeded, time-limited and skill-dependent', () => {
    let novice = 0, expert = 0;
    for (let seed = 0; seed < 100; seed++) for (const level of [1, 10] as const) {
      const actor = self(), defense = new BotUtilityDefense(seed, 1, level);
      defense.perceive(0, actor, [flash]); const command = defense.command(.7, actor, testArena(), []);
      if (command) {if (level === 1) novice++; else expert++;
        expect(Math.abs(command.yawDelta ?? 0)).toBeLessThan(.1); expect(command.fireHeld).toBe(false);}
      expect(defense.command(2, actor, testArena(), [])).toBeUndefined();
    }
    expect(expert).toBeGreaterThan(60); expect(novice).toBeLessThan(20);
  });
  it('steps out of local floor fire without changing position/velocity or stealing combat gaze', () => {
    const actor = self(), before = structuredClone(actor), defense = new BotUtilityDefense(1, 1, 5);
    const fire: UtilityEffect = {id: 2, actorId: 0, side: 'player', kind: 'molotov', type: 'fire',
      position: {...actor.position, y: actor.feet}, radius: 3, startedAt: 0, expiresAt: 7,
      cells: [{...actor.position, y: actor.feet}], holes: []};
    const command = defense.command(1, actor, testArena(), [fire]);
    expect(Math.hypot(command?.forward ?? 0, command?.side ?? 0)).toBeCloseTo(1);
    expect(command?.yawDelta).toBeUndefined(); expect(actor).toEqual(before);
    expect(defense.decision()).toBe('leave-burning-floor');
  });
});
