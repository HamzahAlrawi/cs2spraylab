import {DEG, UNIT, type Vec} from '../actor-physics';
import {aimError} from '../drills';
import {equipmentNames, equipmentStats, isShotgun, type Equipment} from '../equipment';
import type {ActorCommand, DuelActorSnapshot, DuelEvent} from './types';
import type {VisibleEnemy} from './perception';
import {movementInaccuracy, type AccuracyParameters} from '../ballistics';
import {accuracySpeedUnits} from '../shot-model';
import {readCoachingSummary, type CoachingSummary, type SkillMetric} from '../coaching-types';
import {fightDebrief, median, readDuelDebrief, type DamageEvidence, type DuelDebrief, type FightTrace, type ShotEvidence} from './fight-feedback';
import type {ShotState} from '../shot-state';
import {eyeAngleChange, measureAim, readAimMetrics, type AimEncounter, type AimMetrics} from './aim-metrics';

export type ShotAccuracyState = {stats: AccuracyParameters; walking: boolean; aimDirection?: Vec; shotState?: ShotState};

export type DuelReview = {
  shots: number; hits: number; heads: number; kills: number; damage: number; taken: number;
  movingShots: number; airShots: number; accuracy: number; settled: number; headRate: number;
  score: number | null; meanSpeed: number; placement: number | null; timeToDamage: number | null;
  exposedSeconds: number; multipleAnglesSeconds: number; message: string; tip: string;
  coaching?: CoachingSummary;
  debrief?: DuelDebrief;
  aim?: AimMetrics;
};

type PreparedAim = {ready: boolean; low: boolean};
type DuelContact = {
  lastSeen: number; started: number; head?: PreparedAim; body?: PreparedAim; fight?: FightTrace; aim: AimEncounter;
  opening?: number; prepared?: PreparedAim; freshPreparation: boolean;
};
type DuelShot = {
  id: number; at: number; equipment: Equipment; cycle: number; range: number | null;
  visible: number[]; target?: number;
  appropriate: boolean; moving: boolean; airborne: boolean; entered: boolean;
  closeMoving: boolean; hit: boolean; hiddenHit: boolean;
  evidence?: ShotEvidence; fight?: FightTrace; fightHit?: boolean; fightHead?: boolean;
  speed: number; maxSpeed: number; duck: number; head?: boolean; aim?: AimEncounter; yaw: number; pitch: number;
};
const rifle = (weapon: Equipment) => ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug'].includes(weapon);
const sniper = (weapon: Equipment) => ['awp', 'ssg08', 'g3sg1', 'scar20'].includes(weapon);
const bodyWeapon = (weapon: Equipment) => sniper(weapon) || isShotgun(weapon) || weapon === 'zeus';
const mobileWeapon = (weapon: Equipment) => ['mp9', 'mp7', 'mp5sd', 'mac10', 'ump45', 'p90', 'bizon',
  'usp', 'glock', 'hkp2000', 'p250', 'fiveseven', 'tec9', 'elite', 'cz75a'].includes(weapon) || isShotgun(weapon);
const percent = (good: number, total: number) => total ? good / total * 100 : null;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const countValue = (good: number, total: number) => `${good}/${total}${total ? ` (${Math.round(good / total * 100)}%)` : ''}`;

function preparedAim(self: DuelActorSnapshot, point: Vec, body: boolean): PreparedAim {
  const horizontal = Math.hypot(point.x - self.position.x, point.z - self.position.z);
  const yaw = Math.atan2(-(point.x - self.position.x), -(point.z - self.position.z));
  const pitch = Math.atan2(point.y - self.position.y, horizontal);
  const yawError = Math.abs(Math.atan2(Math.sin(self.yaw - yaw), Math.cos(self.yaw - yaw)));
  // This allowance grades preparation, not hitboxes: a micro-correction is OK.
  // Vertical head-height tolerance shrinks with distance instead of using 4 deg.
  const yawBudget = Math.max(.75 * DEG, Math.atan2(body ? .4 : .27, horizontal));
  const pitchBudget = Math.max(.1 * DEG, Math.atan2(body ? .35 : .2025, horizontal));
  return {ready: yawError <= yawBudget && Math.abs(self.pitch - pitch) <= pitchBudget,
    low: self.pitch < pitch - pitchBudget};
}

