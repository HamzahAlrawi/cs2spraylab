import {describe, expect, it} from 'vitest';
import {STEP} from '../actor-physics';
import {gameData, weaponIds, type Weapon} from '../config';
import {BotBrain} from './brain';
import {testArena} from './geometry';
import {createBotTraits} from './skill';
import {TacticalBrain} from './tactics';
import {idleCommand, type DuelActorSnapshot} from './types';
import {DuelWeaponState} from './weapon-state';
import {ZEUS_RECHARGE_SECONDS} from '../equipment';

const map = {...testArena(), lanes: [{side: 1 as const, role: 'entry' as const,
  anchor: {x: 0, y: 0, z: -8}, edge: {x: 1, y: 0, z: -8}, retreat: {x: 0, y: 0, z: -8}}]};
const traits = {...createBotTraits(10, 1, 1), recognitionMedianMs: 0, motorSettlingMs: 1,
  endpointErrorDegrees: 0, preaimErrorDegrees: 0, lowAimTendency: 0, stopTendency: 1};
function encounter(weapon: Weapon, tactical: boolean) {
  const bot: DuelActorSnapshot = {id: 1, generation: 0, side: 'enemy', position: {x: 0, y: 1.62, z: -8},
    feet: 0, grounded: true, velocity: {x: 0, z: 0}, yaw: Math.PI, pitch: 0, duckAmount: 0,
    health: 100, armor: 100, helmet: true, alive: true, crouched: false, equipment: weapon,
    ammo: gameData.weapons[weapon].magazine, reloading: false};
  const brain = tactical ? new TacticalBrain(traits, 'holder', 1, () => .5, map, 10, weapon, 1)
    : new BotBrain(traits, 'holder', 1, () => .5);
  const state = new DuelWeaponState(weapon, () => .5);
  const targetZ = weapon === 'zeus' ? -6 : gameData.weapons[weapon].pellets > 1 ? -2 : 8;
  const step = (tick: number) => {
    const time = tick * STEP;
    if (tick % 4 === 0) brain.perceive({time, self: bot, visible: {id: 0,
      position: {x: 0, y: 1.62, z: targetZ}, aimPoint: {x: 0, y: 1.62, z: targetZ}}});
    const command = {...idleCommand(), ...brain.command(bot, time)};
    bot.yaw += command.yawDelta; bot.pitch += command.pitchDelta;
    const fired = state.advance(time, STEP, command, {...bot, verticalVelocity: 0});
    bot.ammo = state.ammo; bot.reloading = !!state.reloadUntil;
    return {command, fired, time};
  };
  return {brain, bot, step};
}

describe('bot firearm commands', () => {
  it.each(weaponIds.filter(id => !gameData.weapons[id].fullAuto && id !== 'zeus'))(
    'issues repeated semi-auto trigger presses at the extracted %s cadence', weapon => {
      for (const tactical of [false, true]) {
        const {step} = encounter(weapon, tactical), times: number[] = [];
        for (let tick = 0; tick < 4 / STEP; tick++) {
          const {fired, time} = step(tick);
          if (fired) times.push(time);
        }
        expect(times.length, `${weapon}, tactical=${tactical}`).toBeGreaterThanOrEqual(2);
        for (let index = 1; index < times.length; index++)
          expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(gameData.weapons[weapon].cycle - 1e-8);
      }
    });

  it('respects Zeus recharge instead of spamming impossible reloads or synthetic shots', () => {
    for (const tactical of [false, true]) {
      const {step} = encounter('zeus', tactical);
      let shots = 0;
      for (let tick = 0; tick < 4 / STEP; tick++) {
        const {command, fired} = step(tick);
        shots += +!!fired;
        expect(command.reloadPressed).toBe(false);
      }
      expect(shots).toBe(1);
      expect(ZEUS_RECHARGE_SECONDS).toBeGreaterThan(4);
    }
  });

  it.each(['awp', 'ssg08'] as const)('resets a %s engagement shortly after a shot instead of holding a long rifle burst', weapon => {
    const {brain, step} = encounter(weapon, true);
    let firstShot = -1, resetAt = -1;
    for (let tick = 0; tick < 1 / STEP; tick++) {
      const {fired, time} = step(tick);
      if (fired && firstShot < 0) firstShot = time;
      if (firstShot >= 0 && (brain as TacticalBrain).phase !== 'attack') {resetAt = time; break;}
    }
    expect(firstShot).toBeGreaterThanOrEqual(0);
    expect(resetAt - firstShot).toBeGreaterThan(.15);
    expect(resetAt - firstShot).toBeLessThan(.4);
  });

  it('does not advance the burst timer on a semi-auto trigger still waiting for cooldown', () => {
    const {brain, step} = encounter('awp', true);
    for (let tick = 0; tick < .8 / STEP; tick++) step(tick);
    expect((brain as TacticalBrain).phase).toBe('attack');
    let nextShot = -1;
    for (let tick = Math.ceil(.8 / STEP); tick < 2 / STEP; tick++) {
      const {fired, time} = step(tick);
      if (fired) {nextShot = time; break;}
      expect((brain as TacticalBrain).phase).toBe('attack');
    }
    expect(nextShot).toBeGreaterThan(1.4);
  });
});
