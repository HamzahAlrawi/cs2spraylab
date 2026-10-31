import {DEG, STEP, UNIT, type Vec} from '../actor-physics';
import type {SkillLevel} from './config';
import {traceSolid, type Arena} from './geometry';
import {aimStep, type AimMotor} from './motor';
import {randomStream} from './rng';
import type {ThreatReport} from './trading';
import type {DuelActorSnapshot} from './types';
import {UTILITY_RULES, UtilitySimulation, smokeSegmentExposure, type UtilityEffect} from './utilities';
import type {UtilityInventory, UtilityKind} from './utility-loadout';
import {solveUtilityThrow, utilityLaunchPose} from './utility-ballistics';
import {authoredUtilityOpportunity} from './utility-opportunities';
import {nativeFlashVisibility} from './grenade-flash-visibility';
import {nativeFlashArguments} from './grenade-native-flash';
import {nativeGrenadeReleaseAt} from './grenade-native-input';

const gap = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function utilityAimDirection(from: Vec, to: Vec): Vec | undefined {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz), dy = to.y - from.y;
  const speed2 = UTILITY_RULES.throwSpeed ** 2, gravity = UTILITY_RULES.gravity;
  const discriminant = speed2 * speed2 - gravity * (gravity * d * d + 2 * dy * speed2);
  if (![d, dy, discriminant].every(Number.isFinite) || d < .5 || discriminant < 0) return;
  const pitch = Math.atan((speed2 - Math.sqrt(discriminant)) / (gravity * d));
  return {x: dx / d * Math.cos(pitch), y: Math.sin(pitch), z: dz / d * Math.cos(pitch)};
}
// Authored training policy, not native bot logic or a claim of gameplay parity.
const POLICY = {sightAge: 1.5, soundAge: .8, setupSightAge: 3, setupSoundAge: 2,
  checks: .35, candidates: 4, flightSeconds: UTILITY_RULES.projectileLifetime,
  positionTolerance: .08, allyTolerance: .2, contactTolerance: 1.5, flashSeconds: .15};
type Context = {visible: boolean; lastShotAt: number; teammates: readonly DuelActorSnapshot[];
  /** Live held-utility readiness; undefined preserves standalone caller compatibility. */
  readyToThrow?: boolean};
type Shot = {yaw: number; pitch: number};
type Outcome = {position: Vec; effect?: UtilityEffect};
type Plan = {kind: UtilityKind; target: Vec; started: number; expires: number; shot: Shot;
  eye: Vec; evidence: ThreatReport; allies: DuelActorSnapshot[]; arena: Arena};
const finite = (point: Vec) => [point.x, point.y, point.z].every(Number.isFinite);
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const fresh = (report: ThreatReport | null, time: number, preparing = false): report is ThreatReport => !!report &&
  finite(report.point) && Number.isFinite(report.observedAt) && Number.isFinite(report.readyAt) &&
  time >= report.readyAt && time >= report.observedAt &&
  time - report.observedAt <= (report.source === 'sight'
    ? preparing ? POLICY.setupSightAge : POLICY.sightAge : preparing ? POLICY.setupSoundAge : POLICY.soundAge);
const clear = (from: Vec, to: Vec, arena: Arena) => {
  const d = distance(from, to);
  return d < 1e-6 || traceSolid(from, {x: (to.x - from.x) / d, y: (to.y - from.y) / d,
    z: (to.z - from.z) / d}, arena, d).distance >= d - 1e-5;
};
const protectedFrom = (self: DuelActorSnapshot, report: ThreatReport, arena: Arena) =>
  !clear(self.position, report.point, arena) &&
  !clear({...self.position, y: self.feet + .9}, report.point, arena);
const settled = (self: DuelActorSnapshot) => self.grounded !== false &&
  Math.abs(self.verticalVelocity ?? 0) < .1 && Math.hypot(self.velocity.x, self.velocity.z) < .3;
// The live caller releases on its first simulation tick at/after the native deadline.
const releaseTick = (time: number) => Math.ceil(nativeGrenadeReleaseAt(time) / STEP) * STEP;
const alliesOf = (self: DuelActorSnapshot, peers: readonly DuelActorSnapshot[]) => peers
  .filter(peer => peer.id !== self.id && peer.side === self.side && peer.alive)
  .slice(0, UTILITY_RULES.maxActors - 1);

/** Reuse the live projectile kernel, including launch correction, contacts and think ticks.
 * No opponent actor is synthesized from a report. Work is capped even for unsettled smoke. */
