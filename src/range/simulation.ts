import { Angle, clamp, gameData, MeasuredProfile, recoilPattern, Settings, Weapon } from './config';

export const UNIT = .0254;
export const DEG = Math.PI / 180;
export const VERTICAL_FOV = 2 * Math.atan(.75) / DEG;
export const STEP = 1 / 128;
export const TARGET_Z = -100;
export const SPAWN_Z = TARGET_Z + 12;
export const GRAVITY = 800 * UNIT;
export const JUMP_SPEED = 301.993 * UNIT;
export type Vec = { x: number; y: number; z: number };
export type Shot = { index: number; at: number; origin: Vec; direction: Vec; recoil: Angle };
export type ImpactSample = { x: number; y: number; hit: boolean; head: boolean; bullet: number };
export type Result = { id: string; weapon: Weapon; mode: Settings['mode'] | 'tracking'; shots: number; hits: number; heads: number; seconds: number; tracking: number; date: string; samples: ImpactSample[] };
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
  get burstSize() { return Math.min(this.settings.burst || gameData.weapons[this.settings.weapon].magazine, this.pattern.length); }
  targetForShot(index = this.shots) { return this.settings.mode === 'transfer' && index >= Math.floor(this.burstSize / 2) ? 1 : 0; }
  targetPosition(index: number): Vec {
    const transfer = this.settings.mode === 'transfer';
    return { x: this.targetX + (transfer ? index === 0 ? -2 : 2 : 0), y: 0, z: TARGET_Z };
  }
  onShot: (shot: Shot) => void = () => {};
  onResult: (result: Result) => void = () => {};
  constructor(public settings: Settings) { this.pattern = recoilPattern(settings.weapon); this.configure(settings); }
  configure(s: Settings, measured?: MeasuredProfile) {
    this.cancel(); this.settings = s; this.measured = measured;
    this.pattern = recoilPattern(s.weapon, measured);
    this.targetX = this.targetVelocity = 0; this.targetSign = 1;
    this.readyAt = this.time;
  }
  aim(dx: number, dy: number, touch = false) {
    const scale = touch ? .0025 : mouseAngle(1, this.settings.sensitivity);
    this.yaw -= dx * scale;
    this.pitch = clamp(this.pitch - dy * scale * (this.settings.invertY ? -1 : 1), -89 * DEG, 89 * DEG);
  }
  start(automatic = false) {
    if (this.firing) return false;
    this.active = true; this.firing = true; this.automatic = automatic;
    this.shots = this.hits = this.heads = 0;
    this.startedAt = this.time; this.nextShot = Math.max(this.time, this.lastShotAt + gameData.weapons[this.settings.weapon].cycle);
    this.latest = undefined;
    this.samples = [];
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
    this.accumulator = 0;
  }
  finish() {
    if (!this.firing) return;
    this.firing = false; this.automatic = false; this.recoil = { yaw: 0, pitch: 0 };
    this.readyAt = this.time;
    if (this.shots) {
      this.latest = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, weapon: this.settings.weapon, mode: this.settings.mode,
        shots: this.shots, hits: this.hits, heads: this.heads, seconds: this.time - this.startedAt,
        tracking: 0, date: new Date().toISOString(), samples: [...this.samples] };
      this.attempts++;
      this.onResult(this.latest);
    }
  }
  reset() {
    this.cancel(); this.readyAt = this.time; this.shots = this.hits = this.heads = 0;
    this.latest = undefined;
  }
  advance(elapsed: number) {
    if (!this.active) return;
    this.accumulator += Math.min(Math.max(elapsed, 0), .25);
    while (this.accumulator + 1e-10 >= STEP) { this.step(STEP); this.accumulator -= STEP; }
  }
  step(dt: number) {
    this.time += dt;
    const weapon = gameData.weapons[this.settings.weapon];
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
    const nextX = clamp(this.position.x + this.velocity.x * dt, -11.3, 11.3);
    const nextZ = clamp(this.position.z + this.velocity.z * dt, TARGET_Z + 2.2, 5);
    if (nextX === this.position.x) this.velocity.x = 0;
    if (nextZ === this.position.z) this.velocity.z = 0;
    this.position.x = nextX; this.position.z = nextZ;
    this.eyeHeight += ((crouch ? 46 : 64) * UNIT - this.eyeHeight) * Math.min(1, dt * 16);
    this.position.y = this.feet + this.eyeHeight;
    if (this.settings.moving) {
      const extent = this.settings.mode === 'transfer' ? 1.25 : 3;
      this.targetVelocity = this.targetSign * targetSpeed(this.settings);
      this.targetX += this.targetVelocity * dt;
      if (Math.abs(this.targetX) > extent) {
        this.targetX = this.targetSign * (2 * extent - Math.abs(this.targetX));
        this.targetSign *= -1; this.targetVelocity *= -1;
      }
    }
    if (this.firing && this.time + 1e-9 >= this.nextShot) this.fire();
  }
  fire() {
    const weapon = gameData.weapons[this.settings.weapon];
    if (this.shots >= this.burstSize) { this.finish(); return; }
    this.recoil = this.pattern[this.shots];
    let yaw = this.yaw - this.recoil.yaw * DEG;
    let pitch = this.pitch + this.recoil.pitch * DEG;
    if (this.settings.spread) {
      // Optional practice spread uses the installed weapon cone parameters.
      // Random sampling and firing inaccuracy are not advertised as engine parity.
      const moving = clamp((Math.hypot(this.velocity.x, this.velocity.z) / (weapon.speed * UNIT) - .34) / .66, 0, 1);
      const cone = (this.input.crouch ? weapon.crouch : weapon.stand) + moving * weapon.move;
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 2;
      const r = Math.random() * cone, q = Math.random() * weapon.spread;
      yaw += Math.cos(a) * r + Math.cos(b) * q;
      pitch += Math.sin(a) * r + Math.sin(b) * q;
    }
    const index = this.shots++;
    this.lastShotAt = this.time;
    this.onShot({ index, at: this.time, origin: { ...this.position }, direction: direction(yaw, pitch), recoil: this.recoil });
    this.nextShot += weapon.cycle;
    if (this.shots >= this.burstSize) this.finish();
  }
}
