import type {Vec} from '../actor-physics';
import type {SkillLevel} from './config';
import {traceSolid, type Arena} from './geometry';

export const proficiency = (level: SkillLevel) => level === '10+' ? 1 : (level - 1) / 10;
export class AngleAwareness {
  private nextCheck = 0;
  private until = 0;
  private selected?: Vec;
  private visited = new Map<number, number>();
  constructor(private level: SkillLevel, private random: () => number) {}
  look(self: Vec, time: number, expected: Vec, candidates: readonly Vec[], arena: Arena, freshCue = false) {
    const skill = proficiency(this.level);
    if (freshCue) {this.until = time; this.nextCheck = Math.max(this.nextCheck, time + .45); return expected;}
    if (time >= this.nextCheck) {
      const ranked = candidates.map((point, index) => {
        const dx = point.x - self.x, dy = point.y - self.y, dz = point.z - self.z;
        const distance = Math.hypot(dx, dy, dz);
        const clear = distance > .1 && !Number.isFinite(traceSolid(self,
          {x: dx / distance, y: dy / distance, z: dz / distance}, arena, distance - .2).distance);
        const separation = Math.hypot(point.x - expected.x, point.z - expected.z);
        return {point, index, score: distance < 2 || separation < 1 ? -Infinity :
          Math.min(60, time - (this.visited.get(index) ?? -60)) + (clear ? 4 : -4) + this.random() * 3};
      }).sort((a, b) => b.score - a.score);
      this.selected = Number.isFinite(ranked[0]?.score) ? ranked[0].point : undefined;
      if (this.selected) this.visited.set(ranked[0].index, time);
      this.until = time + .65 - skill * .35 + this.random() * .2;
      this.nextCheck = this.until + 4.5 - skill * 3.4 + this.random() * (2 - skill);
    }
    return time < this.until && this.selected ? this.selected : expected;
  }
}
