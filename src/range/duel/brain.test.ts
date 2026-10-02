import {describe, expect, it} from 'vitest';
import {STEP} from '../actor-physics';
import {BotBrain} from './brain';
import {rosterBehaviors, sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {observeBot} from './perception';
import {randomStream} from './rng';
import {DuelSimulation} from './simulation';
import {createBotTraits} from './skill';

describe('autonomous duel perception and execution', () => {
  it('seeds diverse mixed rosters while honoring explicit choices', () => {
    const config = sanitizeDuelConfig({botCount: 5, overrides: [{behavior: 'aggressive'}]});
    const behaviors = rosterBehaviors(config, 19);
    expect(behaviors).toEqual(rosterBehaviors(config, 19));
    expect(behaviors[0]).toBe('aggressive');
    expect(new Set(rosterBehaviors(sanitizeDuelConfig({botCount: 5}), 19))).toEqual(
      new Set(['holder', 'patient', 'aggressive']));
  });

  it('hides occluded target coordinates from the bot policy', () => {
    const simulation = new DuelSimulation();
    const [player, bot] = simulation.snapshot();
    const arena = testArena();
    arena.solids.push({center: {x: 0, y: 1.2, z: 0}, size: {x: 4, y: 2.4, z: .5}});
    const a = observeBot(0, bot, [player], arena);
    const b = observeBot(0, bot, [{...player, position: {...player.position, x: 1}}], arena);
    expect(a.visible).toBeNull();
    expect(b.visible).toBeNull();
    const traits = createBotTraits(5, 11, 1);
    const brainA = new BotBrain(traits, 'mixed', 1, randomStream(11, 'brain'));
    const brainB = new BotBrain(traits, 'mixed', 1, randomStream(11, 'brain'));
    brainA.perceive(a); brainB.perceive(b);
    expect(brainA.command(bot, 0)).toEqual(brainB.command(bot, 0));
    expect(observeBot(0, bot, [player], testArena()).visible?.id).toBe(0);
  });

  it('recognizes head-only and left-half exposures without aiming through the covered center', () => {
    const [player, bot] = new DuelSimulation().snapshot();
    const headOnly = testArena();
    headOnly.solids.push({center: {x: 0, y: .7, z: 0}, size: {x: 2, y: 1.4, z: .5}});
    expect(observeBot(0, bot, [player], headOnly).visible?.aimPoint.y).toBeGreaterThan(1.4);
    const halfBody = testArena();
    halfBody.solids.push({center: {x: .07, y: 1.2, z: 0}, size: {x: .18, y: 2.4, z: .5}});
    expect(observeBot(0, bot, [player], halfBody).visible?.aimPoint.x).toBeLessThan(0);
  });

  it('waits to identify a target before firing and preserves the delay across sensing ticks', () => {
    const simulation = new DuelSimulation();
    const [player, bot] = simulation.snapshot();
    const brain = new BotBrain(createBotTraits(10, 17, 1), 'holder', 1, randomStream(17, 'brain'));
    const observation = observeBot(0, bot, [player], testArena());
    brain.perceive(observation);
    expect(brain.command(bot, 0).fireHeld).toBe(false);
    const otherBrain = new BotBrain(createBotTraits(10, 17, 1), 'holder', 1, randomStream(17, 'brain'));
    otherBrain.perceive(observeBot(0, bot, [{...player, position: {...player.position, x: 4}}], testArena()));
    // Seeing a target can redirect gaze immediately, but cannot skip recognition.
    expect(otherBrain.command(bot, 0).fireHeld).toBe(false);
    expect(brain.command(bot, 0).yawDelta).not.toEqual(otherBrain.command(bot, 0).yawDelta);
    brain.perceive({...observation, time: .1});
    expect(brain.command(bot, .1).fireHeld).toBe(false);
  });

  it('moves and fires autonomously with deterministic seeded behavior for five bots', () => {
    const run = () => {
      const simulation = new DuelSimulation(sanitizeDuelConfig({botCount: 5, skill: 7}), 9001);
      simulation.start();
      for (let tick = 0; tick < 3 / STEP && simulation.phase === 'fighting'; tick++) simulation.step();
      return {actors: simulation.snapshot(), events: simulation.drainEvents()};
    };
    const first = run();
    expect(first).toEqual(run());
    expect(first.events.some(event => event.kind === 'fire' && event.actorId > 0)).toBe(true);
    expect(first.actors.slice(1).some(actor => actor.position.z > -8)).toBe(true);
  });

  it('counterstrafe input opposes velocity instead of assigning velocity directly', () => {
    const [player, bot] = new DuelSimulation().snapshot();
    const moving = {...bot, velocity: {x: 2, z: 0}};
    const traits = {...createBotTraits(10, 20, 1), recognitionMedianMs: 0, brakeErrorMs: 0,
      motorSettlingMs: 0, stopTendency: 1};
    const brain = new BotBrain(traits, 'mixed', 1, randomStream(20, 'brain'));
    brain.perceive(observeBot(0, moving, [player], testArena()));
    const command = brain.command(moving, 0);
    const wishX = (command.side ?? 0) * Math.cos(bot.yaw) - (command.forward ?? 0) * Math.sin(bot.yaw);
    const wishZ = -(command.side ?? 0) * Math.sin(bot.yaw) - (command.forward ?? 0) * Math.cos(bot.yaw);
    expect(wishX * moving.velocity.x + wishZ * moving.velocity.z).toBeLessThan(0);
    expect(moving.velocity).toEqual({x: 2, z: 0});
  });

  it('lets an autonomous bot damage an idle player in an open duel', () => {
    const simulation = new DuelSimulation(sanitizeDuelConfig({skill: 10}), 47);
    simulation.start();
    for (let tick = 0; tick < 5 / STEP && simulation.phase === 'fighting'; tick++) simulation.step();
    const events = simulation.drainEvents();
    expect(events.some(event => event.kind === 'fire' && event.actorId === 1)).toBe(true);
    expect(events.some(event => event.kind === 'hit' && event.shooter === 1 && event.victim === 0)).toBe(true);
    expect(simulation.snapshot()[0].health).toBeLessThan(100);
  });
});
