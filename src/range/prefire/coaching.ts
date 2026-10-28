import {DEG} from '../actor-physics';
import {movementInaccuracy} from '../ballistics';
import {gameData} from '../config';
import {aimError} from '../drills';
import type {Equipment} from '../equipment';
import {accuracySpeedUnits} from '../shot-model';
import {DuelCoach, type DuelReview, type ShotAccuracyState} from '../duel/coaching';
import type {VisibleEnemy} from '../duel/perception';
import type {DuelActorSnapshot, DuelEvent} from '../duel/types';
import type {CoachingSummary} from '../coaching-types';

export type PrefireAngleReview = {
  id: number; name: string; cleared: boolean; shots: number;
  openingStopped: boolean | null; readyAim: boolean | null; entry: boolean | null;
  openingHit: boolean | null; openingHead: boolean | null; threats: number;
  contactToHitMs: number | null; message: string; tip: string;
  aimGap?: number;
};
export type PrefireReview = DuelReview & {
  angles: PrefireAngleReview[]; openingStopped: number | null; readyAim: number | null;
  cleanEntries: number | null; openingHits: number | null; isolation: number | null;
  completed: number; total: number; goalMet: boolean;
  feedback?: {angle: string; message: string; tip: string; until: number};
};
type Encounter = PrefireAngleReview & {seenAt: number; openingId?: number; high?: boolean; low?: boolean};
type Shot = {at: number; stopped: boolean; entry: boolean; threats: number; target?: number};
const bodyAim = (weapon: Equipment) => ['awp', 'g3sg1', 'scar20', 'nova', 'xm1014', 'mag7', 'sawedoff', 'zeus'].includes(weapon);
const rate = (values: boolean[]): number | null => values.length ? values.filter(Boolean).length / values.length * 100 : null;

// Coach estimates are separate from bullet physics. Only sensed, exposed points
// are used; target coordinates behind cover never become aiming hints.
export class PrefireCoach extends DuelCoach {
  private encounters = new Map<number, Encounter>();
  private visible = new Map<number, VisibleEnemy>();
  private shotsById = new Map<number, Shot>();
  private lastMoveAt = -Infinity;
  private clock = 0;
  private soloTime = 0;
  private visibleTime = 0;
  private lastObserve?: number;
  private feedback?: PrefireReview['feedback'];

  constructor(private readonly names: readonly string[]) {super();}

  private encounter(id: number, time: number) {
    let row = this.encounters.get(id);
    if (!row) {
      row = {id, name: this.names[id - 1] ?? `Angle ${id}`, seenAt: time, cleared: false, shots: 0,
        openingStopped: null, readyAim: null, entry: null, openingHit: null, openingHead: null,
        threats: 0, contactToHitMs: null, message: 'Angle encountered', tip: ''};
      this.encounters.set(id, row);
    }
    return row;
  }

  override observe(time: number, self: DuelActorSnapshot, enemies: VisibleEnemy[], readiness?: Parameters<DuelCoach['observe']>[3]) {
    super.observe(time, self, enemies, readiness);
    this.clock = time;
    const elapsed = this.lastObserve === undefined ? 0 : Math.min(.05, Math.max(0, time - this.lastObserve));
    this.lastObserve = time;
    const previousVisible = new Set(this.visible.keys());
    this.visible.clear();
    if (enemies.length) {this.visibleTime += elapsed; if (enemies.length === 1) this.soloTime += elapsed;}
    if (accuracySpeedUnits(self.velocity) > 20) this.lastMoveAt = time;
    for (const enemy of enemies) {
      this.visible.set(enemy.id, enemy);
      const row = this.encounter(enemy.id, time);
      if (!previousVisible.has(enemy.id) && row.contactToHitMs === null) row.seenAt = time;
      const point = bodyAim(self.equipment) ? enemy.bodyPoint ?? enemy.aimPoint : enemy.headPoint;
      if (row.readyAim !== null || !point) continue;
      const distance = Math.hypot(point.x - self.position.x, point.y - self.position.y, point.z - self.position.z);
      // A small, distance-aware allowance includes micro-corrections and crouch
      // transitions. This is a coaching target, not a widened hitbox.
      const tolerance = Math.max(1, Math.atan2(.27, distance) / DEG);
      const horizontal = Math.hypot(point.x - self.position.x, point.z - self.position.z);
      const verticalTolerance = Math.max(.1 * DEG, Math.atan2(bodyAim(self.equipment) ? .35 : .2025, horizontal));
      const targetPitch = Math.atan2(point.y - self.position.y, horizontal);
      const targetYaw = Math.atan2(-(point.x - self.position.x), -(point.z - self.position.z));
      const yawError = Math.abs(Math.atan2(Math.sin(self.yaw - targetYaw), Math.cos(self.yaw - targetYaw)));
      // The forgiving horizontal adjustment budget must not label chest-level
      // rifle aim as good head-height placement at distant angles.
      row.readyAim = yawError <= tolerance * DEG && Math.abs(self.pitch - targetPitch) <= verticalTolerance;
      row.aimGap = aimError(self.position, self.yaw, self.pitch, point);
      row.low = self.pitch < targetPitch - verticalTolerance;
      row.high = self.pitch > targetPitch + verticalTolerance;
    }
  }

