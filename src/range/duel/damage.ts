import {UNIT} from '../actor-physics';
import {equipmentStats, type Equipment} from '../equipment';
import type {Hitgroup} from './types';

export type DamageResult = {healthDamage: number; armorDamage: number};

// Isolated Source-family approximation pending build-specific damage fixtures.
export function resolveDamage(weapon: Equipment, group: Hitgroup, distanceMeters: number, armor: number, helmet: boolean): DamageResult {
  if (weapon === 'knife') return {healthDamage: armor > 0 ? 34 : 40, armorDamage: armor > 0 ? 3 : 0};
  const stats = equipmentStats(weapon);
  const multiplier = group === 'head' ? stats.headshotMultiplier : group === 'stomach' ? 1.25 : group === 'leg' ? .75 : 1;
  const raw = stats.damage * multiplier * Math.pow(stats.rangeModifier, distanceMeters / (500 * UNIT));
  const protectedGroup = group !== 'leg' && (group !== 'head' || helmet);
  if (!protectedGroup || armor <= 0) return {healthDamage: raw, armorDamage: 0};
  const healthDamage = raw * Math.min(1, stats.armorRatio / 2);
  const armorDamage = (raw - healthDamage) / 2;
  if (armorDamage <= armor) return {healthDamage, armorDamage};
  return {healthDamage: raw - armor * 2, armorDamage: armor};
}
