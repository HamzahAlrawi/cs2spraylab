import {describe, expect, it} from 'vitest';
import {DEG, STEP, UNIT, advanceActor, type ActorKinematics} from '../actor-physics';
import {gameData} from '../config';
import {AngleAwareness} from './awareness';
import {BotBrain} from './brain';
import type {BotBehavior, SkillLevel} from './config';
import {testArena, type Arena} from './geometry';
import {randomStream} from './rng';
import {createBotTraits, type BotTraits} from './skill';
import {TacticalBrain} from './tactics';
import {idleCommand, type DuelActorSnapshot} from './types';

const actor = (id = 1): DuelActorSnapshot => ({id, generation: 1, side: 'enemy',
  position: {x: 0, y: 64 * UNIT, z: -10}, feet: 0, grounded: true, velocity: {x: 0, z: 0},
  yaw: Math.PI, pitch: 0, crouched: false, duckAmount: 0, health: 100, armor: 100,
  helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const map = (): Arena => ({...testArena(),
  solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 6, y: 3, z: 1}}],
  lanes: ([-1, 1] as const).flatMap(side => (['entry', 'flank', 'camp', 'offAngle'] as const).map(role => {
    const x = side * (role === 'camp' ? 3.8 : role === 'flank' ? 9 : 5);
    const z = role === 'camp' ? -8 : -5;
    return {side, role, anchor: {x, y: 0, z}, edge: {x: x + side * .2, y: 0, z},
      retreat: {x: role === 'camp' ? side * 2 : x, y: 0, z: role === 'camp' ? z : z - 1.5}};
  })),
});
const make = (seed: number, behavior: BotBehavior = 'holder', level: SkillLevel = 5,
  arena = map(), overrides: Partial<BotTraits> = {}) => new TacticalBrain(
  {...createBotTraits(level, seed, 1), ...overrides}, behavior, 1, randomStream(seed, 'behavior-regression'), arena, level, 'ak47', 1);
const turn = (bot: DuelActorSnapshot, command: ReturnType<TacticalBrain['command']>) => {
  bot.yaw += command.yawDelta ?? 0; bot.pitch += command.pitchDelta ?? 0;
};

