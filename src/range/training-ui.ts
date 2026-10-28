import {pistolIds, shotgunIds, sniperIds, weaponNames, type Mode, type Weapon} from './config';

export const drillGroups: readonly {name: string; modes: readonly Mode[]}[] = [
  {name: 'Match practice', modes: ['duel', 'prefire']},
  {name: 'Aim & movement', modes: ['peek', 'precision', 'burst']},
  {name: 'Recoil control', modes: ['guided', 'spray', 'transfer']},
  {name: 'Awareness', modes: ['hearing']},
];

export const drillSkills: Record<Mode, string> = {
  duel: 'Live fights', prefire: 'Angle clearing', peek: 'Taking space', precision: 'Stop-shot timing',
  burst: 'Movement rhythm', guided: 'Recoil fundamentals', spray: 'Spray consistency',
  transfer: 'Multiple targets', hearing: 'Sound localization',
};

export function matchesDrill(mode: Mode, query: string, name: string, benefit: string): boolean {
  const text = `${name} ${benefit} ${drillSkills[mode]} ${drillGroups.find(group => group.modes.includes(mode))?.name}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
}

export const weaponGroups = ['All', 'Rifles', 'SMGs', 'Pistols', 'Snipers', 'Heavy', 'Equipment'] as const;
export type WeaponGroup = typeof weaponGroups[number];
const smgs: readonly Weapon[] = ['mp9', 'mp7', 'mp5sd', 'mac10', 'ump45', 'p90', 'bizon'];
export function weaponGroup(id: Weapon): WeaponGroup {
  if ((pistolIds as readonly string[]).includes(id)) return 'Pistols';
  if (sniperIds.includes(id)) return 'Snipers';
  if (smgs.includes(id)) return 'SMGs';
  if ((shotgunIds as readonly string[]).includes(id) || id === 'm249' || id === 'negev') return 'Heavy';
  if (id === 'zeus') return 'Equipment';
  return 'Rifles';
}
export function matchesWeapon(id: Weapon, group: WeaponGroup, query: string): boolean {
  return (group === 'All' || weaponGroup(id) === group) && `${weaponNames[id]} ${id}`.toLowerCase().includes(query.trim().toLowerCase());
}
