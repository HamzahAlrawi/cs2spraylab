import {DEG, groundVelocity, STEP, UNIT, type Vec} from '../actor-physics';
import {randomStream} from '../duel/rng';
import {actorVisibilitySamples} from '../duel/actor-visibility';
import {idleCommand, type ActorCommand} from '../duel/types';
import {hasPrefireSight, PREFIRE_ENDPOINT_RADIUS, type BotCollision, type PrefireBotPlan} from './bot-behavior';
import type {PrefireConfig} from './config';
import {activeTrade, copyTradeOrder, type ThreatReport, type TradeOrder} from '../duel/trading';
import type {DamagePunch} from '../aim-punch';
import {aimStep, type AimMotor} from '../duel/motor';
import {botSensorView, pointInView} from '../duel/shadows';

export type PrefireBotActor = {
  position: Vec; feet: number; yaw: number; pitch: number; velocity: {x: number; z: number};
  grounded?: boolean; duckAmount?: number; velocityModifier?: number; generation?: number; punch?: Pick<DamagePunch, 'shotFor'>;
  equipReadyAt?: number;
  weapon: {ammo: number; reserve: number; ordinal: number; nextShotAt: number; reloadUntil: number;
    reload?: {fireReadyAt: number};
    actions?: {stats: {speed: number; fullAuto?: boolean}; readyAt?: number; horizontalFov?: number};
    recovery?: {recoil: {yaw: number; pitch: number}; angle?: {yaw: number; pitch: number}; predict?: (seconds: number) => {yaw: number; pitch: number}}};
};
type Player = {position: Vec; alive: boolean; feet?: number; duckAmount?: number; yaw?: number};
type CombatOptions = Pick<PrefireConfig, 'returnFire' | 'reactionMs'> & {tradeEnabled?: boolean};
type Phase = 'holding' | 'waiting' | 'outbound' | 'exposed' | 'retreating' | 'pushing' | 'recovering';
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const heading = (from: Vec, to: Vec) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const distanceTo = (actor: PrefireBotActor, target: Vec) => Math.hypot(target.x - actor.position.x, target.z - actor.position.z);
const speedOf = (actor: PrefireBotActor) => Math.hypot(actor.velocity.x, actor.velocity.z);
const CONTACT_MEMORY = 3.5;
const THREAT_AREA_MEMORY = 12;
const RECENT_SIGHT_PRIORITY = .75;
const PREAIM_INTERVAL = .2;
const PREAIM_CANDIDATES = 8;

export class PrefireBotController {
  visibilityFilter?: (from: Vec, to: Vec) => boolean;
  private readonly random: () => number;
  private readonly hearingRandom: () => number;
  private phase: Phase;
  private until: number;
  private seenAt?: number;
  private visible = false;
  private contact?: Vec;
  private contactUntil = 0;
  private contactAt = -Infinity;
  private recognizedSight?: ThreatReport;
  private knownApproach?: Vec;
  private areaUntil = 0;
  private heard?: ThreatReport;
  private trade?: TradeOrder;
  private tradeStarted = false;
  private trading = false;
  private nextPerceptionAt = 0;
  private nextBurstAt = 0;
  private burstStart?: number;
  private burstSize = 0;
  private burstWeapon?: PrefireBotActor['weapon'];
  private progressAt = 0;
  private progressDistance = Infinity;
  private returningBlocked = false;
  private retryReturnAt = 0;
  private readonly recoilControl: number;
  private aimYawError = 0;
  private aimPitchError = 0;
  private readonly home: Vec;
  private readonly attack?: Vec;
  private firstCommand = true;
  private readonly takeAngle: boolean;
  private exposureDeadline = Infinity;
  private excursionBlocked = false;
  private returnAttempts = 0;
  private readonly aimMotor: AimMotor = {yawRate: 0, pitchRate: 0};
  private lastCommandAt = -Infinity;
  private exposedAt = 0;
  private pressureActive = false;
  private nextPressureAt = 0;
  private respondedToCueAt = -Infinity;
  private nextPreaimAt = -Infinity;
  private preaimOpenings: Vec[] = [];
  private heldOpening?: Vec;

