import type {Vec} from '../actor-physics';

export type TravelRecovery = 'idle' | 'travel' | 'yield' | 'backoff' | 'replan';
const separation = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Measure useful waypoint progress, not speed: pushing/sliding along a wall
// can be fast without getting closer. Intentional holds never start the clock.
export class TravelProgress {
  private goal: Vec | null = null;
  private waypoint: Vec | null = null;
  private best = Infinity;
  private startedAt = 0;
  private progressAt = 0;
  private replanAt = -Infinity;
  private lastTime = -Infinity;
  private passageWaitAt: number | null = null;
  private decision = {stage: 'idle' as TravelRecovery, stalledFor: 0, progress: 0};

  update(time: number, position: Vec, goal: Vec, waypoint: Vec, intended: boolean, yieldToPeer: boolean,
    waitingForPassage = false) {
    const changed = !this.goal || separation(goal, this.goal) > .75 || !this.waypoint || separation(waypoint, this.waypoint) > .5;
    const remaining = separation(position, waypoint);
    if (time < this.lastTime) this.replanAt = -Infinity;
    if (!intended || changed || time < this.lastTime) this.passageWaitAt = null;
    if (intended && waitingForPassage) {
      if (!this.goal || changed || time < this.lastTime) this.startedAt = time;
      this.passageWaitAt ??= time;
      this.goal = {...goal}; this.waypoint = {...waypoint}; this.best = remaining;
      this.progressAt = time;
      const waitingFor = time - this.passageWaitAt;
      this.decision = {...this.decision, stage: waitingFor >= .35 && waitingFor % 1.2 < .7 ? 'backoff' : 'yield', stalledFor: 0};
      this.lastTime = time;
      return this.snapshot();
    }
    if (this.passageWaitAt !== null) {
      this.progressAt = time; this.best = remaining; this.passageWaitAt = null;
    }
    if (!intended || changed || time < this.lastTime) {
      this.goal = intended ? {...goal} : null; this.waypoint = {...waypoint};
      this.best = remaining; this.startedAt = this.progressAt = time;
      this.decision = {stage: intended ? 'travel' : 'idle', stalledFor: 0, progress: 0};
    } else {
      const gain = this.best - remaining;
      if (gain >= .12) {
        this.best = remaining; this.progressAt = time;
        this.decision.progress += gain;
      }
      const stalledFor = Math.max(0, time - this.progressAt);
      const stage: TravelRecovery = stalledFor >= 2.4 && time - this.replanAt >= 2 ? 'replan'
        : stalledFor >= 1.2 && stalledFor < 1.55 ? 'backoff'
          : stalledFor >= 1.55 || stalledFor >= .7 && yieldToPeer ? 'yield' : 'travel';
      this.decision = {...this.decision, stage, stalledFor};
      if (stage === 'replan') {
        this.replanAt = time; this.progressAt = time; this.best = remaining;
      }
    }
    this.lastTime = time;
    return this.snapshot();
  }

  snapshot() {return {...this.decision, intentSince: this.goal ? this.startedAt : null,
    waitingForPassage: this.passageWaitAt !== null};}
}
