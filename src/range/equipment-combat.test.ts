import {describe, expect, it} from 'vitest';
import {gameData, sanitizeSettings, shotgunIds, weaponIds} from './config';
import {equipmentForSlot, equipmentStats} from './equipment';

describe('native combat catalog and save compatibility', () => {
  it.each([
    ['nova', 8, 32, 9, 26, .88, true], ['xm1014', 7, 32, 6, 20, .35, true],
    ['mag7', 5, 15, 8, 30, .85, false], ['sawedoff', 7, 32, 8, 32, .85, true],
  ] as const)('%s retains extracted per-pellet stats and reserve semantics', (id, magazine, reserve, pellets, damage, cycle, shells) => {
    expect(equipmentStats(id)).toMatchObject({magazine, reserve, pellets, damage, cycle, reloadsSingleShells: shells});
    expect(shotgunIds).toContain(id); expect(weaponIds).toContain(id);
  });
  it('keeps retired AUG saved settings/data without exposing it in the selectable catalog', () => {
    expect(weaponIds).not.toContain('aug'); expect(gameData.weapons.aug.damage).toBe(28);
    expect(sanitizeSettings({weapon: 'aug', sensitivity: .5}).weapon).toBe('aug');
    expect(sanitizeSettings({weapon: 'ak47', sidearm: 'deagle', sensitivity: .5})).toMatchObject({weapon: 'ak47', sidearm: 'deagle', sensitivity: .5});
  });
  it('keeps all old slots and exposes Zeus without replacing the knife', () => {
    expect(equipmentForSlot(1, 'ak47', 'deagle')).toBe('ak47');
    expect(equipmentForSlot(2, 'ak47', 'deagle')).toBe('deagle');
    expect(equipmentForSlot(3, 'ak47')).toBe('knife'); expect(equipmentForSlot(4, 'ak47')).toBe('zeus');
    expect(equipmentStats('zeus')).toMatchObject({magazine: 1, reserve: 0, damage: 500, range: 120, armorRatio: 2});
  });
});
