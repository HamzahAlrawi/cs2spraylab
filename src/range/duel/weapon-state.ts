import {equipmentStats, type Equipment} from '../equipment';
import {UNIT, type Vec} from '../actor-physics';
import {WeaponRecovery} from '../ballistics';
import {direction as aimDirection, shotDirection} from '../shot-model';
import type {ActorCommand} from './types';

export type FiredRound = {origin: Vec; direction: Vec; weapon: Equipment; ordinal: number};

export class DuelWeaponState {
  readonly recovery: WeaponRecovery;
  ammo: number;
  nextShotAt = 0;
  reloadUntil = 0;
  pendingPress = false;
  ordinal = 0;
  private wasHeld = false;

  constructor(public readonly id: Equipment, private readonly random: () => number) {
    this.ammo = equipmentStats(id).magazine;
    this.recovery = new WeaponRecovery(equipmentStats(id));
  }

  advance(time: number, dt: number, command: ActorCommand, actor: {
    position: Vec; yaw: number; pitch: number; velocity: {x: number; z: number};
    feet: number; verticalVelocity: number; duckAmount?: number; grounded?: boolean;
  }): FiredRound | undefined {
    const stats = equipmentStats(this.id);
    const continuous = this.wasHeld && command.fireHeld && stats.fullAuto;
    this.wasHeld = command.fireHeld;
    const airborne = !(actor.grounded ?? actor.feet === 0);
    this.recovery.advance(dt, (actor.duckAmount ?? Number(command.crouch)) >= .95, airborne);
    if (this.id === 'knife') {
      if (!(command.fireHeld || command.firePressed) || time < this.nextShotAt) return;
      this.nextShotAt = time + .4;
      return {origin: {...actor.position}, direction: aimDirection(actor.yaw, actor.pitch), weapon: this.id, ordinal: this.ordinal++};
    }
    if (this.reloadUntil && time + 1e-9 >= this.reloadUntil) {
      this.ammo = stats.magazine;
      this.reloadUntil = 0;
    }
    if (command.reloadPressed && this.ammo < stats.magazine && !this.reloadUntil) {
      this.reloadUntil = time + stats.reload;
      this.pendingPress = false;
      return;
    }
    if (command.firePressed) this.pendingPress = true;
    if (!this.pendingPress && !(command.fireHeld && stats.fullAuto)) return;
    if (this.reloadUntil) return;
    if (this.ammo === 0) {
      this.reloadUntil = time + stats.reload;
      this.pendingPress = false;
      return;
    }
    if (time + 1e-9 < this.nextShotAt) return;
    const speedRatio = Math.hypot(actor.velocity.x, actor.velocity.z) / (stats.speed * UNIT);
    const direction = shotDirection({
      yaw: actor.yaw, pitch: actor.pitch, recoil: this.recovery.recoil, weapon: stats,
      recovery: this.recovery, speedRatio, walking: command.walk, airborne,
      verticalSpeedUnits: actor.verticalVelocity / UNIT, spread: true,
    }, this.random);
    this.recovery.fire();
    this.ammo--;
    // Carry the fractional cycle across ticks, as the range does. Rounding each
    // interval up to a tick slowed full-auto and sampled recoil at the wrong time.
    this.nextShotAt = (continuous && this.ordinal > 0 && time - this.nextShotAt <= dt + 1e-9
      ? this.nextShotAt : time) + stats.cycle;
    this.pendingPress = false;
    return {origin: {...actor.position}, direction, weapon: this.id, ordinal: this.ordinal++};
  }
}
