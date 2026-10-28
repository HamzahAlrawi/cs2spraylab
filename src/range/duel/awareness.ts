import {UNIT, clamp, type Vec} from '../actor-physics';
import type {SkillLevel} from './config';
import {rayBox, traceSolid, type Arena} from './geometry';
import {copyVisibleEnemy, type BotObservation, type VisibleEnemy} from './perception';
import {pointInView} from './shadows';
import {nativeReachableAround} from './native-navigation';

export const proficiency = (level: SkillLevel) => level === '10+' ? 1 : (level - 1) / 10;

export type AttentionSource = 'sight' | 'sound' | 'shadow' | 'teammate';
export type AttentionEvidence = {source: Exclude<AttentionSource, 'sight'>; point: Vec; observedAt: number;
  readyAt?: number; uncertainty: number; confidence?: number; lifetime?: number};
export type AttentionDecision = {reason: 'sight' | 'brief-occlusion' | 'hold-exit' | 'reachable-exit' |
  'cleared-angle' | 'new-evidence' | 'last-sighting' | 'expired' | 'no-evidence';
  source: AttentionSource; confidence: number; point: Vec | null; context: 'ready' | 'low-ammo' | 'reload'};
type CoverExpectation = {point: Vec; travel: number; initialDirection: {x: number; z: number}};
type ExitHypothesis = CoverExpectation & {weight: number; confidence: number; cleared: number;
  clearedAt: number; reopenedAt: number; clearView: boolean; source: AttentionSource};
