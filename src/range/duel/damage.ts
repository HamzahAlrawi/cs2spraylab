import {UNIT, type Vec} from '../actor-physics';
import {equipmentStats, knifeModel, type Equipment} from '../equipment';
import type {Hitgroup} from './types';

export type DamageResult = {healthDamage: number; armorDamage: number};
export type DamageContext = {attack?: 'primary' | 'secondary'; firstSlash?: boolean; backstab?: boolean};

export function armorDamage(raw: number, armor: number, ratio: number): DamageResult {
  const healthDamage = raw * Math.max(0, Math.min(1, ratio / 2));
  const absorbed = (raw - healthDamage) / 2;
  if (absorbed <= armor) return {healthDamage, armorDamage: absorbed};
  return {healthDamage: raw - armor * 2, armorDamage: armor};
}

// Horizontal cone is a Source-family estimate, not a measured CS2 hit fixture.
export function isKnifeBackstab(attacker: Vec, victim: Vec, victimYaw: number): boolean {
  const x = victim.x - attacker.x, z = victim.z - attacker.z, length = Math.hypot(x, z);
  return length > 1e-9 && (-Math.sin(victimYaw) * x - Math.cos(victimYaw) * z) / length > .475;
}

// Isolated Source-family approximation pending build-specific damage fixtures.
export function resolveDamage(weapon: Equipment, group: Hitgroup, distanceMeters: number, armor: number, helmet: boolean, context: DamageContext = {}): DamageResult {
  const zero = {healthDamage: 0, armorDamage: 0};
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return zero;
  armor = Number.isFinite(armor) ? Math.max(0, armor) : 0;
  const stats = equipmentStats(weapon);
  if (weapon === 'knife') {
    const secondary = context.attack === 'secondary';
    if (distanceMeters > (secondary ? knifeModel.secondaryRangeUnits : knifeModel.primaryRangeUnits) * UNIT) return zero;
    const raw = secondary ? (context.backstab ? knifeModel.backStabDamage : knifeModel.stabDamage)
      : context.backstab ? knifeModel.backSlashDamage : context.firstSlash === false ? knifeModel.slashDamage : knifeModel.firstSlashDamage;
    return armor > 0 ? armorDamage(raw, armor, stats.armorRatio) : {healthDamage: raw, armorDamage: 0};
  }
  // Zeus has no hitgroup bonus or armor consumption. Its engine-specific
  // distance curve is not exposed by vdata; retain documented generic falloff.
  if (weapon === 'zeus') return distanceMeters > stats.range * UNIT ? zero
    : {healthDamage: stats.damage * Math.pow(stats.rangeModifier, distanceMeters / (500 * UNIT)), armorDamage: 0};
  const multiplier = group === 'head' ? stats.headshotMultiplier : group === 'stomach' ? 1.25 : group === 'leg' ? .75 : 1;
  const raw = stats.damage * multiplier * Math.pow(stats.rangeModifier, distanceMeters / (500 * UNIT));
  const protectedGroup = group !== 'leg' && (group !== 'head' || helmet);
  if (!protectedGroup || armor <= 0) return {healthDamage: raw, armorDamage: 0};
  return armorDamage(raw, armor, stats.armorRatio);
}

// Use this or update provisional victim armor per pellet in the parent
// simulation. Resolving every pellet against the starting armor is incorrect.
export function resolvePelletDamage(weapon: Equipment, hits: {group: Hitgroup; distanceMeters: number}[], armor: number, helmet: boolean): DamageResult {
  let healthDamage = 0, armorDamage = 0;
  for (const hit of hits) {
    const damage = resolveDamage(weapon, hit.group, hit.distanceMeters, Math.max(0, armor - armorDamage), helmet);
    healthDamage += damage.healthDamage; armorDamage += damage.armorDamage;
  }
  return {healthDamage, armorDamage};
}
