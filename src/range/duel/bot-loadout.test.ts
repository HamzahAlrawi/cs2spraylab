import {describe, expect, it} from 'vitest';
import {DuelWeaponState} from './weapon-state';
import {botLoadoutDecision} from './bot-loadout';
import {sanitizeUtilityLoadout, utilityInventory} from './utility-loadout';

describe('threat-aware inventory decisions', () => {
  const rifle = () => new DuelWeaponState('ak47', () => .5);
  const sidearm = () => new DuelWeaponState('usp', () => .5);
  it('draws a loaded sidearm during an exposed empty reload', () => {
    const gun = rifle(), pistol = sidearm(); gun.ammo = 0; gun.reload.start(0);
    expect(botLoadoutDecision(.1, gun, new Map([['usp', pistol]]), {visible: true, distance: 10}, 0, 0))
      .toMatchObject({equipment: 'usp'});
  });
  it('does not use hidden opponents or switch during deploy', () => {
    const gun = rifle(); gun.ammo = 0; gun.reload.start(0);
    const inventory = new Map([['usp' as const, sidearm()]]);
    expect(botLoadoutDecision(.1, gun, inventory, {visible: false, distance: 1}, 0, 0).equipment).toBeUndefined();
    expect(botLoadoutDecision(.1, gun, inventory, {visible: true, distance: 1}, 1, 0).equipment).toBeUndefined();
  });
  it('cancels an uncommitted tactical reload, preserving its magazine', () => {
    const gun = rifle(); gun.ammo = 8; gun.reload.start(0);
    expect(botLoadoutDecision(.1, gun, new Map(), {visible: true, distance: 10}, 0, 0).cancelReload).toBe(true);
    expect(gun.ammo).toBe(8);
  });
  it('does not cancel committed magazines to bypass their attack floor', () => {
    const gun = rifle(); gun.ammo = 2; gun.reload.start(0);
    gun.reload.advance(gun.reload.ammoCommitAt + .001);
    expect(gun.reload.ammoCommitted).toBe(true);
    expect(botLoadoutDecision(2.5, gun, new Map(), {visible: true, distance: 10}, 0, 0).cancelReload).not.toBe(true);
  });
  it('returns from a sidearm to a loaded sniper too, without treating automatic pistols as rifles', () => {
    const sniper = new DuelWeaponState('awp', () => .5), pistol = new DuelWeaponState('cz75a', () => .5);
    expect(botLoadoutDecision(3, pistol, new Map([['awp', sniper]]), {visible: false, distance: Infinity}, 0, 0))
      .toMatchObject({equipment: 'awp', reason: 'restore-loaded-primary'});
  });
});
describe('legal utility loadouts', () => {
  it('allows every grenade type and two flashes but only four slots', () => {
    expect(sanitizeUtilityLoadout(['flash', 'flash', 'flash', 'smoke', 'he', 'decoy'])).toEqual(['flash', 'flash', 'smoke', 'he']);
    expect(sanitizeUtilityLoadout(['molotov', 'incendiary', 'decoy', 'decoy', 'bad'])).toEqual(['molotov', 'decoy']);
    expect(utilityInventory(['flash', 'flash', 'decoy'])).toMatchObject({flash: 2, decoy: 1, he: 0});
    expect(sanitizeUtilityLoadout([])).toEqual([]);
  });
});