  constructor(readonly plan: PrefireBotPlan, seed: number, private readonly homeYaw: number, private readonly homePitch: number,
    private readonly tradePlan?: PrefireBotPlan) {
    this.random = randomStream(seed, `prefire-behavior:${plan.key}`);
    this.hearingRandom = randomStream(seed, `prefire-hearing:${plan.key}`);
    this.home = plan.attackFromAnchor && plan.exposure ? plan.exposure : plan.anchor;
    this.attack = plan.attackFromAnchor ? plan.anchor : plan.exposure;
    this.takeAngle = plan.intent === 'take-angle';
    this.phase = plan.kind === 'hold' ? 'holding' : plan.attackFromAnchor ? this.takeAngle ? 'exposed' : 'retreating' : 'waiting';
    this.until = this.between(.35, 1.5);
    this.nextPerceptionAt = 0;
    this.recoilControl = this.between(.94, .98);
  }

  threatReport(time: number, reactionMs: number): ThreatReport | null {
    this.rememberSight(time, reactionMs);
    const sight = this.recognizedSight && time >= this.recognizedSight.observedAt && time - this.recognizedSight.observedAt < 1.5
      ? {...this.recognizedSight, point: {...this.recognizedSight.point}} : null;
    return this.heard && time >= this.heard.observedAt && time - this.heard.observedAt < 1.5 &&
      (!sight || this.heard.observedAt > sight.observedAt) ? {...this.heard, point: {...this.heard.point}} : sight;
  }
  combatPolicyState(time: number, actor: PrefireBotActor, options: CombatOptions) {
    const report = this.threatReport(time, options.reactionMs);
    const visible = this.visible && this.seenAt !== undefined && time - this.seenAt >= options.reactionMs / 1000 &&
      time >= this.contactAt && time - this.contactAt < .15;
    // Current recognized sight outranks a newer sound for loadout distance.
    const evidence = visible ? this.recognizedSight : report;
    return {visible, report: evidence ? {...evidence, point: {...evidence.point}} : null,
      allowUtility: !this.visible && (this.phase === 'holding' || this.phase === 'waiting') && speedOf(actor) < .12,
      tradePending: options.returnFire && options.tradeEnabled !== false && !!this.trade && time >= this.trade.observedAt &&
        activeTrade(this.trade, Math.max(time, this.trade.readyAt), actor.generation)};
  }
  hear(point: Vec, time: number, reactionMs: number, occluded: boolean) {
    if (![point.x, point.y, point.z, time, reactionMs].every(Number.isFinite) || time < (this.heard?.observedAt ?? -Infinity)) return;
    const error = occluded ? 1.5 : .65;
    const readyAt = this.heard && time - this.heard.observedAt < .6 ? this.heard.readyAt :
      time + reactionMs / 1000 * (occluded ? .85 : .55);
    this.heard = {point: {x: point.x + (this.hearingRandom() * 2 - 1) * error, y: point.y,
      z: point.z + (this.hearingRandom() * 2 - 1) * error},
      observedAt: time, readyAt, source: 'sound'};
  }
  orderTrade(order: TradeOrder) {
    if (this.trade && this.trade.generation === order.generation && this.trade.victimId === order.victimId &&
      this.trade.observedAt >= order.observedAt) return;
    this.trade = copyTradeOrder(order); this.tradeStarted = this.trading;
  }

  private rememberSight(time: number, reactionMs: number) {
    if (this.visible && this.contact && this.seenAt !== undefined && time - this.seenAt >= reactionMs / 1000 &&
      time >= this.contactAt && time - this.contactAt < .15) {
      this.recognizedSight = {point: {...this.contact}, observedAt: this.contactAt, readyAt: time, source: 'sight'};
    }
  }