export class DuelCoach {
  shots = 0; hits = 0; heads = 0; kills = 0; damage = 0; taken = 0;
  movingShots = 0; airShots = 0; speedTotal = 0; exposedSeconds = 0; multipleAnglesSeconds = 0;
  private spotted = new Map<number, number>();
  private damaged = new Set<number>();
  private placements: number[] = [];
  private times: number[] = [];
  private unsettledShots = 0;
  private hitShots = new Set<number>();
  private headShots = new Set<number>();
  private duelContacts = new Map<number, DuelContact>();
  private currentSight: VisibleEnemy[] = [];
  private duelShots = new Map<number, DuelShot>();
  private openingContacts: DuelContact[] = [];
  private duelClock = 0;
  private observedAt?: number;
  private movedAt = -Infinity;
  private nextShotId = 1;
  private cachedCoaching?: CoachingSummary;
  private cachedDebrief?: DuelDebrief;
  private fights: FightTrace[] = [];
  private received: DamageEvidence[] = [];
  private oppositeAt = -Infinity;
  private preparationBlockedUntil = -Infinity;
  private aimEncounters: AimEncounter[] = [];
  private cachedAim?: AimMetrics;
  private lastAimInputAt = -Infinity;
  observe(time: number, self: DuelActorSnapshot, visible: VisibleEnemy[], readiness?: {weaponReady: boolean; triggerHeld: boolean}) {
    this.duelClock = time;
    const elapsed = this.observedAt === undefined ? 0 : Math.max(0, Math.min(.05, time - this.observedAt));
    this.observedAt = time;
    this.currentSight = visible;
    if (accuracySpeedUnits(self.velocity) > 20) this.movedAt = time;
    if (visible.length) this.exposedSeconds += elapsed;
    if (visible.length > 1) this.multipleAnglesSeconds += elapsed;
    for (const enemy of visible) {
      let contact = this.duelContacts.get(enemy.id);
      if (!contact || time - contact.lastSeen > .55) {
        const aim: AimEncounter = {at: time, yaw: self.yaw, pitch: self.pitch,
          reactionEligible: (readiness?.weaponReady ?? (!self.reloading && self.ammo > 0 && self.equipment !== 'knife')) &&
            !readiness?.triggerHeld && time - this.lastAimInputAt >= .1};
        this.aimEncounters.push(aim); this.cachedAim = undefined;
        contact = {lastSeen: time, started: time, freshPreparation: time > this.preparationBlockedUntil, aim};
        this.duelContacts.set(enemy.id, contact);
      }
      contact.lastSeen = time;
      if (contact.opening !== undefined || !contact.freshPreparation) continue;
      if (enemy.headPoint && !contact.head) contact.head = preparedAim(self, enemy.headPoint, false);
      const body = enemy.bodyPoint ?? (!enemy.headPoint ? enemy.aimPoint : undefined);
      if (body && !contact.body) contact.body = preparedAim(self, body, true);
    }
    for (const enemy of visible) if (!this.spotted.has(enemy.id)) {
      this.spotted.set(enemy.id, time);
      this.placements.push(aimError(self.position, self.yaw, self.pitch, enemy.aimPoint));
    }
    for (const id of this.spotted.keys()) if (!visible.some(enemy => enemy.id === id) && !this.damaged.has(id)) this.spotted.delete(id);
  }
  movement(time: number, self: DuelActorSnapshot, command: ActorCommand) {
    const speed = accuracySpeedUnits(self.velocity);
    if (speed > 20) this.movedAt = time;
    const x = command.side * Math.cos(self.yaw) - command.forward * Math.sin(self.yaw);
    const z = -command.side * Math.sin(self.yaw) - command.forward * Math.cos(self.yaw);
    const length = Math.hypot(x, z), velocity = Math.hypot(self.velocity.x, self.velocity.z);
    if ((self.grounded ?? self.feet === 0) && speed > 40 && length &&
      (x * self.velocity.x + z * self.velocity.z) / (length * velocity) < -.5) this.oppositeAt = time;
    const lookInput = Math.hypot(command.yawDelta, command.pitchDelta) > .03 * DEG;
    if (command.firePressed || lookInput) {
      const fresh = this.observedAt !== undefined && time >= this.observedAt && time - this.observedAt <= .1 + 1e-8;
      let respondingTo: VisibleEnemy | undefined, gap = Infinity;
      if (fresh) for (const enemy of this.currentSight) {
        const error = aimError(self.position, self.yaw, self.pitch, enemy.aimPoint);
        if (error < gap) {gap = error; respondingTo = enemy;}
      }
      if (respondingTo) {
        const enemy = respondingTo;
        const encounter = this.duelContacts.get(enemy.id)?.aim;
        if (encounter && encounter.responseAt === undefined && time >= encounter.at) {
          const before = aimError(self.position, self.yaw - command.yawDelta, self.pitch - command.pitchDelta, enemy.aimPoint);
          if (command.firePressed && gap <= 12 || lookInput && gap < before) {
            encounter.responseAt = time; this.cachedAim = undefined;
          }
        }
      }
      if (lookInput) this.lastAimInputAt = time;
    }
  }
  shotTarget(shotId: number) {return this.duelShots.get(shotId)?.target;}
  shotEvidence(shotId: number, evidence: ShotEvidence) {
    const shot = this.duelShots.get(shotId);
    if (!shot) return;
    shot.evidence = evidence;
    this.cachedCoaching = undefined; this.cachedDebrief = undefined;
  }
  shot(self: DuelActorSnapshot, shotId?: number, time = this.duelClock, accuracyState?: ShotAccuracyState) {
    if (self.equipment === 'knife') return;
    const id = shotId ?? this.nextShotId++;
    if (this.duelShots.has(id)) return;
    this.cachedCoaching = undefined;
    this.cachedDebrief = undefined;
    this.cachedAim = undefined;
    this.nextShotId = Math.max(this.nextShotId, id + 1);
    this.shots++;
    const speed = Math.hypot(self.velocity.x, self.velocity.z) / UNIT;
    this.speedTotal += speed;
    const stats = accuracyState?.stats ?? equipmentStats(self.equipment), speedUnits = accuracySpeedUnits(self.velocity);
    // A new target appearing during a spray is not a fresh head-height setup:
    // pulling down to compensate is legitimate. Conservatively omit fresh
    // preparation inside the native recovery time window.
    this.preparationBlockedUntil = time + Math.max(stats.cycle, stats.recovery, stats.recoveryFinal ?? 0);
    const movementPenalty = accuracyState?.shotState?.movementInaccuracy ?? movementInaccuracy(stats, speedUnits / (stats.speed ?? 1), accuracyState?.walking, speedUnits);
    const moving = movementPenalty > 0;
    const airborne = !(accuracyState?.shotState?.grounded ?? self.grounded ?? self.feet === 0);
    this.movingShots += +moving;
    this.airShots += +airborne;
    this.unsettledShots += +(moving || airborne);
    const sight = this.observedAt !== undefined && time >= this.observedAt && time - this.observedAt <= .1 + 1e-8 ? this.currentSight : [];
    let nearest: VisibleEnemy | undefined, gap = Infinity;
    const aim = accuracyState?.aimDirection;
    const aimYaw = aim ? Math.atan2(-aim.x, -aim.z) : self.yaw;
    const aimPitch = aim ? Math.asin(Math.max(-1, Math.min(1, aim.y))) : self.pitch;
    for (const enemy of sight) {
      const point = bodyWeapon(self.equipment) ? enemy.bodyPoint ?? enemy.aimPoint : enemy.aimPoint;
      const error = aimError(self.position, aimYaw, aimPitch, point);
      if (error < gap) {gap = error; nearest = enemy;}
    }
    const range = nearest ? Math.hypot(nearest.position.x - self.position.x, nearest.position.y - self.position.y,
      nearest.position.z - self.position.z) : null;
    // An unrelated enemy at the edge of the screen must not turn blind spam
    // into spotted accuracy. No extra visibility queries enter this coach.
    const targetEnemy = nearest && range !== null && gap <= Math.max(12, Math.atan2(.65, range) / DEG * 2) ? nearest : undefined;
    const contact = targetEnemy ? this.duelContacts.get(targetEnemy.id) : undefined;
    const closeMoving = !!targetEnemy && !airborne && moving && mobileWeapon(self.equipment) && range !== null &&
      range <= 10 && movementPenalty * range <= .3;
    const shot: DuelShot = {id, at: time, equipment: self.equipment, cycle: stats.cycle, range: targetEnemy ? range : null,
      visible: targetEnemy ? sight.map(enemy => enemy.id) : [], target: targetEnemy?.id,
      appropriate: !airborne && (!moving || closeMoving), moving, airborne,
      entered: time - this.movedAt <= .75, closeMoving, hit: false, hiddenHit: false,
      speed, maxSpeed: stats.speed ?? equipmentStats(self.equipment).speed, duck: self.duckAmount,
      yaw: self.yaw, pitch: self.pitch, aim: contact?.aim};
    if (contact) contact.aim.firstShot ??= time;
    this.duelShots.set(id, shot);
    if (contact && contact.opening === undefined) {
      contact.opening = id;
      contact.prepared = bodyWeapon(self.equipment) ? contact.body ?? contact.head : contact.head;
      this.openingContacts.push(contact);
      contact.fight = {enemy: targetEnemy!.id, started: contact.started, firstShot: time, range: range!, speed,
        entered: shot.entered, oppositeInput: time - this.oppositeAt <= .3, prepared: contact.prepared?.ready ?? null,
        low: rifle(self.equipment) && !!contact.prepared?.low, visibleEnemies: shot.visible.length,
        shots: 0, hits: 0, heads: 0, damage: 0, killed: false, openingHit: false};
      this.fights.push(contact.fight);
    }
    if (contact?.fight) {shot.fight = contact.fight; contact.fight.shots++;}
  }
  hit(event: Extract<DuelEvent, {kind: 'hit'}>, time: number, melee = false, self?: Pick<DuelActorSnapshot, 'reloading'>) {
    if (event.victim === 0) {
      this.taken += event.healthDamage;
      this.cachedCoaching = undefined; this.cachedDebrief = undefined;
      const fresh = this.observedAt !== undefined && time >= this.observedAt && time - this.observedAt <= .1 + 1e-8;
      this.received.push({amount: event.healthDamage, lethal: event.lethal, reloading: !!self?.reloading,
        visible: fresh ? this.currentSight.some(enemy => enemy.id === event.shooter) : null, visibleCount: fresh ? this.currentSight.length : 0});
    }
    if (event.shooter !== 0 || event.victim === 0) return;
    if (!melee && !event.utility) {
      this.cachedCoaching = undefined;
      this.cachedDebrief = undefined;
      this.cachedAim = undefined;
      if(!this.hitShots.has(event.shotId)) {this.hitShots.add(event.shotId);this.hits++;}
      if(event.group==='head'&&!this.headShots.has(event.shotId)) {this.headShots.add(event.shotId);this.heads++;}
      const shot = this.duelShots.get(event.shotId);
      if (shot) {
        if (shot.visible.includes(event.victim)) shot.hit = true;
        else shot.hiddenHit = true;
        if (event.group === 'head' && shot.visible.includes(event.victim)) shot.head = true;
        const aim = shot.target === event.victim ? shot.aim : this.duelContacts.get(event.victim)?.aim;
        if (aim && shot.visible.includes(event.victim) && (event.healthDamage > 0 || event.armorDamage > 0)) {
          if (aim.firstDamage === undefined) {aim.firstDamage = time; aim.correction = eyeAngleChange(aim, shot);}
          if (event.lethal) aim.killedAt = time;
        }
        if (shot.fight?.enemy === event.victim) {
          const fight = shot.fight;
          if (!shot.fightHit) {fight.hits++; shot.fightHit = true;}
          if (!shot.fightHead && event.group === 'head') {fight.heads++; shot.fightHead = true;}
          fight.damage += event.healthDamage; fight.killed ||= event.lethal;
          if (event.lethal) fight.killedAt = time;
          fight.openingHit ||= fight.firstShot === shot.at;
          fight.firstDamage ??= time;
        }
      }
    }
    this.kills += +event.lethal; this.damage += event.healthDamage;
    const seen = this.spotted.get(event.victim);
    if (seen !== undefined && !this.damaged.has(event.victim)) this.times.push(Math.max(0, time - seen) * 1000);
    this.damaged.add(event.victim);
    if (event.lethal) this.duelContacts.delete(event.victim);
  }
  review(): DuelReview {
    const accuracy = this.shots ? Math.min(100, 100 * this.hits / this.shots) : 0;
    const settled = this.shots ? 100 * (this.shots - this.unsettledShots) / this.shots : 0;
    const headRate = this.hits ? 100 * this.heads / this.hits : 0;
    const placement = median(this.placements), timeToDamage = median(this.times);
    // Sight refreshes and rendering do not change completed shot measurements.
    const coaching = this.cachedCoaching ??= this.summary();
    const {score, focus: message, action: tip} = coaching;
    return {shots: this.shots, hits: this.hits, heads: this.heads, kills: this.kills, damage: this.damage, taken: this.taken,
      movingShots: this.movingShots, airShots: this.airShots, exposedSeconds: this.exposedSeconds,
      multipleAnglesSeconds: this.multipleAnglesSeconds, accuracy, settled, headRate, score, placement, timeToDamage,
      meanSpeed: this.shots ? this.speedTotal / this.shots : 0, message, tip, coaching,
      debrief: this.debrief(), aim: this.cachedAim ??= measureAim([...this.duelShots.values()], this.aimEncounters)};
  }