  override shot(self: DuelActorSnapshot, shotId?: number, time = this.clock, accuracyState?: ShotAccuracyState) {
    super.shot(self, shotId, time, accuracyState);
    if (self.equipment === 'knife' || shotId === undefined) return;
    this.clock = time;
    const speed = accuracySpeedUnits(self.velocity), stats = accuracyState?.stats ?? gameData.weapons[self.equipment];
    const shot: Shot = {at: this.clock, stopped: (self.grounded ?? self.feet === 0) && movementInaccuracy(stats, speed / (stats.speed ?? 1), accuracyState?.walking, speed) === 0,
      entry: this.clock - this.lastMoveAt <= .75, threats: this.visible.size};
    const targetPoint = (enemy: VisibleEnemy) => bodyAim(self.equipment) ? enemy.bodyPoint ?? enemy.aimPoint : enemy.aimPoint;
    const nearest = [...this.visible.values()].sort((a, b) =>
      aimError(self.position, self.yaw, self.pitch, targetPoint(a)) - aimError(self.position, self.yaw, self.pitch, targetPoint(b)))[0];
    if (nearest) {shot.target = nearest.id; this.attachOpening(this.encounter(nearest.id, this.clock), shotId, shot);}
    this.shotsById.set(shotId, shot);
  }

  private attachOpening(row: Encounter, id: number, shot: Shot) {
    row.shots++;
    if (row.openingId !== undefined) return;
    row.openingId = id; row.openingStopped = shot.stopped; row.entry = shot.entry;
    row.openingHit = false; row.openingHead = false; row.threats = shot.threats;
  }

  override hit(event: Extract<DuelEvent, {kind: 'hit'}>, time: number, melee = false, self?: Pick<DuelActorSnapshot, 'reloading'>) {
    super.hit(event, time, melee, self);
    this.clock = time;
    if (event.shooter !== 0 || melee) return;
    const shot = this.shotsById.get(event.shotId);
    const row = this.encounter(event.victim, shot?.at ?? time);
    if (event.utility) {
      if (event.lethal) {
        row.cleared = true;
        this.feedback = {angle: row.name, message: 'Utility clear',
          tip: 'Use the space your grenade created. Pre-aim the next angle and stop before the first shot.', until: time + 3};
      }
      return;
    }
    // A legitimate prefire may hit before the next 32-Hz sight sample. Register
    // the actual impact without inventing pre-aim measurements through cover.
    if (shot && shot.target !== event.victim) this.attachOpening(row, event.shotId, shot);
    if (row.openingId === event.shotId) {row.openingHit = true; row.openingHead ||= event.group === 'head';}
    row.contactToHitMs ??= Math.max(0, time - row.seenAt) * 1000;
    if (event.lethal) {
      row.cleared = true;
      const advice = this.advice(row);
      Object.assign(row, advice);
      this.feedback = {angle: row.name, ...advice, until: time + 3};
    }
  }

