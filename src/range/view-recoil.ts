import {DEG} from './actor-physics';
import type {RecoilAngle} from './recoil';

// Source-style view tracking is presentation only. ShotAim continues to use the
// full physical recoil once. The 0.45 view fraction is a tuning prior, not a
// measured reconstruction of the current CS2 camera animation system.
export function recoilView(yaw: number, pitch: number, recoil: RecoilAngle) {
  return {yaw: yaw - recoil.yaw * DEG * .45, pitch: pitch + recoil.pitch * DEG * .45,
    weaponYaw: -recoil.yaw * DEG * .22, weaponPitch: recoil.pitch * DEG * .22};
}
