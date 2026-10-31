import {gameData, sniperIds, type Weapon} from '../config';
import type {SkillLevel} from './config';
import {weaponFamily} from './skill';

export type CombatMovement = {style: 'commit' | 'stutter' | 'run'; maxRounds: number;
  stationarySeconds: number; stepWidth: number};

/** Authored input policy, not native weapon accuracy or measured FACEIT behavior. */
export function combatMovement(level: SkillLevel, weapon: Weapon, range: number,
  crouchSpray: boolean, random: () => number): CombatMovement {
  const skill = level === '10+' ? 1 : (level - 1) / 9, family = weaponFamily(weapon);
  const stats = gameData.weapons[weapon], sniper = sniperIds.includes(weapon);
  const heavyPistol = weapon === 'deagle' || weapon === 'revolver';
  const rifle = family === 'rifle' && !sniper && stats.pellets === 1 && weapon !== 'zeus';
  if (crouchSpray || rifle && skill < .55) return {style: 'commit', maxRounds: Infinity,
    stationarySeconds: Infinity, stepWidth: 1};
  const runChance = sniper || heavyPistol || family === 'lmg' || rifle ? 0
    : family === 'smg' || weapon === 'cz75a' ? range <= 12 ? .9 : range <= 22 ? .5 : .1
      : stats.pellets > 1 || weapon === 'zeus' ? range <= 8 ? .65 : 0
        : range <= 9 ? .45 : range <= 15 ? .15 : 0;
  const run = runChance > 0 && random() < runChance * (.75 + .25 * skill);
  return {style: run ? 'run' : 'stutter', maxRounds: sniper || stats.pellets > 1 || weapon === 'zeus' || heavyPistol ? 1
    : family === 'pistol' ? 2 : family === 'smg' ? run ? 12 : 6 : range > 20 ? 3 : range > 11 ? 5 : 8,
    stationarySeconds: .55 + (1 - skill) * .55, stepWidth: run ? 1.2 + .4 * skill : .65 + .35 * skill};
}