  private between(min: number, max: number) {return min + this.random() * (max - min);}
  private wait(time: number) {
    this.phase = 'waiting';
    this.until = time + (time < this.contactUntil ? this.between(.4, .95) : this.between(.7, 1.8));
    this.burstStart = undefined;
    this.progressDistance = Infinity;
  }
  private retreat(time: number, physical = false) {
    this.burstStart = undefined;
    if (!physical && this.plan.kind === 'crouch-hide') this.wait(time);
    else if (physical || this.plan.exposure || this.tradePlan?.exposure) {
      this.phase = this.pressureActive ? 'recovering' : 'retreating';
      this.progressAt = time; this.progressDistance = Infinity;
    }
  }
  private expose(time: number, options: Pick<PrefireConfig, 'returnFire' | 'reactionMs'>) {
    this.exposedAt = time;
    this.phase = 'exposed'; this.until = time + this.exposureSeconds(options);
    this.exposureDeadline = time + (options.returnFire ? options.reactionMs / 1000 : 0) +
      (this.plan.peekStyle === 'wide' ? 1.5 : .85);
  }
  private perceive(time: number, actor: PrefireBotActor, player: Player, collision: BotCollision) {
    const previouslyVisible = this.visible;
    const seen = this.visiblePoint(actor, player, collision);
    this.visible = !!seen;
    if (seen) {
      if (!previouslyVisible) {this.preaimOpenings = []; this.heldOpening = undefined;}
      this.seenAt ??= time;
      this.contact = seen;
      this.contactAt = time;
      this.contactUntil = time + CONTACT_MEMORY;
      const approach = this.plan.approachViews?.reduce<Vec | undefined>((best, view) => !best ||
        Math.hypot(view.x - seen.x, view.y - seen.y, view.z - seen.z) <
        Math.hypot(best.x - seen.x, best.y - seen.y, best.z - seen.z) ? view : best, undefined);
      // After precise contact expires, hold its approach area, not the original
      // spawn entrance. This uses old observed evidence, never hidden movement.
      this.knownApproach = approach ? {...approach} :
        {...seen, x: Math.round(seen.x * 2) / 2, z: Math.round(seen.z * 2) / 2};
      this.areaUntil = time + THREAT_AREA_MEMORY;
      if (!previouslyVisible && this.phase === 'waiting' && this.plan.kind === 'crouch-hide') {
        this.until = Math.min(this.until, time + this.between(.08, .18));
      }
    } else {
      this.seenAt = undefined;
      this.burstStart = undefined;
    }
    this.nextPerceptionAt = time + this.between(.075, .105);
  }

  private visiblePoint(actor: PrefireBotActor, player: Player, collision: BotCollision): Vec | undefined {
    if (!player.alive) return;
    if (Math.abs(angleDelta(actor.yaw, heading(actor.position, player.position))) >= 1.9) return;
    // Use Duel's bounded stance/yaw-aware silhouette samples. Never copy a
    // hidden root/head just because some other part of the actor is visible.
    const samples = player.feet === undefined ? [] : actorVisibilitySamples({position: player.position,
      feet: player.feet, duckAmount: player.duckAmount ?? 0, yaw: player.yaw ?? 0}, actor.position);
    // Hidden acquisition keeps the existing four-ray budget. Once acquired,
    // shared silhouette edges preserve legitimate contact through partial cover.
    const points = player.feet === undefined ? [player.position] : (this.visible ? samples :
      [samples[0], ...samples.filter(sample => sample.group === 'chest').slice(0, 3)]).map(sample => sample.point);
    const view = botSensorView(actor.weapon.actions?.horizontalFov);
    const seen = points.find(point => pointInView(actor, point, view) && (!this.visibilityFilter || this.visibilityFilter(actor.position, point)) &&
      hasPrefireSight(collision, actor.position, point));
    return seen ? {...seen} : undefined;
  }

