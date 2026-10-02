import data from './equipment-data.json';
import {gameData, weaponNames, type Weapon, type Pistol} from './config';

export type Equipment = Weapon | 'usp' | 'knife';
export type Slot = 1 | 2 | 3;
export const equipmentNames: Record<Equipment,string> = {...weaponNames, knife: 'Default knife'};
export const equipmentStats = (id: Equipment) => id === 'knife' ? data.weapons[id] : gameData.weapons[id];
export const equipmentForSlot = (slot: Slot, primary: Weapon, sidearm: Pistol = 'usp'): Equipment => slot === 1 ? primary : slot === 2 ? sidearm : 'knife';
export const zoomLevels = (id: Equipment) => id === 'knife' ? 0 : gameData.weapons[id].zoomLevels;
export function weaponModeStats(id: Equipment, alternate = false) {
  const base = equipmentStats(id);
  return alternate && id !== 'knife' ? {...base, ...gameData.weapons[id].alternate} : base;
}
export const equipmentIds = Object.keys(equipmentNames) as Equipment[];
export const equipmentData = data;
