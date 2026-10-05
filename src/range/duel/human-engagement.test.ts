import {describe, expect, it, vi} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {gameData, type Weapon} from '../config';
import {SightingMemory} from './awareness';
import {sanitizeDuelConfig} from './config';
import {testArena, type Arena} from './geometry';
import * as geometry from './geometry';
import {observeBot} from './perception';
import {randomStream} from './rng';
import {createBotTraits, peekDistribution, sampleCombatPlan} from './skill';
import {DuelSimulation} from './simulation';
import {TacticalBrain} from './tactics';

const map = (): Arena => ({...testArena(),
  solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 6, y: 3, z: 1}}],
  lanes: ([-1, 1] as const).flatMap(side => [
    {side, role: 'camp' as const, anchor: {x: side * 3.8, y: 0, z: -8},
      edge: {x: side * 4, y: 0, z: -8}, retreat: {x: side * 2, y: 0, z: -8}},
    {side, role: 'entry' as const, anchor: {x: side * 6, y: 0, z: -5},
      edge: {x: side * 7, y: 0, z: -5}, retreat: {x: side * 5, y: 0, z: -7}},
  ]),
});

function encounter(seed: number, covered = false, weapon: Weapon = 'ak47') {
  const arena = map();
  const sim = new DuelSimulation(sanitizeDuelConfig({skill: 10, behavior: covered ? 'holder' : 'aggressive',
    botWeapon: weapon, roundSeconds: 20}), seed, arena);
  sim.actors[0].health = 10000;
  sim.actors[0].position = {x: covered ? 3.8 : 6, y: 64 * UNIT, z: 8};
  sim.actors[1].position = {x: covered ? 3.8 : 6, y: 64 * UNIT, z: covered ? -8 : -5};
  sim.actors[1].yaw = Math.PI; sim.actors[1].pitch = 0;
  const brain = new TacticalBrain({...createBotTraits(10, seed, 1), recognitionMedianMs: 80,
    motorSettlingMs: 40, endpointErrorDegrees: 0, preaimErrorDegrees: 0, lowAimTendency: 0, stopTendency: 1},
  covered ? 'holder' : 'aggressive', 1, randomStream(seed, 'human-engagement'), arena, 10, weapon, 1);
  sim.command(1, {}); sim.start();
  const step = () => {
    const [player, bot] = sim.snapshot();
    if (sim.tick % 4 === 0) brain.perceive(observeBot(sim.time, bot, [player], arena));
    const command = brain.command(bot, sim.time, sim.actors[1].weapon.recovery.recoil);
    sim.command(1, command); sim.step();
    return {command, time: sim.time, decision: brain.decisionSnapshot(), bot: sim.snapshot()[1],
      shots: sim.drainEvents().filter(event => event.kind === 'fire' && event.actorId === 1).length};
  };
  return {sim, brain, step};
}