describe('seeded auditory decisions without visual identification', () => {
  it.each(['holder', 'patient', 'aggressive'] as const)('%s responds to audible steps and shots only after recognition', behavior => {
    for (const kind of ['footstep', 'gunshot'] as const) for (const seed of [17, 42, 63, 431]) {
      const bot = actor(), heard = make(seed, behavior, 5, map(), {recognitionMedianMs: 300});
      const quiet = make(seed, behavior, 5, map(), {recognitionMedianMs: 300});
      heard.perceive({time: 0, self: bot, visible: null}); quiet.perceive({time: 0, self: bot, visible: null});
      heard.hear({x: -9, y: 0, z: 6}, 0, kind, true);
      expect(heard.command(bot, .1)).toEqual(quiet.command(bot, .1));
      expect(heard.contactReport(.7)).toBeNull();
      for (let tick = 90; tick < 200; tick++) {
        const time = tick * STEP;
        heard.perceive({time, self: bot, visible: null});
        expect(heard.command(bot, time).fireHeld).toBe(false);
      }
      if (behavior === 'aggressive') expect(heard.phase).toBe('investigate');
      else {
        expect(heard.decisionSnapshot().side).toBe(-1);
        expect(heard.decisionSnapshot().role).toBe(behavior === 'patient' ? 'flank' : 'camp');
      }
    }
  });

  it('keeps localization uncertain, with larger errors through cover, and copies incoming points', () => {
    const rms = (occluded: boolean, kind: 'footstep' | 'gunshot') => {
      let squared = 0;
      for (let seed = 1; seed <= 128; seed++) {
        const policy = make(seed, 'aggressive', 8), point = {x: 6, y: 0, z: 8};
        policy.hear(point, 0, kind, occluded);
        const belief = {...policy['heard']!};
        const error = Math.hypot(belief.x - point.x, belief.z - point.z);
        expect(error).toBeGreaterThan(.01);
        squared += error * error;
        point.x = -99;
        expect(policy['heard']).toEqual(belief);
      }
      return Math.sqrt(squared / 128);
    };
    expect(rms(true, 'footstep') / rms(false, 'footstep')).toBeCloseTo(1.7, 8);
    expect(rms(true, 'footstep')).toBeGreaterThan(rms(true, 'gunshot') * 1.8);
  });

  it('coalesces footsteps, rejects future cues and stops using expired sound', () => {
    const bot = actor(), policy = make(43, 'aggressive', 5, map(), {recognitionMedianMs: 360});
    policy.perceive({time: 0, self: bot, visible: null});
    for (const time of [0, .2, .4]) policy.hear({x: -8, y: 0, z: 6}, time, 'footstep', false);
    policy.command(bot, .37);
    expect(policy.phase).toBe('approach');
    policy.command(bot, .42);
    expect(policy.phase).toBe('investigate');
    policy.command(bot, 4);
    expect(policy.phase).not.toBe('investigate');
    expect(policy.command(bot, 4).fireHeld).toBe(false);
  });

  it('does not shorten a settled setup wait before an auditory cue is recognized', () => {
    const bot = {...actor(), position: {x: 3.8, y: 64 * UNIT, z: -8}};
    const heard = make(17, 'holder', 5, map(), {recognitionMedianMs: 600});
    const quiet = make(17, 'holder', 5, map(), {recognitionMedianMs: 600});
    heard.hear({x: -8, y: 0, z: 8}, 0, 'footstep', true);
    for (let tick = 0; tick < .6 / STEP; tick++) {
      const time = tick * STEP;
      heard.perceive({time, self: bot, visible: null}); quiet.perceive({time, self: bot, visible: null});
      expect(heard.command(bot, time)).toEqual(quiet.command(bot, time));
      expect(heard.decisionSnapshot()).toEqual(quiet.decisionSnapshot());
    }
  });

  it('uses a newer audible cue instead of continuing to aim at an older sighting', () => {
    const bot = actor(), policy = make(31, 'holder', 10, map(), {recognitionMedianMs: 100, preaimErrorDegrees: 0});
    const old = {x: 8, y: bot.position.y, z: 8};
    policy.perceive({time: 0, self: bot, visible: {id: 0, position: old, aimPoint: old}});
    policy.perceive({time: .5, self: bot, visible: null});
    policy.hear({x: -8, y: 0, z: 8}, .5, 'gunshot', true);
    for (let tick = 0; tick < 64; tick++) {
      const time = .7 + tick * STEP;
      policy.perceive({time, self: bot, visible: null});
      const command = policy.command(bot, time);
      expect(command.fireHeld).toBe(false); turn(bot, command);
    }
    expect(Math.atan2(Math.sin(bot.yaw - Math.PI), Math.cos(bot.yaw - Math.PI))).toBeLessThan(-10 * DEG);
  });
});

