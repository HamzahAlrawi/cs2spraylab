import { Angle, clamp, gameData, MeasuredProfile, recoilPattern, Settings } from './config';
import {equipmentForSlot, equipmentStats, equipmentData, type Equipment, type Slot} from './equipment';
import {createScenario, DrillCoach, isDrillMode, moveWithCover, type CoachSample, type DrillMetrics} from './drills';

export const UNIT = .0254;
export const DEG = Math.PI / 180;
export const VERTICAL_FOV = 2 * Math.atan(.75) / DEG;
export const STEP = 1 / 128;
export const TARGET_Z = -100;
export const SPAWN_Z = TARGET_Z + 12;
export const GRAVITY = 800 * UNIT;
export const JUMP_SPEED = 301.993 * UNIT;
export type Vec = { x: number; y: number; z: number };
export type Shot = { index: number; at: number; origin: Vec; direction: Vec; recoil: Angle; equipment?: Equipment; melee?: boolean };
export type ImpactSample = { x: number; y: number; hit: boolean; head: boolean; bullet: number };
export type Result = { id: string; weapon: Equipment; mode: Settings['mode'] | 'tracking'; shots: number; hits: number; heads: number; seconds: number; tracking: number; date: string; samples: ImpactSample[]; drill?: DrillMetrics };
export type Input = { forward: number; side: number; walk: boolean; crouch: boolean; jump: boolean };
export const idleInput = (): Input => ({ forward: 0, side: 0, walk: false, crouch: false, jump: false });

export function mouseAngle(count: number, sensitivity: number) { return count * .022 * sensitivity * DEG; }
export function direction(yaw: number, pitch: number): Vec {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}
export function groundVelocity(vx: number, vz: number, x: number, z: number, speed: number, dt: number) {
  const v = Math.hypot(vx, vz);
  if (v > 0) {
    const retained = Math.max(0, v - Math.max(v, 80 * UNIT) * 5.2 * dt) / v;
    vx *= retained; vz *= retained;
  }
  const length = Math.hypot(x, z);
  if (length > 0) {
    x /= length; z /= length;
    const add = Math.min(Math.max(0, speed - (vx * x + vz * z)), 5.5 * speed * dt);
    vx += x * add; vz += z * add;
  }
  return { x: vx, z: vz };
}
export function targetSpeed(settings: Settings) {
  return (settings.targetSpeed === 'knife' ? 250 : settings.targetSpeed === 'smg' ? 240 : gameData.weapons[settings.weapon].speed) * UNIT;
}
export function airVelocity(vx: number, vz: number, x: number, z: number, speed: number, dt: number) {
  const length = Math.hypot(x, z);
  if (!length) return { x: vx, z: vz };
  x /= length; z /= length;
  const add = Math.min(Math.max(0, Math.min(speed, 30 * UNIT) - vx * x - vz * z), 12 * speed * dt);
  return { x: vx + x * add, z: vz + z * add };
}

