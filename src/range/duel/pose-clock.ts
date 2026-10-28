export type PoseClockInput = {id: number; generation: number; cyclesPerSecond: number; airborne: boolean; jumpClip: string};
export type PoseClockState = {gait: number; idle: number; air: number; airborne: boolean; jumpClip: string};
type Checkpoint = PoseClockState & {time: number};
const advance = (state: PoseClockState, input: PoseClockInput, dt: number): PoseClockState => ({
  gait: (state.gait + input.cyclesPerSecond * dt) % 1, idle: state.idle + dt,
  air: input.airborne ? state.airborne ? state.air + dt : 0 : 0,
  airborne: input.airborne, jumpClip: input.airborne && !state.airborne ? input.jumpClip : state.jumpClip,
});

/** Scalar simulation history. Pose queries never change the locomotion clock. */
export class ActorPoseClock {
  private readonly frames: (Checkpoint | undefined)[] = new Array(256);
  private head = 0;
  private count = 0;
  private id = -1;
  private generation = -1;
  constructor(private readonly initialGait = 0) {}
  record(input: PoseClockInput, time: number) {
    if (!Number.isFinite(time) || !Number.isFinite(input.cyclesPerSecond)) return;
    const prior = this.frames[this.head];
    if (this.id !== input.id || this.generation !== input.generation || prior && time < prior.time) this.count = 0;
    this.id = input.id; this.generation = input.generation;
    if (this.count && prior?.time === time) return;
    const state = this.count && prior ? advance(prior, input, Math.min(.25, time - prior.time))
      : {gait: this.initialGait, idle: 0, air: 0, airborne: input.airborne, jumpClip: input.jumpClip};
    this.head = this.count ? (this.head + 1) % this.frames.length : 0;
    this.frames[this.head] = {...state, time}; this.count = Math.min(this.frames.length, this.count + 1);
  }
  sample(input: PoseClockInput, time: number): PoseClockState | undefined {
    if (input.id !== this.id || input.generation !== this.generation || !Number.isFinite(time)) return;
    for (let n = 0; n < this.count; n++) {
      const frame = this.frames[(this.head - n + this.frames.length) % this.frames.length]!;
      if (frame.time > time) continue;
      return advance(frame, input, Math.min(.25, time - frame.time));
    }
  }
}
