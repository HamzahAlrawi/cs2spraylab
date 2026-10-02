import {equipmentStats, type Equipment} from '../equipment';
import {DEG, UNIT, type Vec} from '../actor-physics';
import type {DamagePunch} from '../aim-punch';
import {WeaponRecovery} from '../ballistics';
import {direction as aimDirection, shotDirection} from '../shot-model';
import type {ActorCommand} from './types';
import {WeaponActions} from '../weapon-actions';

export type FiredRound = {origin: Vec; direction: Vec; weapon: Equipment; ordinal: number};

export class DuelWeaponState {
  readonly recovery: WeaponRecovery;
  ammo: number;
  nextShotAt = 0;
  reloadUntil = 0;
  reloadEmpty = false;
  pendingPress = false;
  ordinal = 0;
  private wasHeld = false;
  private wasAlternateHeld = false;
  readonly actions: WeaponActions;
  private burstLeft = 0;
  private burstEnd = 0;

  constructor(public readonly id: Equipment, private readonly random: () => number) {
    this.ammo = equipmentStats(id).magazine;
    this.recovery = new WeaponRecovery(equipmentStats(id));
    this.actions = new WeaponActions(id);
  }

  holster() {
    this.reloadUntil = 0; this.pendingPress = false; this.wasHeld = false; this.wasAlternateHeld = false;
    this.burstLeft = 0; this.actions.holster();
  }

  advance(time: number, dt: number, command: ActorCommand, actor: {
    position: Vec; yaw: number; pitch: number; velocity: {x: number; z: number};
    feet: number; verticalVelocity: number; duckAmount?: number; grounded?: boolean;
    punch?: DamagePunch;
  }): FiredRound | undefined {
    this.actions.advance(time);
    if (command.secondaryPressed && !this.reloadUntil) this.actions.secondary(time);
    this.actions.alternateFire = this.id === 'revolver' && !!(command.secondaryHeld || command.secondaryPressed);
    const stats = this.actions.stats;
    this.recovery.setParameters(stats);
    const continuous = (this.wasHeld && command.fireHeld || this.wasAlternateHeld && this.actions.alternateFire) && stats.fullAuto;
    this.wasHeld = command.fireHeld;
    this.wasAlternateHeld = this.actions.alternateFire;
    const airborne = !(actor.grounded ?? actor.feet === 0);
    this.recovery.advance(dt, (actor.duckAmount ?? Number(command.crouch)) >= .95, airborne);
    const punch = actor.punch?.shotFor(this.recovery.angle);
    if (this.id === 'knife') {
      if (!(command.fireHeld || command.firePressed) || time < this.nextShotAt) return;
      this.nextShotAt = time + .4;
      return {origin: {...actor.position}, direction: aimDirection(actor.yaw - (punch?.yaw ?? 0) * DEG,
        actor.pitch + (punch?.pitch ?? 0) * DEG), weapon: this.id, ordinal: this.ordinal++};
    }
    if (this.reloadUntil && time + 1e-9 >= this.reloadUntil) {
      this.ammo = stats.magazine;
      this.reloadUntil = 0;
    }
    if (command.reloadPressed && this.ammo < stats.magazine && !this.reloadUntil) {
      this.reloadEmpty = this.ammo === 0;
      this.reloadUntil = time + stats.reload;
      this.pendingPress = false;
      this.actions.holster(); this.burstLeft = 0;
      return;
    }
    if (command.firePressed || this.actions.alternateFire && command.secondaryPressed) this.pendingPress = true;
    if (!this.pendingPress && !this.burstLeft && !(command.fireHeld && stats.fullAuto) && !this.actions.alternateFire) return;
    if (this.reloadUntil) return;
    if (this.ammo === 0) {
      this.reloadEmpty = true;
      this.reloadUntil = time + stats.reload;
      this.pendingPress = false;
      this.actions.holster(); this.burstLeft = 0;
      return;
    }
    const chargedAt = this.actions.chargeTrigger(time, command.fireHeld);
    if (!Number.isFinite(chargedAt)) {this.pendingPress = false; return;}
    if (time + 1e-9 < Math.max(this.nextShotAt, this.actions.readyAt, chargedAt)) return;
    const burstShotAt = this.burstLeft && time - this.nextShotAt <= dt + 1e-9 ? this.nextShotAt : time;
    if (this.actions.burst && !this.burstLeft) {
      this.burstLeft = 3;
      this.burstEnd = time + this.actions.burstCycle;
    }
    const speedRatio = Math.hypot(actor.velocity.x, actor.velocity.z) / (stats.speed * UNIT);
    const direction = shotDirection({
      yaw: actor.yaw, pitch: actor.pitch, recoil: this.recovery.recoil, punch, weapon: stats,
      recovery: this.recovery, speedRatio, walking: command.walk, airborne,
      verticalSpeedUnits: actor.verticalVelocity / UNIT, spread: true,
    }, this.random);
    this.recovery.fire();
    this.actions.afterShot(time);
    this.ammo--;
    // Carry the fractional cycle across ticks, as the range does. Rounding each
    // interval up to a tick slowed full-auto and sampled recoil at the wrong time.
    this.nextShotAt = (continuous && this.ordinal > 0 && time - this.nextShotAt <= dt + 1e-9
      ? this.nextShotAt : time) + stats.cycle;
    if (this.burstLeft > 0) {
      this.burstLeft--;
      this.nextShotAt = this.burstLeft ? burstShotAt + this.actions.burstInterval : this.burstEnd;
    }
    this.pendingPress = false;
    return {origin: {...actor.position}, direction, weapon: this.id, ordinal: this.ordinal++};
  }
}