export class Simulation {
  time = 0; accumulator = 0;
  position = { x: 0, y: 64 * UNIT, z: SPAWN_Z };
  velocity = { x: 0, z: 0 }; yaw = 0; pitch = 0;
  feet = 0; verticalVelocity = 0; eyeHeight = 64 * UNIT; jumpHeld = false;
  targetX = 0; targetVelocity = 0; targetSign = 1;
  input = idleInput(); active = false; firing = false; automatic = false;
  readyAt = 0; nextShot = 0; startedAt = 0; shots = 0; hits = 0; heads = 0;
  recoil: Angle = { yaw: 0, pitch: 0 };
  pattern: Angle[]; latest?: Result; measured?: MeasuredProfile;
  samples: ImpactSample[] = []; attempts = 0;
  lastShotAt = -Infinity;
  slot: Slot = 1; previousSlot: Slot = 2; equipReadyAt = 0;
  pistolAmmo = 12; pistolReloadAt = 0; pistolPenalty = 0; meleeAt = -Infinity;
  drill?: DrillCoach; drillRound = 0; drillPassed = 0; drillCompleted = 0;
  drillResult?: DrillMetrics; nextDrillAt = 0; repositionFrom?: Vec; repositionYaw = 0; drillRevision = 0;
  get equipped() { return equipmentForSlot(this.slot, this.settings.weapon); }
  get stats() { return equipmentStats(this.equipped); }
  get burstSize() {
    if (this.slot !== 1 || this.settings.mode === 'precision') return 1;
    if (this.settings.mode === 'burst') return 3;
    return Math.min(this.settings.burst || gameData.weapons[this.settings.weapon].magazine, this.pattern.length);
  }
  targetForShot(index = this.shots) { return this.settings.mode === 'transfer' && index >= Math.floor(this.burstSize / 2) ? 1 : 0; }
  targetPosition(index: number): Vec {
    if (this.drill) return {...this.drill.scenario.target};
    const transfer = this.settings.mode === 'transfer';
    return { x: this.targetX + (transfer ? index === 0 ? -2 : 2 : 0), y: 0, z: TARGET_Z };
  }
  onShot: (shot: Shot) => void = () => {};
  onResult: (result: Result) => void = () => {};
  constructor(public settings: Settings) { this.pattern = recoilPattern(settings.weapon); this.configure(settings); }
  configure(s: Settings, measured?: MeasuredProfile) {
    const changedMode = s.mode !== this.settings.mode;
    this.cancel(); this.settings = s; this.measured = measured;
    this.pattern = recoilPattern(s.weapon, measured);
    this.targetX = this.targetVelocity = 0; this.targetSign = 1;
    this.readyAt = this.time;
    this.drillRound = this.drillPassed = this.drillCompleted = 0;
    this.drillResult = undefined; this.nextDrillAt = 0; this.repositionFrom = undefined;
    if (isDrillMode(s.mode)) this.newDrill(true);
    else { this.drill = undefined; this.drillRevision++; if (changedMode) { this.position = {x:0,y:64*UNIT,z:SPAWN_Z}; this.yaw = this.pitch = this.feet = this.verticalVelocity = 0; } }
  }
  equip(slot: Slot) {
    if (slot === this.slot) return false;
    this.finish(); this.previousSlot = this.slot; this.slot = slot;
    this.pistolReloadAt = 0;
    this.equipReadyAt = this.time + (this.active ? 1 : 0);
    return true;
  }
  reload() {
    if (this.slot !== 2 || this.pistolAmmo === 12 || this.pistolReloadAt) return false;
    this.finish(); this.pistolReloadAt = this.time + equipmentData.weapons.usp.reload; return true;
  }
  coachSample(): CoachSample {
    return {time:this.time,position:this.position,yaw:this.yaw,pitch:this.pitch,velocity:this.velocity,speedCap:this.stats.speed*UNIT,input:this.input,feet:this.feet};
  }
  newDrill(resetPosition = false) {
    if (!isDrillMode(this.settings.mode)) return;
    const scenario = createScenario(this.settings.mode, this.drillRound++, this.settings.peekScenario);
    if (resetPosition || this.settings.mode === 'peek') {
      this.position = {...scenario.spawn}; this.yaw = scenario.yaw; this.pitch = scenario.pitch;
      this.velocity = {x:0,z:0}; this.feet = this.verticalVelocity = 0; this.eyeHeight = 64*UNIT;
    } else scenario.spawn = {...this.position};
    this.drill = new DrillCoach(this.settings.mode, scenario, this.time);
    this.drillRevision++; this.nextDrillAt = 0; this.repositionFrom = undefined;
    this.shots = this.hits = this.heads = 0; this.samples = [];
    this.drill.update(this.coachSample());
  }
  completeDrill(timeout = false) {
    if (!this.drill || this.drill.finished) return;
    this.drillResult = this.drill.result(timeout); this.drill.finished = true;
    this.drillCompleted++; this.drillPassed += +this.drillResult.passed;
    this.nextDrillAt = this.time+1.4;
    if (this.settings.mode === 'burst') { this.repositionFrom = {...this.position}; this.repositionYaw = this.yaw; }
    this.firing = this.automatic = false; this.recoil = {yaw:0,pitch:0};
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
    if (this.firing || this.time < this.equipReadyAt || this.pistolReloadAt || this.drill?.finished) return false;
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
    if (this.firing) this.finish();
    this.active = false; this.input = idleInput(); this.velocity = { x: 0, z: 0 };
    this.drill?.interruptMovement();
    this.accumulator = 0;
  }
  finish() {
    if (!this.firing) return;
    this.firing = false; this.automatic = false; this.recoil = { yaw: 0, pitch: 0 };
    this.readyAt = this.time;
    if (this.shots && !this.drill) this.publishResult();
    if (this.drill && this.settings.mode === 'burst' && this.drill.shots >= 3) this.completeDrill();
  }
  reset() {
    this.cancel(); this.readyAt = this.time; this.shots = this.hits = this.heads = 0;
    this.latest = undefined;
    this.pistolAmmo = 12; this.pistolReloadAt = 0; this.pistolPenalty = 0;
    if (isDrillMode(this.settings.mode)) { this.drillResult = undefined; this.newDrill(true); }
  }
  advance(elapsed: number) {
    if (!this.active) return;
    this.accumulator += Math.min(Math.max(elapsed, 0), .25);
    while (this.accumulator + 1e-10 >= STEP) { this.step(STEP); this.accumulator -= STEP; }
  }
  step(dt: number) {
    this.time += dt;
    const weapon = this.stats;
    this.pistolPenalty *= Math.exp(-dt/equipmentData.weapons.usp.recovery);
    if (this.pistolReloadAt && this.time >= this.pistolReloadAt) { this.pistolAmmo = 12; this.pistolReloadAt = 0; }
    const { forward, side, walk, crouch, jump } = this.input;
    const wishX = side * Math.cos(this.yaw) - forward * Math.sin(this.yaw);
    const wishZ = -side * Math.sin(this.yaw) - forward * Math.cos(this.yaw);
    const speed = weapon.speed * UNIT * (crouch ? .34 : walk ? .52 : 1);
    if (jump && !this.jumpHeld && this.feet === 0) this.verticalVelocity = JUMP_SPEED;
    this.jumpHeld = jump;
    const airborne = this.feet > 0 || this.verticalVelocity > 0;
    this.velocity = (airborne ? airVelocity : groundVelocity)(this.velocity.x, this.velocity.z, wishX, wishZ, speed, dt);
    if (airborne) {
      this.feet = Math.max(0, this.feet + this.verticalVelocity * dt - GRAVITY * dt * dt / 2);
      this.verticalVelocity -= GRAVITY * dt;
      if (this.feet === 0) this.verticalVelocity = 0;
    }
    const desired = {...this.position,x:clamp(this.position.x+this.velocity.x*dt,-11.3,11.3),z:clamp(this.position.z+this.velocity.z*dt,TARGET_Z+2.2,5)};
    const resolved = this.drill ? moveWithCover(this.position,desired,this.drill.scenario.covers,this.feet,crouch ? 54*UNIT : 72*UNIT) : desired;
    const nextX = resolved.x, nextZ = resolved.z;
    if (nextX === this.position.x) this.velocity.x = 0;
    if (nextZ === this.position.z) this.velocity.z = 0;
    this.position.x = nextX; this.position.z = nextZ;
    this.eyeHeight += ((crouch ? 46 : 64) * UNIT - this.eyeHeight) * Math.min(1, dt * 16);
    this.position.y = this.feet + this.eyeHeight;
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
      else if (!this.drill.finished && this.drill.seenAt !== null && this.time-this.drill.seenAt > (this.settings.drillPace==='challenge' ? 1.5 : 8)) this.completeDrill(true);
    }
    if (this.firing && this.time + 1e-9 >= this.nextShot) this.fire();
  }
  fire() {
    const weapon = this.stats;
    if (this.shots >= this.burstSize) { this.finish(); return; }
    this.recoil = this.slot === 2 ? {yaw:0,pitch:0} : this.pattern[this.shots];
    let yaw = this.yaw - this.recoil.yaw * DEG;
    let pitch = this.pitch + this.recoil.pitch * DEG;
    if (this.settings.spread || this.drill) {
      // Optional practice spread uses the installed weapon cone parameters.
      // Random sampling and firing inaccuracy are not advertised as engine parity.
      const moving = clamp((Math.hypot(this.velocity.x, this.velocity.z) / (weapon.speed * UNIT) - .34) / .66, 0, 1);
      const cone = (this.input.crouch ? weapon.crouch : weapon.stand) + moving * weapon.move + (this.slot===2 ? this.pistolPenalty : 0);
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 2;
      const r = Math.random() * cone, q = Math.random() * weapon.spread;
      yaw += Math.cos(a) * r + Math.cos(b) * q;
      pitch += Math.sin(a) * r + Math.sin(b) * q;
    }
    const index = this.shots++;
    if (this.slot===2) { this.pistolAmmo--; this.pistolPenalty = Math.min(.2,this.pistolPenalty+weapon.fire); }
    this.lastShotAt = this.time;
    this.onShot({ index, at: this.time, origin: { ...this.position }, direction: direction(yaw, pitch), recoil: this.recoil, equipment:this.equipped });
    if (this.drill && !this.drill.finished) {
      const sample = this.samples[this.samples.length-1];
      this.drill.record(this.coachSample(),!!sample?.hit,!!sample?.head);
      if (this.settings.mode==='precision' || this.settings.mode==='peek' && (sample?.head || this.drill.shots>=5)) this.completeDrill();
    }
    this.nextShot += weapon.cycle;
    if (this.shots >= this.burstSize) this.finish();
  }
}