  private debrief() {return this.cachedDebrief ??= fightDebrief([...this.duelShots.values()], this.fights, this.received);}

  private summary(): CoachingSummary {
    const measured = [...this.duelShots.values()].filter(shot => shot.target !== undefined && (!shot.hiddenHit || shot.hit));
    const measuredIds = new Set(measured.map(shot => shot.id));
    const openings = this.openingContacts.map(contact => ({contact, shot: this.duelShots.get(contact.opening!)!}))
      .filter(row => measuredIds.has(row.shot.id));
    const prepared = openings.filter(row => row.contact.prepared);
    const goodTiming = measured.filter(shot => shot.appropriate).length;
    const ready = prepared.filter(row => row.contact.prepared!.ready).length;
    const isolated = openings.filter(row => row.shot.visible.length === 1).length;
    const landed = measured.filter(shot => shot.hit).length;
    const timingScore = percent(goodTiming, measured.length), aimScore = percent(ready, prepared.length);
    const accuracyScore = percent(landed, measured.length), isolationScore = percent(isolated, openings.length);
    const chains: DuelShot[][] = [];
    for (const shot of measured) {
      const chain = chains[chains.length - 1], previous = chain?.[chain.length - 1];
      if (previous && previous.equipment === shot.equipment && previous.target === shot.target &&
        shot.at - previous.at >= 0 && shot.at - previous.at <= Math.max(.18, previous.cycle * 1.6)) chain.push(shot);
      else chains.push([shot]);
    }
    const sprays = chains.filter(chain => chain.length >= 3 && rifle(chain[0].equipment));
    const sprayShots = sprays.flat(), sprayHits = sprayShots.filter(shot => shot.hit).length;
    const sprayScore = percent(sprayHits, sprayShots.length);
    const diagnosed = measured.filter(shot => shot.evidence);
    const clearAim = (shot: DuelShot) => shot.evidence!.aimOnTarget && !shot.evidence!.stoppedByCover;
    const aimLineScore = percent(diagnosed.filter(clearAim).length, diagnosed.length);
    const control = sprayShots.filter(shot => shot.evidence);
    const controlScore = percent(control.filter(clearAim).length, control.length);
    const parts: [number | null, number][] = [[timingScore, 35], [aimScore, 25],
      [aimLineScore ?? accuracyScore, sprayScore === null ? 25 : 15], [controlScore ?? sprayScore, 10], [isolationScore, 15]];
    const available = parts.filter((part): part is [number, number] => part[0] !== null);
    const score = available.length ? Math.round(available.reduce((sum, [value, weight]) => sum + value * weight, 0) /
      available.reduce((sum, [, weight]) => sum + weight, 0)) : null;
    const movingBad = measured.filter(shot => shot.moving && !shot.closeMoving && !shot.airborne);
    const air = measured.filter(shot => shot.airborne);
    const badOpenings = openings.filter(row => !row.shot.appropriate);
    const broad = openings.length - isolated;
    const low = prepared.filter(row => rifle(row.shot.equipment) && row.contact.prepared!.low);
    const entered = openings.filter(row => row.shot.entered).length;
    const ranges = measured.flatMap(shot => shot.range === null ? [] : [shot.range]);
    const averageRange = mean(ranges);
    const late = sprays.filter(chain => chain.length >= 6).flatMap(chain => chain.slice(3));
    const early = sprays.filter(chain => chain.length >= 6).flatMap(chain => chain.slice(0, 3));
    const earlyRate = percent(early.filter(shot => shot.hit).length, early.length);
    const lateRate = percent(late.filter(shot => shot.hit).length, late.length);
    const weapons = [...new Set(measured.map(shot => shot.equipment))];
    const weapon = weapons.length === 1 ? weapons[0] : undefined;
    const context = `${weapon ? equipmentNames[weapon] : 'this loadout'}${averageRange === null ? '' : ` at about ${Math.round(averageRange)} m`}`;
    const metrics: SkillMetric[] = [
      {label: 'Shot timing', value: countValue(goodTiming, measured.length), score: timingScore,
        detail: '35% weight. Actual grounded movement accuracy at fire time; close-range mobile weapons get a contextual allowance when added movement spread fits 0.3 m. Settled does not prove an opposite-key counterstrafe.'},
      {label: 'Prepared openings', value: countValue(ready, prepared.length), score: aimScore,
        detail: '25% weight. First exposed head/body point, before firing; distance-aware head height and a small correction allowance. Unknown, covered or recently firing/spray-transfer preparation is not scored.'},
      {label: 'Visible-target accuracy', value: countValue(landed, measured.length), score: accuracyScore,
        detail: `${sprayScore === null ? '25' : '15'}% weight. One hit per fired shot, not per pellet or collateral victim. Blind shots and hits on unseen targets are excluded; visibility is sampled at 32 Hz. Aim, recovery and spread all affect hits; one spread miss alone does not prove bad aim.`},
      {label: 'Single-angle openings', value: countValue(isolated, openings.length), score: isolationScore,
        detail: '15% weight. Visible enemies at the opening shot, not time spent looking for information. Cover can isolate a fight; a wide swing is not automatically wrong.'},
      {label: 'Spray accuracy', value: countValue(sprayHits, sprayShots.length), score: sprayScore,
        detail: '10% weight when present. Rapid sequences of at least three visible-target shots with the same weapon and target. This is measured control, not a recoil-only diagnosis.'},
      {label: 'Entered / held openings', value: `${entered} / ${openings.length - entered}`, score: null,
        detail: 'Recent movement within 0.75 s versus no recent movement. Both entry and holding can be valid; per-fight details separately report observed opposite movement input, not inferred intent.'},
    ];
    let focus = 'Make the first bullet count';
    let evidence = `${countValue(goodTiming, measured.length)} shots had no excess movement spread; ${countValue(ready, prepared.length)} openings were pre-aimed at first contact with ${context}.`;
    let action = 'Pre-aim the next likely position, make any mouse correction, then fire. Prioritize first-bullet accuracy over rushing the shot.';
    let goal = 'Next five openings: confirm the crosshair is on the exposed target before each first shot.';
    if (!measured.length) {
      focus = 'Take one deliberate duel';
      evidence = this.shots ? `${this.shots} gunshot${this.shots === 1 ? '' : 's'} recorded, but no fresh visible-target sequence could be measured.` : 'No gunshots recorded yet.';
      action = 'Hold an angle or pre-aim the next peek; fire when the exposed target is lined up.';
      goal = 'Next rep: take one aimed opening; blind prefire and knife attacks are not graded as misses.';
      // A blind airborne shot still deserves a factual safety cue, not a score.
      if (this.airShots) action = 'Land before firing for a precise first shot.';
    } else if (air.length) {
      focus = 'Land for first-bullet accuracy';
      evidence = `${air.length}/${measured.length} visible-target shots were airborne with ${context}. Crouching mid-air does not restore grounded accuracy.`;
      action = 'Use the jump peek for info, then land and settle before shooting.';
      goal = 'Next five committed openings: zero airborne shots.';
    } else if (badOpenings.length || movingBad.length >= 2) {
      focus = 'Counter-strafe, then shoot';
      evidence = `${badOpenings.length}/${openings.length} openings and ${movingBad.length}/${measured.length} shots still had excess movement spread with ${context}. Crouching is not an instant stop; a crouch spray can still be valid once settled.`;
      action = 'Release the strafe key, tap the opposite direction, then fire once settled. Give the first bullet a clean stop.';
      if (badOpenings.length >= 3) action = 'Slow the rep down: strafe, counter-strafe, then shoot after you stop. Repeat in Counterstrafing practice before taking the duel again.';
      goal = 'Next five openings: at least four first shots without excess movement spread.';
    } else if (broad) {
      focus = 'Isolate a 1v1';
      evidence = `${broad}/${openings.length} opening shots were taken with multiple enemies visible. Information peeks without firing are not penalized.`;
      action = 'Slice the pie: clear one angle at a time, using cover to block the second enemy. Take the 1v1 before opening the next angle.';
      if (broad >= 3) action = 'Lower the bot count for a few reps and slice the pie around cover. Isolate a 1v1 before adding more opponents.';
      goal = 'Next three duels: one visible enemy at the opening shot when cover allows.';
    } else if (low.length) {
      focus = 'Pre-aim at head height';
      evidence = `${low.length}/${prepared.length} measured rifle openings started below the exposed head with ${context}. Body hits later in a spray are fine.`;
      action = 'Keep your crosshair at head height before the peek, adjusting for ramps, stairs and crouched enemies. Make a mouse correction if they play an off-angle.';
      if (low.length >= 3) action = 'Slow down a Prefire route and use cover edges as head-height references. Adjust for crouched or elevated enemies; use the mouse for off-angles.';
      goal = 'Next five rifle openings: at least four prepared at the exposed head height.';
    } else if (prepared.length >= 2 && ready / prepared.length < .6) {
      focus = 'Pre-aim the next fight';
      evidence = `${countValue(ready, prepared.length)} openings had the crosshair near the exposed target at first contact with ${context}.`;
      action = bodyWeapon(weapon ?? 'ak47') ? 'Pre-aim center mass for this weapon, then make the mouse correction before firing. If only the head is exposed, adjust to it.'
        : 'Pre-aim the likely head position, then correct with the mouse if they play an off-angle. Use movement to help line up, not to replace every mouse adjustment.';
      goal = 'Next five openings: pre-aim four before contact, with the same weapon and range.';
    } else if (late.length >= 4 && earlyRate !== null && lateRate !== null && earlyRate - lateRate >= 25) {
      focus = 'Keep your spray on target';
      evidence = `Long sprays hit ${Math.round(earlyRate)}% on their first three shots, then ${Math.round(lateRate)}% afterward with ${context}. Aim, recoil and spread can all affect this.`;
      action = averageRange !== null && averageRange > 20 ? 'At this range, use shorter controlled bursts and let recoil reset between them. Re-peek from cover if the spray gets away.'
        : 'With an automatic weapon, commit to a close-range spray while you stay on target. Reset behind cover if you lose them; body hits still count.';
      goal = 'Next three duels: reset behind cover when the burst or spray gets away.';
    } else if (measured.length >= 6 && (accuracyScore ?? 0) < 25) {
      focus = 'Line up the shot before committing';
      evidence = `${countValue(landed, measured.length)} visible-target shots connected with ${context}; aim, recovery and spread can all contribute.`;
      action = weapon && bodyWeapon(weapon) ? 'Line up the exposed target and let the weapon recover before the next shot. Favor center mass when it is visible with this loadout.'
        : averageRange !== null && averageRange > 20 ? 'Use taps or short bursts at this range, letting recoil reset before you fire again. Take the mouse correction before the shot.'
          : 'Line up the first bullet before firing, then keep the follow-up shots on target. Reset behind cover if you lose the target.';
      goal = 'Next three duels: confirm the first shot before committing to follow-up shots.';
    }
    const strength = goodTiming && goodTiming === measured.length ? 'Every measured shot avoided excess movement spread. That works whether you swing or hold an angle.'
      : ready && ready === prepared.length ? 'Your crosshair placement was ready for every measured opening; keep that pre-aim.' : undefined;
    const debrief = this.debrief(), finding = debrief.findings[0];
    // New recordings have physical ray evidence. Old histories and imported
    // synthetic reviews retain their conservative compatibility summary.
    if ((measured.some(shot => shot.evidence) || this.received.length) && finding) {
      focus = finding.title; evidence = finding.evidence; action = finding.action; goal = finding.goal;
    }
    if (diagnosed.length) {
      metrics[2] = {label: 'Visible-target accuracy', value: countValue(landed, measured.length), score: aimLineScore,
        detail: `${sprayScore === null ? '25' : '15'}% scoring weight uses a clear aim/recoil line on the actual target shape (${countValue(diagnosed.filter(clearAim).length, diagnosed.length)}), before random dispersion. The displayed hit rate remains actual landed shots. Blocked lines count as firing-line errors, not aim misses.`};
      if (control.length) metrics[4] = {label: 'Spray accuracy', value: countValue(sprayHits, sprayShots.length), score: controlScore,
        detail: '10% scoring weight uses a clear pre-spread aim line on the target during rapid rifle sequences of at least three shots. Actual hit rate is shown; it is not a recoil-only measurement.'};
    }
    return {score, focus, evidence, action, goal, strength, metrics,
      confidence: `${openings.length < 3 ? 'Provisional: collect at least three openings. ' : ''}${openings.length} measured openings / ${measured.length} visible-target shots. Local practice goals, not a FACEIT rank. Missing metrics are omitted and available weights renormalized. Contact-to-damage is descriptive, not a reaction-time grade.`};
  }
}