function predict(kind: UtilityKind, shot: Shot, self: DuelActorSnapshot, allies: DuelActorSnapshot[],
  arena: Arena, releaseAt: number): Outcome | undefined {
  const simulation = new UtilitySimulation(1);
  const actors = [{...self, ...shot}, ...allies];
  const launch = utilityLaunchPose(self.position, shot.yaw, shot.pitch, arena);
  simulation.throw({actorId: self.id, side: self.side, kind, ...launch, strength: 1, time: releaseAt,
    velocity: {x: self.velocity.x, y: self.verticalVelocity ?? 0, z: self.velocity.z}});
  const dt = 1 / 8;
  for (let tick = 1; tick <= POLICY.flightSeconds / dt; tick++) {
    const events = simulation.advance(dt, releaseAt + tick * dt, arena, actors);
    if (events.some(event => event.type === 'damage' && event.damage > 0)) return;
    const detonation = events.find(event => event.type === 'detonate');
    if (detonation) return {position: {...detonation.position},
      effect: simulation.snapshot().effects.find(effect => effect.type === 'smoke' || effect.type === 'fire')};
    if (!simulation.projectiles.length) return;
  }
}

function safeOutcome(kind: UtilityKind, target: Vec, outcome: Outcome, self: DuelActorSnapshot,
  allies: DuelActorSnapshot[], report: ThreatReport, arena: Arena) {
  const point = outcome.position;
  if (!finite(point) || gap(point, target) > 2 || Math.abs(point.y - target.y) > (kind === 'flash' ? 3 : 1.5)) return false;
  // Landing near the report is not useful if a wall shields that reported angle.
  const blast = {...point, y: point.y + UNIT};
  if (kind === 'he' && !clear(blast, report.point, arena)) return false;
  if (kind === 'flash') {
    const source = blast;
    if (nativeFlashVisibility(report.point, source, arena) <= 0) return false;
    // Assume friends can turn toward the burst; looking away now is not a safety guarantee.
    return [self, ...allies].every(actor => nativeFlashArguments(distance(actor.position, source) / UNIT, 1,
      nativeFlashVisibility(actor.position, source, arena)).duration <= POLICY.flashSeconds);
  }
  if (kind === 'molotov' || kind === 'incendiary') {
    const effect = outcome.effect;
    // Reserve the entire future spread envelope, not merely the first ignition cell.
    return effect?.type === 'fire' && [self, ...allies].every(actor =>
      Math.abs(actor.feet - effect.position.y) > 1 || gap(actor.position, effect.position) > effect.radius + .8);
  }
  if (kind === 'smoke') {
    const effect = outcome.effect;
    if (effect?.type !== 'smoke') return false;
    const bloomAt = effect.startedAt + UTILITY_RULES.smokeBloom;
    // A teammate with a clear contact lane must not lose it to our defensive smoke.
    return !allies.some(peer => clear(peer.position, report.point, arena) &&
      smokeSegmentExposure(peer.position, report.point, [effect], bloomAt) >= .3);
  }
  return true;
}

