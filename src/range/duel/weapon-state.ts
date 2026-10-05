import {equipmentStats, isPumpShotgun, knifeModel, ZEUS_RECHARGE_SECONDS, type Equipment} from '../equipment';
import {DEG, UNIT, type Vec} from '../actor-physics';
import type {DamagePunch} from '../aim-punch';
import {WeaponRecovery} from '../ballistics';
import {direction as aimDirection, shotDirections} from '../shot-model';
import type {ActorCommand} from './types';
import {NativeReloadState, WeaponActions, type ReloadActionEvent} from '../weapon-actions';

export type FiredRound = {
  origin: Vec; direction: Vec; weapon: Equipment; ordinal: number;
  kind: 'bullet' | 'pellets' | 'melee' | 'zeus'; attack: 'primary' | 'secondary';
  maxDistance: number; pelletDirections?: Vec[]; firstSlash?: boolean;
};
export type WeaponActionEvent = ReloadActionEvent | {kind: 'zeus-discharge' | 'zeus-ready'; at: number};
export type WeaponCommand = ActorCommand & {reloadHeld?: boolean};
export type WeaponStateOptions = {spread?: boolean; silentReloadMultiplier?: number};

export class DuelWeaponState {
  readonly recovery: WeaponRecovery;
  readonly reload: NativeReloadState;
  get ammo() {return this.reload.ammo;}
  set ammo(value: number) {this.reload.ammo = value;}
  get reserve() {return this.reload.reserve;}
  set reserve(value: number) {this.reload.reserve = value;}
  nextShotAt = 0;
  get reloadUntil() {return this.reload.until;}
  get reloadEmpty() {return this.reload.empty;}
  get reloadPhase() {return this.reload.phase;}
  get reloadSilent() {return this.reload.active && this.reload.silent;}
  rechargeUntil = 0;
  pumpUntil = 0;
  pendingPress = false;
  ordinal = 0;
  private wasHeld = false;
  private wasAlternateHeld = false;
  readonly actions: WeaponActions;
  private burstLeft = 0;
  private burstEnd = 0;
  private actionEvents: WeaponActionEvent[] = [];
  private firstSlashAfter = -Infinity;
  private lastMelee?: {ordinal: number; at: number; secondary: boolean};

  constructor(public readonly id: Equipment, private readonly random: () => number, private readonly options: WeaponStateOptions = {}) {
    this.reload = new NativeReloadState(id, options.silentReloadMultiplier);
    this.recovery = new WeaponRecovery(equipmentStats(id));
    this.actions = new WeaponActions(id);
  }

  holster() {
    this.reload.cancel(); this.pendingPress = false; this.wasHeld = false; this.wasAlternateHeld = false;
    this.burstLeft = 0; this.actions.holster();
  }

  drainActionEvents(): WeaponActionEvent[] {
    const events = [...this.actionEvents, ...this.reload.drainActionEvents()];
    this.actionEvents = []; return events;
  }

  advancePassive(time: number, dt: number, crouch = false, airborne = false) {
    if (this.id === 'zeus') {
      const stats = equipmentStats(this.id);
      this.recovery.penalty = airborne ? stats.stand + stats.jump : crouch ? stats.crouch : stats.stand;
      if (this.rechargeUntil && time + 1e-9 >= this.rechargeUntil) {
        this.ammo = 1; this.rechargeUntil = 0; this.actionEvents.push({kind: 'zeus-ready', at: time});
      }
    } else this.recovery.advance(dt, crouch, airborne);
  }

  // Main calls this after resolving the knife trace, including misses. It must
  // not let a delayed trace overwrite a newer attack's cooldown.
  resolveMeleeHit(ordinal: number, hit: boolean) {
    const attack = this.lastMelee;
    if (!attack || attack.ordinal !== ordinal) return;
    const cycle = attack.secondary ? (hit ? knifeModel.secondaryHitCycle : knifeModel.secondaryMissCycle)
      : (hit ? knifeModel.primaryHitCycle : knifeModel.primaryMissCycle);
    this.nextShotAt = attack.at + cycle;
    this.firstSlashAfter = this.nextShotAt + knifeModel.firstSlashGrace;
  }

