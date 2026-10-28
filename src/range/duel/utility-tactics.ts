import {DEG, type Vec} from '../actor-physics';
import type {SkillLevel} from './config';
import {traceSolid, type Arena} from './geometry';
import {aimStep, type AimMotor} from './motor';
import {randomStream} from './rng';
import type {ThreatReport} from './trading';
import type {DuelActorSnapshot} from './types';
import {UTILITY_RULES} from './utilities';
import type {UtilityInventory, UtilityKind} from './utility-loadout';
import {solveUtilityThrow} from './utility-ballistics';
import {authoredUtilityOpportunity} from './utility-opportunities';

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
type Plan = {kind: UtilityKind; target: Vec; started: number; expires: number; authored?: {yaw:number;pitch:number;name:string}};

/** Low-frequency decisions consume beliefs, never the hidden opponent actor. */
export class BotUtilityPlanner {
  private readonly random: () => number;
  private readonly motor: AimMotor = {yawRate: 0, pitchRate: 0};
  private nextCheck = 0;
  private nextThrow = 3;
  private plan?: Plan;
  private reason = 'holding-utility';
  constructor(seed: number, actor: number, private readonly level: SkillLevel) {
    this.random = randomStream(seed, `utility-policy:${actor}`);
    this.nextCheck = 1.5 + actor * .15;
  }
  decision() {return this.plan ? `${this.plan.kind}:prepare` : this.reason;}
  target() {return this.plan?.target;}
  cancel(time: number) {this.plan = undefined; this.nextThrow = time + 3;}
  command(time: number, self: DuelActorSnapshot, inventory: UtilityInventory, report: ThreatReport | null,
    arena: Arena, context: {visible: boolean; lastShotAt: number; teammates: readonly DuelActorSnapshot[]}) {
    const skill = this.level === '10+' ? 1 : (this.level - 1) / 9;
    if (this.plan && (time > this.plan.expires || !self.alive || self.reloading || inventory[this.plan.kind] <= 0 ||
      context.visible && time - context.lastShotAt < .5)) this.cancel(time);
    if (!this.plan && time >= this.nextCheck) {
      this.nextCheck = time + .35;
      if (!report || time < report.readyAt || time - report.observedAt > 2.2 || time < this.nextThrow ||
        self.reloading || context.visible || time - context.lastShotAt < .75 || self.equipment === 'knife') return;
      this.nextThrow = time + 4 + this.random() * 3;
      const opportunity=authoredUtilityOpportunity(self,arena,inventory,report,time);
      const distance = gap(self.position, report.point);
      if (distance < 7 || distance > 25 || this.random() > .12 + skill * .43) return;
      const covered = Number.isFinite(traceSolid(self.position,
        {x: (report.point.x - self.position.x) / Math.max(.01, distance), y: 0,
          z: (report.point.z - self.position.z) / Math.max(.01, distance)}, arena, distance - .2).distance);
      const kind: UtilityKind | undefined = opportunity?.kind as UtilityKind | undefined ?? (self.health < 40 && inventory.smoke ? 'smoke'
        : covered && inventory.flash && this.random() < .5 ? 'flash'
          : covered && (inventory.molotov || inventory.incendiary) ? inventory.molotov ? 'molotov' : 'incendiary'
            : inventory.he ? 'he' : inventory.flash ? 'flash' : inventory.decoy ? 'decoy' : undefined);
      if (!kind) return;
      const factor = kind === 'smoke' ? Math.min(.55, 7 / distance) : 1;
      const target = opportunity?.target ?? {x: self.position.x + (report.point.x - self.position.x) * factor,
        y: kind === 'smoke' ? self.feet + .1 : report.point.y - (kind === 'flash' ? .1 : 1.2),
        z: self.position.z + (report.point.z - self.position.z) * factor};
      if ((kind === 'he' || kind === 'molotov' || kind === 'incendiary') && context.teammates.some(peer =>
        peer.id !== self.id && peer.alive && gap(peer.position, target) < (kind === 'he' ? 7 : 4))) return;
      // Throwing straight into an adjacent wall is not a useful setup.
      const direction = utilityAimDirection(self.position, target);
      if (!direction || traceSolid(self.position, direction, arena, 1.2).distance < 1.2) return;
      this.plan = {kind, target, started: time, expires: time + 3.5, authored:opportunity?{yaw:opportunity.yaw,pitch:opportunity.pitch,name:opportunity.name}:undefined};
      this.reason = opportunity?`validated-lineup:${opportunity.id}`:'sensed-contact-setup';
    }
    if (!this.plan) return;
    const solution = this.plan.authored ?? solveUtilityThrow(self.position, this.plan.target, arena);
    if (!solution) {this.cancel(time); return;}
    const {yaw,pitch}=solution;
    const yawError = angleDelta(yaw, self.yaw), pitchError = pitch - self.pitch;
    const aim = aimStep(this.motor, yawError, pitchError, 220 + (1 - skill) * 180);
    const stopped = Math.hypot(self.velocity.x, self.velocity.z) < .3;
    const ready = time - this.plan.started >= .45 && stopped && Math.hypot(yawError, pitchError) < 3 * DEG;
    const command = {kind: this.plan.kind, yawDelta: aim.yawDelta, pitchDelta: aim.pitchDelta, throw: ready};
    if (ready) {this.plan = undefined; this.nextThrow = time + 6 + this.random() * 4; this.reason = 'utility-commitment';}
    return command;
  }
}