describe('weapon-appropriate committed combat plans', () => {
  it('uses short controlled rifle bursts at range, and longer close/SMG commitments', () => {
    const near = sampleCombatPlan(10, 'ak47', 7, 30, false, () => .5);
    const far = sampleCombatPlan(10, 'ak47', 26, 30, false, () => .5);
    const smg = sampleCombatPlan(10, 'mp9', 7, 30, false, () => .5);
    const beginner = sampleCombatPlan(1, 'ak47', 26, 30, true, () => .5);
    expect(far.rounds).toBeLessThan(near.rounds);
    expect(far.recovery).toBeGreaterThan(near.recovery);
    expect(smg.rounds).toBeGreaterThan(near.rounds);
    expect(beginner.rounds).toBeGreaterThan(far.rounds * 3);
    expect(sampleCombatPlan(10, 'ak47', 6, 2, true, () => .5).rounds).toBe(2);
    expect(sampleCombatPlan(10, 'awp', 20, 10, false, () => .5).rounds).toBe(1);
    expect(sampleCombatPlan(10, 'nova', 6, 8, false, () => .5).rounds).toBe(1);
  });

  it('retains meaningful persistent variation without modifying native weapon data or novice repertoire', () => {
    const before = JSON.stringify(gameData.weapons);
    const plans = Array.from({length: 64}, (_, seed) => sampleCombatPlan(10, 'ak47', 15, 30, false,
      randomStream(seed, 'combat-plan')));
    expect(new Set(plans.map(plan => plan.rounds)).size).toBe(4);
    expect(new Set(plans.map(plan => plan.recovery.toFixed(2))).size).toBeGreaterThan(10);
    expect(plans).toEqual(Array.from({length: 64}, (_, seed) => sampleCombatPlan(10, 'ak47', 15, 30, false,
      randomStream(seed, 'combat-plan'))));
    expect(JSON.stringify(gameData.weapons)).toBe(before);
    expect(peekDistribution(1, 'ak47')).toMatchObject({shoulder: 0, ferrari: 0, jump: 0, crouchWide: 0, prefire: 0});
  });

  it('fights through short burst recoveries instead of returning to a distant peek waypoint after each burst', () => {
    for (const seed of [1, 17, 42, 63]) {
      const {brain, step} = encounter(seed);
      let shots = 0, attacking = 0;
      for (let tick = 0; tick < 1.15 / STEP; tick++) {
        const frame = step(); shots += frame.shots;
        attacking += +(frame.decision.phase === 'attack');
        if (frame.time > .25) expect(frame.decision.intent).toBe('contest');
        expect(frame.decision.phase).not.toBe('return');
      }
      expect(shots, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(attacking).toBeGreaterThan(100);
      expect(brain.decisionSnapshot().burstRounds).toBeLessThanOrEqual(7);
    }
  });

  it('changes an open firing line between exchanges, counterstrafes and shoots again', () => {
    for (const seed of [1, 17, 42, 63]) {
      const {step} = encounter(seed);
      let moved = false, braked = false, shotAfterMove = false;
      let shots = 0;
      for (let tick = 0; tick < 5 / STEP; tick++) {
        const frame = step(); shots += frame.shots;
        moved ||= frame.decision.phase === 'microstrafe';
        braked ||= moved && frame.decision.phase === 'brake';
        shotAfterMove ||= braked && frame.shots > 0;
        if (shotAfterMove) break;
      }
      expect(moved, `seed ${seed}`).toBe(true);
      expect(braked).toBe(true); expect(shotAfterMove).toBe(true);
      expect(shots).toBeGreaterThan(7);
    }
  });

  it('keeps a useful covered hold stable initially but does not sit there indefinitely', () => {
    for (const seed of [1, 17, 42]) {
      const {step} = encounter(seed, true);
      let firstMovement = Infinity, shots = 0;
      for (let tick = 0; tick < 8 / STEP; tick++) {
        const frame = step(); shots += frame.shots;
        if (frame.time > .4 && Math.hypot(frame.command.forward ?? 0, frame.command.side ?? 0) > .2)
          firstMovement = Math.min(firstMovement, frame.time);
      }
      expect(firstMovement, `seed ${seed}`).toBeGreaterThan(3);
      expect(firstMovement).toBeLessThan(7);
      expect(shots).toBeGreaterThan(15);
    }
  });

  it('does not abandon an unfired burst while native weapon readiness is still pending', () => {
    const {sim, brain, step} = encounter(42);
    sim.actors[1].weapon.nextShotAt = 1.25;
    let firstShot = Infinity;
    for (let tick = 0; tick < 1.7 / STEP; tick++) {
      const frame = step();
      if (frame.time > .25 && frame.time < 1.25) {
        expect(brain.phase).toBe('attack'); expect(frame.shots).toBe(0);
      }
      if (frame.shots) {firstShot = frame.time; break;}
    }
    expect(firstShot).toBeGreaterThanOrEqual(1.25);
    expect(firstShot).toBeLessThan(1.3);
  });

  it('stops and contests a failed exposed reposition instead of silently crossing open space', () => {
    const {sim, brain, step} = encounter(42);
    while (sim.time < .6) step();
    brain['intent'] = 'change-angle'; brain['forceReposition'] = true;
    brain.phase = 'return'; brain['phaseAt'] = sim.time;
    brain['resetPlannedAt'] = -Infinity;
    let shotAfterReset = false;
    while (sim.time < 1.5) {const frame = step(); shotAfterReset ||= frame.shots > 0;}
    expect(shotAfterReset).toBe(true);
    expect(brain['forceReposition']).toBe(false);
    expect(['attack', 'microstrafe', 'brake']).toContain(brain.phase);
  });

  it('still preserves a deliberate escape after serious damage, rather than overriding it with shoot-on-sight', () => {
    const {sim, brain, step} = encounter(42);
    while (sim.time < .6) step();
    sim.actors[1].health = 20;
    brain.hurt(sim.time, 20);
    expect(brain.decisionSnapshot().intent).toBe('reset');
    const before = {...sim.actors[1].position};
    let shots = 0;
    while (sim.time < .85) shots += step().shots;
    expect(shots).toBe(0);
    expect(Math.hypot(sim.actors[1].position.x - before.x, sim.actors[1].position.z - before.z)).toBeGreaterThan(.2);
  });
});

describe('credible sensory beliefs and bounded tactical work', () => {
  it('smooths repeated audible bearings without shrinking the native first-cue uncertainty', () => {
    const brain = encounter(42).brain;
    const point = {x: -5, y: 0, z: 8};
    const deltas: number[] = [];
    for (let index = 0; index < 12; index++) {
      const before = brain['heard'] && {...brain['heard']};
      brain.hear(point, index * .25, 'footstep', true);
      if (before) deltas.push(Math.hypot(brain['heard']!.x - before.x, brain['heard']!.z - before.z));
    }
    expect(Math.max(...deltas)).toBeLessThan(3);
    expect(brain['heard']).not.toEqual(point);
  });

  it('keeps a recently lost contact expected without resampling an attack every command tick', () => {
    const {sim, brain, step} = encounter(42, true);
    while (sim.time < .6) step();
    const remembered = {...brain['lastSeen']!.position};
    sim.actors[0].position.x = 0;
    const plans = vi.spyOn(brain as unknown as {beginBurst: (time: number) => void}, 'beginBurst');
    try {
      for (let tick = 0; tick < .8 / STEP; tick++) {
        const frame = step();
        expect(frame.shots).toBe(0);
        expect(brain['lastSeen']?.position).toEqual(remembered);
      }
      expect(plans.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {plans.mockRestore();}
  });

  it('lets recognized fresh audio replace an older contact expectation without granting hidden target coordinates', () => {
    const {sim, brain, step} = encounter(17, true);
    while (sim.time < .6) step();
    const seenAt = brain['lastSeenAt'], sight = {...brain['lastSeen']!.position};
    const soundPoint = {x: -7, y: 0, z: 8};
    sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 8};
    brain.hear(soundPoint, sim.time, 'gunshot', true);
    soundPoint.x = 100;
    const oldYaw = sim.actors[1].yaw;
    for (let tick = 0; tick < 1 / STEP; tick++) expect(step().shots).toBe(0);
    const turn = Math.atan2(Math.sin(sim.actors[1].yaw - oldYaw), Math.cos(sim.actors[1].yaw - oldYaw));
    expect(turn).toBeLessThan(-.1);
    expect(brain['lastSeenAt']).toBe(seenAt);
    expect(brain['lastSeen']!.position).toEqual(sight);
    expect(brain['heard']!.x).toBeLessThan(0);
  });

  it('caches useful-hold geometry and hidden-exit visibility below motor tick rate', () => {
    const {brain, sim} = encounter(17, true);
    const [player, self] = sim.snapshot();
    const memory = new SightingMemory(10, sim.arena);
    memory.observe({time: 0, self, visible: {id: 0, position: player.position, aimPoint: player.position}});
    const rays = vi.spyOn(geometry, 'traceSolid');
    try {
      for (let tick = 1; tick <= 128; tick++) {
        const time = tick * STEP;
        brain['usefulHold'](self, player.position, time);
        if (tick % 4 === 0) memory.observe({time, self, visible: null});
      }
      expect(rays.mock.calls.length).toBeLessThan(80);
    } finally {rays.mockRestore();}
  });

  it('does not rebuild a knife route or phase on every motor tick', () => {
    const {brain, sim} = encounter(17);
    const bot = {...sim.snapshot()[1], equipment: 'knife' as const};
    for (let tick = 0; tick < 128; tick++) brain.command(bot, tick * STEP);
    expect(brain['phaseAt']).toBe(0);
    expect(brain['routeAt']).toBe(0);
  });
});