  private contextualAim(time: number, actor: PrefireBotActor, collision: BotCollision, desired: Vec | undefined,
    recentSight: boolean, traveling: boolean, evidenceSector?: Vec): Vec | undefined {
    if (!desired) return;
    // Ready sound/trade reports can redirect attention beyond the authored
    // lane. Routine course geometry alone cannot authorize a rear check.
    const lane = recentSight ? this.contact : evidenceSector ??
      (time < this.areaUntil ? this.knownApproach ?? this.plan.watchPoint : this.plan.watchPoint);
    const laneYaw = lane && Math.hypot(lane.x - actor.position.x, lane.z - actor.position.z) > .1
      ? heading(actor.position, lane) : this.homeYaw;
    const inLane = (point: Vec) => Math.abs(angleDelta(laneYaw, heading(actor.position, point))) <= (traveling ? .5 : .55) * Math.PI;
    const fallback = inLane(desired) ? desired : lane;
    if (!fallback) return;
    // Plans contain static course views, not live actor positions. Keep only a
    // small nearest shortlist; perception and firing retain their own LOS gates.
    const score = (point: Vec) => Math.hypot(point.x - fallback.x, point.z - fallback.z) +
      Math.abs(point.y - fallback.y) * .5 + Math.abs(angleDelta(laneYaw, heading(actor.position, point))) * .25;
    if (time + 1e-9 >= this.nextPreaimAt) {
      this.nextPreaimAt = time + PREAIM_INTERVAL;
      const points: Vec[] = [], scores: number[] = [];
      const add = (point: Vec | undefined) => {
        if (!point || ![point.x, point.y, point.z].every(Number.isFinite) || !inLane(point) ||
          points.some(old => old.x === point.x && old.y === point.y && old.z === point.z)) return;
        const value = score(point);
        let at = 0; while (at < scores.length && scores[at] <= value) at++;
        if (at >= PREAIM_CANDIDATES) return;
        points.splice(at, 0, point); scores.splice(at, 0, value);
        if (points.length > PREAIM_CANDIDATES) {points.pop(); scores.pop();}
      };
      // A remembered visible contact is valid evidence; a sound is only a
      // noisy area cue, so it selects course openings rather than exact aim.
      if (desired === this.contact) add(this.contact);
      add(this.plan.watchPoint);
      for (const view of this.plan.approachViews ?? []) add(view);
      this.preaimOpenings = points.filter(point => hasPrefireSight(collision, actor.position, point)).map(point => ({...point}));
    }
    let best: Vec | undefined, bestScore = Infinity, held: Vec | undefined;
    for (const point of this.preaimOpenings) {
      if (!inLane(point)) continue;
      const value = score(point);
      if (value < bestScore) {best = point; bestScore = value;}
      if (this.heldOpening && point.x === this.heldOpening.x && point.y === this.heldOpening.y && point.z === this.heldOpening.z) held = point;
    }
    // Small noisy reports should not make a holder alternate between corners.
    if (held && score(held) <= bestScore + .35) best = held;
    this.heldOpening = best;
    return best ?? fallback;
  }

  private pressureEvidence(time: number, actor: PrefireBotActor) {
    const report = this.recognizedSight, endpoint = this.plan.pressure?.endpoint;
    if (!report || !endpoint || time < report.readyAt || time - report.observedAt > 1.5) return false;
    const dx = endpoint.x - actor.position.x, dz = endpoint.z - actor.position.z, length = Math.hypot(dx, dz);
    const tx = report.point.x - actor.position.x, tz = report.point.z - actor.position.z;
    const along = (dx * tx + dz * tz) / Math.max(.01, length);
    return along > length + 48 * UNIT && along < 16 &&
      Math.abs(dx * tz - dz * tx) / Math.max(.01, length) < Math.max(2.5, along * 1.05) &&
      Math.abs(report.point.y - actor.position.y) < 1.5;
  }

  verifyShot(time: number, actor: PrefireBotActor, player: Player, collision: BotCollision, reactionMs: number) {
    this.perceive(time, actor, player, collision);
    this.rememberSight(time, reactionMs);
    return this.visible && this.seenAt !== undefined && time - this.seenAt >= reactionMs / 1000;
  }

  guardSight(time: number, actor: PrefireBotActor, player: Player, collision: BotCollision) {
    if (!this.visible) return;
    if (this.visiblePoint(actor, player, collision)) return;
    // Called after physical movement: even a brief occlusion interrupts a
    // continuous-sight reaction timer. Hidden contacts still use idle sensing.
    this.visible = false; this.seenAt = undefined; this.burstStart = undefined;
    this.nextPerceptionAt = Math.min(this.nextPerceptionAt, time);
  }

