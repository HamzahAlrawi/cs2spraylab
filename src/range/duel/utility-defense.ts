import {UNIT, type Vec} from '../actor-physics';
import type {SkillLevel} from './config';
import {canFitInArena, type Arena} from './geometry';
import {aimStep, type AimMotor} from './motor';
import {clearSegment} from './navigation';
import {randomStream} from './rng';
import type {ActorCommand, DuelActorSnapshot} from './types';
import {UTILITY_RULES, type UtilityEffect, type UtilityProjectile} from './utilities';

/** Reactions use visible throws or local fire contact, never an unseen thrower's pose. */
export class BotUtilityDefense {
  private readonly random: () => number;
  private readonly motor: AimMotor = {yawRate: 0, pitchRate: 0};
  private readonly seen = new Set<number>();
  private flash?: {readyAt: number; until: number; yaw: number};
  private escape?: Vec;
  private nextEscape = 0;
  private reason = 'none';
  private readonly skill: number;
  constructor(seed: number, actorId: number, level: SkillLevel) {
    this.random = randomStream(seed, `utility-defense:${actorId}`);
    this.skill = level === '10+' ? 1 : (level - 1) / 9;
  }
  perceive(time: number, self: DuelActorSnapshot, visible: readonly UtilityProjectile[]) {
    for (const projectile of visible) {
      if (projectile.kind !== 'flash' || this.seen.has(projectile.id)) continue;
      if (this.seen.size >= 32) this.seen.delete(this.seen.values().next().value!);
      this.seen.add(projectile.id);
      if (this.random() > .05 + this.skill * .8) continue;
      const readyAt = time + .2 + (1 - this.skill) * .35 + this.random() * .12;
      const until = projectile.thrownAt + UTILITY_RULES.fuse + .12;
      if (readyAt >= until) continue;
      this.flash = {readyAt, until,
        yaw: Math.atan2(-(projectile.position.x - self.position.x), -(projectile.position.z - self.position.z)) + Math.PI};
    }
  }
  decision() {return this.reason;}
  command(time: number, self: DuelActorSnapshot, arena: Arena, effects: readonly UtilityEffect[]): Partial<ActorCommand> | undefined {
    this.reason = 'none';
    const command: Partial<ActorCommand> = {};
    if (this.flash && time >= this.flash.readyAt && time < this.flash.until) {
      const error = Math.atan2(Math.sin(this.flash.yaw - self.yaw), Math.cos(this.flash.yaw - self.yaw));
      const turn = aimStep(this.motor, error, -self.pitch * .25, 200 + (1 - this.skill) * 220);
      Object.assign(command, turn, {fireHeld: false, firePressed: false, secondaryHeld: false, secondaryPressed: false});
      this.reason = 'turn-from-seen-flash';
    } else if (this.flash && time >= this.flash.until) this.flash = undefined;
    if (time >= this.nextEscape) {
      this.nextEscape = time + .2; this.escape = undefined;
      const cells = effects.filter(effect => effect.type === 'fire' && time < effect.expiresAt)
        .flatMap(effect => effect.cells).filter(cell => Math.abs(cell.y - self.feet) < .4);
      const safety = (point: Vec) => cells.reduce((nearest, cell) => Math.min(nearest,
        Math.hypot(cell.x - point.x, cell.z - point.z)), Infinity);
      if (safety(self.position) < .95) {
        let best = safety(self.position);
        const from = {...self.position, y: self.feet};
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4 + self.yaw;
          const candidate = {x: from.x + Math.cos(angle) * 1.4, y: self.feet, z: from.z + Math.sin(angle) * 1.4};
          const score = safety(candidate);
          if (score > best && canFitInArena(candidate, self.feet, (self.crouched ? 54 : 72) * UNIT, arena) && clearSegment(from, candidate, arena)) {
            best = score; this.escape = candidate;
          }
        }
      }
    }
    if (this.escape) {
      const dx = this.escape.x - self.position.x, dz = this.escape.z - self.position.z, length = Math.hypot(dx, dz);
      if (length > .15) {
        const yaw = self.yaw + (command.yawDelta ?? 0);
        command.forward = (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / length;
        command.side = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length;
        command.walk = false; command.crouch = false;
        this.reason = 'leave-burning-floor';
      }
    }
    return Object.keys(command).length ? command : undefined;
  }
}
