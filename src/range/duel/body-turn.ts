import {clamp, UNIT} from '../actor-physics';

export const bodyYawDelta = (target: number, current: number) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
export type BodyTurnActor = {id: number; generation: number; alive: boolean; yaw: number;
  velocity: {x: number; z: number}; grounded?: boolean; duckAmount: number};
export type BodyTurnPhase = 'idle' | 'start' | 'move' | 'stop' | 'reverse' | 'turn';

/** Bounded turn primitive, NOT the native graph or a foot-contact solver.
 * Use BodyTurnTimeline for multiple pose consumers, not per-call dt updates.
 */
export class LowerBodyTurn {
  bodyYaw = 0;
  phase: BodyTurnPhase = 'idle';
  private id?: number;
  private generation?: number;
  private vx = 0;
  private vz = 0;
  private moving = false;
  private remaining = 0;
  private initialized = false;
  copyFrom(source: LowerBodyTurn) {
    this.bodyYaw = source.bodyYaw; this.phase = source.phase; this.id = source.id; this.generation = source.generation;
    this.vx = source.vx; this.vz = source.vz; this.moving = source.moving;
    this.remaining = source.remaining; this.initialized = source.initialized;
  }
  reset(actor: BodyTurnActor) {
    this.id = actor.id; this.generation = actor.generation; this.bodyYaw = actor.yaw;
    this.vx = actor.velocity.x; this.vz = actor.velocity.z;
    this.moving = Math.hypot(this.vx, this.vz) > 16 * UNIT;
    this.phase = this.moving ? 'move' : 'idle'; this.remaining = 0; this.initialized = true;
    return this.bodyYaw;
  }
  update(actor: BodyTurnActor, dt: number) {
    if (!Number.isFinite(actor.yaw)) return this.bodyYaw;
    if (!this.initialized || this.id !== actor.id || this.generation !== actor.generation || !actor.alive ||
      !Number.isFinite(dt) || dt > .25 || actor.grounded === false) return this.reset(actor);
    if (dt <= 0) return this.bodyYaw;
    const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
    const moving = speed > (this.moving ? 8 : 16) * UNIT;
    const reversed = moving && this.moving && this.vx * actor.velocity.x + this.vz * actor.velocity.z < 0;
    if (reversed || moving !== this.moving) {
      this.phase = reversed ? 'reverse' : moving ? 'start' : 'stop';
      this.remaining = reversed ? .18 : moving ? .12 : .16;
    } else this.remaining = Math.max(0, this.remaining - dt);
    const gap = bodyYawDelta(actor.yaw, this.bodyYaw);
    const deadZone = moving ? 0 : 12 * Math.PI / 180;
    const speedLimit = (moving ? this.phase === 'reverse' ? 360 : 540 : 240) * Math.PI / 180;
    const turn = Math.abs(gap) > deadZone ? clamp(gap, -speedLimit * dt, speedLimit * dt) : 0;
    // Bound torso compensation even for a discontinuous 180-degree aim change.
    // This safety clamp may snap the root on teleports; never bend the spine backwards.
    const maxLag = (moving ? 30 : 45) * Math.PI / 180;
    this.bodyYaw += turn;
    const residual = bodyYawDelta(actor.yaw, this.bodyYaw);
    if (Math.abs(residual) > maxLag) this.bodyYaw = actor.yaw - Math.sign(residual) * maxLag;
    this.bodyYaw = bodyYawDelta(this.bodyYaw, 0);
    if (this.remaining === 0) this.phase = moving ? 'move' : Math.abs(gap) > deadZone ? 'turn' : 'idle';
    this.vx = actor.velocity.x; this.vz = actor.velocity.z; this.moving = moving;
    return this.bodyYaw;
  }
}

/** Only record at fixed simulation ticks. Pose/sensor/render queries are read-only.
 * Keeps 256 checkpoints (~2 s at 128 Hz); out-of-history queries fall back to aim.
 * Re-recording the same timestamp is idempotent. Rewinds/new generations reset.
 */
export class BodyTurnTimeline {
  private readonly states = Array.from({length: 256}, () => new LowerBodyTurn());
  private readonly times = new Float64Array(256);
  private readonly query = new LowerBodyTurn();
  private head = 0;
  private count = 0;
  private id?: number;
  private generation?: number;
  record(actor: BodyTurnActor, time: number) {
    if (!Number.isFinite(time) || !Number.isFinite(actor.yaw)) return;
    if (this.id !== actor.id || this.generation !== actor.generation || this.count && time < this.times[this.head]) this.count = 0;
    this.id = actor.id; this.generation = actor.generation;
    if (this.count && time === this.times[this.head]) return;
    const previous = this.head;
    this.head = this.count ? (this.head + 1) % this.states.length : 0;
    if (this.count) {
      this.states[this.head].copyFrom(this.states[previous]); this.states[this.head].update(actor, time - this.times[previous]);
    } else this.states[this.head].reset(actor);
    this.times[this.head] = time; this.count = Math.min(this.count + 1, this.states.length);
  }
  sample(actor: BodyTurnActor, time: number) {
    if (!Number.isFinite(time) || this.id !== actor.id || this.generation !== actor.generation || !actor.alive) return actor.yaw;
    for (let n = 0; n < this.count; n++) {
      const index = (this.head - n + this.states.length) % this.states.length;
      if (this.times[index] > time) continue;
      this.query.copyFrom(this.states[index]);
      const yaw = this.query.update(actor, time - this.times[index]);
      // Aim may change after the checkpoint but before a same-tick shot.
      // Bound that residual without advancing or rewriting the checkpoint.
      const lag = (Math.hypot(actor.velocity.x, actor.velocity.z) > 16 * UNIT ? 30 : 45) * Math.PI / 180;
      const residual = bodyYawDelta(actor.yaw, yaw);
      return Math.abs(residual) > lag ? actor.yaw - Math.sign(residual) * lag : yaw;
    }
    return actor.yaw;
  }
}