describe('roster-aware quiet travel', () => {
  it.each(['holder', 'patient', 'aggressive'] as const)('%s still reacts promptly to sounds during quiet one/two-bot travel', behavior => {
    for (const count of [1, 2]) for (const kind of ['footstep', 'gunshot'] as const) for (const seed of [42, 63]) {
      const bot = {...actor(), position: {x: 4, y: 64 * UNIT, z: -7}};
      const policy = make(seed, behavior, 5, map(), {recognitionMedianMs: 240});
      const peers = Array.from({length: count}, (_, id) => ({...actor(id + 1), position: {x: 10, y: bot.position.y, z: -17}}));
      policy.perceive({time: 0, self: bot, visible: null});
      const opening = policy.command(bot, .05, undefined, peers);
      expect(opening.walk).toBe(true);
      expect(Math.hypot(opening.forward ?? 0, opening.side ?? 0)).toBeGreaterThan(.1);
      policy.hear({x: -10, y: 0, z: 6}, .06, kind, true);
      const ready = .06 + .24 * (kind === 'gunshot' ? .65 : 1) * 1.35;
      policy.command(bot, ready - STEP, undefined, peers);
      if (behavior === 'aggressive') expect(policy.phase).not.toBe('investigate');
      const response = policy.command(bot, ready + STEP, undefined, peers);
      expect(response.fireHeld).toBe(false);
      if (behavior === 'aggressive') expect(policy.phase).toBe('investigate');
      else {
        expect(policy.decisionSnapshot().side).toBe(policy['heard']!.x >= 0 ? 1 : -1);
        expect(policy.decisionSnapshot().role).toBe(behavior === 'patient' ? 'flank' : 'camp');
      }
      expect(Math.hypot(response.forward ?? 0, response.side ?? 0)).toBeGreaterThan(.1);
    }
  });

  const quietFraction = (count: number, behavior: BotBehavior) => {
    let quiet = 0;
    for (let seed = 1; seed <= 256; seed++) {
      const bot = {...actor(), position: {x: 4, y: 64 * UNIT, z: -7}}, policy = make(seed, behavior);
      const peers = Array.from({length: count}, (_, id) => ({...actor(id + 1), position: {x: 10, y: bot.position.y, z: -17}}));
      const command = policy.command(bot, .5, undefined, peers);
      quiet += +!!command.walk;
      expect(command.fireHeld).toBe(false);
    }
    return quiet / 256;
  };
  it.each(['holder', 'patient', 'aggressive'] as const)('%s is quieter in one/two-bot encounters than a full roster', behavior => {
    const one = quietFraction(1, behavior), two = quietFraction(2, behavior), five = quietFraction(5, behavior);
    expect(one).toBeGreaterThanOrEqual(two);
    expect(two).toBeGreaterThan(five + .2);
    expect(one).toBeGreaterThan(five + .3);
    expect(quietFraction(2, behavior)).toBe(two);
  });

  it('counts only live teammates and drops quiet travel when escaping recent damage', () => {
    const bot = actor(), policy = make(6, 'patient'), same = make(6, 'patient');
    const peers = [actor(), ...[2, 3, 4, 5].map(id => ({...actor(id), alive: false}))];
    expect(policy.command(bot, .5, undefined, peers).walk).toBe(same.command(bot, .5, undefined, [actor()]).walk);
    policy.hurt(.6, 25);
    expect(policy.command(bot, .7, undefined, peers).walk).toBe(false);
  });

  it('quiet input stays below the existing running-footstep threshold in shared physics', () => {
    const bot = actor(), policy = make(17, 'patient');
    policy.hear({x: 8, y: 0, z: 6}, 0, 'gunshot', false);
    let motion: ActorKinematics = {...bot, verticalVelocity: 0, eyeHeight: bot.position.y, jumpHeld: false};
    const max = gameData.weapons.ak47.speed * UNIT;
    let walked = 0;
    for (let tick = 0; tick < 128; tick++) {
      const time = .4 + tick * STEP, command = {...idleCommand(), ...policy.command({...bot, ...motion}, time)};
      walked += +command.walk;
      motion.yaw += command.yawDelta;
      motion = advanceActor(motion, command, max, STEP);
      if (tick > 32) expect(Math.hypot(motion.velocity.x, motion.velocity.z)).toBeLessThan(max * .54);
    }
    expect(walked).toBe(128);
  });
});

