import {UNIT} from '../actor-physics';

export type LocomotionPose = {
  weights: ReadonlyMap<string, number>; gait: number; idle: number;
  x: number; z: number; feet: number; bodyYaw: number;
};
export type LocomotionInput = LocomotionPose & {
  id: number; generation: number; equipment: string;
  vx: number; vz: number; duck: number; airborne: boolean; supported: boolean;
};
export type LocomotionTransitionKind = 'steady' | 'start' | 'stop' | 'reverse' | 'stance' | 'takeoff' | 'land';
export type LocomotionSample = {
  weights: ReadonlyMap<string, number>; kind: LocomotionTransitionKind;
  contact?: {pose: LocomotionPose; weight: number};
};
type Frame = {time: number; input: LocomotionInput; weights: ReadonlyMap<string, number>;
  kind: LocomotionTransitionKind; until: number; contact?: {pose: LocomotionPose; time: number}};
const speed = (input: LocomotionInput) => Math.hypot(input.vx, input.vz);
const sameActor = (a: LocomotionInput, b: LocomotionInput) => a.id === b.id && a.generation === b.generation && a.equipment === b.equipment;
const yawGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function nextFrame(prior: Frame, input: LocomotionInput, time: number): Frame {
  const dt = Math.max(0, time - prior.time), before = speed(prior.input), after = speed(input);
  if (dt > .25 || Math.hypot(input.x - prior.input.x, input.z - prior.input.z) > 1 ||
    Math.abs(input.feet - prior.input.feet) > 8 * UNIT) return initialFrame(input, time);
  let kind: LocomotionTransitionKind = time < prior.until ? prior.kind : 'steady';
  let until = prior.until;
  const event: LocomotionTransitionKind | undefined = input.airborne !== prior.input.airborne ? input.airborne ? 'takeoff' : 'land'
    : before < 4 * UNIT && after >= 4 * UNIT ? 'start'
    : before >= 4 * UNIT && after < 4 * UNIT ? 'stop'
    : before > 16 * UNIT && after > 16 * UNIT &&
      (input.vx * prior.input.vx + input.vz * prior.input.vz) / (before * after) < -.25 ? 'reverse'
    : Math.abs(input.duck - prior.input.duck) > .001 ? 'stance' : undefined;
  if (event) {kind = event; until = time + .18;}
  // These are trainer blend time constants, not extracted Source 2 graph timings.
  const tau = {steady: .035, start: .045, stop: .055, reverse: .065, stance: .035, takeoff: .025, land: .045}[kind];
  const amount = -Math.expm1(-dt / tau), weights = new Map<string, number>();
  for (const name of new Set([...prior.weights.keys(), ...input.weights.keys()])) {
    const value = (prior.weights.get(name) ?? 0) * (1 - amount) + (input.weights.get(name) ?? 0) * amount;
    if (value > 1e-7) weights.set(name, value);
  }
  let contact = prior.contact;
  if (!contact && !input.airborne && input.supported && after < 40 * UNIT &&
    (before >= 40 * UNIT || event === 'stop' || event === 'stance')) {
    contact = {time, pose: {...prior.input, weights: prior.weights}};
  }
  if (contact && (input.airborne || !input.supported || after > 48 * UNIT || time - contact.time >= .22 ||
    yawGap(input.bodyYaw, contact.pose.bodyYaw) > .18 || Math.abs(input.feet - contact.pose.feet) > UNIT ||
    Math.hypot(input.x - contact.pose.x, input.z - contact.pose.z) > .18)) contact = undefined;
  return {time, input, weights, kind, until, contact};
}
const initialFrame = (input: LocomotionInput, time: number): Frame => ({time, input, weights: new Map(input.weights), kind: 'steady', until: time});
function sampleFrame(frame: Frame): LocomotionSample {
  const age = frame.contact ? frame.time - frame.contact.time : 0;
  return {weights: frame.weights, kind: frame.kind, contact: frame.contact ? {pose: frame.contact.pose,
    weight: Math.max(0, Math.min(1, age / .035, (.22 - age) / .09))} : undefined};
}

/** Fixed-tick scalar history; rendering, shot queries and rewinds only sample it. */
export class LocomotionTransitions {
  private frames: (Frame | undefined)[] = new Array(256);
  private head = 0;
  private count = 0;
  private fallback?: Frame;
  record(input: LocomotionInput, time: number) {
    if (!Number.isFinite(time)) return;
    const prior = this.frames[this.head];
    if (prior && (!sameActor(prior.input, input) || time < prior.time)) this.count = 0;
    if (this.count && prior?.time === time) return;
    const frame = this.count && prior ? nextFrame(prior, input, time) : initialFrame(input, time);
    this.head = this.count ? (this.head + 1) % this.frames.length : 0;
    this.frames[this.head] = frame; this.count = Math.min(this.count + 1, this.frames.length);
  }
  sample(input: LocomotionInput, time: number): LocomotionSample | undefined {
    if (!Number.isFinite(time)) return;
    for (let n = 0; n < this.count; n++) {
      const frame = this.frames[(this.head - n + this.frames.length) % this.frames.length]!;
      if (!sameActor(frame.input, input)) return;
      if (frame.time <= time) return sampleFrame(time === frame.time ? frame : nextFrame(frame, input, time));
    }
  }
  advance(input: LocomotionInput, dt: number): LocomotionSample {
    const prior = this.fallback;
    this.fallback = prior && sameActor(prior.input, input) ? nextFrame(prior, input, prior.time + dt) : initialFrame(input, 0);
    return sampleFrame(this.fallback);
  }
  clear() {this.frames.fill(undefined); this.count = 0; this.head = 0; this.fallback = undefined;}
}