const groundDistance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const MAX_KNOWN_SPEED = 250 * UNIT;
const CORNER_MARGIN = .52;
const finitePoint = (point: Vec) => [point.x, point.y, point.z].every(Number.isFinite);
const bearingError = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const attended = ({self, view}: BotObservation, point: Vec) => {
  const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
  return pointInView(self, point, view) && bearingError(Math.atan2(-dx, -dz), self.yaw) < .09 &&
    bearingError(Math.atan2(dy, Math.hypot(dx, dz)), self.pitch) < .12;
};
function openPoint(eye: Vec, point: Vec, arena: Arena) {
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z, length = Math.hypot(dx, dy, dz);
  return length > .01 && !Number.isFinite(traceSolid(eye,
    {x: dx / length, y: dy / length, z: dz / length}, arena, length - 1e-4).distance);
}
function clearOpening(observation: BotObservation, point: Vec, arena: Arena) {
  if (!attended(observation, point) || !unobscuredOpening(observation, point)) return false;
  const eye = observation.self.position, dx = point.x - eye.x, dz = point.z - eye.z;
  const length = Math.hypot(dx, dz) || 1;
  // A center ray beside cover is not enough evidence to clear a whole opening.
  return [-.18, 0, .18].every(offset => {
    const sample = {x: point.x + dz / length * offset, y: point.y, z: point.z - dx / length * offset};
    return pointInView(observation.self, sample, observation.view) && openPoint(eye, sample, arena);
  });
}
function unobscuredOpening(observation: BotObservation, point: Vec) {
  if (!observation.visibilityFilter) return true;
  const eye = observation.self.position, dx = point.x - eye.x, dz = point.z - eye.z;
  const length = Math.hypot(dx, dz) || 1;
  return [-.18, 0, .18].every(offset => observation.visibilityFilter!(eye,
    {x: point.x + dz / length * offset, y: point.y, z: point.z - dx / length * offset}));
}
function evidenceStrength(cue: AttentionEvidence, point: Vec, time: number) {
  const age = time - cue.observedAt, lifetime = cue.lifetime ?? 2;
  if (age < 0 || age >= lifetime || time < (cue.readyAt ?? cue.observedAt)) return 0;
  const gap = groundDistance(cue.point, point), radius = Math.max(.35, cue.uncertainty);
  if (gap > Math.max(1, radius * 2)) return 0;
  return (cue.confidence ?? .65) * Math.exp(-age / lifetime - gap * gap / (2 * radius * radius));
}

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
  private exits: ExitHypothesis[] = [];
  private eligible: ExitHypothesis[] = [];
  private focusPoint: Vec | null = null;
  private selected: ExitHypothesis | null = null;
  private selectedAt = -Infinity;
  private lastObservationAt = -Infinity;
  private clearOrigin: Vec | null = null;
  private evidence: AttentionEvidence[] = [];
  private reason: AttentionDecision['reason'] = 'no-evidence';
  private context: AttentionDecision['context'] = 'ready';
  private nextGeometryAt = -Infinity;
  private nativeCoverAt = -Infinity;
  private nativeCoverOrigin?:Vec;
  private nativeCover:CoverExpectation[]=[];
  private readonly skill: number;
  private readonly lifetime: number;

  constructor(level: SkillLevel, private readonly arena?: Arena) {
    this.skill = proficiency(level);
    this.lifetime = 2.4 + this.skill * 1.2;
  }

  // Accept only already-perceived noisy cues/reports, never hidden actor snapshots.
  noteEvidence(cue: AttentionEvidence) {
    if (!finitePoint(cue.point) || !Number.isFinite(cue.observedAt) || !Number.isFinite(cue.uncertainty) ||
      cue.uncertainty < 0 || cue.readyAt !== undefined && !Number.isFinite(cue.readyAt) ||
      cue.confidence !== undefined && (!Number.isFinite(cue.confidence) || cue.confidence < 0 || cue.confidence > 1) ||
      cue.lifetime !== undefined && (!Number.isFinite(cue.lifetime) || cue.lifetime <= 0)) return;
    if (this.evidence.some(old => old.source === cue.source && old.observedAt >= cue.observedAt)) return;
    this.evidence = this.evidence.filter(old => old.source !== cue.source || old.observedAt > cue.observedAt);
    this.evidence.push({...cue, point: {...cue.point}});
    this.evidence = this.evidence.slice(-8);
  }

  observe(observation: BotObservation, evidence: readonly AttentionEvidence[] = []) {
    const {visible, time} = observation;
    if (!Number.isFinite(time) || time <= this.lastObservationAt) return;
    const elapsed = time - this.lastObservationAt;
    const dt = elapsed <= .1 ? Math.min(elapsed, .05) : 0;
    this.lastObservationAt = time;
    this.context = observation.self.reloading ? 'reload' : observation.self.ammo <= 3 ? 'low-ammo' : 'ready';
    for (const cue of evidence) this.noteEvidence(cue);
    this.evidence = this.evidence.filter(cue => time - cue.observedAt < (cue.lifetime ?? 2));
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
      this.reason = 'sight';
      this.exits = []; this.eligible = []; this.selected = null;
      this.nextGeometryAt = -Infinity;
      this.evidence = [];
      return;
    }
    if (!this.seen || time - this.seenAt >= this.lifetime) {
      this.focusPoint = null; this.eligible = []; this.wasVisible = false;
      this.selected = null;
      this.reason = this.seen ? 'expired' : 'no-evidence';
      return;
    }
    if (this.wasVisible) {
      this.exits = this.coverExits(observation).map(exit => ({...exit, weight: 0, confidence: 0,
        cleared: 0, clearedAt: -Infinity, reopenedAt: -Infinity, clearView: false, source: 'sight'}));
    }
    this.wasVisible = false;
    const age = time - this.seenAt;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (time >= this.nextGeometryAt) {
      this.nextGeometryAt = time + .12;
      this.clearOrigin = {...observation.self.position};
      this.eligible = this.exits.filter(exit => {
        const alignment = speed > .2 ? (exit.initialDirection.x * this.velocity.x + exit.initialDirection.z * this.velocity.z) / speed : 0;
        const reversalDelay = alignment < -.25 ? .18 : 0;
        if (exit.travel > MAX_KNOWN_SPEED * Math.max(0, age - reversalDelay) + .3) return false;
        const open = !this.arena || openPoint(observation.self.position, exit.point, this.arena);
        exit.clearView = !!this.arena && open && clearOpening(observation, exit.point, this.arena);
        return open;
      });
    }
    for (const exit of this.eligible) {
      if (exit.clearView && this.clearOrigin && groundDistance(this.clearOrigin, observation.self.position) < .1 &&
        Math.abs(this.clearOrigin.y - observation.self.position.y) < .1 && attended(observation, exit.point) && age >= .18 &&
        unobscuredOpening(observation, exit.point)) {
        exit.cleared += dt * (2 + this.skill * 2);
        exit.clearedAt = time;
      }
      const alignment = speed > .2 ? clamp((exit.initialDirection.x * this.velocity.x +
        exit.initialDirection.z * this.velocity.z) / speed, -1, 1) : 0;
      const prior = Math.exp(-exit.travel / (2 + age * 2) + alignment * this.skill * .8);
      let support = 0;
      exit.source = 'sight';
      for (const cue of this.evidence) {
        if (cue.observedAt < this.seenAt) continue;
        const strength = evidenceStrength(cue, exit.point, time);
        if (strength > support) {support = strength; exit.source = cue.source;}
        // A new report can reopen a cleared exit; a stale/repeated report cannot.
        if (strength > .2 && cue.observedAt > exit.clearedAt && cue.observedAt > exit.reopenedAt) {
          exit.cleared *= .25; exit.reopenedAt = cue.observedAt;
        }
      }
      exit.weight = (prior + support * (1 + this.skill)) * Math.exp(-exit.cleared * 3);
    }
    const total = this.eligible.reduce((sum, exit) => sum + exit.weight, 0);
    for (const exit of this.eligible) exit.confidence = total > 0 ? exit.weight / total : 0;
    const best = this.eligible.reduce<ExitHypothesis | null>((winner, exit) =>
      !winner || exit.weight > winner.weight ? exit : winner, null);
    const previous = this.selected;
    const invalid = !previous || !this.eligible.includes(previous);
    const committed = time - this.selectedAt >= .25 + (1 - this.skill) * .3 + (this.context === 'ready' ? 0 : .2);
    if (invalid || best && previous && committed && best.weight > previous.weight * (1.3 + (1 - this.skill) * .3) + .015) {
      this.selected = best; this.selectedAt = time;
      this.reason = previous && previous.cleared > .15 ? 'cleared-angle' : best?.source !== 'sight' && best
        ? 'new-evidence' : 'reachable-exit';
    } else this.reason = 'hold-exit';
    if (age < .18) this.reason = 'brief-occlusion';
    else if (!this.selected) this.reason = 'last-sighting';
    // Hold the actual sighting through a brief occlusion; never extrapolate a
    // hidden pose. Later look at physical exits, not a target behind the wall.
    this.focusPoint = age < .18 ? this.seen.aimPoint : this.selected?.point ?? this.seen.aimPoint;
  }

  focus(time: number): Vec | null {
    return time >= this.seenAt && time - this.seenAt < this.lifetime ? this.focusPoint : null;
  }

  anticipation(time: number) {
    const point = this.focus(time);
    if (!point || !this.seen) return null;
    const age = time - this.seenAt;
    const confidence = Math.exp(-age / 1.4) *
      (this.selected ? this.selected.confidence * Math.exp(-this.selected.cleared) : 1);
    return {point: {...point}, observedAt: this.seenAt, confidence,
      uncertainty: .15 + age * 1.6, prefireReady: age < 2 && confidence > .12};
  }

  expectations(time: number): readonly CoverExpectation[] {
    return time >= this.seenAt && time - this.seenAt < this.lifetime ? this.eligible : [];
  }

  decision(time: number): AttentionDecision {
    const point = this.focus(time), age = time - this.seenAt;
    return {reason: point ? this.reason : this.seen ? 'expired' : 'no-evidence',
      source: this.selected?.source ?? 'sight', context: this.context,
      confidence: point ? Math.exp(-Math.max(0, age) / 1.4) *
        (this.selected ? this.selected.confidence * Math.exp(-this.selected.cleared) : 1) : 0,
      point: point ? {...point} : null};
  }

  hypotheses(time: number) {
    return this.expectations(time).map(exit => {
      const hypothesis = exit as ExitHypothesis;
      return {point: {...exit.point}, travel: exit.travel, confidence: hypothesis.confidence,
        cleared: hypothesis.cleared, source: hypothesis.source, selected: exit === this.selected};
    });
  }

  private coverExits(observation:BotObservation): CoverExpectation[] {
    if (!this.arena || !this.seen) return [];
    const arena = this.arena, origin = this.seen.position, height = this.seen.aimPoint.y;
    if(arena.native) {
      if(observation.time-this.nativeCoverAt<.4 && this.nativeCoverOrigin &&
        groundDistance(origin,this.nativeCoverOrigin)<.25 && Math.abs(origin.y-this.nativeCoverOrigin.y)<.25)return this.nativeCover;
      this.nativeCoverAt=observation.time;this.nativeCoverOrigin={...origin};
      const support=arena.native.vertical(origin,origin.y+.08,origin.y-74*UNIT,72*UNIT);
      const eyeHeight=support.grounded?clamp(height-support.feet,36*UNIT,64*UNIT):64*UNIT;
      const paths=nativeReachableAround(origin,arena,MAX_KNOWN_SPEED*this.lifetime);
      const sectors=new Set<string>(),choices:CoverExpectation[]=[];
      let rays=0;
      for(const path of paths) {
        if(path.travel<.35)continue;
        const point={...path.point,y:path.point.y+eyeHeight};
        const bearing=Math.atan2(point.x-observation.self.position.x,point.z-observation.self.position.z);
        const key=`${Math.floor(bearing/.065)}:${Math.floor(path.travel/3)}`;
        if(sectors.has(key))continue;sectors.add(key);
        if(++rays>48)break;
        if(!openPoint(observation.self.position,point,arena))continue;
        if(choices.some(exit=>groundDistance(exit.point,point)<.9))continue;
        choices.push({...path,point});
        if(choices.length===16)break;
      }
      this.nativeCover=choices;return choices;
    }
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

export type AngleCue = {source: 'sound' | 'shadow'; point: Vec; observedAt: number; readyAt: number;
  uncertainty: number; lifetime: number};

// Rank physical openings near a noisy cue. Cache the geometry work at 5 Hz;
// deadlines and evidence expiry are still checked on every motor tick.
export class CueAngleChecks {
  private cue: AngleCue | null = null;
  private ranked: Vec[] = [];
  private nextRankAt = -Infinity;
  private rankOrigin: Vec | null = null;
  private selected: Vec | null = null;
  private selectedAt = -Infinity;
  private cleared: {point: Vec; time: number; radius: number}[] = [];
  private emptyObservedAt = -Infinity;
  private emptyGeometryAt = -Infinity;
  private emptyOrigin: Vec | null = null;
  private emptyPoint: Vec | null = null;
  private emptyClear = false;
  private emptyDwell = 0;
  private lastDecision: {reason: 'hold-cue' | 'new-evidence' | 'cleared-angle' | 'expired';
    source: AngleCue['source']; confidence: number} | null = null;
  constructor(private readonly level: SkillLevel) {}

  observe(cue: AngleCue) {
    if (!Number.isFinite(cue.observedAt) || cue.observedAt < (this.cue?.observedAt ?? -Infinity) ||
      !finitePoint(cue.point) || !Number.isFinite(cue.readyAt) || !Number.isFinite(cue.uncertainty) ||
      cue.uncertainty < 0 || !Number.isFinite(cue.lifetime) || cue.lifetime <= 0) return;
    this.cue = {...cue, point: {...cue.point}};
    // Repeated steps/shadow frames must not force a geometry rebuild each tick.
  }

  // Caller must supply a sensor-verified empty opening, not a hidden target location.
  clearAngle(point: Vec, observedAt: number, radius = .6) {
    if (!finitePoint(point) || !Number.isFinite(observedAt) || !Number.isFinite(radius) || radius <= 0) return;
    this.cleared.push({point: {...point}, time: observedAt, radius});
    this.cleared = this.cleared.slice(-16);
  }

  decision() {return this.lastDecision ? {...this.lastDecision} : null;}

  observeEmpty(observation: BotObservation, arena: Arena) {
    const {time} = observation, point = this.selected, cue = this.cue;
    if (!Number.isFinite(time) || time <= this.emptyObservedAt) return;
    const dt = time - this.emptyObservedAt; this.emptyObservedAt = time;
    if (!cue || time < cue.observedAt || time < cue.readyAt || time - cue.observedAt >= cue.lifetime ||
      observation.visible || !point || !attended(observation, point) || dt > .1) {this.emptyDwell = 0; return;}
    if (time >= this.emptyGeometryAt || !this.emptyPoint || groundDistance(point, this.emptyPoint) > .1) {
      if (!this.emptyPoint || groundDistance(point, this.emptyPoint) > .1) this.emptyDwell = 0;
      this.emptyGeometryAt = time + .2; this.emptyOrigin = {...observation.self.position}; this.emptyPoint = {...point};
      this.emptyClear = clearOpening(observation, point, arena);
    }
    if (!this.emptyClear || !this.emptyOrigin || groundDistance(this.emptyOrigin, observation.self.position) > .1 ||
      Math.abs(this.emptyOrigin.y - observation.self.position.y) > .1) {this.emptyDwell = 0; return;}
    this.emptyDwell += Math.min(dt, .05);
    if (this.emptyDwell >= .18 + (1 - proficiency(this.level)) * .2) {
      this.clearAngle(point, time); this.emptyDwell = 0;
    }
  }

  focus(self: Vec, time: number, candidates: readonly Vec[], arena: Arena): Vec | null {
    const cue = this.cue;
    if (!cue || time < cue.observedAt || time < cue.readyAt || time - cue.observedAt >= cue.lifetime) {
      if (cue) this.lastDecision = {reason: 'expired', source: cue.source, confidence: 0};
      return null;
    }
    if (time >= this.nextRankAt || !this.rankOrigin || groundDistance(self, this.rankOrigin) > 1) {
      this.nextRankAt = time + .2; this.rankOrigin = {...self};
      this.ranked = candidates.map(point => {
        const dx = point.x - self.x, dy = point.y - self.y, dz = point.z - self.z;
        const length = Math.hypot(dx, dy, dz), gap = groundDistance(point, cue.point);
        const clear = length > .1 && !Number.isFinite(traceSolid(self,
          {x: dx / length, y: dy / length, z: dz / length}, arena, length - .02).distance);
        return {point, score: clear && gap <= Math.max(3, cue.uncertainty * 2 + 1)
          ? gap + length * .025 : Infinity};
      }).filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score).slice(0, 3)
        .map(item => ({...item.point}));
    }
    const weight = (point: Vec) => {
      const negative = this.cleared.some(clear => clear.time <= time && clear.time >= cue.observedAt &&
        groundDistance(clear.point, point) <= clear.radius);
      const gap = groundDistance(point, cue.point), range = groundDistance(point, self);
      return Math.exp(-(gap + range * .025) / Math.max(1, cue.uncertainty)) * (negative ? .05 : 1);
    };
    const best = this.ranked.reduce<Vec | null>((winner, point) => !winner || weight(point) > weight(winner) ? point : winner, null);
    if (!best) {this.selected = null; this.lastDecision = {reason: 'expired', source: cue.source, confidence: 0}; return null;}
    const current = this.ranked.find(point => this.selected && groundDistance(point, this.selected) < .05);
    const previousCleared = !!current && this.cleared.some(clear => clear.time <= time && clear.time >= cue.observedAt &&
      groundDistance(clear.point, current) <= clear.radius);
    if (!current || time - this.selectedAt >= .25 + (1 - proficiency(this.level)) * .3 && weight(best) > weight(current) * 1.3) {
      this.selected = best; this.selectedAt = time;
      this.lastDecision = {reason: previousCleared ? 'cleared-angle' : 'new-evidence', source: cue.source, confidence: weight(best)};
    } else this.lastDecision = {reason: 'hold-cue', source: cue.source, confidence: weight(current)};
    return this.selected ? {...this.selected} : null;
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
    const inSector = (point: Vec) => {
      const ax = expected.x - self.x, az = expected.z - self.z, bx = point.x - self.x, bz = point.z - self.z;
      const length = Math.hypot(ax, az) * Math.hypot(bx, bz);
      return length > .01 && (ax * bx + az * bz) / length >= Math.cos((60 + (1 - skill) * 25) * Math.PI / 180);
    };
    if (freshCue) {this.until = time; this.nextCheck = Math.max(this.nextCheck, time + .45); return expected;}
    if (time >= this.nextCheck) {
      const ranked = candidates.map((point, index) => {
        const dx = point.x - self.x, dy = point.y - self.y, dz = point.z - self.z;
        const distance = Math.hypot(dx, dy, dz);
        const clear = distance > .1 && !Number.isFinite(traceSolid(self,
          {x: dx / distance, y: dy / distance, z: dz / distance}, arena, distance - .2).distance);
        const separation = Math.hypot(point.x - expected.x, point.z - expected.z);
        return {point, index, score: distance < 2 || separation < 1 || !inSector(point) || skill >= .5 && !clear ? -Infinity :
          Math.min(60, time - (this.visited.get(index) ?? -60)) + (clear ? 4 : -4) * (1 - novice * .8) +
          this.random() * (3 + novice * 14)};
      }).sort((a, b) => b.score - a.score);
      this.selected = Number.isFinite(ranked[0]?.score) ? ranked[0].point : undefined;
      if (this.selected) this.visited.set(ranked[0].index, time);
      this.until = time + .65 - skill * .35 + this.random() * .2;
      this.nextCheck = this.until + 4.5 - skill * 3.4 + this.random() * (2 - skill);
    }
    return time < this.until && this.selected && inSector(this.selected) ? this.selected : expected;
  }
}
