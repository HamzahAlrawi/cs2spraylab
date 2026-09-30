import {describe, expect, it} from 'vitest';
import {STEP} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {duelArena, moveInArena, traceSolid} from './geometry';
import {clearSegment, routeTo} from './navigation';
import {observeBot} from './perception';
import {DuelSimulation} from './simulation';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';
import {randomStream} from './rng';

describe('cover-based duel arena', () => {
  it('keeps all spawns out of direct line of sight in each template', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 5}), seed, duelArena(seed));
      const [player, ...bots] = sim.snapshot();
      for (const bot of bots) {
        expect(observeBot(0, bot, [player], sim.arena).visible).toBeNull();
        expect(observeBot(0, player, [bot], sim.arena).visible).toBeNull();
      }
    }
  });

  it('routes around center cover without crossing a wall or leaving the play area', () => {
    for (const seed of [1, 2, 3]) {
      const arena = duelArena(seed);
      const start = {x: 0, y: 1.6, z: -8};
      const goal = {x: 0, y: 1.6, z: 8};
      expect(clearSegment(start, goal, arena)).toBe(false);
      const path = routeTo(start, goal, arena);
      expect(path.length).toBeGreaterThan(1);
      for (let n = 0; n < path.length; n++) expect(clearSegment(n ? path[n - 1] : start, path[n], arena)).toBe(true);
      expect(path[path.length - 1]).toEqual(goal);
    }
  });

  it('offers reachable entry, flank and camp angles on both sides', () => {
    for (const seed of [1, 2, 3]) {
      const arena = duelArena(seed);
      expect(arena.solids.length).toBeGreaterThanOrEqual(18);
      expect(new Set(arena.solids.map(solid => solid.kind)).size).toBeGreaterThanOrEqual(4);
      for (const role of ['entry', 'flank', 'camp']) for (const side of [-1, 1]) {
        const lane = arena.lanes?.find(candidate => candidate.role === role && candidate.side === side);
        expect(lane).toBeDefined();
        const spawn = {x: 0, y: 1.6, z: -8};
        const route = routeTo(spawn, lane!.anchor, arena);
        expect(route.length, `seed ${seed}, ${role}, side ${side}`).toBeGreaterThan(0);
        for (let n = 0; n < route.length; n++)
          expect(clearSegment(n ? route[n - 1] : spawn, route[n], arena)).toBe(true);
        expect(clearSegment(lane!.anchor, lane!.edge, arena)).toBe(true);
      }
    }
  });

  it('keeps physical cover authoritative for sight, shots, and movement', () => {
    const arena = duelArena(1);
    const from = {x: 0, y: 1.6, z: -1.3};
    const desired = {x: 0, y: 1.6, z: 1.3};
    expect(traceSolid(from, {x: 0, y: 0, z: 1}, arena).distance).toBeLessThan(1.3);
    expect(moveInArena(from, desired, 0, 1.8, arena).z).toBeLessThan(-.7);
  });

  it('uses back-cover camp pockets for holders and forward entry angles for pushers', () => {
    const positionAfter = (behavior: 'holder' | 'aggressive') => {
      const sim = new DuelSimulation(sanitizeDuelConfig({behavior}), 208, duelArena(208));
      sim.actors[0].health = 10000;
      sim.start();
      for (let tick = 0; tick < 3 / STEP; tick++) sim.step();
      return sim.snapshot()[1].position;
    };
    const holder = positionAfter('holder'), pusher = positionAfter('aggressive');
    expect(holder.z).toBeLessThan(-8);
    expect(pusher.z).toBeGreaterThan(-5);
  });

  it('moves a five-bot roster through cover and preserves a bounded simulation cost', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 5, skill: 5, roundSeconds: 20}), 431, duelArena(431));
    sim.actors[0].health = 10000;
    sim.start();
    let furthestPeek = 0;
    let usedBackCover = false;
    for (let tick = 0; tick < 20 / STEP && sim.phase === 'fighting'; tick++) {
      sim.step();
      furthestPeek = Math.max(furthestPeek, ...sim.snapshot().slice(1).map(bot => Math.abs(bot.position.x)));
      usedBackCover ||= sim.time > 1 && sim.snapshot().slice(1).some(bot => bot.position.z < -8.5);
    }
    const bots = sim.snapshot().slice(1);
    expect(bots.some(bot => bot.position.z > -7.5)).toBe(true);
    expect(usedBackCover).toBe(true);
    expect(furthestPeek).toBeGreaterThan(3.5);
    const events = sim.drainEvents();
    expect(events.some(event => event.kind === 'fire' && event.actorId > 0)).toBe(true);
    for (const bot of bots) {
      expect(bot.position.x).toBeGreaterThan(sim.arena.minX);
      expect(bot.position.x).toBeLessThan(sim.arena.maxX);
    }
  });

  it('rotates to a player who commits to the opposite cover lane', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1, skill: 7, roundSeconds: 30}), 12, duelArena(12));
    sim.actors[0].health = 10000;
    sim.start();
    sim.command(0, {side: 1});
    for (let tick = 0; tick < 1 / STEP; tick++) sim.step();
    sim.command(0, {side: 0});
    expect(sim.snapshot()[1].position.x).toBeGreaterThan(3);
    let seenRight = false;
    for (let tick = 0; tick < 20 / STEP && sim.phase === 'fighting'; tick++) {
      sim.step();
      seenRight ||= sim.snapshot()[1].position.x > 3.4;
    }
    expect(seenRight).toBe(true);
    expect(sim.drainEvents().some(event => event.kind === 'fire' && event.actorId === 1)).toBe(true);
  });

  it('does not settle into one repeated route or a no-contact stalemate', () => {
    let multiRoute = 0, variedCombat = 0, combatRepositions = 0;
    // Measure a population of geometry/behavior combinations. Finding the
    // opponent during a rotation is valid and need not trigger a scripted peek.
    for (const seed of [1, 2, 3, 4, 5, 6, 19, 42, 101, 208, 431, 9001]) {
      // Keep this population regression at its original level-5 calibration,
      // independent of the first-visit UI difficulty.
      const sim = new DuelSimulation(sanitizeDuelConfig({roundSeconds: 25, skill: 5}), seed, duelArena(seed));
      sim.actors[0].health = 10000;
      sim.start();
      const roles = new Set<string>(), peeks = new Set<string>();
      let shots = 0, movedBetweenBursts = false;
      for (let tick = 0; tick < 25 / STEP; tick++) {
        sim.step();
        const decision = sim.botDecision(1);
        if (decision?.role) roles.add(decision.role);
        if (decision?.phase === 'expose') peeks.add(decision.peek);
        movedBetweenBursts ||= decision?.phase === 'microstrafe';
        shots += sim.drainEvents().filter(event => event.kind === 'fire' && event.actorId === 1).length;
      }
      expect(shots, `seed ${seed} never engaged`).toBeGreaterThan(0);
      multiRoute += +(roles.size > 1);
      // Sustained visible contact can replace a fresh peek with a combat strafe.
      variedCombat += +(peeks.size > 1 || movedBetweenBursts);
      combatRepositions += +movedBetweenBursts;
    }
    expect(multiRoute).toBeGreaterThanOrEqual(10);
    expect(variedCombat).toBeGreaterThanOrEqual(8);
    expect(combatRepositions).toBeGreaterThanOrEqual(4);
  });

  it('falls back after serious damage without knowing an unseen shooter location', () => {
    const arena = duelArena(4);
    const bot = new DuelSimulation(sanitizeDuelConfig({behavior: 'holder'}), 4, arena).snapshot()[1];
    const brain = new TacticalBrain(createBotTraits(8, 4, 1), 'holder', 1,
      randomStream(4, 'hurt'), arena, 8, 'ak47', 1);
    brain.hurt(.5, 25);
    expect(brain.decisionSnapshot().phase).toBe('return');
    expect(brain.command(bot, .6).fireHeld).toBe(false);
  });

  it('reloads behind cover after emptying a magazine and resumes its plan', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({behavior: 'aggressive'}), 3, duelArena(3));
    sim.actors[0].health = 10000;
    sim.actors[1].weapon.ammo = 0;
    sim.start();
    let sawReload = false;
    for (let tick = 0; tick < 9 / STEP; tick++) {
      sim.step();
      sawReload ||= sim.snapshot()[1].reloading;
    }
    expect(sawReload).toBe(true);
    expect(sim.snapshot()[1].ammo).toBeGreaterThan(0);
    expect(sim.botDecision(1)?.phase).not.toBe('reload');
  });

  it('allows a slower opponent to finish aiming before its firing burst expires', () => {
    const arena = duelArena(4);
    const [player, bot] = new DuelSimulation(sanitizeDuelConfig({}), 4, arena).snapshot();
    const traits = {...createBotTraits(1, 4, 1), recognitionMedianMs: 0, motorSettlingMs: 350,
      endpointErrorDegrees: 0, stopTendency: 1, lowAimTendency: 0};
    const brain = new TacticalBrain(traits, 'holder', 1, () => 0, arena, 1, 'ak47', 1);
    let fired = false;
    for (let tick = 0; tick < 80; tick++) {
      const time = tick * STEP;
      brain.perceive({time, self: bot, visible: {id: 0, position: player.position, aimPoint: player.position}});
      const command = brain.command(bot, time);
      bot.yaw += command.yawDelta ?? 0; bot.pitch += command.pitchDelta ?? 0;
      fired ||= !!command.firePressed;
      if (fired) break;
    }
    expect(fired).toBe(true);
  });

});
