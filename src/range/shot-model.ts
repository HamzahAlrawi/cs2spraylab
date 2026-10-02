import {DEG, type Vec} from './actor-physics';
import type {RecoilAngle} from './recoil';
import type {WeaponRecovery, AccuracyParameters} from './ballistics';

export function direction(yaw: number, pitch: number): Vec {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

export type ShotAim = {
  yaw: number;
  pitch: number;
  recoil: RecoilAngle;
  punch?: RecoilAngle & {roll?: number};
  weapon: AccuracyParameters;
  recovery: WeaponRecovery;
  speedRatio: number;
  walking: boolean;
  airborne: boolean;
  verticalSpeedUnits: number;
  spread: boolean;
};

export function shotDirection(aim: ShotAim, random: () => number = Math.random): Vec {
  const yaw = aim.yaw - (aim.recoil.yaw + (aim.punch?.yaw ?? 0)) * DEG;
  const pitch = aim.pitch + (aim.recoil.pitch + (aim.punch?.pitch ?? 0)) * DEG;
  const forward = direction(yaw, pitch);
  if (aim.spread) {
    const cone = aim.recovery.inaccuracy(aim.speedRatio, aim.walking, aim.airborne, aim.verticalSpeedUnits);
    const a = random() * Math.PI * 2, b = random() * Math.PI * 2;
    const r = random() * cone, q = random() * aim.weapon.spread;
    const horizontal = Math.cos(a) * r + Math.cos(b) * q;
    const vertical = Math.sin(a) * r + Math.sin(b) * q;
    const roll = (aim.punch?.roll ?? 0) * DEG;
    const right = horizontal * Math.cos(roll) - vertical * Math.sin(roll);
    const up = horizontal * Math.sin(roll) + vertical * Math.cos(roll);
    // Spread is a slope in the plane perpendicular to the physical shot ray,
    // not an Euler-angle offset. Euler offsets squash the cone at steep aim.
    const x = forward.x + Math.cos(yaw) * right + Math.sin(yaw) * Math.sin(pitch) * up;
    const y = forward.y + Math.cos(pitch) * up;
    const z = forward.z - Math.sin(yaw) * right + Math.cos(yaw) * Math.sin(pitch) * up;
    const length = Math.hypot(x, y, z);
    return {x: x / length, y: y / length, z: z / length};
  }
  return forward;
}
