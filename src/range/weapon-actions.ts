import {gameData} from './config';
import {equipmentStats, weaponModeStats, type Equipment} from './equipment';

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
