export const utilityKinds = ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'] as const;
export type UtilityKind = typeof utilityKinds[number];
export const utilityNames: Record<UtilityKind, string> = {
  he: 'HE grenade', flash: 'Flashbang', smoke: 'Smoke grenade', molotov: 'Molotov',
  incendiary: 'Incendiary grenade', decoy: 'Decoy grenade',
};
export type UtilityInventory = Record<UtilityKind, number>;
export function canCarryUtility(inventory: Readonly<UtilityInventory>, kind: UtilityKind) {
  return utilityKinds.includes(kind) && Object.values(inventory).reduce((sum, count) => sum + count, 0) < 4 &&
    inventory[kind] < (kind === 'flash' ? 2 : 1) &&
    !(kind === 'molotov' && inventory.incendiary || kind === 'incendiary' && inventory.molotov);
}
export function sanitizeUtilityLoadout(value: unknown): UtilityKind[] {
  if (!Array.isArray(value)) return ['he', 'flash', 'smoke', 'molotov'];
  const result: UtilityKind[] = [];
  for (const kind of value) {
    if (!utilityKinds.includes(kind) || result.length >= 4) continue;
    if (result.filter(item => item === kind).length >= (kind === 'flash' ? 2 : 1)) continue;
    if ((kind === 'molotov' || kind === 'incendiary') && result.some(item => item === 'molotov' || item === 'incendiary')) continue;
    result.push(kind);
  }
  return result;
}
export function utilityInventory(loadout: readonly UtilityKind[]): UtilityInventory {
  const inventory = Object.fromEntries(utilityKinds.map(kind => [kind, 0])) as UtilityInventory;
  for (const kind of loadout) inventory[kind]++;
  return inventory;
}
