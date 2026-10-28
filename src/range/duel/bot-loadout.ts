import type {Equipment} from '../equipment';
import type {DuelWeaponState} from './weapon-state';
import {pistolIds, type Pistol} from '../config';

export type LoadoutDecision = {equipment?: Equipment; cancelReload?: boolean; reason: string};
/** Inventory policy uses sensed contact only; readiness is always enforced by weapon state. */
export function botLoadoutDecision(time: number, current: DuelWeaponState,
  inventory: ReadonlyMap<Equipment, DuelWeaponState>, contact: {visible: boolean; distance: number},
  equipReadyAt: number, nextDecisionAt: number): LoadoutDecision {
  if (time < nextDecisionAt || time < equipReadyAt || current.id === 'knife' || current.id === 'zeus')
    return {reason: 'weapon-commitment'};
  const threatened = contact.visible && contact.distance < 28;
  if (threatened && current.reload.active) {
    const remaining = current.reload.fireReadyAt - time;
    if (current.ammo > 0 && !current.reload.ammoCommitted && remaining > .65)
      return {cancelReload: true, reason: 'cancel-exposed-reload'};
    if (current.ammo > 0 && remaining <= .65) return {reason: 'finish-nearly-ready-reload'};
  }
  if (threatened && (current.ammo === 0 || current.reload.active)) {
    const loaded = [...inventory.values()].filter(state => state.id !== current.id && state.id !== 'knife' &&
      state.id !== 'zeus' && state.ammo > 0 && !state.reload.active);
    const alternative = loaded.sort((a, b) => b.actions.stats.damage - a.actions.stats.damage)[0];
    if (alternative) return {equipment: alternative.id, reason: 'loaded-backup-under-threat'};
  }
  // Return to the primary only after contact is lost, never oscillate each tick.
  if (!contact.visible && !current.reload.active) {
    const primary = [...inventory.values()].find(state => state.id !== current.id && state.id !== 'knife' &&
      state.id !== 'zeus' && !pistolIds.includes(state.id as Pistol) && state.ammo > 0 && !state.reload.active);
    if (primary && pistolIds.includes(current.id as Pistol)) return {equipment: primary.id, reason: 'restore-loaded-primary'};
  }
  return {reason: threatened ? 'fight-current-weapon' : 'safe-reload-or-hold'};
}
