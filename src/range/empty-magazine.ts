import type {Equipment} from './equipment';

export type EmptyMagazineState = {
  equipment: Equipment;
  ammo: number;
  reserve: number;
  active: boolean;
  reloading: boolean;
  attackHeld: boolean;
  secondaryHeld?: boolean;
  burstPending?: boolean;
  readyAt: number;
};

/** Idle policy only; native reload state still owns ammo commitment and reserves. */
export function shouldAutoReloadEmptyMagazine(time: number, state: EmptyMagazineState): boolean {
  return state.active && state.equipment !== 'knife' && state.equipment !== 'zeus' &&
    state.ammo === 0 && Number.isFinite(state.reserve) && state.reserve > 0 &&
    !state.reloading && !state.attackHeld && !state.secondaryHeld && !state.burstPending &&
    Number.isFinite(time) && Number.isFinite(state.readyAt) && time + 1e-9 >= state.readyAt;
}
