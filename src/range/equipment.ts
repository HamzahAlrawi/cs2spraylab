import data from './equipment-data.json';
import {gameData, weaponNames, type Weapon, type Pistol} from './config';

export type Equipment = Weapon | 'usp' | 'knife';
export type Slot = 1 | 2 | 3 | 4;
export const equipmentNames: Record<Equipment,string> = {...weaponNames, knife: 'Default knife'};
export const equipmentStats = (id: Equipment) => id === 'knife' ? data.weapons[id] : gameData.weapons[id];
export const equipmentForSlot = (slot: Slot, primary: Weapon, sidearm: Pistol = 'usp'): Equipment => slot === 1 ? primary : slot === 2 ? sidearm : slot === 4 ? 'zeus' : 'knife';
export const zoomLevels = (id: Equipment) => id === 'knife' ? 0 : gameData.weapons[id].zoomLevels;
export function weaponModeStats(id: Equipment, alternate = false) {
  const base = equipmentStats(id);
  return alternate && id !== 'knife' ? {...base, ...gameData.weapons[id].alternate} : base;
}
export const equipmentIds = Object.keys(equipmentNames) as Equipment[];
export const equipmentData = data;

// These engine-side transitions are estimates, not extracted vdata fields.
export const SILENT_RELOAD_MULTIPLIER = 2;
export const SHELL_RELOAD_START = .5;
export const SHELL_RELOAD_FINISH = .2;
// Installed research/convars.txt and Valve's 2024-02-06 release notes agree.
export const ZEUS_RECHARGE_SECONDS = 30;
export const isShotgun = (id: Equipment) => ['nova', 'xm1014', 'mag7', 'sawedoff'].includes(id);
export const isPumpShotgun = (id: Equipment) => ['nova', 'mag7', 'sawedoff'].includes(id);
export const knifeModel = {
  primaryRangeUnits: 48, secondaryRangeUnits: 32,
  primaryMissCycle: .5, primaryHitCycle: .4,
  secondaryMissCycle: 1, secondaryHitCycle: 1.1,
  firstSlashGrace: .4,
  firstSlashDamage: 40, slashDamage: 25, backSlashDamage: 90,
  stabDamage: 65, backStabDamage: 180,
} as const;