  advance(time: number, dt: number, command: WeaponCommand, actor: {
    position: Vec; yaw: number; pitch: number; velocity: {x: number; z: number};
    feet: number; verticalVelocity: number; duckAmount?: number; grounded?: boolean;
    punch?: DamagePunch;
  }): FiredRound | undefined {
    this.actions.advance(time);
    this.reload.advance(time, command.reloadHeld);
    if (command.secondaryPressed && !this.reloadUntil) this.actions.secondary(time);
    this.actions.alternateFire = this.id === 'revolver' && !!(command.secondaryHeld || command.secondaryPressed);
    const stats = this.actions.stats;
    this.recovery.setParameters(stats);
    const continuous = (this.wasHeld && command.fireHeld || this.wasAlternateHeld && this.actions.alternateFire) && stats.fullAuto;
    this.wasHeld = command.fireHeld;
    this.wasAlternateHeld = this.actions.alternateFire;
    const airborne = !(actor.grounded ?? actor.feet === 0);
    this.advancePassive(time, dt, (actor.duckAmount ?? Number(command.crouch)) >= .95, airborne);
    const punch = actor.punch?.shotFor(this.recovery.angle);
    if (this.id === 'knife') {
      const secondary = !!(command.secondaryHeld || command.secondaryPressed);
      if (!(command.fireHeld || command.firePressed || secondary) || time + 1e-9 < this.nextShotAt) return;
      const firstSlash = !secondary && time + 1e-9 >= this.firstSlashAfter;
      this.nextShotAt = time + (secondary ? knifeModel.secondaryMissCycle : knifeModel.primaryMissCycle);
      this.firstSlashAfter = this.nextShotAt + knifeModel.firstSlashGrace;
      this.lastMelee = {ordinal: this.ordinal, at: time, secondary};
      return {origin: {...actor.position}, direction: aimDirection(actor.yaw - (punch?.yaw ?? 0) * DEG,
        actor.pitch + (punch?.pitch ?? 0) * DEG), weapon: this.id, ordinal: this.ordinal++,
        kind: 'melee', attack: secondary ? 'secondary' : 'primary', firstSlash,
        maxDistance: (secondary ? knifeModel.secondaryRangeUnits : knifeModel.primaryRangeUnits) * UNIT};
    }
    if (command.reloadPressed && this.reload.start(time, !!command.reloadHeld)) {
      this.pendingPress = false;
      this.actions.holster(); this.burstLeft = 0;
      return;
    }
    if (command.firePressed || this.actions.alternateFire && command.secondaryPressed) this.pendingPress = true;
    if (!this.pendingPress && !this.burstLeft && !(command.fireHeld && stats.fullAuto) && !this.actions.alternateFire) return;
    if (this.reload.active) {this.reload.interrupt(); return;}
    if (this.ammo === 0) {
      this.reload.start(time, !!command.reloadHeld);
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
    const directions = shotDirections({
      yaw: actor.yaw, pitch: actor.pitch, recoil: this.recovery.recoil, punch, weapon: stats,
      recovery: this.recovery, speedRatio, walking: command.walk, airborne,
      verticalSpeedUnits: actor.verticalVelocity / UNIT, spread: this.options.spread !== false,
      weaponId: this.id, alternateFire: this.actions.alternateFire,
      recoilIndex: this.recovery.index, seed: this.ordinal + 1,
    }, stats.pellets, this.random);
    const direction = directions[0];
    if (this.id !== 'zeus') this.recovery.fire();
    this.actions.afterShot(time);
    this.ammo--;
    if (isPumpShotgun(this.id)) this.pumpUntil = time + stats.cycle;
    if (this.id === 'zeus') {
      this.rechargeUntil = time + ZEUS_RECHARGE_SECONDS;
      this.actionEvents.push({kind: 'zeus-discharge', at: time});
    }
    // Carry the fractional cycle across ticks, as the range does. Rounding each
    // interval up to a tick slowed full-auto and sampled recoil at the wrong time.
    this.nextShotAt = (continuous && this.ordinal > 0 && time - this.nextShotAt <= dt + 1e-9
      ? this.nextShotAt : time) + stats.cycle;
    if (this.burstLeft > 0) {
      this.burstLeft--;
      this.nextShotAt = this.burstLeft ? burstShotAt + this.actions.burstInterval : this.burstEnd;
    }
    this.pendingPress = false;
    return {origin: {...actor.position}, direction, weapon: this.id, ordinal: this.ordinal++,
      kind: this.id === 'zeus' ? 'zeus' : directions.length > 1 ? 'pellets' : 'bullet',
      attack: this.actions.alternateFire ? 'secondary' : 'primary', maxDistance: stats.range * UNIT,
      ...(directions.length > 1 ? {pelletDirections: directions} : {})};
  }
}