/** Low-frequency decisions consume beliefs, never the hidden opponent actor. */
export class BotUtilityPlanner {
  private readonly random: () => number;
  private readonly motor: AimMotor = {yawRate: 0, pitchRate: 0};
  private nextCheck = 0;
  private nextThrow = 3;
  private candidateCursor = 0;
  private plan?: Plan;
  private reason = 'holding-utility';
  constructor(seed: number, actor: number, private readonly level: SkillLevel) {
    this.random = randomStream(seed, `utility-policy:${actor}`);
    this.nextCheck = 1.5 + actor * .15;
  }
  decision() {return this.plan ? `${this.plan.kind}:prepare` : this.reason;}
  target() {return this.plan && {...this.plan.target};}
  cancel(time: number) {
    this.plan = undefined; this.nextThrow = time + 3;
    this.motor.yawRate = this.motor.pitchRate = 0;
    this.reason = 'utility-cancelled';
  }
  command(time: number, self: DuelActorSnapshot, inventory: UtilityInventory, report: ThreatReport | null,
    arena: Arena, context: Context) {
    const skill = this.level === '10+' ? 1 : (this.level - 1) / 9;
    // The caller's short threat-report horizon can end during native deploy.
    // Retain only this plan's own bounded observation, never a hidden live actor.
    report ??= this.plan && fresh(this.plan.evidence, time, true) ? this.plan.evidence : null;
    // These guards run every call, including calls between low-frequency planning checks.
    if (!Number.isFinite(time) || !finite(self.position) || !self.alive || self.reloading ||
      self.equipment === 'knife' || context.visible || time - context.lastShotAt < .75 ||
      !fresh(report, time, !!this.plan) || !settled(self)) {
      if (this.plan) this.cancel(time);
      return;
    }
    const allies = alliesOf(self, context.teammates);
    if (this.plan) {
      const plan = this.plan;
      if (time > plan.expires || inventory[plan.kind] <= 0 || arena !== plan.arena ||
        distance(self.position, plan.eye) > POLICY.positionTolerance ||
        report.observedAt < plan.evidence.observedAt || report.source !== plan.evidence.source ||
        distance(report.point, plan.evidence.point) > POLICY.contactTolerance ||
        allies.length !== plan.allies.length || allies.some(peer => {
          const old = plan.allies.find(ally => ally.id === peer.id && ally.generation === peer.generation);
          return !old || distance(peer.position, old.position) > POLICY.allyTolerance ||
            Math.hypot(peer.velocity.x - old.velocity.x, peer.velocity.z - old.velocity.z) > .3;
        }) || !protectedFrom(self, report, arena)) {
        this.cancel(time);
        return;
      }
    }
    if (!this.plan && time >= this.nextCheck) {
      this.nextCheck = time + POLICY.checks;
      if (time < this.nextThrow || !protectedFrom(self, report, arena)) return;
      this.nextThrow = time + 4 + this.random() * 3;
      const range = gap(self.position, report.point);
      if (range < 7 || range > 25 || this.random() > .12 + skill * .43) return;
      const opportunity = authoredUtilityOpportunity(self, arena, inventory, report, time);
      // Sound is an uncertain area cue, not a precision flash/damage target.
      const permitted = (kind: UtilityKind) => inventory[kind] > 0 &&
        (report.source === 'sight' || kind === 'smoke' || kind === 'decoy') &&
        (kind !== 'smoke' || self.health < 40);
      const preferred: UtilityKind[] = ['molotov', 'incendiary', 'he', 'flash', 'decoy'];
      const available = preferred.filter(permitted);
      const cursor = this.candidateCursor++ % Math.max(1, available.length);
      const kinds = [...new Set([...(opportunity ? [opportunity.kind as UtilityKind] : []),
        ...(permitted('smoke') ? ['smoke' as const] : []), ...available.slice(cursor), ...available.slice(0, cursor)])];
      let checks = 0;
      // First pass: one shot per kind. Rotate the shortlist on later attempts so a
      // four-candidate budget cannot permanently starve HE/flash behind two fire types.
      for (const high of [false, true]) for (const kind of kinds.filter(permitted)) {
        if (checks >= POLICY.candidates || this.plan) break;
        const authored = opportunity?.kind === kind ? opportunity : undefined;
        if (high && authored) continue;
        const factor = kind === 'smoke' ? Math.min(.55, 7 / range) : 1;
        // Unauthored target height is a body-point offset approximation, not a
        // resolved platform/ramp floor. The outcome height tolerance is policy,
        // not floor certainty; fire additionally requires a real kernel fire effect.
        const target = authored?.target ?? {x: self.position.x + (report.point.x - self.position.x) * factor,
          y: kind === 'smoke' ? self.feet + .1 : report.point.y - (kind === 'flash' ? .1 : 1.2),
          z: self.position.z + (report.point.z - self.position.z) * factor};
        checks++;
        const shot = authored ?? solveUtilityThrow(self.position, target, arena, high);
        if (!shot) continue;
        const outcome = predict(kind, shot, self, allies, arena, releaseTick(time));
        if (!outcome || !safeOutcome(kind, target, outcome, self, allies, report, arena)) continue;
        this.plan = {kind, target: {...target}, started: time, expires: time + 3.5, shot: {yaw: shot.yaw, pitch: shot.pitch},
          eye: {...self.position}, evidence: {...report, point: {...report.point}},
          allies: allies.map(peer => ({...peer, position: {...peer.position}, velocity: {...peer.velocity}})), arena};
        this.reason = authored ? `validated-lineup:${authored.id}` : 'validated-sensed-contact';
      }
    }
    if (!this.plan) return;
    const {yaw, pitch} = this.plan.shot;
    const yawError = angleDelta(yaw, self.yaw), pitchError = pitch - self.pitch;
    const aim = aimStep(this.motor, yawError, pitchError, 220 + (1 - skill) * 180);
    const ready = context.readyToThrow !== false &&
      time - this.plan.started >= .45 &&
      Math.hypot(yawError, pitchError) < .25 * DEG;
    if (ready) {
      // One final replay of the actual view and release clock, not the ideal solver angle.
      const outcome = predict(this.plan.kind, self, self, allies, arena, releaseTick(time));
      if (!outcome || !safeOutcome(this.plan.kind, this.plan.target, outcome, self, allies, report, arena)) {
        this.cancel(time); return;
      }
    }
    const command = {kind: this.plan.kind, yawDelta: aim.yawDelta, pitchDelta: aim.pitchDelta, throw: ready};
    if (ready) {
      // The caller queues native pin/release timing and must hold this validated pose.
      command.yawDelta = command.pitchDelta = 0;
      this.plan = undefined; this.nextThrow = time + 6 + this.random() * 4;
      this.motor.yawRate = this.motor.pitchRate = 0;
      this.reason = 'utility-commitment';
    }
    return command;
  }
}
