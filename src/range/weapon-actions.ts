import {gameData} from './config';
import {equipmentStats, weaponModeStats, SILENT_RELOAD_MULTIPLIER, SHELL_RELOAD_START, SHELL_RELOAD_FINISH, type Equipment} from './equipment';

// Trainer estimate: vdata exposes R8 fire modes but not its engine-side windup.
// Keep this separate from the audited native weapon parameters.
export const REVOLVER_WINDUP = .2;

// Mode-specific values are exported from weapons.vdata, never inferred from class.
export class WeaponActions {
  zoom = 0;
  burst = false;
  alternateFire = false;
  readyAt = 0;
  private resumeZoom = 0;
  private resumeAt = 0;
  private chargedAt?: number;
  readonly base;
  readonly alternate;
  private readonly idleRevolver;
  constructor(readonly id: Equipment) {
    this.base = equipmentStats(id); this.alternate = weaponModeStats(id, true);
    this.idleRevolver = {...this.base, speed:this.alternate.speed};
  }
  get stats() {return this.zoom > 0 || this.burst || this.alternateFire ? this.alternate : this.isRevolver && !this.charging ? this.idleRevolver : this.base;}
  get charging() {return this.chargedAt !== undefined && !this.alternateFire;}
  get horizontalFov() {return this.zoom && this.id !== 'knife' ? gameData.weapons[this.id].zoomFov[this.zoom - 1] : 90;}
  get sensitivityScale() {return this.horizontalFov / 90;}
  get hidesViewmodel() {return this.zoom > 0 && this.id !== 'knife' && gameData.weapons[this.id].hideWhenZoomed;}
  get burstCycle() {return this.id === 'knife' ? 0 : gameData.weapons[this.id].burstCycle;}
  get burstInterval() {return this.id === 'knife' ? 0 : gameData.weapons[this.id].burstInterval;}
  get isRevolver() {return this.id !== 'knife' && gameData.weapons[this.id].isRevolver;}
  get pendingZoom() {return this.resumeZoom > 0;}
  chargeTrigger(time: number, held: boolean) {
    if (!this.isRevolver || this.alternateFire) {this.chargedAt = undefined; return time;}
    if (!held) {this.chargedAt = undefined; return Infinity;}
    return this.chargedAt ??= time + REVOLVER_WINDUP;
  }
  advance(time: number) {
    if (this.resumeZoom && time >= this.resumeAt) {this.zoom = this.resumeZoom; this.resumeZoom = 0;}
  }
  afterShot(time: number) {
    if (this.isRevolver) this.chargedAt = undefined;
    if (this.zoom && this.id !== 'knife' && gameData.weapons[this.id].unzoomsAfterShot) {
      this.resumeZoom = this.zoom; this.resumeAt = time + this.stats.cycle; this.zoom = 0;
    }
  }
  secondary(time: number) {
    if (this.id === 'knife' || time < this.readyAt) return false;
    const data = gameData.weapons[this.id];
    this.resumeZoom = 0;
    if (data.zoomLevels) {
      this.zoom = (this.zoom + 1) % (data.zoomLevels + 1);
      this.readyAt = time + data.zoomTime[this.zoom];
      return true;
    }
    if (data.hasBurst) {this.burst = !this.burst; this.readyAt = time + .3; return true;}
    return false;
  }
  holster() {this.zoom = 0; this.resumeZoom = 0; this.alternateFire = false; this.readyAt = 0; this.chargedAt = undefined;}
}

export const scopeVerticalFov = (horizontalFov: number) => 2 * Math.atan(Math.tan(horizontalFov * Math.PI / 360) / (4 / 3)) * 180 / Math.PI;

export type ReloadPhase = 'idle' | 'magazine' | 'start' | 'shell' | 'finish';
export type ReloadActionEvent = {kind: 'reload-start' | 'reload-shell' | 'reload-end' | 'reload-cancel' | 'reload-mode';
  at: number; silent: boolean; phase: ReloadPhase; ammo: number; reserve: number};

