import {clamp} from '../actor-physics';
import type {BotObservation} from './perception';

/** Authored evidence policy, not a measured FACEIT reaction-time model.
 * Uses only confirmed visible probes; sample coverage is not body exposure. */
export class ExposureRecognition {
  private identity = '';
  private at = -Infinity;
  private seenAt = -Infinity;
  private visibleNow = false;
  private exposureKnown = false;
  private evidence = 0;
  update({time, visible, self}: BotObservation) {
    if (!Number.isFinite(time) || time <= this.at) return;
    const identity = visible ? `${visible.id}:${visible.generation}` : '';
    const elapsed = time - this.at;
    if (!identity) {
      if (time - this.seenAt > .12) {this.evidence = 0; this.identity = '';}
      this.visibleNow = false; this.at = time; return;
    }
    if (identity !== this.identity || time - this.seenAt > .12) this.evidence = 0;
    else if (this.visibleNow) {
      const distance2 = Math.max(.01, (visible!.position.x - self.position.x) ** 2 +
        (visible!.position.y - self.position.y) ** 2 + (visible!.position.z - self.position.z) ** 2);
      const solidAngle = visible!.candidates?.reduce((sum, candidate) =>
        sum + Math.max(0, candidate.exposureMargin) ** 2 / distance2, 0);
      const weight = solidAngle === undefined ? 1 : .3 + .7 * clamp(Math.sqrt(solidAngle) / .012, 0, 1);
      this.evidence += Math.min(.075, elapsed) * weight;
    }
    this.identity = identity; this.at = this.seenAt = time; this.visibleNow = true;
    this.exposureKnown = visible!.candidates !== undefined;
  }
  ready(time: number) {return this.visibleNow && !!this.identity && time - this.at <= .075 &&
    (!this.exposureKnown || this.evidence >= .06);}
}