  command(time: number, actor: PrefireBotActor, player: Player, collision: BotCollision,
    options: CombatOptions): ActorCommand {
    const command = idleCommand();
    if (this.burstWeapon !== actor.weapon) {
      this.burstWeapon = actor.weapon; this.burstStart = undefined; this.burstSize = 0;
    }
    if (time - this.lastCommandAt > .1) this.aimMotor.yawRate = this.aimMotor.pitchRate = 0;
    this.lastCommandAt = time;
    command.walk = false;
    const speed = speedOf(actor), home = distanceTo(actor, this.home) < PREFIRE_ENDPOINT_RADIUS && speed < .12;
    if (home && this.excursionBlocked) {
      this.excursionBlocked = false; this.returningBlocked = false; this.returnAttempts = 0;
    }
    const reloading = actor.weapon.reloadUntil > time;
    if (actor.weapon.ammo === 0) this.burstStart = undefined;
    const trade = options.returnFire && options.tradeEnabled !== false && activeTrade(this.trade, time, actor.generation) ? this.trade : undefined;
    const pendingTrade = options.returnFire && options.tradeEnabled !== false && this.trade && time >= this.trade.observedAt &&
      activeTrade(this.trade, Math.max(time, this.trade.readyAt), actor.generation);
    if (time + 1e-9 >= this.nextPerceptionAt) this.perceive(time, actor, player, collision);
    this.rememberSight(time, options.reactionMs);
    const needsReload = options.returnFire && actor.weapon.reserve > 0 && (actor.weapon.ammo === 0 ||
      !pendingTrade && !this.visible && time - this.contactAt > 1.5 && actor.weapon.ammo <= 3 && this.burstStart === undefined);
    if (!options.returnFire) this.burstStart = undefined;
    const cue = this.threatReport(time, options.reactionMs);
    if (this.phase === 'waiting' && cue && time >= cue.readyAt && cue.observedAt > this.respondedToCueAt) {
      this.respondedToCueAt = cue.observedAt;
      // A local noisy report can hasten the next planned check, not author a
      // new endpoint or bypass recognition/LOS at the eventual shot.
      const watch = this.plan.watchPoint;
      if (watch && Math.hypot(cue.point.x - watch.x, cue.point.z - watch.z) < 6) {
        this.until = Math.min(this.until, time + this.between(.15, .35));
      }
    }

    const tradeAttack = this.tradePlan?.attackFromAnchor ? this.tradePlan.anchor : this.tradePlan?.exposure;
    if (this.trading && (!trade || needsReload || reloading)) {
      this.trading = false; this.burstStart = undefined;
      this.retreat(time, true);
    }
    if (trade && !this.tradeStarted && !needsReload && !reloading && !this.pressureActive) {
      this.tradeStarted = true;
      this.trading = !!tradeAttack && !this.excursionBlocked;
      if (tradeAttack && !this.excursionBlocked) {
        this.phase = 'outbound'; this.progressAt = time; this.progressDistance = Infinity;
      }
    }
    const attack = this.trading ? tradeAttack : this.attack;

    // The unchanged source anchor may already be a good fighting point. Do not
    // walk away from a seen opponent just to initialize a reversed peek loop.
    if (this.firstCommand && this.phase === 'retreating' && this.visible && !needsReload && !reloading) {
      this.expose(time, options);
    }
    this.firstCommand = false;

    if (this.returningBlocked && this.returnAttempts < 2 && time >= this.retryReturnAt && !reloading) {
      this.returnAttempts++;
      this.returningBlocked = false; this.phase = this.pressureActive ? 'recovering' : 'retreating';
      this.progressAt = time; this.progressDistance = Infinity;
    }

    if (needsReload || reloading) {
      if (this.phase === 'outbound' || this.phase === 'pushing' || this.phase === 'exposed' || this.phase === 'waiting' && !home) this.retreat(time);
      command.reloadPressed = !reloading && (home || this.plan.kind === 'hold' || this.returningBlocked);
    } else if (this.phase === 'waiting' && !this.excursionBlocked && time >= this.until && (!this.visible || this.plan.kind === 'crouch-hide')) {
      if (this.plan.kind === 'crouch-hide') this.expose(time, options);
      else this.phase = 'outbound';
      this.progressAt = time; this.progressDistance = Infinity;
    }

    if (this.phase === 'outbound' && attack && distanceTo(actor, attack) < PREFIRE_ENDPOINT_RADIUS && speed < .12) {
      this.expose(time, options);
    }
    // Quick checks counterstrafe when they acquire the opponent, rather than
    // continue a rehearsed walk past a visible threat. Wide/take-angle swings
    // retain their endpoint so the two behaviors remain physically distinct.
    if (this.phase === 'outbound' && this.visible && this.seenAt !== undefined &&
      (this.trading ? time - this.seenAt >= Math.max(.1, options.reactionMs / 1000)
        : !this.takeAngle && this.plan.peekStyle !== 'wide' && time - this.seenAt >= .075)) this.expose(time, options);
    if (this.phase === 'recovering' && this.attack && distanceTo(actor, this.attack) < PREFIRE_ENDPOINT_RADIUS && speed < .12) {
      this.pressureActive = false; this.phase = 'retreating'; this.progressAt = time; this.progressDistance = Infinity;
    }
    if (this.phase === 'retreating' && home) {
      if (this.plan.kind === 'hold') {this.phase = 'holding'; this.burstStart = undefined;}
      else this.wait(time);
    }
    // Keep the configured response delay even when sight is acquired halfway
    // through a swing. The short burst starts after settling, not while running.
    if (this.phase === 'exposed' && options.returnFire && actor.weapon.ammo > 0 && this.visible && this.seenAt !== undefined) {
      this.until = Math.min(this.exposureDeadline, Math.max(this.until, this.seenAt + options.reactionMs / 1000 + .4));
    }
    if (this.phase === 'exposed' && player.alive && !this.visible && !this.trading && !trade && !this.pressureActive && !this.excursionBlocked &&
      !needsReload && !reloading && time >= this.nextPressureAt && time - this.exposedAt >= .25 &&
      time - this.contactAt >= .15 && this.pressureEvidence(time, actor)) {
      this.pressureActive = true; this.phase = 'pushing'; this.burstStart = undefined;
      this.nextPressureAt = time + this.between(10, 14); this.progressAt = time; this.progressDistance = Infinity;
    }
    if (this.phase === 'pushing' && (this.visible && this.seenAt !== undefined && time - this.seenAt >= .075 ||
      this.plan.pressure && distanceTo(actor, this.plan.pressure.endpoint) < PREFIRE_ENDPOINT_RADIUS && speed < .12)) this.expose(time, options);
    if (this.phase === 'exposed' && !this.trading && !this.takeAngle && (time >= this.exposureDeadline ||
      time >= this.until && this.burstStart === undefined)) this.retreat(time);
    if (this.burstStart !== undefined && actor.weapon.ordinal - this.burstStart >= this.burstSize) {
      this.burstStart = undefined;
      this.nextBurstAt = time + this.between(.35, .65);
      if (this.phase === 'exposed' && !this.trading && !this.takeAngle) this.retreat(time);
    }

    const traveling = this.phase === 'outbound' || this.phase === 'retreating' || this.phase === 'pushing' || this.phase === 'recovering';
    const posture = this.trading && this.tradePlan ? this.tradePlan : this.plan;
    command.crouch = posture.kind === 'crouch-hide' ? this.phase !== 'exposed' :
      traveling ? this.pressureActive ? this.plan.pressure!.travelCrouched : posture.travelCrouched ?? posture.sourceCrouched : posture.sourceCrouched ||
      posture.peekStyle === 'crouch' && this.phase === 'exposed';
    let target = this.phase === 'pushing' ? this.plan.pressure?.endpoint : this.phase === 'recovering' ? this.attack :
      this.phase === 'outbound' ? attack : this.phase === 'retreating' ? this.home : undefined;
    if (target) {
      const remaining = distanceTo(actor, target);
      if (remaining < this.progressDistance - .04) {this.progressDistance = remaining; this.progressAt = time;}
      if (time - this.progressAt > 1.5) {
        // A player/another bot may temporarily block an otherwise validated lane.
        // Abandon the excursion; never relocate the pawn to resolve it.
        if (this.phase === 'outbound' || this.phase === 'pushing') {
          this.excursionBlocked = true; this.trading = false;
          this.retreat(time, true); target = this.pressureActive ? this.attack : this.home;
        }
        else {
          this.excursionBlocked = true;
          this.returningBlocked = true; this.retryReturnAt = time + this.between(.6, 1.2);
          this.phase = 'holding'; target = undefined;
        }
      }
    }

    const engaging = this.phase === 'holding' || this.phase === 'exposed' ||
      this.phase === 'waiting' && this.plan.kind !== 'crouch-hide';
    let ready = options.returnFire && engaging && this.visible && player.alive && this.seenAt !== undefined &&
      time - this.seenAt >= options.reactionMs / 1000 && time >= this.nextBurstAt && !needsReload && !reloading && actor.weapon.ammo > 0;
    // Only firing opportunities need a synchronous ray. Idle perception is ~11 Hz.
    if (ready && actor.weapon.nextShotAt <= time + STEP + 1e-9) {
      this.perceive(time, actor, player, collision);
      ready = this.visible && this.seenAt !== undefined && time - this.seenAt >= options.reactionMs / 1000;
    }
    const heard = this.heard && time >= this.heard.readyAt && time - this.heard.observedAt < CONTACT_MEMORY ? this.heard : undefined;
    let aim = time < this.areaUntil ? this.knownApproach ?? this.plan.watchPoint : this.plan.watchPoint, observedAt = -Infinity;
    let evidenceSector: Vec | undefined;
    if (time < this.contactUntil && this.contact) {aim = this.contact; observedAt = this.contactAt;}
    const recentSight = !!this.contact && time >= this.contactAt && time - this.contactAt < RECENT_SIGHT_PRIORITY;
    if (heard && heard.observedAt > observedAt && !recentSight) {
      aim = heard.point; observedAt = heard.observedAt; evidenceSector = heard.point;
    }
    if (trade && trade.observedAt > observedAt && !recentSight) {aim = trade.point; evidenceSector = trade.point;}
    if (this.visible && this.contact) aim = this.contact;
    else aim = this.contextualAim(time, actor, collision, aim, recentSight, traveling, evidenceSector);
    const targetYaw = aim ? heading(actor.position, aim) : this.homeYaw;
    const targetPitch = aim ? Math.atan2(aim.y - actor.position.y, Math.hypot(aim.x - actor.position.x, aim.z - actor.position.z)) : this.homePitch;
    const recoil = this.visible ? actor.weapon.recovery?.predict?.(STEP) ?? actor.weapon.recovery?.recoil : undefined;
    const yaw = targetYaw + (recoil ? recoil.yaw * DEG * this.recoilControl + this.aimYawError : 0);
    const pitch = targetPitch - (recoil ? recoil.pitch * DEG * this.recoilControl - this.aimPitchError : 0);
    const punch = actor.punch?.shotFor(actor.weapon.recovery?.angle ?? {yaw: 0, pitch: 0});
    const viewYaw = actor.yaw - (punch?.yaw ?? 0) * DEG, viewPitch = actor.pitch + (punch?.pitch ?? 0) * DEG;
    // Return fire controls damage, not whether a defender can notice a player.
    if (aim || options.returnFire) {
      // Reaction remains a sight/fire gate. This bounded training heuristic only
      // changes the motor's settling, not that configured recognition delay.
      const settlingMs = Math.max(160, Math.min(240, 140 + options.reactionMs * .1));
      const turn = aimStep(this.aimMotor, angleDelta(viewYaw, yaw), pitch - viewPitch, settlingMs);
      command.yawDelta = turn.yawDelta; command.pitchDelta = turn.pitchDelta;
    } else this.aimMotor.yawRate = this.aimMotor.pitchRate = 0;
    const movingYaw = actor.yaw + command.yawDelta;
    const stopped = actor.grounded !== false && speed < .12;
    if (target) this.move(command, actor, target, movingYaw);
    else if (!stopped) this.brake(command, actor, movingYaw);
    const stanceReady = command.crouch ? (actor.duckAmount ?? 0) >= .95 : (actor.duckAmount ?? 0) < .05;
    const aimDistance = aim ? Math.hypot(aim.x - actor.position.x, aim.z - actor.position.z) : 1;
    const aligned = Math.atan2(.09, Math.max(1, aimDistance));
    // Check the combined predicted shot error too: two individually acceptable
    // axes (or residual recoil) can still put the physical ray outside the cone.
    const shotYawError = angleDelta(targetYaw, viewYaw + command.yawDelta - (recoil?.yaw ?? 0) * DEG);
    const shotPitchError = viewPitch + command.pitchDelta + (recoil?.pitch ?? 0) * DEG - targetPitch;
    const actionReadyAt = Math.max(actor.weapon.actions?.readyAt ?? 0, actor.equipReadyAt ?? 0, actor.weapon.reload?.fireReadyAt ?? 0);
    const attackReadyAt = Math.max(actor.weapon.nextShotAt, actionReadyAt);
    const weaponReady = time + 1e-9 >= actionReadyAt && (this.burstStart !== undefined || time + 1e-9 >= attackReadyAt);
    if (ready && weaponReady && stopped && stanceReady && Math.abs(angleDelta(viewYaw, yaw)) < aligned && Math.abs(viewPitch - pitch) < aligned &&
      Math.abs(angleDelta(viewYaw + command.yawDelta, yaw)) < aligned && Math.abs(viewPitch + command.pitchDelta - pitch) < aligned &&
      Math.hypot(shotYawError, shotPitchError) < aligned) {
      if (this.burstStart === undefined) {
        this.burstStart = actor.weapon.ordinal; this.burstSize = Math.floor(this.between(2, 5));
        this.aimYawError = this.between(-.10, .10) * DEG;
        this.aimPitchError = this.between(-.07, .07) * DEG;
      }
      command.fireHeld = true;
      // Semi-auto backups need a fresh press, but never queue one during a
      // cycle/deploy/reload lock. Rifles retain their continuous held fire.
      command.firePressed = actor.weapon.actions?.stats.fullAuto === false && time + 1e-9 >= attackReadyAt;
    }
    return command;
  }

