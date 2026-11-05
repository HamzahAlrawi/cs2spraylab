import {stanceCurve, UNIT, type Vec} from '../actor-physics';
import {canFitInArena, traceSolid, type Arena, type CoverLane} from './geometry';
import {clearSegment} from './navigation';
import type {DuelActorSnapshot} from './types';
import type {SkillLevel} from './config';

const gap = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
export const strictCover = (level: SkillLevel) => level === '10+' || level >= 6;

/** Conservative body envelope, not an enlarged combat hitbox. Only queried
 * against sensed/remembered threats or authored approach points. */
export function bodyBehindCover(feet: Vec, duck: number, threat: Vec, arena: Arena, headOnlyHold = false) {
  const height = (72 - 18 * stanceCurve(duck)) * UNIT, radius = 16 * UNIT + .08;
  const heights = headOnlyHold ? [.12, height * .48, height * .82] : [.12, height * .55, height + .02];
  for (const y of heights) for (const x of [-radius, radius]) for (const z of [-radius, radius]) {
    const dx = feet.x + x - threat.x, dy = feet.y + y - threat.y, dz = feet.z + z - threat.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < .1 || !Number.isFinite(traceSolid(threat,
      {x: dx / distance, y: dy / distance, z: dz / distance}, arena, distance - .02).distance)) return false;
  }
  return true;
}

/** Twelve local candidates per stance; no grid/nav search or actor lookup. */
export function findBodyCover(self: DuelActorSnapshot, threat: Vec, arena: Arena, candidates: readonly Vec[]) {
  const height = (72 - 18 * stanceCurve(self.duckAmount)) * UNIT;
  const from = {...self.position, y: self.feet};
  for (const candidate of candidates.slice(0, 12)) {
    if (gap(from, candidate) > 7 || Math.abs(candidate.y - from.y) > .5) continue;
    // Bullet/visual floor triangles can lie below the actor hull's supported
    // height on a ramp. Use the same support query as movement on native maps.
    const support = arena.native?.vertical(candidate, candidate.y + .46, candidate.y - .5, height);
    const point = support ? support.grounded && (support.normal?.y ?? 1) >= .7 ? {...candidate, y:support.feet} : undefined
      : Math.abs(candidate.y) < .01 ? {...candidate,y:0} : undefined;
    if (!point || !canFitInArena(point, point.y, height, arena) ||
      !bodyBehindCover(point, self.duckAmount, threat, arena) || !clearSegment(from, point, arena)) continue;
    return point;
  }
}

export class CoverDiscipline {
  private checkAt = -Infinity;
  private goal?: Vec;
  private context = '';
  private duck = false;
  private unsafe = false;
  get crouching() {return this.duck;}
  get exposed() {return this.unsafe;}
  constructor(private readonly level: SkillLevel, private readonly actorId: number) {}
  update(self: DuelActorSnapshot, threat: Vec | null | undefined, arena: Arena, lane: CoverLane,
    time: number, waiting: boolean, staticHold: boolean) {
    if (!strictCover(this.level) || !waiting || !threat || !self.alive || self.grounded === false) {
      this.goal = undefined; this.context = ''; this.duck = this.unsafe = false; return;
    }
    const context = `${lane.anchor.x}:${lane.anchor.y}:${lane.anchor.z}:${self.duckAmount > .5}:${arena.solids.length}`;
    if (context === this.context && time < this.checkAt) return this.goal;
    this.context = context; this.checkAt = time + .4 + (this.actorId % 5) * .025;
    const feet = {...self.position, y: self.feet};
    if (bodyBehindCover(feet, self.duckAmount, threat, arena, staticHold)) {this.goal = undefined; this.unsafe = false; return;}
    const dx = lane.anchor.x - lane.edge.x, dz = lane.anchor.z - lane.edge.z, length = Math.hypot(dx, dz);
    const away = length > .05 ? {x: dx / length, z: dz / length} : lane.axis ?? {x: 1, z: 0};
    const offset = (x:number,z:number):Vec=>({x:feet.x+away.x*x-away.z*z,y:feet.y,z:feet.z+away.z*x+away.x*z});
    const candidates = [lane.retreat,lane.anchor,feet,offset(.35,0),offset(.7,0),offset(1.65,0),
      offset(-.7,0),offset(0,.6),offset(0,-.6),offset(0,1.15),offset(0,-1.15),offset(.7,.7)];
    this.goal = findBodyCover(self, threat, arena, candidates);
    this.duck = false;
    if (!this.goal) {
      this.goal = findBodyCover({...self,duckAmount:1},threat,arena,candidates);
      this.duck = !!this.goal;
    }
    this.unsafe = !this.goal;
    return this.goal;
  }
}
