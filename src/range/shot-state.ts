import type {RecoilAngle} from './recoil';

/** Captured before firing changes accuracy/recoil, never inferred from a miss. */
export type ShotState = {
  speedUnits: number; grounded: boolean; movementInaccuracy: number;
  inaccuracy: number; recoveringInaccuracy: number; spread: number; recoil: RecoilAngle;
};

export function describeShotState(state: ShotState) {
  if (!state.grounded) return {label: 'Shot while airborne', tip: 'Land before taking the accurate shot. Use a jump spot for info, then take a separate shooting peek.'};
  if (state.movementInaccuracy > 0) return {label: `Shot while moving / ${Math.round(state.speedUnits)} u/s`,
    tip: 'Counter-strafe for an accurate rifle opening. Releasing a key or crouching does not instantly stop your momentum.'};
  if (Math.hypot(state.recoil.yaw, state.recoil.pitch) > .2) return {label: 'Settled / recoil still active',
    tip: 'Recoil has not reset. Keep compensating through a spray, or leave a recovery pause before the next burst.'};
  if (state.recoveringInaccuracy > .00001) return {label: 'Settled / accuracy recovering',
    tip: 'You stopped, but accuracy is still recovering from firing, a stance change or a weapon-mode change. Compare slower follow-ups.'};
  return {label: 'Settled / baseline accuracy', tip: 'No running or jump penalty on this shot. A distant headshot is still not guaranteed: base weapon spread applies, so one miss does not prove bad aim.'};
}

// This is the cone's maximum radius, not an invented hit-probability estimate.
export const shotConeDegrees = (state: ShotState) => Math.atan(state.inaccuracy + state.spread) * 180 / Math.PI;
