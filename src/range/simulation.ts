import { Angle, clamp, gameData, MeasuredProfile, recoilPattern, Settings } from './config';
import {equipmentForSlot, equipmentStats, equipmentData, type Equipment, type Slot} from './equipment';
import {createScenario, DrillCoach, isDrillMode, moveWithCover, RANGE_WALLS, REPOSITION_SHOTS, type CoachSample, type DrillMetrics} from './drills';
import {WeaponRecovery} from './ballistics';
import {advanceActor, DEG, GRAVITY, JUMP_SPEED, STEP, UNIT, airVelocity, groundVelocity, idleInput, type MoveInput, type Vec} from './actor-physics';
import {direction, shotDirection} from './shot-model';
import {fitsHull, verticalContact} from './actor-collision';
import {resolveDamage} from './duel/damage';

export {DEG, GRAVITY, JUMP_SPEED, STEP, UNIT, airVelocity, groundVelocity, idleInput, direction};
export const VERTICAL_FOV = 2 * Math.atan(.75) / DEG;
export const TARGET_Z = -100;
export const SPAWN_Z = TARGET_Z + 12;
export type {Vec};
export type Shot = { index: number; at: number; origin: Vec; direction: Vec; recoil: Angle; equipment?: Equipment; melee?: boolean };
export type ImpactSample = { x: number; y: number; hit: boolean; head: boolean; bullet: number };
export type Result = { id: string; weapon: Equipment; mode: Settings['mode'] | 'tracking'; shots: number; hits: number; heads: number; seconds: number; tracking: number; date: string; samples: ImpactSample[]; drill?: DrillMetrics };
export type Input = MoveInput;

