import {describe, expect, it, vi} from 'vitest';
import {DEG, STEP} from '../actor-physics';
import {SightingMemory} from './awareness';
import {BotBrain} from './brain';
import {testArena, type Arena} from './geometry';
import {currentVisible, observeBot, type BotObservation, type VisibleEnemy} from './perception';
import {createBotTraits} from './skill';
import {TacticalBrain} from './tactics';
import type {DuelActorSnapshot} from './types';

const actor = (side: 'player' | 'enemy' = 'enemy'): DuelActorSnapshot => ({
  id: side === 'player' ? 0 : 1, generation: 0, side,
  position: {x: 0, y: 1.62, z: side === 'player' ? 2 : -8}, feet: 0,
  velocity: {x: 0, z: 0}, yaw: side === 'player' ? 0 : Math.PI, pitch: 0,
  crouched: false, duckAmount: 0, health: 100, armor: 100, helmet: true,
  alive: true, equipment: 'ak47', ammo: 30, reloading: false,
});
const target = (x = 4.4, z = 1.4): VisibleEnemy => ({id: 0,
  position: {x, y: 1.62, z}, aimPoint: {x, y: 1.62, z}, bodyPoint: {x, y: 1.3, z}});
const arena = (): Arena => ({...testArena(),
  solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 6, y: 3, z: 1.2}}],
  lanes: [{side: -1, role: 'entry', anchor: {x: -7, y: 0, z: -8},
    edge: {x: -7, y: 0, z: -5}, retreat: {x: -7, y: 0, z: -10}}],
});
const traits = {...createBotTraits(10, 1, 1), recognitionMedianMs: 600,
  endpointErrorDegrees: 0, preaimErrorDegrees: 0, lowAimTendency: 0};
const observation = (time: number, visible: VisibleEnemy | null, self = actor()): BotObservation => ({time, visible, self});
const yawTo = (self: DuelActorSnapshot, point: VisibleEnemy['aimPoint']) =>
  Math.atan2(-(point.x - self.position.x), -(point.z - self.position.z));
const angle = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const brain = (map = arena()) => new TacticalBrain(traits, 'aggressive', 1, () => .5, map, 10, 'ak47', 1);