  private advice(row: Encounter): {message: string; tip: string} {
    if (row.openingStopped === null) return {message: 'No opening shot yet', tip: 'Pre-aim the next angle from cover, then counter-strafe before firing.'};
    if (row.openingStopped === false) return {message: 'Stop before the opening shot',
      tip: 'Counter-strafe before firing on the next peek; land first if you were airborne.'};
    if (row.threats > 1) return {message: 'Multiple enemies visible on the opening shot',
      tip: 'Slice the pie: use cover to isolate a 1v1 before clearing the next angle.'};
    if (row.low) return {message: 'Crosshair placement was low',
      tip: "Raise your pre-aim to the target's height before peeking; use boxes or doorframes as references for elevation and crouched holds."};
    if (row.high) return {message: 'Crosshair placement was high',
      tip: "Lower your pre-aim to the target's height before peeking; account for lower ground or a crouched hold."};
    if (row.readyAim === false) return {message: 'Pre-aim missed the revealed position',
      tip: 'Pre-aim the likely hold before exposing yourself. Make a mouse correction if the enemy plays an off-angle.'};
    if (row.entry === false) return {message: 'Stopped shot; now practice the entry',
      tip: 'A stationary shot is valid, but this entry drill needs a peek from cover: pre-aim, strafe out, counter-strafe, fire.'};
    if (row.openingHit === false) return {message: 'Stopped opening shot missed',
      tip: 'Next rep, confirm the crosshair is on target before firing. A single miss can still be weapon spread.'};
    return {message: 'Clean opening', tip: 'Repeat that pre-aim and stop timing on the next angle.'};
  }

