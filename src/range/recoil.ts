export type RecoilParameters = {
  recoilSeed: number; recoilAngle: number; recoilVariance: number;
  recoilMagnitude: number; recoilMagnitudeVariance: number; fullAuto: boolean;
  magazine: number; cycle: number;
};
export type RecoilAngle = { yaw: number; pitch: number };
const f = Math.fround;

// Park-Miller with the 32-entry shuffle used by tier0's uniform stream.
// Float conversion is tested against offline emulation of the installed DLL.
export class UniformRandomStream {
  private state: number;
  private shuffle = new Int32Array(32);
  private previous = 0;
  constructor(seed: number) { this.state = -Math.abs(seed); }
  private nextInteger() {
    if (this.state <= 0 || this.previous === 0) {
      this.state = Math.max(1, -this.state);
      for (let j = 39; j >= 0; j--) {
        this.state = this.state * 16807 % 2147483647;
        if (j < 32) this.shuffle[j] = this.state;
      }
      this.previous = this.shuffle[0];
    }
    this.state = this.state * 16807 % 2147483647;
    const index = Math.floor(this.previous / 67108864);
    this.previous = this.shuffle[index];
    this.shuffle[index] = this.state;
    return this.previous;
  }
  float(low: number, high: number) {
    const unit = Math.min(.9999998807907104, f(f(this.nextInteger()) * f(1 / 2147483647)));
    return f(f(unit * f(high - low)) + low);
  }
}

export function recoilTable(w: RecoilParameters) {
  const random = new UniformRandomStream(w.recoilSeed);
  let angle = 0, magnitude = 0;
  return Array.from({ length: 64 }, (_, i) => {
    const a = f(w.recoilAngle + random.float(-w.recoilVariance, w.recoilVariance));
    const m = f(w.recoilMagnitude + random.float(-w.recoilMagnitudeVariance, w.recoilMagnitudeVariance));
    angle = w.fullAuto && i > 0 ? f(angle + f(f(a - angle) * f(.55))) : a;
    magnitude = w.fullAuto && i > 0 ? f(magnitude + f(f(m - magnitude) * f(.55))) : m;
    if (w.fullAuto && i < 4) magnitude = f(magnitude * f(.75 + i / 16));
    return { angle, magnitude };
  });
}

const DT = 1 / 128;
const decay = f(Math.exp(-8 * DT));
const velocityDecay = f(Math.exp(-4.5 * DT));
function integrate(angle: RecoilAngle, velocity: RecoilAngle) {
  let yaw = f(angle.yaw * decay), pitch = f(angle.pitch * decay);
  const length = Math.hypot(yaw, pitch);
  const scale = length > 18 * DT ? f(1 - f(18 * DT / length)) : 0;
  yaw = f(yaw * scale); pitch = f(pitch * scale);
  const next = { yaw: f(velocity.yaw * velocityDecay), pitch: f(velocity.pitch * velocityDecay) };
  if (Math.hypot(next.yaw, next.pitch) < 1 / 32) next.yaw = next.pitch = 0;
  const start = Math.hypot(velocity.yaw, velocity.pitch) < 1 / 32 ? { yaw: 0, pitch: 0 } : velocity;
  return {
    angle: { yaw: f(f(yaw + f(start.yaw * DT / 2)) + f(next.yaw * DT / 2)), pitch: f(f(pitch + f(start.pitch * DT / 2)) + f(next.pitch * DT / 2)) },
    velocity: next
  };
}

// Recovered CS2 recurrence: 128 Hz angle cache, exponential + linear angle
// recovery, and trapezoidal integration of exponentially damped impulse velocity.
// The browser interpolates Euler angles; the native client interpolates quaternions.
export function nativeRecoilPattern(w: RecoilParameters): RecoilAngle[] {
  const table = recoilTable(w);
  let angle = { yaw: 0, pitch: 0 }, velocity = { yaw: 0, pitch: 0 };
  return Array.from({ length: w.magazine }, (_, shot) => {
    const point = { yaw: angle.yaw * 2, pitch: angle.pitch * 2 };
    const impulse = table[shot % 64];
    const radians = f(impulse.angle * f(Math.PI / 180));
    velocity = { yaw: f(velocity.yaw + f(Math.sin(radians) * impulse.magnitude)), pitch: f(velocity.pitch + f(Math.cos(radians) * impulse.magnitude)) };
    let elapsed = 0;
    while (elapsed + DT <= w.cycle + 1e-9) {
      ({ angle, velocity } = integrate(angle, velocity));
      elapsed += DT;
    }
    const fraction = (w.cycle - elapsed) / DT;
    if (fraction > 1e-8) {
      const next = integrate(angle, velocity);
      angle = { yaw: f(angle.yaw + (next.angle.yaw - angle.yaw) * fraction), pitch: f(angle.pitch + (next.angle.pitch - angle.pitch) * fraction) };
      const v = Math.exp(-4.5 * (w.cycle - elapsed));
      velocity = { yaw: f(velocity.yaw * v), pitch: f(velocity.pitch * v) };
    }
    return point;
  });
}
