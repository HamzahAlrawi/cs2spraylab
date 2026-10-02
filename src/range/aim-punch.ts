import {clamp, STEP} from './actor-physics';
import type {Hitgroup} from './duel/types';
import type {RecoilAngle} from './recoil';

export type PunchAngle = {pitch: number; yaw: number; roll: number};
export type PunchHit = {group: Hitgroup; rawDamage: number; armor: number; helmet: boolean};
const f = Math.fround;
const FLINCH_SCALE = 3;
const NO_RECOIL = {pitch: 0, yaw: 0};

// Build 2000922's hitgroup arithmetic, verified by offline native fixtures.
// Damage is distance/hitgroup-scaled BEFORE armor absorption, not lost HP.
export function damagePunch(hit: PunchHit, random: () => number): PunchAngle {
  const damage = Math.max(0, hit.rawDamage), scaled = f(f(damage) * FLINCH_SCALE);
  if (hit.group === 'head') {
    if (hit.helmet) return {pitch: 0, yaw: 0, roll: 0};
    return {pitch: Math.min(12 * FLINCH_SCALE, f(scaled * f(.2))), yaw: 0,
      roll: clamp(f(f(random() * 2 - 1) * scaled), -9 * FLINCH_SCALE, 9 * FLINCH_SCALE)};
  }
  if (hit.group !== 'chest' && hit.group !== 'stomach') return {pitch: 0, yaw: 0, roll: 0};
  return {pitch: Math.min(4 * FLINCH_SCALE, f(scaled * f(hit.armor > 0 ? .005 : .033))), yaw: 0, roll: 0};
}

export function recoverDamagePunch(angle: PunchAngle, dt: number): PunchAngle {
  const decay = f(Math.exp(-8 * dt));
  const pitch = f(angle.pitch * decay), yaw = f(angle.yaw * decay), roll = f(angle.roll * decay);
  const length = f(Math.sqrt(f(f(f(pitch * pitch) + f(yaw * yaw)) + f(roll * roll))));
  const linear = f(18 * dt), scale = length > linear ? f(1 - f(linear / length)) : 0;
  return {pitch: f(pitch * scale), yaw: f(yaw * scale), roll: f(roll * scale)};
}

// Damage punch belongs to the actor, not the weapon. Its native angle gets the
// same 2x physical aim scale as recoil, but full camera motion (not the recoil
// camera's presentation fraction). No weapon RNG, recoil index or bloom changes.
export class DamagePunch {
  angle: PunchAngle = {pitch: 0, yaw: 0, roll: 0};
  constructor(private readonly random: () => number = Math.random) {}
  hit(hit: PunchHit) {
    const impulse = damagePunch(hit, this.random);
    this.angle = {pitch: f(this.angle.pitch + impulse.pitch), yaw: f(this.angle.yaw + impulse.yaw), roll: f(this.angle.roll + impulse.roll)};
  }
  advance(dt: number, recoil: RecoilAngle = NO_RECOIL) {this.angle = this.relativeRecovery(dt, recoil);}
  get shot(): PunchAngle {return this.shotFor(NO_RECOIL);}
  shotFor(recoil: RecoilAngle): PunchAngle {return this.relativePhysical(this.angle, recoil);}
  predict(remainder: number, recoil: RecoilAngle = NO_RECOIL): PunchAngle {
    const next = this.relativeRecovery(STEP, recoil), alpha = clamp(remainder / STEP, 0, 1);
    return this.relativePhysical({pitch: this.angle.pitch + (next.pitch - this.angle.pitch) * alpha,
      yaw: this.angle.yaw + (next.yaw - this.angle.yaw) * alpha, roll: this.angle.roll + (next.roll - this.angle.roll) * alpha}, recoil);
  }
  private relativeRecovery(dt: number, recoil: RecoilAngle): PunchAngle {
    if (this.angle.pitch === 0 && this.angle.yaw === 0 && this.angle.roll === 0) return this.angle;
    if (recoil.pitch === 0 && recoil.yaw === 0) return recoverDamagePunch(this.angle, dt);
    const base = {pitch: recoil.pitch, yaw: recoil.yaw, roll: 0};
    const combined = recoverDamagePunch({pitch: f(base.pitch + this.angle.pitch), yaw: f(base.yaw + this.angle.yaw), roll: this.angle.roll}, dt);
    const unchanged = recoverDamagePunch(base, dt);
    // Recover the shared cache once. Keeping only its difference from the
    // unhit cache preserves every existing no-damage spray/recoil sample.
    return {pitch: f(combined.pitch - unchanged.pitch), yaw: f(combined.yaw - unchanged.yaw), roll: combined.roll};
  }
  private relativePhysical(angle: PunchAngle, recoil: RecoilAngle): PunchAngle {
    if (angle.pitch === 0 && angle.yaw === 0 && angle.roll === 0) return {pitch: 0, yaw: 0, roll: 0};
    if (recoil.pitch === 0 && recoil.yaw === 0) return this.physical(angle);
    const combined = this.physical({pitch: f(recoil.pitch + angle.pitch), yaw: f(recoil.yaw + angle.yaw), roll: angle.roll});
    const base = this.physical({pitch: recoil.pitch, yaw: recoil.yaw, roll: 0});
    return {pitch: combined.pitch - base.pitch, yaw: combined.yaw - base.yaw, roll: combined.roll - base.roll};
  }
  private physical(angle: PunchAngle): PunchAngle {
    if (Math.hypot(angle.pitch, angle.yaw, angle.roll) < .03125) return {pitch: 0, yaw: 0, roll: 0};
    return {pitch: clamp(angle.pitch, -89, 89) * 2, yaw: clamp(angle.yaw, -89, 89) * 2, roll: clamp(angle.roll, -89, 89) * 2};
  }
}
