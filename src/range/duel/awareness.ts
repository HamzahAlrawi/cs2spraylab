import {UNIT, clamp, type Vec} from '../actor-physics';
import type {SkillLevel} from './config';
import {rayBox, traceSolid, type Arena} from './geometry';
import {copyVisibleEnemy, type BotObservation, type VisibleEnemy} from './perception';

export const proficiency = (level: SkillLevel) => level === '10+' ? 1 : (level - 1) / 10;

type CoverExpectation = {point: Vec; travel: number; initialDirection: {x: number; z: number}};
const groundDistance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const MAX_KNOWN_SPEED = 250 * UNIT;
const CORNER_MARGIN = .52;

// Small local visibility graph, not an actor query or a per-tick nav search.
function memoryPathClear(a: Vec, b: Vec, arena: Arena) {
  const radius = 16 * UNIT + .01, length = groundDistance(a, b);
  if (b.x < arena.minX + radius || b.x > arena.maxX - radius ||
    b.z < arena.minZ + radius || b.z > arena.maxZ - radius) return false;
  const direction = {x: length > 0 ? (b.x - a.x) / length : 0, y: 0,
    z: length > 0 ? (b.z - a.z) / length : 0};
  return !arena.solids.some(({center, size}) => size.y > .8 &&
    Number.isFinite(rayBox({...a, y: 0}, direction,
      {x: center.x - size.x / 2 - radius, y: -1, z: center.z - size.z / 2 - radius},
      {x: center.x + size.x / 2 + radius, y: 1, z: center.z + size.z / 2 + radius}, length)));
}

export class SightingMemory {
  seen: VisibleEnemy | null = null;
  seenAt = -Infinity;
  readonly velocity = {x: 0, z: 0};
  private wasVisible = false;
  private exits: CoverExpectation[] = [];
  private eligible: CoverExpectation[] = [];
  private focusPoint: Vec | null = null;
  private selected: CoverExpectation | null = null;
  private nextAngleAt = 0;
  private readonly skill: number;
  private readonly lifetime: number;

  constructor(level: SkillLevel, private readonly arena?: Arena) {
    this.skill = proficiency(level);
    this.lifetime = 2.4 + this.skill * 1.2;
  }

  observe(observation: BotObservation) {
    const {visible, time} = observation;
    if (visible) {
      const dt = time - this.seenAt;
      if (this.wasVisible && this.seen?.id === visible.id && dt > 0 && dt < .12) {
        const response = 1 - Math.exp(-dt / .07);
        const vx = (visible.position.x - this.seen.position.x) / dt;
        const vz = (visible.position.z - this.seen.position.z) / dt;
        const scale = Math.min(1, MAX_KNOWN_SPEED / Math.max(1e-6, Math.hypot(vx, vz)));
        this.velocity.x += (vx * scale - this.velocity.x) * response;
        this.velocity.z += (vz * scale - this.velocity.z) * response;
      } else this.velocity.x = this.velocity.z = 0;
      this.seen = copyVisibleEnemy(visible);
      this.seenAt = time;
      this.wasVisible = true;
      this.focusPoint = this.seen.aimPoint;
      this.exits = []; this.eligible = []; this.selected = null;
      return;
    }
    if (!this.seen || time - this.seenAt >= this.lifetime) {
      this.focusPoint = null; this.eligible = []; this.wasVisible = false;
      return;
    }
    if (this.wasVisible) {
      this.exits = this.coverExits();
      this.nextAngleAt = this.seenAt + .8 + this.skill * .4;
    }
    this.wasVisible = false;
    const age = time - this.seenAt;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.eligible = this.exits.filter(exit => {
      const alignment = speed > .2 ? (exit.initialDirection.x * this.velocity.x + exit.initialDirection.z * this.velocity.z) / speed : 0;
      const reversalDelay = alignment < -.25 ? .18 : 0;
      if (exit.travel > MAX_KNOWN_SPEED * Math.max(0, age - reversalDelay) + .3) return false;
      const eye = observation.self.position, point = exit.point;
      const length = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
      return !this.arena || length < .01 || !Number.isFinite(traceSolid(eye,
        {x: (point.x - eye.x) / length, y: (point.y - eye.y) / length, z: (point.z - eye.z) / length},
        this.arena, length - .02).distance);
    });
    if (!this.selected || !this.eligible.includes(this.selected)) this.selected = this.eligible[0] ?? null;
    if (time >= this.nextAngleAt && this.eligible.length > 1) {
      const index = this.selected ? this.eligible.indexOf(this.selected) : -1;
      this.selected = this.eligible[(index + 1) % this.eligible.length];
      this.nextAngleAt = time + .5 + (1 - this.skill) * .25;
    }
    // Hold the actual sighting through a brief occlusion; never extrapolate a
    // hidden pose. Later look at physical exits, not a target behind the wall.
    this.focusPoint = age < .18 ? this.seen.aimPoint : this.selected?.point ?? this.seen.aimPoint;
  }