describe('recent sighting and geometry-limited re-peek expectations', () => {
  it('holds a brief sighting even before the firing recognition delay completes', () => {
    for (const make of [() => brain(), () => new BotBrain(traits, 'holder', 1, () => .5)]) {
      const policy = make(), bot = actor(), sight = target();
      policy.perceive(observation(0, sight, bot));
      policy.perceive(observation(.03, null, bot));
      for (let tick = 4; tick <= 96; tick++) {
        const time = tick * STEP;
        if (tick % 4 === 0) policy.perceive(observation(time, null, bot));
        const command = policy.command(bot, time);
        bot.yaw += command.yawDelta ?? 0; bot.pitch += command.pitchDelta ?? 0;
        expect(command.fireHeld).toBe(false);
      }
      // Both likely nearby exits are on the sighting's right side, not the
      // approach waypoint seven metres to the left.
      expect(angle(bot.yaw, Math.PI)).toBeGreaterThan(10 * DEG);
      expect(Math.abs(angle(bot.yaw, yawTo(bot, sight.aimPoint)))).toBeLessThan(9 * DEG);
    }
  });

  it('looks at a newly visible player instead of the old memory, route or scan during recognition', () => {
    const bot = actor(), policy = brain(), old = target(-4.4);
    policy.perceive(observation(0, old, bot));
    policy.perceive(observation(.5, null, bot));
    const live = target(5);
    policy.perceive(observation(.6, live, bot));
    const command = policy.command(bot, .6);
    expect(command.yawDelta).toBeGreaterThan(0);
    expect(command.fireHeld).toBe(false);
    expect(policy.contactReport(.6)).toBeNull();
  });

  it('limits short-loss expectations to the nearby edge and later considers both sides', () => {
    const memory = new SightingMemory(10, arena());
    memory.observe(observation(0, target()));
    memory.observe(observation(.08, null));
    expect(memory.focus(.08)).toEqual(target().aimPoint);
    memory.observe(observation(.5, null));
    expect(memory.expectations(.5).length).toBeGreaterThan(0);
    expect(memory.expectations(.5).every(exit => exit.point.x > 0)).toBe(true);
    const nearby = memory.focus(.5)!;
    expect(nearby.x).toBeGreaterThan(3);
    memory.observe(observation(2.1, null));
    const older = memory.expectations(2.1);
    expect(older.some(exit => exit.point.x < -3)).toBe(true);
    expect(older.some(exit => exit.point.x > 3)).toBe(true);
    expect(older.find(exit => exit.point.x < 0)!.travel).toBeGreaterThan(9);
    expect(memory.focus(2.1)!.x).toBeLessThan(0);
    memory.observe(observation(3.7, null));
    expect(memory.focus(3.7)).toBeNull();
    expect(memory.expectations(3.7)).toEqual([]);
  });

  it('uses the same geometry-relative expectations for a rotated wall', () => {
    const rotate = ({x, y, z}: VisibleEnemy['position']) => ({x: -z, y, z: x});
    const map = arena();
    map.solids = map.solids.map(solid => ({...solid, center: rotate(solid.center),
      size: {x: solid.size.z, y: solid.size.y, z: solid.size.x}}));
    const memory = new SightingMemory(10, map), bot = actor(), sight = target();
    bot.position = rotate(bot.position);
    memory.observe(observation(0, {...sight, position: rotate(sight.position), aimPoint: rotate(sight.aimPoint)}, bot));
    memory.observe(observation(.5, null, bot));
    expect(memory.expectations(.5).every(exit => exit.point.z > 0)).toBe(true);
    expect(memory.focus(.5)!.z).toBeGreaterThan(3);
    memory.observe(observation(2.1, null, bot));
    expect(memory.expectations(2.1).some(exit => exit.point.z < -3)).toBe(true);
  });

  it('does not invent a route through an adjacent wall to the far exit', () => {
    const map = arena();
    map.solids.push({center: {x: 0, y: 1.5, z: -4}, size: {x: 1, y: 3, z: 32}});
    const memory = new SightingMemory(10, map);
    memory.observe(observation(0, target()));
    memory.observe(observation(2.1, null));
    expect(memory.expectations(2.1).every(exit => exit.point.x > 0)).toBe(true);
  });

  it('retains measured velocity only as an exit prior and resets it on reacquisition', () => {
    const memory = new SightingMemory(10, arena());
    for (let frame = 0; frame <= 8; frame++) memory.observe(observation(frame / 32, target(5.2 - frame * .1)));
    expect(memory.velocity.x).toBeLessThan(-2.5);
    const velocity = {...memory.velocity};
    memory.observe(observation(.5, null));
    expect(memory.velocity).toEqual(velocity);
    expect(memory.focus(.5)!.x).toBeGreaterThan(3);
    memory.observe(observation(1, target(-5)));
    expect(memory.velocity).toEqual({x: 0, z: 0});
  });

  it('uses last observed travel direction to prioritize otherwise equivalent cover exits', () => {
    for (const sign of [-1, 1]) {
      const memory = new SightingMemory(10, arena());
      for (let frame = 0; frame <= 8; frame++)
        memory.observe(observation(frame / 32, target(sign * (frame - 8) * .1, -1.5)));
      memory.observe(observation(.95, null));
      expect(Math.sign(memory.focus(.95)!.x)).toBe(sign);
    }
  });

  it('never learns a hidden pose, velocity, stance or turn from the opponents array', () => {
    const map = arena(), first = brain(map), second = brain(map), bot = actor();
    first.perceive(observation(0, target(), bot)); second.perceive(observation(0, target(), bot));
    for (let tick = 1; tick < 128; tick++) {
      const time = tick / 32;
      const a = {...actor('player'), position: {x: -1, y: 1.62, z: 2}, velocity: {x: -6, z: 0}};
      const b = {...actor('player'), position: {x: 1, y: 1.1, z: 3}, velocity: {x: 6, z: 1}, duckAmount: 1, yaw: 1};
      const seenA = observeBot(time, bot, [a], map), seenB = observeBot(time, bot, [b], map);
      expect(seenA.visible).toBeNull(); expect(seenB.visible).toBeNull();
      first.perceive(seenA); second.perceive(seenB);
      expect(first.command(bot, time)).toEqual(second.command(bot, time));
    }
  });

  it('copies sighting vectors so a caller cannot mutate remembered enemy coordinates', () => {
    const memory = new SightingMemory(10, arena()), sight = target();
    memory.observe(observation(0, sight));
    sight.position.x = -10; sight.aimPoint.x = -10; sight.bodyPoint!.y = 0;
    memory.observe(observation(.1, null));
    expect(memory.focus(.1)).toEqual(target().aimPoint);
    expect(memory.seen!.bodyPoint!.y).toBe(1.3);
  });

  it('only rebuilds cover hypotheses when cached perception first loses visibility', () => {
    const memory = new SightingMemory(10, arena());
    const builds = vi.spyOn(memory as unknown as {coverExits: () => unknown}, 'coverExits');
    memory.observe(observation(0, target()));
    for (let tick = 1; tick <= 128; tick++) {
      if (tick % 4 === 0) memory.observe(observation(tick * STEP, null));
      memory.focus(tick * STEP);
    }
    expect(builds).toHaveBeenCalledTimes(1);
  });

  it('lets routine scanning resume after visual memory expires', () => {
    const bot = actor(), policy = brain();
    const sight = target(); bot.yaw = yawTo(bot, sight.aimPoint);
    policy.perceive(observation(0, sight, bot));
    for (let tick = 1; tick <= 16; tick++) {
      const time = 3.7 + tick * STEP;
      policy.perceive(observation(time, null, bot));
      const command = policy.command(bot, time);
      bot.yaw += command.yawDelta ?? 0;
    }
    expect(angle(bot.yaw, yawTo(bot, sight.aimPoint))).toBeLessThan(-1 * DEG);
  });

  it('never fires on remembered positions, including prefire peeks or stale cached visibility', () => {
    const policy = new TacticalBrain({...traits, recognitionMedianMs: 0, motorSettlingMs: 1},
      'aggressive', 1, () => .5, arena(), 10, 'ak47', 1), bot = actor(), sight = target();
    bot.yaw = yawTo(bot, sight.aimPoint);
    policy.perceive(observation(0, sight, bot));
    policy.phase = 'attack'; policy.activePeek = 'prefire';
    expect(policy.command(bot, .04).fireHeld).toBe(true);
    expect(policy.command(bot, .1).fireHeld).toBe(false);
    policy.perceive(observation(.12, null, bot));
    expect(policy.command(bot, .12).fireHeld).toBe(false);
    expect(currentVisible(observation(0, sight, bot), .04)).toBe(sight);
    expect(currentVisible(observation(0, sight, bot), .1)).toBeNull();
  });
});
