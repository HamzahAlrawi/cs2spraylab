import {weaponIds, type Weapon} from '../config';
import {randomStream} from './rng';

export type SkillLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | '10+';
export type BotBehavior = 'mixed' | 'holder' | 'patient' | 'aggressive';
export type BotOverride = Partial<{
  skill: SkillLevel;
  weapon: Weapon;
  health: number;
  armor: boolean;
  accuracy: number;
  behavior: BotBehavior;
}>;
export type DuelConfig = {
  botCount: number;
  skill: SkillLevel;
  weapons: Weapon[];
  health: number;
  playerHealth: number;
  armor: boolean;
  accuracy: number;
  behavior: BotBehavior;
  roundSeconds: number;
  feedbackSeconds: number;
  arenaScale: number;
  shortcutProtection: boolean;
  overrides: BotOverride[];
};

export const duelDefaults: DuelConfig = {
  botCount: 1, skill: 5, weapons: ['ak47'], health: 100, playerHealth: 100, armor: true,
  accuracy: 1, behavior: 'mixed', roundSeconds: 60, feedbackSeconds: 2,
  shortcutProtection: true, overrides: [],
  arenaScale: 1,
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const finite = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;
const integer = (value: unknown, fallback: number, min: number, max: number) => Math.round(finite(value, fallback, min, max));
const skill = (value: unknown): SkillLevel => value === '10+' ? '10+' : typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
  ? value as SkillLevel : duelDefaults.skill;
const weapon = (value: unknown): value is Weapon => typeof value === 'string' && weaponIds.some(id => id === value);
const behaviors: BotBehavior[] = ['mixed', 'holder', 'patient', 'aggressive'];
const behavior = (value: unknown): BotBehavior => behaviors.find(item => item === value) ?? duelDefaults.behavior;

export function sanitizeDuelConfig(raw: unknown): DuelConfig {
  const input = record(raw);
  const count = integer(input.botCount, duelDefaults.botCount, 1, 5);
  const weapons = Array.isArray(input.weapons) ? [...new Set(input.weapons.filter(weapon))] : [];
  const overrides = Array.isArray(input.overrides) ? input.overrides.slice(0, count).map(rawOverride => {
    const value = record(rawOverride), result: BotOverride = {};
    if (value.skill !== undefined) result.skill = skill(value.skill);
    if (weapon(value.weapon)) result.weapon = value.weapon;
    if (value.health !== undefined) result.health = integer(value.health, duelDefaults.health, 1, 500);
    if (typeof value.armor === 'boolean') result.armor = value.armor;
    if (value.accuracy !== undefined) result.accuracy = finite(value.accuracy, duelDefaults.accuracy, .5, 1.5);
    if (value.behavior !== undefined) result.behavior = behavior(value.behavior);
    return result;
  }) : [];
  return {
    botCount: count, skill: skill(input.skill), weapons: weapons.length ? weapons : [...duelDefaults.weapons],
    health: integer(input.health, duelDefaults.health, 1, 500), armor: input.armor !== false,
    playerHealth: integer(input.playerHealth, duelDefaults.playerHealth, 1, 500),
    accuracy: finite(input.accuracy, duelDefaults.accuracy, .5, 1.5), behavior: behavior(input.behavior),
    roundSeconds: integer(input.roundSeconds, duelDefaults.roundSeconds, 15, 180),
    feedbackSeconds: finite(input.feedbackSeconds, duelDefaults.feedbackSeconds, 1, 3),
    arenaScale: finite(input.arenaScale, 1, 1, 1.5),
    shortcutProtection: input.shortcutProtection !== false, overrides,
  };
}

export function botConfig(config: DuelConfig, index: number) {
  const override = config.overrides[index] ?? {};
  return {
    skill: override.skill ?? config.skill,
    weapon: override.weapon ?? config.weapons[index % config.weapons.length],
    health: override.health ?? config.health,
    armor: override.armor ?? config.armor,
    accuracy: override.accuracy ?? config.accuracy,
    behavior: override.behavior ?? config.behavior,
  };
}

export function rosterBehaviors(config: DuelConfig, seed: number): Exclude<BotBehavior, 'mixed'>[] {
  const random = randomStream(seed, 'roster:behavior');
  const sample = (): Exclude<BotBehavior, 'mixed'> => {
    const roll = random();
    return roll < .35 ? 'holder' : roll < .75 ? 'patient' : 'aggressive';
  };
  const base: Exclude<BotBehavior, 'mixed'>[] = config.botCount >= 3
    ? ['holder', 'patient', 'aggressive', ...Array.from({length: config.botCount - 3}, sample)]
    : Array.from({length: config.botCount}, sample);
  for (let index = base.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [base[index], base[swap]] = [base[swap], base[index]];
  }
  return base.map((choice, index) => {
    const requested = botConfig(config, index).behavior;
    return requested === 'mixed' ? choice : requested;
  });
}
