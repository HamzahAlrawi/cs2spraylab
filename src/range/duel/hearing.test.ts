import {describe, expect, it, vi} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {defaults, gameData} from '../config';
import {Simulation} from '../simulation';
import {sanitizeDuelConfig} from './config';
import {duelArena, testArena} from './geometry';
import {observeBot} from './perception';
import {randomStream} from './rng';
import {DuelSimulation} from './simulation';
import {createBotTraits} from './skill';
import {TacticalBrain} from './tactics';

describe('duel audio and movement parity', () => {
  it('hears running footsteps across 24m of cover without visual access, but not past the native cutoff', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({skill: 10}), 1, duelArena(1, 1.5));
    const hear = vi.spyOn(TacticalBrain.prototype, 'hear');
    try {
      sim.actors[0].position = {x: 0, y: 1.6256, z: 12};
      sim.actors[1].position = {x: 0, y: 1.6256, z: -12};
      expect(observeBot(0, sim.snapshot()[1], [sim.snapshot()[0]], sim.arena).visible).toBeNull();
      sim['informHearing'](sim.actors[0], {x: 0, y: 0, z: 12}, 'footstep');
      expect(hear).toHaveBeenCalledOnce();
      expect(hear.mock.calls[0][3]).toBe(true);
      sim.actors[1].position.z = -18;
      sim['informHearing'](sim.actors[0], {x: 0, y: 0, z: 12}, 'footstep');
      expect(hear).toHaveBeenCalledOnce();
    } finally {hear.mockRestore();}
  });
  it('turns a heard, unseen shot into a delayed investigation without granting visual identification', () => {
    const arena = duelArena(1);
    const sim = new DuelSimulation(sanitizeDuelConfig({behavior: 'aggressive'}), 1, arena);
    const [player, bot] = sim.snapshot();
    expect(observeBot(0, bot, [player], arena).visible).toBeNull();
    const traits = {...createBotTraits(5, 42, 1), recognitionMedianMs: 240};
    const heard = new TacticalBrain(traits, 'aggressive', 1, randomStream(42, 'sound'), arena, 5, 'ak47', 1);
    const silent = new TacticalBrain(traits, 'aggressive', 1, randomStream(42, 'sound'), arena, 5, 'ak47', 1);
    const observation = observeBot(0, bot, [player], arena);
    heard.perceive(observation); silent.perceive(observation);
    heard.hear({x: 6, y: 0, z: 7}, 0, 'gunshot', true);
    const early = heard.command(bot, .1), baseline = silent.command(bot, .1);
    expect({forward: early.forward, side: early.side, fire: early.fireHeld})
      .toEqual({forward: baseline.forward, side: baseline.side, fire: baseline.fireHeld});
    expect(heard.phase).toBe('approach');
    heard.command(bot, .3);
    expect(heard.phase).toBe('investigate');
    expect(heard.command(bot, .31).fireHeld).toBe(false);
    expect(silent.phase).toBe('approach');
  });

  it('coalesces rapid footsteps so the hearing delay can finish', () => {
    const arena = duelArena(1);
    const sim = new DuelSimulation(sanitizeDuelConfig({behavior: 'aggressive'}), 1, arena);
    const bot = sim.snapshot()[1];
    const traits = {...createBotTraits(5, 41, 1), recognitionMedianMs: 360};
    const brain = new TacticalBrain(traits, 'aggressive', 1, randomStream(41, 'steps'), arena, 5, 'ak47', 1);
    for (const time of [0, .2, .4]) brain.hear({x: 5, y: 0, z: 6}, time, 'footstep', false);
    brain.command(bot, .35);
    expect(brain.phase).toBe('approach');
    brain.command(bot, .42);
    expect(brain.phase).toBe('investigate');
  });

  it('treats a teammate callout as delayed, uncertain information rather than permission to shoot', () => {
    const arena = duelArena(1);
    const sim = new DuelSimulation(sanitizeDuelConfig({behavior: 'aggressive'}), 1, arena);
    const bot = sim.snapshot()[1];
    const traits = {...createBotTraits(5, 42, 1), recognitionMedianMs: 240};
    const brain = new TacticalBrain(traits, 'aggressive', 1, randomStream(42, 'callout'), arena, 5, 'ak47', 1);
    brain.perceive({time: 0, self: bot, visible: null});
    brain.teammateCallout({x: 4, y: 0, z: 6}, 0);
    expect(brain.contactReport(.1)).toBeNull();
    expect(brain.command(bot, .1).fireHeld).toBe(false);
    expect(brain.phase).toBe('approach');
    for (let tick = 1; tick <= 128; tick++) {
      const time = tick / 128;
      brain.perceive({time, self: bot, visible: null});
      expect(brain.command(bot, time).fireHeld).toBe(false);
    }
    expect(brain.phase).toBe('investigate');
  });

  it('only reports a visual contact while the player is still visible', () => {
    const arena = duelArena(2);
    const sim = new DuelSimulation(sanitizeDuelConfig({}), 2, arena);
    const [player, bot] = sim.snapshot();
    const traits = {...createBotTraits(7, 2, 1), recognitionMedianMs: 0};
    const brain = new TacticalBrain(traits, 'patient', 1, randomStream(2, 'report'), arena, 7, 'ak47', 1);
    const visible = {id: 0, position: player.position, aimPoint: player.position};
    brain.perceive({time: .1, self: bot, visible});
    expect(brain.contactReport(.1)).toEqual(player.position);
    brain.perceive({time: .2, self: bot, visible: null});
    expect(brain.contactReport(.2)).toBeNull();
  });

  it('propagates a player gunshot through occluding cover into bot movement', () => {
    const config = sanitizeDuelConfig({behavior: 'aggressive', skill: 5});
    const alerted = new DuelSimulation(config, 63, duelArena(63));
    const quiet = new DuelSimulation(config, 63, duelArena(63));
    alerted.start(); quiet.start();
    alerted.command(0, {firePressed: true});
    for (let tick = 0; tick < .7 / STEP; tick++) {alerted.step(); quiet.step();}
    expect(alerted.drainEvents().some(event => event.kind === 'fire' && event.actorId === 0)).toBe(true);
    const a = alerted.snapshot()[1], b = quiet.snapshot()[1];
    expect(observeBot(0, a, [alerted.snapshot()[0]], alerted.arena).visible).toBeNull();
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(.05);
  });

  it('keeps settled shift movement quiet but exposes running footsteps', () => {
    const run = (walk: boolean) => {
      const sim = new DuelSimulation(sanitizeDuelConfig({}), 64, testArena());
      sim.command(1, {});
      sim.start(); sim.command(0, {forward: 1, walk});
      for (let tick = 0; tick < 1 / STEP; tick++) sim.step();
      return sim.drainEvents().filter(event => event.kind === 'sound' && event.actorId === 0 && event.sound === 'footstep');
    };
    expect(run(true)).toHaveLength(0);
    expect(run(false).length).toBeGreaterThan(0);
  });

  it('uses the same AK movement acceleration, crouch and jump path as the range', () => {
    const range = new Simulation({...defaults, weapon: 'ak47', mode: 'spray'});
    const duel = new DuelSimulation(sanitizeDuelConfig({}), 77, testArena());
    range.position = {x: 0, y: 64 * UNIT, z: 4};
    duel.actors[0].position = {...range.position};
    range.active = true;
    duel.command(1, {});
    duel.start();
    const input = {forward: 1, side: 0, walk: false, crouch: false, jump: false};
    for (let tick = 0; tick < 128; tick++) {
      if (tick === 36) input.side = 1;
      if (tick === 54) input.crouch = true;
      if (tick === 70) input.jump = true;
      if (tick === 71) input.jump = false;
      range.input = {...input};
      duel.command(0, input);
      range.step(STEP); duel.step();
      const player = duel.snapshot()[0];
      expect(player.position.x).toBeCloseTo(range.position.x, 7);
      expect(player.position.y).toBeCloseTo(range.position.y, 7);
      expect(player.position.z).toBeCloseTo(range.position.z, 7);
      expect(player.velocity.x).toBeCloseTo(range.velocity.x, 7);
      expect(player.velocity.z).toBeCloseTo(range.velocity.z, 7);
      expect(player.duckAmount).toBeCloseTo(range.duckAmount, 7);
    }
    expect(Math.hypot(range.velocity.x, range.velocity.z)).toBeLessThan(gameData.weapons.ak47.speed * UNIT);
  });
});
