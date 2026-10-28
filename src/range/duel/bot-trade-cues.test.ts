import {describe, expect, it} from 'vitest';
import {BotBrain} from './brain';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';
import {testArena, type Arena} from './geometry';
import type {DuelActorSnapshot} from './types';
import type {TradeOrder} from './trading';
import {STEP} from '../actor-physics';

const self = (): DuelActorSnapshot => ({id: 1, generation: 1, side: 'enemy', position: {x: 5, y: 1.62, z: -6},
  feet: 0, grounded: true, velocity: {x: 0, z: 0}, yaw: Math.PI, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const arena: Arena = {...testArena(), lanes: [{side: 1, role: 'entry', axis: {x: 1, z: 0},
  anchor: {x: 5, y: 0, z: -6}, edge: {x: 5.5, y: 0, z: -4}, retreat: {x: 4, y: 0, z: -8}}]};
const traits = {...createBotTraits(10, 19, 1), recognitionMedianMs: 200, lowAimTendency: 0, preaimErrorDegrees: 0};
const make = (tactical: boolean) => tactical ? new TacticalBrain(traits, 'holder', 1, () => .5, arena, 10, 'ak47', 1)
  : new BotBrain(traits, 'holder', 1, () => .5);
const target = (x: number) => ({id: 0, position: {x, y: 1.62, z: 5}, aimPoint: {x, y: 1.62, z: 5}});
const order: TradeOrder = {victimId: 2, generation: 1, point: {x: -5, y: 1.62, z: 5},
  observedAt: .2, readyAt: .3, expiresAt: 3, source: 'sight'};

describe('death-trade knowledge boundaries', () => {
  it.each([false, true])('new trade evidence supersedes older hidden sighting, tactical=%s', tactical => {
    const brain = make(tactical), bot = self();
    brain.perceive({time: 0, self: bot, visible: target(5)});
    brain.perceive({time: .1, self: bot, visible: null});
    brain.orderTrade(order);
    const command = brain.command(bot, .4);
    expect(command.yawDelta).toBeLessThan(0); expect(command.fireHeld).toBe(false);
    brain.perceive({time: .5, self: bot, visible: target(15)});
    brain.command(bot, .5);
    expect(brain.command(bot, .5 + STEP).yawDelta).toBeGreaterThan(0);
  });
  it('knife responders approach an active report without permission to attack an unseen opponent', () => {
    const brain = make(true), baseline = make(true), bot = {...self(), equipment: 'knife' as const};
    brain.orderTrade(order);
    expect(brain.command(bot, .2)).toEqual(baseline.command(bot, .2));
    brain.command(bot, .4);
    const command = brain.command(bot, .4 + STEP);
    expect(command.yawDelta).toBeLessThan(0);
    expect(Math.hypot(command.forward ?? 0, command.side ?? 0)).toBeGreaterThan(.5);
    expect(command.fireHeld || command.secondaryHeld).toBe(false);
  });
  it('reports newer auditory evidence without bypassing its recognition deadline', () => {
    const brain = make(true) as TacticalBrain, bot = self();
    brain.perceive({time: 0, self: bot, visible: target(5)});
    brain.hear({x: -5, y: 1.62, z: 5}, .3, 'gunshot', false);
    const report = brain.threatReport(.3)!;
    expect(report.source).toBe('sound'); expect(report.observedAt).toBe(.3);
    expect(report.readyAt).toBeGreaterThan(.3);
  });
});
