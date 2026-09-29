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
  weapon: AccuracyParameters;
  recovery: WeaponRecovery;
  speedRatio: number;
  walking: boolean;
  airborne: boolean;
  verticalSpeedUnits: number;
  spread: boolean;
};

export function shotDirection(aim: ShotAim, random: () => number = Math.random): Vec {
  let yaw = aim.yaw - aim.recoil.yaw * DEG;
  let pitch = aim.pitch + aim.recoil.pitch * DEG;
  if (aim.spread) {
    const cone = aim.recovery.inaccuracy(aim.speedRatio, aim.walking, aim.airborne, aim.verticalSpeedUnits);
    const a = random() * Math.PI * 2, b = random() * Math.PI * 2;
    const r = random() * cone, q = random() * aim.weapon.spread;
    yaw += Math.cos(a) * r + Math.cos(b) * q;
    pitch += Math.sin(a) * r + Math.sin(b) * q;
  }
  return direction(yaw, pitch);
}