  focus(time: number): Vec | null {
    return time - this.seenAt < this.lifetime ? this.focusPoint : null;
  }

  expectations(time: number): readonly CoverExpectation[] {
    return time - this.seenAt < this.lifetime ? this.eligible : [];
  }

  private coverExits(): CoverExpectation[] {
    if (!this.arena || !this.seen) return [];
    const arena = this.arena, origin = this.seen.position, height = this.seen.aimPoint.y;
    const nearby = arena.solids.map(solid => ({solid, gap: Math.hypot(
      Math.max(0, Math.abs(origin.x - solid.center.x) - solid.size.x / 2),
      Math.max(0, Math.abs(origin.z - solid.center.z) - solid.size.z / 2))}))
      .filter(({solid, gap}) => gap < 2.5 && solid.center.y + solid.size.y / 2 > height - .15)
      .sort((a, b) => a.gap - b.gap).slice(0, 2);
    const points = [origin, ...nearby.flatMap(({solid: {center, size}}) =>
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z]) => ({
        x: center.x + x * (size.x / 2 + CORNER_MARGIN), y: height,
        z: center.z + z * (size.z / 2 + CORNER_MARGIN),
      })))];
    const paths = points.map(() => Infinity), visited = points.map(() => false);
    const first = points.map(() => ({x: 0, z: 0}));
    paths[0] = 0;
    for (let step = 0; step < points.length; step++) {
      let at = -1;
      for (let index = 0; index < points.length; index++)
        if (!visited[index] && Number.isFinite(paths[index]) && (at < 0 || paths[index] < paths[at])) at = index;
      if (at < 0) break;
      visited[at] = true;
      for (let next = 1; next < points.length; next++) {
        if (visited[next]) continue;
        const length = groundDistance(points[at], points[next]);
        const travel = paths[at] + length;
        if (travel >= paths[next] || !memoryPathClear(points[at], points[next], arena)) continue;
        paths[next] = travel;
        first[next] = at === 0 ? {x: (points[next].x - origin.x) / Math.max(.001, length),
          z: (points[next].z - origin.z) / Math.max(.001, length)} : first[at];
      }
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const weight = (exit: CoverExpectation) => exit.travel - (speed > .2 ?
      clamp((exit.initialDirection.x * this.velocity.x + exit.initialDirection.z * this.velocity.z) / speed, -1, 1) * .6 : 0);
    return points.slice(1).map((point, index) => ({point, travel: paths[index + 1], initialDirection: first[index + 1]}))
      .filter(exit => Number.isFinite(exit.travel)).sort((a, b) => weight(a) - weight(b));
  }
}

export class AngleAwareness {
  private nextCheck = 0;
  private until = 0;
  private selected?: Vec;
  private visited = new Map<number, number>();
  constructor(private level: SkillLevel, private random: () => number) {}
  look(self: Vec, time: number, expected: Vec, candidates: readonly Vec[], arena: Arena, freshCue = false) {
    const skill = proficiency(this.level);
    const novice = Math.max(0, 1 - skill / .3);
    if (freshCue) {this.until = time; this.nextCheck = Math.max(this.nextCheck, time + .45); return expected;}
    if (time >= this.nextCheck) {
      const ranked = candidates.map((point, index) => {
        const dx = point.x - self.x, dy = point.y - self.y, dz = point.z - self.z;
        const distance = Math.hypot(dx, dy, dz);
        const clear = distance > .1 && !Number.isFinite(traceSolid(self,
          {x: dx / distance, y: dy / distance, z: dz / distance}, arena, distance - .2).distance);
        const separation = Math.hypot(point.x - expected.x, point.z - expected.z);
        return {point, index, score: distance < 2 || separation < 1 ? -Infinity :
          Math.min(60, time - (this.visited.get(index) ?? -60)) + (clear ? 4 : -4) * (1 - novice * .8) +
          this.random() * (3 + novice * 14)};
      }).sort((a, b) => b.score - a.score);
      this.selected = Number.isFinite(ranked[0]?.score) ? ranked[0].point : undefined;
      if (this.selected) this.visited.set(ranked[0].index, time);
      this.until = time + .65 - skill * .35 + this.random() * .2;
      this.nextCheck = this.until + 4.5 - skill * 3.4 + this.random() * (2 - skill);
    }
    return time < this.until && this.selected ? this.selected : expected;
  }
}