export type DuelHistory = {date: string; outcome: string; review: DuelReview; setupKey?: string};
export function loadDuelHistory(): DuelHistory[] {
  try {
    const value = JSON.parse(localStorage.getItem('spraylab.duel.history.v1') || '[]');
    return Array.isArray(value) ? value.filter(v => v && typeof v.date === 'string' && typeof v.outcome === 'string' &&
      v.review && ['shots', 'hits', 'heads', 'kills', 'damage', 'taken', 'accuracy', 'settled', 'headRate',
        'movingShots', 'airShots', 'meanSpeed', 'exposedSeconds', 'multipleAnglesSeconds'].every(k => Number.isFinite(v.review[k]) && v.review[k] >= 0) &&
      ['score', 'placement', 'timeToDamage'].every(k => v.review[k] === null || Number.isFinite(v.review[k]) && v.review[k] >= 0) &&
      (v.review.score === null || v.review.score <= 100) &&
      typeof v.review.tip === 'string' && typeof v.review.message === 'string').slice(0, 50)
      .map(v => ({...v, setupKey: typeof v.setupKey === 'string' && /^setup-v2:[a-f0-9]{32}$/.test(v.setupKey) ? v.setupKey : undefined,
        review: {...v.review, coaching: readCoachingSummary(v.review.coaching), debrief: readDuelDebrief(v.review.debrief), aim: readAimMetrics(v.review.aim)}})) : [];
  } catch {return [];}
}

export function damageBearing(player: Vec, source: Vec) {return Math.atan2(source.x - player.x, player.z - source.z);}