export function mouseAngle(count: number, sensitivity: number) { return count * .022 * sensitivity * DEG; }
export function targetSpeed(settings: Settings) {
  return (settings.targetSpeed === 'knife' ? 250 : settings.targetSpeed === 'smg' ? 240 : gameData.weapons[settings.weapon].speed) * UNIT;
}
export class Simulation {
  time = 0; accumulator = 0;
  position = { x: 0, y: 64 * UNIT, z: SPAWN_Z };
  velocity = { x: 0, z: 0 }; yaw = 0; pitch = 0;
  feet = 0; verticalVelocity = 0; eyeHeight = 64 * UNIT; duckAmount = 0; jumpHeld = false;
  duckSpeed = 8; crouchHeld = false; duckCooldown = 0; duckRecoveryOrigin?: {x: number; z: number};
  grounded = true;
  private previousPosition?: Vec;
  renderPosition() {
    if (!this.active || !this.previousPosition) return this.position;
    const alpha = clamp(this.accumulator / STEP, 0, 1);
    return {x: this.previousPosition.x + (this.position.x - this.previousPosition.x) * alpha,
      y: this.previousPosition.y + (this.position.y - this.previousPosition.y) * alpha,
      z: this.previousPosition.z + (this.position.z - this.previousPosition.z) * alpha};
  }
  targetX = 0; targetVelocity = 0; targetSign = 1;
  targetHealth = [100, 100];
  private stepDistance = 0;
  input = idleInput(); active = false; firing = false; automatic = false;
  readyAt = 0; nextShot = 0; startedAt = 0; shots = 0; hits = 0; heads = 0;
  recoil: Angle = { yaw: 0, pitch: 0 };
  pattern: Angle[]; latest?: Result; measured?: MeasuredProfile;
  samples: ImpactSample[] = []; attempts = 0;
  lastShotAt = -Infinity;
  slot: Slot = 1; previousSlot: Slot = 2; equipReadyAt = 0;
  pistolAmmo = 12; pistolReloadAt = 0; primaryReloadAt = 0; meleeAt = -Infinity;
  recoveryStates = new Map<Equipment,WeaponRecovery>();
  drill?: DrillCoach; drillRound = 0; drillPassed = 0; drillCompleted = 0;
  drillResult?: DrillMetrics; nextDrillAt = 0; repositionFrom?: Vec; repositionYaw = 0; drillRevision = 0;
  get equipped() { return equipmentForSlot(this.slot, this.settings.weapon); }
  get stats() { return equipmentStats(this.equipped); }
  get recovery() {
    let state=this.recoveryStates.get(this.equipped);
    if(!state){state=new WeaponRecovery(this.stats,this.slot===1?this.measured?.points:undefined);this.recoveryStates.set(this.equipped,state);}
    return state;
  }
  resetRecovery(){this.recoveryStates.clear();this.recoil={yaw:0,pitch:0};}
  predictedRecoil(next=false){
    const due=this.firing?this.nextShot:Math.max(this.time,this.lastShotAt+this.stats.cycle);
    const scheduledDelay=(at:number)=>Math.max(0,Math.ceil((at-this.time)/STEP-1e-8))*STEP;
    const delay=scheduledDelay(due);
    if(!next)return this.recovery.predict(delay);
    const state=Object.assign(Object.create(WeaponRecovery.prototype),this.recovery) as WeaponRecovery;
    state.advance(delay);return state.predict(scheduledDelay(due+this.stats.cycle)-delay,true);
  }
  get burstSize() {
    if (this.slot !== 1 || this.settings.mode === 'precision') return 1;
    if (this.settings.mode === 'burst') return REPOSITION_SHOTS;
    if (this.settings.mode === 'peek') return Math.min(gameData.weapons[this.settings.weapon].magazine,this.pattern.length);
    return Math.min(this.settings.burst || gameData.weapons[this.settings.weapon].magazine, this.pattern.length);
  }
  targetForShot(index = this.shots) {
    return this.settings.mode === 'transfer' && (this.settings.transferRule === 'kill' ? this.targetHealth[0] <= 0
      : index >= Math.min(this.settings.transferAfter, Math.max(1, this.burstSize - 1))) ? 1 : 0;
  }
  damageTarget(index: number, head: boolean, distance: number) {
    if (this.settings.mode !== 'transfer') return;
    const damage = resolveDamage(this.equipped, head ? 'head' : 'chest', distance, 0, false);
    this.targetHealth[index] = Math.max(0, this.targetHealth[index] - damage.healthDamage);
  }
  targetPosition(index: number): Vec {
    if (this.drill) return {...this.drill.scenario.target};
    const transfer = this.settings.mode === 'transfer';
    return { x: this.targetX + (transfer ? index === 0 ? -2 : 2 : 0), y: 0, z: TARGET_Z };
  }
  onShot: (shot: Shot) => void = () => {};
  onSound: (landing: boolean) => void = () => {};
  onResult: (result: Result) => void = () => {};
  constructor(public settings: Settings) { this.pattern = recoilPattern(settings.weapon); this.configure(settings); }
  configure(s: Settings, measured?: MeasuredProfile) {
    this.previousPosition = undefined;
    const changedMode = s.mode !== this.settings.mode;
    const leavingPositionedDrill = isDrillMode(this.settings.mode);
    this.cancel(); this.settings = s; this.measured = measured;
    this.resetRecovery();
    this.pattern = recoilPattern(s.weapon, measured);
    this.targetX = this.targetVelocity = 0; this.targetSign = 1;
    this.readyAt = this.time;
    this.drillRound = this.drillPassed = this.drillCompleted = 0;
    this.drillResult = undefined; this.nextDrillAt = 0; this.repositionFrom = undefined;
    if (isDrillMode(s.mode)) this.newDrill(true);
    else { this.drill = undefined; this.drillRevision++; if (changedMode && leavingPositionedDrill) {
      this.position = {x:0,y:64*UNIT,z:SPAWN_Z}; this.yaw = this.pitch = this.feet = this.verticalVelocity = this.duckAmount = 0;
      this.eyeHeight = 64 * UNIT; this.duckSpeed = 8; this.crouchHeld = false; this.duckCooldown = 0; this.duckRecoveryOrigin = undefined;
    } }
  }
  equip(slot: Slot) {
    if (slot === this.slot) return false;
    this.finish(); this.previousSlot = this.slot; this.slot = slot;
    this.pistolReloadAt = this.primaryReloadAt = 0;
    this.equipReadyAt = this.time + (this.active ? 1 : 0);
    return true;
  }
  reload() {
    if (this.slot === 1 && !this.primaryReloadAt) {
      this.finish(); this.primaryReloadAt = this.time + this.stats.reload; return true;
    }
    if (this.slot !== 2 || this.pistolAmmo === 12 || this.pistolReloadAt) return false;
    this.finish(); this.pistolReloadAt = this.time + equipmentData.weapons.usp.reload; return true;
  }
  coachSample(): CoachSample {
    return {time:this.time,position:this.position,yaw:this.yaw,pitch:this.pitch,velocity:this.velocity,speedCap:this.stats.speed*UNIT,input:this.input,feet:this.feet,grounded:this.grounded};
  }
  newDrill(resetPosition = false) {
    this.previousPosition = undefined;
    if (!isDrillMode(this.settings.mode)) return;
    const scenario = createScenario(this.settings.mode, this.drillRound++, this.settings.peekScenario);
    if (resetPosition || this.settings.mode === 'peek') {
      this.position = {...scenario.spawn}; this.yaw = scenario.yaw; this.pitch = scenario.pitch;
      this.velocity = {x:0,z:0}; this.feet = this.verticalVelocity = this.duckAmount = 0; this.eyeHeight = 64*UNIT;
      this.grounded = true; this.jumpHeld = false;
      this.duckSpeed = 8; this.crouchHeld = false; this.duckCooldown = 0; this.duckRecoveryOrigin = undefined;
    } else scenario.spawn = {...this.position};
    this.drill = new DrillCoach(this.settings.mode, scenario, this.time);
    this.resetRecovery();
    this.drillRevision++; this.nextDrillAt = 0; this.repositionFrom = undefined;
    this.shots = this.hits = this.heads = 0; this.samples = [];
    this.drill.update(this.coachSample());
  }
  completeDrill(timeout = false) {
    if (!this.drill || this.drill.finished) return;
    this.drillResult = this.drill.result(timeout); this.drill.finished = true;
    this.drillCompleted++; this.drillPassed += +this.drillResult.passed;
    this.nextDrillAt = this.time+(this.settings.mode==='peek' ? 0 : 1.4);
    if (this.settings.mode === 'burst') { this.repositionFrom = {...this.position}; this.repositionYaw = this.yaw; }
    this.firing = this.automatic = false;
    this.publishResult(this.drillResult);
  }
  publishResult(drill?: DrillMetrics) {
    this.latest = {id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,weapon:this.equipped,mode:this.settings.mode,
      shots:drill?.shots ?? this.shots,hits:drill?.hits ?? this.hits,heads:drill?.heads ?? this.heads,
      seconds:this.time-(this.drill?.beganAt ?? this.startedAt),tracking:0,date:new Date().toISOString(),samples:[...this.samples],...(drill ? {drill} : {})};
    this.attempts++; this.onResult(this.latest);
  }
  aim(dx: number, dy: number, touch = false) {
    const scale = touch ? .0025 : mouseAngle(1, this.settings.sensitivity);
    this.drill?.mouse(Math.hypot(dx,dy)*scale/DEG);
    this.yaw -= dx * scale;
    this.pitch = clamp(this.pitch - dy * scale * (this.settings.invertY ? -1 : 1), -89 * DEG, 89 * DEG);
  }
  start(automatic = false) {
    if (this.firing || this.time < this.equipReadyAt || this.pistolReloadAt || this.primaryReloadAt || this.drill?.finished) return false;
    if (this.slot === 3) {
      this.active = true;
      if (this.time-this.meleeAt < .4) return false;
      this.meleeAt = this.time;
      this.onShot({index:0,at:this.time,origin:{...this.position},direction:direction(this.yaw,this.pitch),recoil:{yaw:0,pitch:0},equipment:'knife',melee:true});
      return true;
    }
    if (this.slot === 2 && this.pistolAmmo === 0) { this.reload(); return false; }
    this.active = true; this.firing = true; this.automatic = automatic;
    this.shots = this.hits = this.heads = 0;
    this.startedAt = this.time; this.nextShot = Math.max(this.time, this.lastShotAt + this.stats.cycle);
    this.targetHealth = [100, 100];
    this.latest = undefined;
    if (!this.drill) this.samples = [];
    if (this.time >= this.nextShot) this.fire();
    return true;
  }
  release(pointerType: string) {
    if (this.automatic || pointerType === 'touch') return;
    this.finish();
  }
  cancel() {
    this.previousPosition = undefined;
    if (this.firing) this.finish();
    this.active = false; this.input = idleInput(); this.velocity = { x: 0, z: 0 };
    this.drill?.interruptMovement();
    this.accumulator = 0;
  }
  finish() {
    if (!this.firing) return;
    this.firing = false; this.automatic = false;
    this.readyAt = this.time;
    if (this.shots && !this.drill) this.publishResult();
  }
  reset() {
    this.cancel(); this.readyAt = this.time; this.shots = this.hits = this.heads = 0;
    this.latest = undefined;
    this.pistolAmmo = 12; this.pistolReloadAt = this.primaryReloadAt = 0; this.resetRecovery();
    if (isDrillMode(this.settings.mode)) { this.drillResult = undefined; this.newDrill(true); }
  }
  advance(elapsed: number) {
    if (!this.active) return;
    this.accumulator += Math.min(Math.max(elapsed, 0), .25);
    while (this.accumulator + 1e-10 >= STEP) { this.step(STEP); this.accumulator -= STEP; }
  }
  step(dt: number) {
    this.previousPosition = {...this.position};
    this.time += dt;
    const weapon = this.stats;
    if (this.pistolReloadAt && this.time >= this.pistolReloadAt) { this.pistolAmmo = 12; this.pistolReloadAt = 0; }
    if (this.primaryReloadAt && this.time >= this.primaryReloadAt) this.primaryReloadAt = 0;
    const covers = this.drill?.scenario.covers ?? RANGE_WALLS;
    const next = advanceActor(this, this.input, weapon.speed * UNIT, dt, (from, desired, feet, height) =>
      moveWithCover(from, {...desired,x:clamp(desired.x,-11.3,11.3),z:clamp(desired.z,TARGET_Z+2.2,5)},covers,feet,height),
      (position, feet, height) => fitsHull(position, feet, height, covers),
      (position, from, to, height) => verticalContact(position, from, to, height, covers));
    const traveled = Math.hypot(next.position.x - this.position.x, next.position.z - this.position.z);
    if (next.grounded && !this.grounded) this.onSound(true);
    const audible = Math.hypot(next.velocity.x, next.velocity.z) > weapon.speed * UNIT * .54;
    if (next.grounded && audible && traveled > 0) {
      this.stepDistance += traveled;
      if (this.stepDistance >= 1.35) {this.stepDistance %= 1.35; this.onSound(false);}
    } else if (!audible) this.stepDistance = 0;
    this.velocity = next.velocity;
    this.position.x = next.position.x; this.position.y = next.position.y; this.position.z = next.position.z;
    this.feet = next.feet; this.verticalVelocity = next.verticalVelocity;
    this.eyeHeight = next.eyeHeight; this.duckAmount = next.duckAmount ?? 0; this.jumpHeld = next.jumpHeld;
    this.duckSpeed = next.duckSpeed ?? 8; this.crouchHeld = next.crouchHeld ?? false;
    this.duckCooldown = next.duckCooldown ?? 0; this.duckRecoveryOrigin = next.duckRecoveryOrigin;
    this.grounded = !!next.grounded;
    const crouch = this.duckAmount >= .95;
    const recovery=this.recovery;
    for(const state of this.recoveryStates.values())state.advance(dt,crouch,!this.grounded);
    this.recoil=this.slot===3?{yaw:0,pitch:0}:recovery.recoil;
    if (this.settings.moving && !this.drill) {
      const extent = this.settings.mode === 'transfer' ? 1.25 : 3;
      this.targetVelocity = this.targetSign * targetSpeed(this.settings);
      this.targetX += this.targetVelocity * dt;
      if (Math.abs(this.targetX) > extent) {
        this.targetX = this.targetSign * (2 * extent - Math.abs(this.targetX));
        this.targetSign *= -1; this.targetVelocity *= -1;
      }
    }
    if (this.drill) {
      this.drill.update(this.coachSample());
      const repositioned = !this.repositionFrom || Math.abs((this.position.x-this.repositionFrom.x)*Math.cos(this.repositionYaw)-(this.position.z-this.repositionFrom.z)*Math.sin(this.repositionYaw))>=.9;
      if (this.drill.finished && this.time >= this.nextDrillAt && repositioned) this.newDrill();
      else if (!this.drill.finished && this.settings.mode==='peek') {
        if(this.drill.firstShotAt!==null && this.time-this.drill.firstShotAt >= this.settings.peekDuration) {
          this.completeDrill(); this.newDrill();
        }
      }
      else if (!this.drill.finished && this.drill.seenAt !== null && this.time-this.drill.seenAt > (this.settings.drillPace==='challenge' ? 1.5 : 8)) this.completeDrill(true);
    }
    if (this.firing && this.time + 1e-9 >= this.nextShot) this.fire();
  }
  fire() {
    const weapon = this.stats;
    if (this.shots >= this.burstSize) { this.finish(); return; }
    this.recoil = this.recovery.recoil;
    const firedDirection = shotDirection({yaw:this.yaw,pitch:this.pitch,recoil:this.recoil,weapon,recovery:this.recovery,
      speedRatio:Math.hypot(this.velocity.x,this.velocity.z)/(weapon.speed*UNIT),walking:this.input.walk,
      airborne:!this.grounded,verticalSpeedUnits:this.verticalVelocity/UNIT,spread:this.settings.spread});
    const index = this.shots++;
    if (this.slot===2) this.pistolAmmo--;
    this.recovery.fire();
    this.lastShotAt = this.time;
    this.onShot({ index, at: this.time, origin: { ...this.position }, direction: firedDirection, recoil: this.recoil, equipment:this.equipped });
    if (this.drill && !this.drill.finished) {
      const sample = this.samples[this.samples.length-1];
      this.drill.record(this.coachSample(),!!sample?.hit,!!sample?.head);
      if (this.settings.mode==='precision' || this.settings.mode==='burst' && this.drill.shots>=REPOSITION_SHOTS) this.completeDrill();
    }
    this.nextShot += weapon.cycle;
    if (this.shots >= this.burstSize) this.finish();
  }
}
