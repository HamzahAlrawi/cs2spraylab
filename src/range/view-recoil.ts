import {DEG} from './actor-physics';
import type {RecoilAngle} from './recoil';

// Build 2000930 recoil camera paths apply .45 to the doubled recoil cache.
// This does not establish external damage-punch or weapon-sway parity.
export const CAMERA_PUNCH_FRACTION = .45;
export function recoilView(yaw: number, pitch: number, recoil: RecoilAngle) {
  return {yaw: yaw - recoil.yaw * DEG * CAMERA_PUNCH_FRACTION,
    pitch: pitch + recoil.pitch * DEG * CAMERA_PUNCH_FRACTION,
    weaponYaw: -recoil.yaw * DEG * .22, weaponPitch: recoil.pitch * DEG * .22};
}