/** Ammo changes only on completed insert phases; cancellation cannot mint ammo. */
export class NativeReloadState {
  ammo: number;
  reserve: number;
  phase: ReloadPhase = 'idle';
  empty = false;
  silent = false;
  startedAt = 0;
  private lastTime = 0;
  private remaining = 0;
  private events: ReloadActionEvent[] = [];
  readonly stats;
  constructor(readonly id: Equipment, readonly silentMultiplier = SILENT_RELOAD_MULTIPLIER) {
    if (!Number.isFinite(silentMultiplier) || silentMultiplier < 1) throw new Error('Invalid silent reload multiplier');
    this.stats = equipmentStats(id);
    this.ammo = this.stats.magazine; this.reserve = this.stats.reserve;
  }
  get active() {return this.phase !== 'idle';}
  get phaseDuration() {return this.phase === 'idle' ? 0 : this.phase === 'start' ? SHELL_RELOAD_START
    : this.phase === 'finish' ? SHELL_RELOAD_FINISH : this.stats.reload;}
  get progress() {return this.phaseDuration ? Math.max(0, Math.min(1, 1 - this.remaining / this.phaseDuration)) : 0;}
  get until() {return this.active ? this.lastTime + this.remaining * (this.silent ? this.silentMultiplier : 1) : 0;}
  start(time: number, silent = false) {
    if (this.active || this.id === 'knife' || this.id === 'zeus' || this.ammo >= this.stats.magazine || this.reserve <= 0) return false;
    this.empty = this.ammo === 0; this.silent = silent; this.startedAt = this.lastTime = time;
    this.phase = this.stats.reloadsSingleShells ? 'start' : 'magazine';
    this.remaining = this.phase === 'start' ? SHELL_RELOAD_START : this.stats.reload;
    this.emit('reload-start', time);
    return true;
  }
  advance(time: number, reloadHeld?: boolean) {
    // Integrate the preceding interval at its preceding rate. Changing modes
    // cannot retroactively accelerate already elapsed reload time.
    let work = Math.max(0, time - this.lastTime) / (this.silent ? this.silentMultiplier : 1);
    this.lastTime = Math.max(this.lastTime, time);
    while (this.active && work + 1e-9 >= this.remaining) {
      work = Math.max(0, work - this.remaining);
      if (this.phase === 'magazine') {
        const inserted = Math.min(this.stats.magazine - this.ammo, this.reserve);
        this.ammo += inserted; this.reserve -= inserted; this.emit('reload-end', time); this.cancel(false);
      } else if (this.phase === 'finish') {this.emit('reload-end', time); this.cancel(false);}
      else {
        if (this.phase === 'shell') {this.ammo++; this.reserve--; this.emit('reload-shell', time);}
        this.phase = this.ammo >= this.stats.magazine || this.reserve <= 0 ? 'finish' : 'shell';
        this.remaining = this.phase === 'finish' ? SHELL_RELOAD_FINISH : this.stats.reload;
      }
    }
    if (this.active) this.remaining -= work;
    if (reloadHeld !== undefined && this.active && this.silent !== reloadHeld) {
      this.silent = reloadHeld; this.emit('reload-mode', time);
    }
  }
  interrupt() {
    if (!this.active || !this.stats.reloadsSingleShells || this.ammo <= 0) return false;
    if (this.phase !== 'finish') {this.phase = 'finish'; this.remaining = SHELL_RELOAD_FINISH;}
    return true;
  }
  cancel(notify = true) {
    if (this.active && notify) this.emit('reload-cancel', this.lastTime);
    this.phase = 'idle'; this.remaining = 0; this.silent = false;
  }
  drainActionEvents() {const events = this.events; this.events = []; return events;}
  private emit(kind: ReloadActionEvent['kind'], at: number) {
    this.events.push({kind, at, silent: this.silent, phase: this.phase, ammo: this.ammo, reserve: this.reserve});
  }
}
