import data from './equipment-data.json';
import {gameData, weaponNames, type Weapon} from './config';

export type Equipment = Weapon | 'usp' | 'knife';
export type Slot = 1 | 2 | 3;
export const equipmentNames: Record<Equipment,string> = {...weaponNames, usp: 'USP-S', knife: 'Butterfly | Emerald'};
export const equipmentStats = (id: Equipment) => id === 'usp' || id === 'knife' ? data.weapons[id] : gameData.weapons[id];
export const equipmentForSlot = (slot: Slot, primary: Weapon): Equipment => slot === 1 ? primary : slot === 2 ? 'usp' : 'knife';
export const equipmentIds = Object.keys(equipmentNames) as Equipment[];
export const equipmentData = data;
