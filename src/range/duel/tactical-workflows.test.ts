import {describe, expect, it, vi} from 'vitest';
import {STEP} from '../actor-physics';
import {CueAngleChecks, SightingMemory} from './awareness';
import {BotBrain} from './brain';
import {testArena, type Arena} from './geometry';
import * as geometry from './geometry';
import {randomStream} from './rng';
import {createBotTraits} from './skill';
import {TacticalBrain} from './tactics';
import type {TeamAssignment} from './coordination';
import type {DuelActorSnapshot} from './types';

const actor = (): DuelActorSnapshot => ({id: 1, generation: 1, side: 'enemy', position: {x: 5, y: 1.62, z: -6},
  feet: 0, grounded: true, velocity: {x: 0, z: 0}, yaw: Math.PI, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const map = (): Arena => ({...testArena(), solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 4, y: 3, z: 1}}],
  lanes: [{side: 1, role: 'entry', axis: {x: 1, z: 0}, anchor: {x: 5, y: 0, z: -6},
    edge: {x: 5.5, y: 0, z: -4}, retreat: {x: 4, y: 0, z: -8}}]});
const make = (level: 1 | 5 | 10 = 10, seed = 19, arena = map()) => new TacticalBrain(
  {...createBotTraits(level, seed, 1), recognitionMedianMs: 200, lowAimTendency: 0, preaimErrorDegrees: 0},
  'aggressive', 1, randomStream(seed, 'workflow'), arena, level, 'ak47', 1);
const assignment = (): TeamAssignment => ({actorId: 1, generation: 1, role: 'trade', partnerId: 2,
  lane: map().lanes![0], point: {x: 6, y: 1.62, z: 6}, contactAt: 0, peekAt: 1, expiresAt: 2});

describe('brain tactical workflow boundaries', () => {
  it('holds a synchronized stage until release, then exposes without identifying the callout', () => {
    const brain = make(), bot = actor();
    brain.coordinate(assignment());
    for (let tick = 0; tick < 128; tick++) {
      const time = tick * STEP;
      brain.perceive({time, self: bot, visible: null});
      expect(brain.command(bot, time).fireHeld).toBe(false);
      expect(brain.phase).toBe('setup');
    }
    brain.command(bot, 1.01);
    expect(brain.phase).toBe('expose');
    expect(brain.contactReport(1.01)).toBeNull();
  });

  it('keeps a partner barrier closed even after the original deadline', () => {
    const brain = make(), bot = actor();
    brain.coordinate({...assignment(), peekAt: .2, waitForPartner: true});
    brain.command(bot, 0); brain.command(bot, .8);
    expect(brain.phase).toBe('setup');
    brain.coordinate({...assignment(), peekAt: .2, waitForPartner: false});
    brain.command(bot, .81);
    expect(brain.phase).toBe('expose');
  });

  it('ignores advanced assignments for novices and invalid actor/generation/expired assignments', () => {
    const bot = actor();
    for (const invalid of [{...assignment(), actorId: 99}, {...assignment(), generation: 99},
      {...assignment(), expiresAt: -.1}]) {
      const brain = make(), baseline = make();
      brain.coordinate(invalid);
      expect(brain.command(bot, .01)).toEqual(baseline.command(bot, .01));
    }
    const novice = make(1), baseline = make(1);
    novice.coordinate(assignment());
    expect(novice.command(bot, .01)).toEqual(baseline.command(bot, .01));
  });

  it('shadow-only evidence redirects gaze after recognition, never sight/fire permission, and expires', () => {
    const brain = make(), baseline = make(), bot = actor();
    const cue = {id: 'surface', point: {x: -5, y: .01, z: -2}, observedAt: 0, uncertainty: 1};
    brain.perceive({time: 0, self: bot, visible: null, shadowCues: [cue]});
    baseline.perceive({time: 0, self: bot, visible: null});
    cue.point.x = 99;
    expect(brain.command(bot, .05)).toEqual(baseline.command(bot, .05));
    const sensed = brain.command(bot, .3);
    expect(sensed.yawDelta).toBeLessThan(0);
    expect(sensed.fireHeld).toBe(false); expect(brain.contactReport(.3)).toBeNull();
    expect(brain.command(bot, 1).fireHeld).toBe(false);
  });

  it('rejects future shadows and keeps novice commands unchanged by shadow-only evidence', () => {
    for (const level of [1, 10] as const) {
      const brain = make(level), baseline = make(level), bot = actor();
      brain.perceive({time: 0, self: bot, visible: null, shadowCues: [{id: 'future',
        point: {x: -8, y: 0, z: 5}, observedAt: level === 1 ? 0 : 2, uncertainty: 1}]});
      baseline.perceive({time: 0, self: bot, visible: null});
      expect(brain.command(bot, .4)).toEqual(baseline.command(bot, .4));
    }
  });

  it('uses current picked-up firearm cycle and never fires a knife as a rifle', () => {
    const bot = actor(), brain = make(); bot.equipment = 'awp';
    brain.command(bot, 0);
    expect(brain['weapon']).toBe('awp');
    bot.equipment = 'knife';
    const knifeCommand=brain.command(bot, .1);
    expect(knifeCommand).toMatchObject({fireHeld: false, jump: false});
    expect(knifeCommand).not.toHaveProperty('equipSlot');
    const simple = new BotBrain(createBotTraits(10, 1, 1), 'holder', 1, () => .5);
    const simpleKnife=simple.command(bot, .1);
    expect(simpleKnife).toMatchObject({fireHeld: false});
    expect(simpleKnife).not.toHaveProperty('equipSlot');
  });

  it.each(['zeus', 'nova'] as const)('closes on recognized contact with %s instead of wasting distant shots', weapon => {
    const bot = actor(), brain = make(); bot.equipment = weapon;
    const point = {x: 5, y: 1.62, z: 8};
    brain.perceive({time: 0, self: bot, visible: {id: 0, position: point, aimPoint: point}});
    brain.perceive({time: .4, self: bot, visible: {id: 0, position: point, aimPoint: point}});
    const command = brain.command(bot, .4);
    expect(brain.phase).toBe('close'); expect(command.fireHeld).toBe(false);
    expect(Math.hypot(command.forward ?? 0, command.side ?? 0)).toBeGreaterThan(.5);
    brain.perceive({time: .5, self: bot, visible: null});
    expect(brain.command(bot, .5).fireHeld).toBe(false); expect(brain.phase).not.toBe('close');
  });

  it('ignores out-of-order snapshots without overwriting a newer actual sighting', () => {
    const bot = actor(), brain = make();
    const point = {x: 6, y: 1.62, z: 6};
    brain.perceive({time: 1, self: bot, visible: {id: 0, position: point, aimPoint: point}});
    brain.perceive({time: .8, self: bot, visible: null});
    expect(brain['lastSeenAt']).toBe(1);
    expect(brain['observation']?.visible?.aimPoint).toEqual(point);
  });

  it('settles actual aim before the first recognized shot even when contact arrives off-axis', () => {
    const bot = actor(), brain = make(), point = {x: -7, y: bot.position.y, z: -4};
    let firstShotAt = -1;
    for (let tick = 0; tick < 2 / STEP; tick++) {
      const time = tick * STEP;
      brain.perceive({time, self: bot, visible: {id: 0, position: point, aimPoint: point}});
      const command = brain.command(bot, time);
      bot.yaw += command.yawDelta ?? 0; bot.pitch += command.pitchDelta ?? 0;
      if (time < .3) expect(command.firePressed).toBe(false);
      if (command.firePressed) {
        const goal = Math.atan2(-(point.x - bot.position.x), -(point.z - bot.position.z));
        const error = Math.atan2(Math.sin(goal - bot.yaw), Math.cos(goal - bot.yaw));
        expect(Math.abs(error)).toBeLessThan(.04);
        firstShotAt = time; break;
      }
    }
    expect(firstShotAt).toBeGreaterThan(.3);
  });

  it('does not let invalid coordination reports alter later hearing or tactical decisions', () => {
    const brain = make(), baseline = make(), bot = actor();
    brain.coordinate({...assignment(), actorId: 99});
    for (let tick = 0; tick < 128; tick++) {
      const time = tick * STEP;
      brain.perceive({time, self: bot, visible: null}); baseline.perceive({time, self: bot, visible: null});
      expect(brain.command(bot, time)).toEqual(baseline.command(bot, time));
    }
  });
});