  private exposureSeconds(options: Pick<PrefireConfig, 'returnFire' | 'reactionMs'>) {
    const window = this.plan.peekStyle === 'wide' || this.plan.kind === 'move-out'
      ? this.between(.7, 1.05) : this.between(.3, .5);
    return window + (options.returnFire ? options.reactionMs / 1000 : 0);
  }
  private brake(command: ActorCommand, actor: PrefireBotActor, yaw: number) {
    const speed = speedOf(actor);
    if (speed < .12) return;
    // Releasing the opposite key before crossing zero avoids alternating A/D
    // on the final two ticks. Acceleration/friction still come from the motor.
    const runningSpeed = (actor.weapon.actions?.stats.speed ?? 225) * UNIT, duck = actor.duckAmount ?? 0;
    const predicted = groundVelocity(actor.velocity.x, actor.velocity.z, -actor.velocity.x / speed, -actor.velocity.z / speed,
      runningSpeed * (command.crouch || duck > 0 ? 1 - .66 * duck : 1) * (actor.velocityModifier ?? 1), STEP,
      {weaponSpeed: runningSpeed, ducking: command.crouch || duck > 0, walking: false});
    if (predicted.x * actor.velocity.x + predicted.z * actor.velocity.z <= 0) return;
    this.wish(command, -actor.velocity.x / speed, -actor.velocity.z / speed, yaw);
  }
  private move(command: ActorCommand, actor: PrefireBotActor, target: Vec, yaw: number) {
    const dx = target.x - actor.position.x, dz = target.z - actor.position.z, distance = Math.hypot(dx, dz);
    // Predict the counterstrafe's travel with the shared motor instead of
    // creeping up to a point using small alternating inputs.
    if (distance < PREFIRE_ENDPOINT_RADIUS * .5 + this.stoppingDistance(actor, command)) {this.brake(command, actor, yaw); return;}
    this.wish(command, dx / distance, dz / distance, yaw);
  }
  private stoppingDistance(actor: PrefireBotActor, command: ActorCommand) {
    let velocity = actor.velocity, distance = 0;
    const runningSpeed = (actor.weapon.actions?.stats.speed ?? 225) * UNIT, duck = actor.duckAmount ?? 0;
    const speed = runningSpeed * (command.crouch || duck > 0 ? 1 - .66 * duck : 1) * (actor.velocityModifier ?? 1);
    const stance = {weaponSpeed: runningSpeed, ducking: command.crouch || duck > 0, walking: false};
    for (let tick = 0; tick < 64; tick++) {
      const length = Math.hypot(velocity.x, velocity.z);
      if (length < .12) break;
      let next = groundVelocity(velocity.x, velocity.z, -velocity.x / length, -velocity.z / length, speed, STEP, stance);
      if (next.x * velocity.x + next.z * velocity.z <= 0) next = groundVelocity(velocity.x, velocity.z, 0, 0, speed, STEP, stance);
      distance += Math.hypot(next.x, next.z) * STEP; velocity = next;
    }
    return distance;
  }
  private wish(command: ActorCommand, x: number, z: number, yaw: number) {
    command.side = x * Math.cos(yaw) - z * Math.sin(yaw);
    command.forward = -x * Math.sin(yaw) - z * Math.cos(yaw);
  }
  snapshot() {return {key: this.plan.key, kind: this.plan.kind, phase: this.phase, until: this.until, visible: this.visible,
    seenAt: this.seenAt, nextBurstAt: this.nextBurstAt, burstSize: this.burstSize, trading: this.trading,
    pressureActive: this.pressureActive};}
}