  override review(): PrefireReview {
    const base = super.review(), rows = [...this.encounters.values()];
    const openings = rows.filter(row => row.openingStopped !== null);
    const openingStopped = rate(openings.map(row => row.openingStopped!));
    const readyAim = rate(rows.filter(row => row.readyAim !== null).map(row => row.readyAim!));
    const cleanEntries = rate(openings.map(row => !!row.openingStopped && !!row.entry && row.readyAim !== false && row.threats <= 1));
    const openingHits = rate(openings.map(row => !!row.openingHit));
    const isolation = this.visibleTime ? this.soloTime / this.visibleTime * 100 : null;
    const completed = rows.filter(row => row.cleared).length;
    const components = [{value: completed / Math.max(1, this.names.length) * 100, weight: 20}, {value: openingStopped, weight: 25},
      {value: readyAim, weight: 20}, {value: cleanEntries, weight: 15}, {value: isolation, weight: 10}, {value: Math.min(100, base.accuracy * 2), weight: 10}];
    const available = components.filter((c): c is {value: number; weight: number} => c.value !== null);
    const score = this.shots ? Math.round(available.reduce((n, c) => n + c.value * c.weight, 0) / available.reduce((n, c) => n + c.weight, 0)) : null;
    const goalMet = completed === this.names.length && openings.length >= Math.min(3, this.names.length) &&
      (openingStopped ?? 0) >= 90 && (readyAim ?? 0) >= 70 && (cleanEntries ?? 0) >= 70 && (isolation ?? 0) >= 80 && base.accuracy >= 35;
    let message = 'Pre-aim, peek, counter-strafe, fire', tip = 'Start from cover and pre-aim the next likely hold before peeking.';
    const moving = openings.filter(row => row.openingStopped === false).length;
    const broad = openings.filter(row => row.threats > 1).length;
    if (moving) {message = 'Stop before the opening shot'; tip = moving > 1
      ? 'Repeat the route at a controlled pace: counter-strafe before firing on each peek, and land first if airborne.'
      : this.advice(openings.find(row => row.openingStopped === false)!).tip;}
    else if (broad || this.multipleAnglesSeconds > 1) {message = 'Isolate a 1v1'; tip = 'Slice the pie from cover so the second enemy stays blocked while you clear the first.';}
    else if (readyAim !== null && readyAim < 70) {message = 'Pre-aim before exposing yourself'; tip = 'Use the angle review to fix crosshair placement before peeking. Correct to an off-angle normally with your mouse.';}
    else if (openings.length && cleanEntries !== null && cleanEntries < 70) {message = 'Practice the peek, not just the shot'; tip = 'A stationary shot is valid, but this entry drill needs a peek from cover: pre-aim, strafe out, counter-strafe, fire.';}
    else if (goalMet) {message = 'Clean route'; tip = 'Repeat with random occupancy or return fire, changing one setting at a time.';}
    else if (this.shots && base.accuracy < 25) {message = 'Low hit rate across the run'; tip = 'Next run, confirm your crosshair is on target before firing; at longer range, try a controlled burst and reset if it misses.';}
    else if (completed) {message = 'Good peek-and-stop timing'; tip = 'Repeat the route with the same pre-aim and stop timing before adding speed.';}
    const prepared = rows.filter(row => row.readyAim !== null), ready = prepared.filter(row => row.readyAim).length;
    const firstIssue = moving ? openings.find(row => row.openingStopped === false) : broad ? openings.find(row => row.threats > 1)
      : prepared.find(row => row.readyAim === false) ?? openings.find(row => !row.entry);
    const evidence = moving ? `${moving}/${openings.length} openings had movement or air inaccuracy${firstIssue ? `; start with ${firstIssue.name}` : ''}.`
      : broad || this.multipleAnglesSeconds > 1 ? `${broad}/${openings.length} openings exposed multiple enemies; ${this.multipleAnglesSeconds.toFixed(1)} s with multiple visible enemies.`
      : readyAim !== null && readyAim < 70 ? `${ready}/${prepared.length} positions pre-aimed on first sight${firstIssue ? `; review ${firstIssue.name}${firstIssue.aimGap === undefined ? '' : ` (${firstIssue.aimGap.toFixed(1)} deg aim gap)`}` : ''}.`
      : `${completed}/${this.names.length} angles cleared; ${openings.filter(row => row.openingStopped).length}/${openings.length} settled openings; ${ready}/${prepared.length} prepared aiming points; ${this.hits}/${this.shots} hits.`;
    const coaching: CoachingSummary = {score, focus: message, evidence, action: tip,
      goal: moving ? 'Next run: counter-strafe before firing on each peek, without chasing the route timer.'
        : broad || this.multipleAnglesSeconds > 1 ? 'Next rep: use cover to isolate a 1v1 before taking the shot.'
        : readyAim !== null && readyAim < 70 ? 'Next rep: pre-aim the likely hold before peeking, then correct to the actual enemy.'
        : goalMet ? 'Repeat the same opening-shot quality before increasing difficulty.'
        : 'Next run: repeat the pre-aim, peek and stop sequence from cover.',
      strength: openingStopped !== null && openingStopped >= 90 ? 'Most opening shots avoided movement inaccuracy while grounded; keep that timing.' : undefined,
      confidence: `${openings.length} opening shots; ${prepared.length} exposed aim samples. Local training criteria, not a professional benchmark. Hidden heads are not graded.`,
      metrics: [
        {label: 'Route completion', value: `${completed}/${this.names.length}`, score: components[0].value, detail: '20% weight. Actual gun-cleared angles; does not reward speed.'},
        {label: 'Settled openings', value: openingStopped === null ? '--' : `${Math.round(openingStopped)}%`, score: openingStopped, detail: '25% weight. Actual native movement-inaccuracy eligibility and ground contact on the first shot.'},
        {label: 'Prepared aim', value: readyAim === null ? '--' : `${Math.round(readyAim)}%`, score: readyAim, detail: '20% weight. Exposed head preparation, or upper body for body-focused weapons, on first sight.'},
        {label: 'Clean entries', value: cleanEntries === null ? '--' : `${Math.round(cleanEntries)}%`, score: cleanEntries, detail: '15% weight. Recent entry movement, settled opening, prepared aim when measurable, at most one visible threat.'},
        {label: 'Angle isolation', value: isolation === null ? '--' : `${Math.round(isolation)}%`, score: isolation, detail: '10% weight. Single-threat share of visible-contact time. Hidden enemies are not counted.'},
        {label: 'Shot efficiency', value: `${this.hits}/${this.shots}`, score: Math.min(100, base.accuracy * 2), detail: '10% weight. Full local credit at 50% hit rate; random misses do not erase good preparation.'},
      ]};
    return {...base, score, message, tip, coaching, openingStopped, readyAim, cleanEntries, openingHits, isolation,
      completed, total: this.names.length, goalMet, angles: rows.map(row => ({...row, ...this.advice(row)})),
      feedback: this.feedback && this.clock <= this.feedback.until ? this.feedback : undefined};
  }
}