describe('novice angles and dynamic idle decisions', () => {
  it('novices frequently choose an ordinary but unsuitable opening instead of a patient flank', () => {
    let noviceMistakes = 0;
    for (let seed = 1; seed <= 256; seed++) {
      noviceMistakes += +(make(seed, 'patient', 1).decisionSnapshot().role !== 'flank');
      expect(make(seed, 'patient', 10).decisionSnapshot().role).toBe('flank');
    }
    expect(noviceMistakes / 256).toBeGreaterThan(.3);
    expect(noviceMistakes / 256).toBeLessThan(.6);
    expect(createBotTraits(1, 19, 1).preaimErrorDegrees).toBeGreaterThan(createBotTraits(10, 19, 1).preaimErrorDegrees * 4);
  });

  it('novices are more likely to waste an angle check on occluded geometry', () => {
    const arena = map(), self = actor().position, expected = {x: 0, y: self.y, z: -18};
    const angles = [{x: 0, y: self.y, z: 8}, {x: 8, y: self.y, z: -8}];
    const blocked = (level: SkillLevel) => {
      let count = 0;
      for (let seed = 1; seed <= 256; seed++) {
        const awareness = new AngleAwareness(level, randomStream(seed, 'angle-regression'));
        count += +(awareness.look(self, 0, expected, angles, arena) === angles[0]);
      }
      return count;
    };
    expect(blocked(1)).toBeGreaterThan(80);
    expect(blocked(10)).toBe(0);
  });

  it('keeps a useful covered firing hold steady across bursts, then moves when hurt', () => {
    for (const seed of [1, 17, 42, 208]) {
      const bot = {...actor(), position: {x: 3.8, y: 64 * UNIT, z: -8}};
      const policy = make(seed, 'holder', 10, map(), {recognitionMedianMs: 80, motorSettlingMs: 40,
        endpointErrorDegrees: 0, preaimErrorDegrees: 0, lowAimTendency: 0, stopTendency: 1});
      const point = {x: 3.8, y: bot.position.y, z: 8};
      let shots = 0;
      for (let tick = 0; tick < 4 / STEP; tick++) {
        const time = tick * STEP;
        policy.perceive({time, self: bot, visible: {id: 0, position: point, aimPoint: point}});
        const command = policy.command(bot, time);
        if (time > .3) {
          expect(Math.hypot(command.forward ?? 0, command.side ?? 0)).toBe(0);
          expect(policy.phase).toBe('attack');
        }
        shots += +!!command.firePressed; turn(bot, command);
      }
      expect(shots).toBeGreaterThan(12);
      policy.hurt(4, 25);
      const escape = policy.command(bot, 4.1);
      expect(Math.hypot(escape.forward ?? 0, escape.side ?? 0)).toBeGreaterThan(.5);
      expect(policy.phase).toBe('return');
    }
  });

  it('abandons a stale camp instead of remaining an idle target or adding random strafes', () => {
    for (let seed = 1; seed <= 64; seed++) {
      const policy = make(seed, 'holder', 10), bot = {...actor(), position: {x: 3.8, y: 64 * UNIT, z: -8}};
      let firstMove = Infinity;
      for (let tick = 0; tick < 3.5 / STEP; tick++) {
        const time = tick * STEP;
        policy.perceive({time, self: bot, visible: null});
        const command = policy.command(bot, time);
        if (Math.hypot(command.forward ?? 0, command.side ?? 0) > .1) {firstMove = time; break;}
        expect(policy.phase).not.toBe('microstrafe');
      }
      expect(firstMove, `seed ${seed}`).toBeLessThan(3);
      expect(['approach', 'expose', 'push']).toContain(policy.phase);
    }
  });
});

describe('seeded executed acquisition speed', () => {
  it('makes levels 5-8 slower than 10 while retaining a faster 10+', () => {
    const median = (level: SkillLevel) => {
      const times = Array.from({length: 64}, (_, seed) => {
        const bot = actor(), policy = new BotBrain(createBotTraits(level, seed + 1, 1), 'holder', 1,
          randomStream(seed + 1, 'acquisition-regression'));
        const point = {x: 0, y: bot.position.y, z: 8};
        for (let tick = 0; tick < 2 / STEP; tick++) {
          const time = tick * STEP;
          if (tick % 4 === 0) policy.perceive({time, self: bot, visible: {id: 0, position: point, aimPoint: point}});
          const command = policy.command(bot, time); turn(bot, command);
          if (command.firePressed) return time;
        }
        throw new Error(`level ${level}, seed ${seed} never acquired`);
      }).sort((a, b) => a - b);
      return times[32];
    };
    const elite = median(10);
    for (const level of [5, 6, 7, 8] as const) expect(median(level)).toBeGreaterThan(elite * 1.1);
    expect(median('10+')).toBeLessThan(elite);
  });
});
