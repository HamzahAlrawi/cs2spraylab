import {describe, expect, it} from 'vitest';
import {CueAngleChecks, SightingMemory, type AttentionEvidence} from './awareness';
import {testArena} from './geometry';
import type {BotObservation} from './perception';
import type {DuelActorSnapshot} from './types';

const self = (): DuelActorSnapshot => ({id: 1, generation: 0, side: 'enemy', position: {x: 0, y: 1.62, z: -8},
  feet: 0, velocity: {x: 0, z: 0}, yaw: Math.PI, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const arena = () => ({...testArena(), solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 6, y: 3, z: 1.2}}]});
const sight = () => ({id: 0, position: {x: 4.4, y: 1.62, z: 1.4}, aimPoint: {x: 4.4, y: 1.62, z: 1.4}});
const observation = (time: number, bot = self(), visible: BotObservation['visible'] = null): BotObservation => ({time, self: bot, visible});
const setup = (level: 1 | 10 = 10) => {
  const memory = new SightingMemory(level, arena());
  memory.observe(observation(0, self(), sight())); memory.observe(observation(.5)); return memory;
};

describe('evidence-driven cover attention', () => {
  it('holds a likely exit across former scan deadlines while considering newly reachable alternatives', () => {
    const memory = setup(), point = {...memory.focus(.5)!};
    for (let tick = 17; tick <= 90; tick++) {
      memory.observe(observation(tick / 32)); expect(memory.focus(tick / 32)).toEqual(point);
    }
    expect(memory.hypotheses(2.8).some(exit => exit.point.x < 0)).toBe(true);
    expect(memory.decision(2.8).reason).toBe('hold-exit');
  });

  it('switches after sustained empty-angle clearing, not from an unattended or stale negative frame', () => {
    const memory = setup(), bot = self(), point = memory.focus(.5)!;
    bot.yaw = Math.atan2(-(point.x - bot.position.x), -(point.z - bot.position.z));
    let explained = false;
    for (let tick = 17; tick <= 90; tick++) {
      memory.observe(observation(tick / 32, bot));
      explained ||= memory.decision(tick / 32).reason === 'cleared-angle';
    }
    expect(memory.focus(2.8)!.x).toBeLessThan(0); expect(explained).toBe(true);
    expect(memory.hypotheses(2.8).find(exit => exit.point.x > 0)!.cleared).toBeGreaterThan(1);
    const stale = setup(); stale.observe(observation(2.1, bot));
    expect(stale.hypotheses(2.1).every(exit => exit.cleared === 0)).toBe(true);
  });

  it.each(['sound', 'teammate', 'shadow'] as const)('uses a fresh %s report to switch hypotheses without replacing remembered coordinates', source => {
    const memory = setup(); memory.observe(observation(1.9));
    const far = memory.hypotheses(1.9).find(exit => exit.point.x < 0)!.point;
    const cue: AttentionEvidence = {source, point: {...far}, observedAt: 2, readyAt: 2.2, uncertainty: .4, confidence: .9};
    memory.noteEvidence(cue); cue.point.x = 99;
    memory.observe(observation(2.1)); expect(memory.focus(2.1)!.x).toBeGreaterThan(0);
    memory.observe(observation(2.25));
    expect(memory.focus(2.25)!.x).toBeLessThan(0);
    expect(memory.decision(2.25)).toMatchObject({reason: 'new-evidence', source});
    expect(memory.seen!.position).toEqual(sight().position);
  });

  it('does not infer a contact from sound alone, extend sight lifetime, or accept future/stale/invalid cues as live evidence', () => {
    const memory = new SightingMemory(10, arena());
    memory.noteEvidence({source: 'sound', point: sight().position, observedAt: 0, uncertainty: 2});
    memory.observe(observation(.5)); expect(memory.focus(.5)).toBeNull();
    memory.observe(observation(1, self(), sight())); memory.observe(observation(1.5));
    const point = {...memory.focus(1.5)!};
    for (const cue of [
      {observedAt: 9, uncertainty: .5}, {observedAt: 0, uncertainty: .5}, {observedAt: 2, uncertainty: NaN},
    ]) memory.noteEvidence({source: 'sound', point: {x: -3.52, y: 1.62, z: -1.12}, ...cue});
    memory.observe(observation(2)); expect(memory.focus(2)).toEqual(point);
    memory.observe(observation(5)); expect(memory.focus(5)).toBeNull(); expect(memory.decision(5).confidence).toBe(0);
  });

  it('preserves skill variation and exposes own low-ammo/reload context without enemy weapon knowledge', () => {
    const run = (level: 1 | 10) => {
      const memory = setup(level), bot = self(), point = memory.focus(.5)!;
      bot.yaw = Math.atan2(-point.x, -(point.z - bot.position.z)); bot.ammo = 2;
      for (let tick = 17; tick <= 40; tick++) memory.observe(observation(tick / 32, bot));
      expect(memory.decision(1.25).context).toBe('low-ammo');
      bot.reloading = true; memory.observe(observation(1.3, bot)); expect(memory.decision(1.3).context).toBe('reload');
      return memory.hypotheses(1.3).find(exit => exit.point.x > 0)!.cleared;
    };
    expect(run(10)).toBeGreaterThan(run(1));
  });

  it('reacquisition resets negative evidence and diagnostics cannot mutate the memory', () => {
    const memory = setup(), diagnostics = memory.hypotheses(.5), decision = memory.decision(.5);
    diagnostics[0].point.x = 99; decision.point!.x = 99;
    expect(memory.focus(.5)!.x).not.toBe(99);
    memory.observe(observation(.6, self(), sight()));
    expect(memory.hypotheses(.6)).toEqual([]); expect(memory.decision(.6).reason).toBe('sight');
    memory.observe(observation(.55)); expect(memory.decision(.6).reason).toBe('sight');
  });
});

describe('contextual noisy-cue commitments', () => {
  it('does not cycle on cue age, but switches on clearing and reopens with a fresh sound', () => {
    const checks = new CueAngleChecks(10), bot = {x: 0, y: 1.62, z: -8};
    const near = {x: 4, y: 1.62, z: 0}, other = {x: 6, y: 1.62, z: 0};
    const cue = {source: 'sound' as const, point: near, observedAt: 0, readyAt: .2, uncertainty: 3, lifetime: 4};
    checks.observe(cue);
    for (const time of [.2, .8, 1.5]) expect(checks.focus(bot, time, [near, other], testArena())).toEqual(near);
    checks.clearAngle(near, 1.6);
    expect(checks.focus(bot, 1.8, [near, other], testArena())).toEqual(other);
    expect(checks.decision()?.reason).toBe('cleared-angle');
    checks.observe({...cue, observedAt: 2, readyAt: 2});
    expect(checks.focus(bot, 2.2, [near, other], testArena())).toEqual(near);
    expect(checks.focus(bot, 7, [near, other], testArena())).toBeNull();
  });
});