describe('evidence-backed preaim and sound angle checks', () => {
  it('only creates anticipation from actual sight memory and expires without hidden extrapolation', () => {
    const memory = new SightingMemory(10, map()), bot = actor(), point = {x: 5, y: 1.62, z: 5};
    expect(memory.anticipation(0)).toBeNull();
    memory.observe({time: 1, self: bot, visible: {id: 0, position: point, aimPoint: point}});
    expect(memory.anticipation(.9)).toBeNull();
    const first = memory.anticipation(1.1)!;
    expect(first.prefireReady).toBe(true); expect(first.observedAt).toBe(1);
    first.point.x = 99;
    expect(memory.anticipation(1.1)?.point.x).toBe(5);
    expect(memory.anticipation(3.1)?.prefireReady).toBe(false);
    expect(memory.anticipation(5)).toBeNull();
  });

  it('checks accessible openings near a sound estimate instead of unrelated or occluded angles', () => {
    const checks = new CueAngleChecks(10), arena = map(), self = {x: 0, y: 1.62, z: -6};
    const blocked = {x: 0, y: 1.62, z: 6}, edge = {x: 5, y: 1.62, z: -1};
    checks.observe({source: 'sound', point: {x: 4, y: 1.62, z: 0}, observedAt: 0, readyAt: .2,
      uncertainty: 3, lifetime: 3});
    const candidates = [blocked, edge, {x: -10, y: 1.62, z: -5}];
    expect(checks.focus(self, .1, candidates, arena)).toBeNull();
    expect(checks.focus(self, .3, candidates, arena)).toEqual(edge);
    expect(checks.focus(self, 3, candidates, arena)).toBeNull();
  });

  it('limits cue raycasts to 5 Hz despite repeated cue refreshes', () => {
    const spy = vi.spyOn(geometry, 'traceSolid');
    try {
      const checks = new CueAngleChecks(10), arena = testArena(), point = {x: 4, y: 1.62, z: 4};
      for (let tick = 0; tick < 128; tick++) {
        const time = tick * STEP;
        checks.observe({source: 'shadow', point, observedAt: time, readyAt: 0, uncertainty: 2, lifetime: 1});
        checks.focus({x: 0, y: 1.62, z: 0}, time, [point], arena);
      }
      expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
    } finally {spy.mockRestore();}
  });
});
