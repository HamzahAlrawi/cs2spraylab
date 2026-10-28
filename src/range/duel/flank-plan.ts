import type {Vec} from '../actor-physics';
import type {TacticalPersonality} from './tactical-personality';

// Tactical memory only: evidence points must already have passed perception.
export class FlankPlan {
  private plan: {lane: string; until: number; startedAt: number; evidenceAt: number; point: Vec | null} | null = null;
  constructor(private readonly personality: TacticalPersonality) {}

  begin(lane: string, time: number, evidenceAt: number, point: Vec | null) {
    this.plan = {lane, startedAt: time, until: time + 3.5 * this.personality.flankCommitment,
      evidenceAt, point: point && {...point}};
  }

  retains(lane: string, time: number, evidenceAt: number, point: Vec | null) {
    const plan = this.plan;
    if (!plan || plan.lane !== lane || time < plan.startedAt || time >= plan.until) return false;
    const changedEvidence = evidenceAt > plan.evidenceAt && point && (!plan.point ||
      Math.hypot(point.x - plan.point.x, point.z - plan.point.z) >= 4 / this.personality.adaptation);
    return !(changedEvidence && (!plan.point || time - plan.startedAt >= .45 / this.personality.adaptation));
  }

  clear() {this.plan = null;}
  snapshot() {return this.plan ? {...this.plan, point: this.plan.point && {...this.plan.point}} : null;}
}
