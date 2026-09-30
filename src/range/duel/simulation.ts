import {advanceActor, DEG, STEP, UNIT, type ActorKinematics, type Vec} from '../actor-physics';
import {gameData, type Weapon} from '../config';
import {botConfig, rosterBehaviors, sanitizeDuelConfig, type DuelConfig} from './config';
import {BotBrain} from './brain';
import {TacticalBrain} from './tactics';
import {resolveDamage} from './damage';
import {canFitInArena, moveInArena, pointOnRay, testArena, traceActor, traceSolid, type Arena} from './geometry';
import {observeBot} from './perception';
import {randomStream} from './rng';
import {interpolateActors} from './presentation';
import {createBotTraits} from './skill';
import {idleCommand, type ActorCommand, type DuelActorSnapshot, type DuelEvent, type Hitgroup} from './types';
import {DuelWeaponState, type FiredRound} from './weapon-state';
import {verticalContact} from '../actor-collision';
import {FOOTSTEP_RANGE, footstepGain} from '../sound-model';
import {proficiency} from './awareness';
import {equipmentForSlot, equipmentStats, type Equipment, type Slot} from '../equipment';
import {DuelCoach} from './coaching';
import {coveredSpawns} from './spawns';
import {applyTagging, recoverTagging, type TaggingState} from '../tagging';

type CombatActor = ActorKinematics & TaggingState & {
  id: number;
  generation: number;
  side: 'player' | 'enemy';
  pitch: number;
  health: number;
  armor: number;
  helmet: boolean;
  alive: boolean;
  weapon: DuelWeaponState;
  command: ActorCommand;
  stepDistance: number;
  inventory: Map<Equipment, DuelWeaponState>;
  equipReadyAt: number;
};
type PendingHit = {victim: CombatActor; weapon: Equipment; event: Extract<DuelEvent, {kind: 'hit'}>};

const makeActor = (id: number, side: CombatActor['side'], x: number, z: number, weapon: Weapon,
  health: number, armored: boolean, seed: number): CombatActor => ({
  id, generation: 1, side,
  position: {x, y: 64 * UNIT, z}, velocity: {x: 0, z: 0}, yaw: side === 'player' ? 0 : Math.PI,
  pitch: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false,
  health, armor: armored ? 100 : 0, helmet: armored, alive: true,
  flinchStack: 1, velocityModifier: 1,
  weapon: new DuelWeaponState(weapon, randomStream(seed, `shot:${id}`)), command: idleCommand(),
  stepDistance: 0,
  inventory: new Map(), equipReadyAt: 0,
});

export class DuelSimulation {
  readonly config: DuelConfig;
  readonly arena: Arena;
  readonly actors: CombatActor[];
  time = 0;
  tick = 0;
  accumulator = 0;
  phase: 'ready' | 'fighting' | 'result' = 'ready';
  outcome?: 'won' | 'lost' | 'draw';
  private paused = false;
  private shotId = 0;
  private events: DuelEvent[] = [];
  private brains = new Map<number, BotBrain | TacticalBrain>();
  private controlledBots = new Set<number>();
  private lastCalloutAt = new Map<number, number>();
  private previous: DuelActorSnapshot[] = [];
  readonly coach = new DuelCoach();
  playerAspect = 16 / 9;

  constructor(config: DuelConfig = sanitizeDuelConfig({}), private seed = 1, arena: Arena = testArena(), private playerWeapon: Weapon = 'ak47') {
    this.config = sanitizeDuelConfig(config);
    this.arena = arena;
    this.actors = [makeActor(0, 'player', 0, 8, playerWeapon, this.config.playerHealth, true, seed)];
    this.actors[0].position.z *= this.config.arenaScale;
    const spawns = arena.solids.length ? coveredSpawns(arena, seed, this.config.botCount) : undefined;
    if (spawns) this.actors[0].position = {...spawns.player};
    const behaviors = rosterBehaviors(this.config, seed);
    for (let index = 0; index < this.config.botCount; index++) {
      const bot = botConfig(this.config, index);
      this.actors.push(makeActor(index + 1, 'enemy', (index - (this.config.botCount - 1) / 2) * .88,
        -8 * this.config.arenaScale, bot.weapon, bot.health, bot.armor, seed));
      if (spawns) this.actors[index + 1].position = {...spawns.bots[index]};
      const traits = createBotTraits(bot.skill, seed, index + 1);
      const random = randomStream(seed, `brain:${index + 1}`);
      this.brains.set(index + 1, arena.lanes?.length
        ? new TacticalBrain(traits, behaviors[index], bot.accuracy, random, arena, bot.skill, bot.weapon, index + 1, seed % 2)
        : new BotBrain(traits, behaviors[index], bot.accuracy, random));
    }
  }

  start() { if (this.phase === 'ready') this.phase = 'fighting'; }
  equipPlayer(slot: Slot) {
    const actor = this.actors[0], id = equipmentForSlot(slot, this.playerWeapon);
    if (!actor.alive || actor.weapon.id === id) return;
    actor.weapon.reloadUntil = 0; actor.weapon.pendingPress = false;
    actor.inventory.set(actor.weapon.id, actor.weapon);
    actor.weapon = actor.inventory.get(id) ?? new DuelWeaponState(id, randomStream(this.seed, `equipment:${id}`));
    actor.inventory.set(id, actor.weapon);
    actor.equipReadyAt = this.time + (this.phase === 'ready' ? 0 : 1);
    actor.command.fireHeld = actor.command.firePressed = false;
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; for (const actor of this.actors) actor.command = idleCommand(); }

  command(actorId: number, patch: Partial<ActorCommand>) {
    const actor = this.actors[actorId];
    if (!actor || !actor.alive) return;
    if (actorId !== 0) this.controlledBots.add(actorId);
    actor.command = {
      ...actor.command, ...patch,
      yawDelta: actor.command.yawDelta + (patch.yawDelta ?? 0),
      pitchDelta: actor.command.pitchDelta + (patch.pitchDelta ?? 0),
      firePressed: actor.command.firePressed || patch.firePressed === true,
      reloadPressed: actor.command.reloadPressed || patch.reloadPressed === true,
    };
  }

  advance(elapsed: number) {
    if (this.phase !== 'fighting' || this.paused) return;
    this.accumulator += Math.min(Math.max(elapsed, 0), .25);
    while (this.accumulator + 1e-10 >= STEP && this.phase === 'fighting') {
      this.step(); this.accumulator -= STEP;
    }
  }

  step() {
    if (this.phase !== 'fighting' || this.paused) return;
    this.tick++;
    this.time = this.tick * STEP;
    const actorView = this.snapshot();
    this.previous = actorView;
    if (this.tick % 4 === 1) {
      this.coach.observe(this.time, actorView[0], actorView.slice(1).flatMap(opponent => {
        const visible = observeBot(this.time, actorView[0], [opponent], this.arena,
          {aspect: this.playerAspect, verticalFov: 2 * Math.atan(.75)}).visible;
        return visible ? [visible] : [];
      }));
      for (const actor of actorView.slice(1)) {
        if (!actor.alive || this.controlledBots.has(actor.id)) continue;
        this.brains.get(actor.id)?.perceive(observeBot(this.time, actor, actorView, this.arena));
      }
      for (const actor of actorView.slice(1)) {
        const brain = this.brains.get(actor.id);
        if (!actor.alive || !(brain instanceof TacticalBrain) ||
          this.time - (this.lastCalloutAt.get(actor.id) ?? -Infinity) < 1.5) continue;
        const report = brain.contactReport(this.time);
        if (!report) continue;
        this.lastCalloutAt.set(actor.id, this.time);
        for (const peer of actorView.slice(1)) {
          if (!peer.alive || peer.id === actor.id) continue;
          const listener = this.brains.get(peer.id);
          if (listener instanceof TacticalBrain) listener.teammateCallout(report, this.time);
        }
      }
    }
    for (const actor of this.actors.slice(1)) {
      if (!actor.alive || this.controlledBots.has(actor.id)) continue;
      const brain = this.brains.get(actor.id);
      const patch = brain instanceof TacticalBrain
        ? brain.command(actorView[actor.id], this.time, actor.weapon.recovery.recoil, actorView.slice(1))
        : brain?.command(actorView[actor.id], this.time);
      if (patch) this.commandBot(actor, patch);
    }
    const shots: {actor: CombatActor; fired: FiredRound; shotId: number}[] = [];
    for (const actor of this.actors) {
      if (!actor.alive) continue;
      const command = actor.command;
      if (actor.id === 0 && command.equipSlot) {this.equipPlayer(command.equipSlot); command.equipSlot = undefined;}
      actor.yaw += command.yawDelta;
      actor.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, actor.pitch + command.pitchDelta));
      recoverTagging(actor, STEP, actor.grounded ?? actor.feet === 0);
      const next = advanceActor(actor, command, equipmentStats(actor.weapon.id).speed * UNIT, STEP,
        (from, desired, feet, height) => {
          const staticPosition = moveInArena(from, desired, feet, height, this.arena);
          const clear = (position: Vec) => this.actors.every(other => other === actor || !other.alive ||
            Math.hypot(position.x - other.position.x, position.z - other.position.z) >= 32 * UNIT);
          if (clear(staticPosition)) return staticPosition;
          const xOnly = {...staticPosition, z: from.z};
          if (clear(xOnly)) return xOnly;
          const zOnly = {...staticPosition, x: from.x};
          return clear(zOnly) ? zOnly : from;
        }, (position, feet, height) => canFitInArena(position, feet, height, this.arena),
        (position, from, to, height) => verticalContact(position, from, to, height, this.arena.solids));
      const traveled = Math.hypot(next.position.x - actor.position.x, next.position.z - actor.position.z);
      if (next.grounded && !(actor.grounded ?? actor.feet === 0)) this.emitSound(actor, 'landing', next.position);
      const audible = Math.hypot(next.velocity.x, next.velocity.z) > equipmentStats(actor.weapon.id).speed * UNIT * .54;
      if (next.grounded && audible && traveled > 0) {
        actor.stepDistance += traveled;
        if (actor.stepDistance >= 1.35) {
          actor.stepDistance %= 1.35;
          this.emitSound(actor, 'footstep', next.position);
        }
      } else if (!audible) actor.stepDistance = 0;
      actor.position = next.position; actor.velocity = next.velocity; actor.feet = next.feet;
      actor.verticalVelocity = next.verticalVelocity; actor.eyeHeight = next.eyeHeight;
      actor.duckAmount = next.duckAmount; actor.jumpHeld = next.jumpHeld;
      actor.duckSpeed = next.duckSpeed; actor.crouchHeld = next.crouchHeld;
      actor.duckCooldown = next.duckCooldown; actor.duckRecoveryOrigin = next.duckRecoveryOrigin;
      actor.grounded = next.grounded;
      for (const state of actor.inventory.values()) if (state !== actor.weapon) state.recovery.advance(STEP, (actor.duckAmount ?? 0) >= .95, !actor.grounded);
      const fired = actor.weapon.advance(this.time, STEP, this.time < actor.equipReadyAt ? {...command, fireHeld: false, firePressed: false} : command, actor);
      command.yawDelta = command.pitchDelta = 0;
      command.firePressed = command.reloadPressed = false;
      if (!fired) continue;
      if (actor.id === 0) this.coach.shot(this.snapshot()[0]);
      const shotId = this.shotId++;
      shots.push({actor, fired, shotId});
      this.emit({kind: 'fire', tick: this.tick, actorId: actor.id, shotId,
        equipment: fired.weapon, origin: fired.origin, direction: fired.direction});
      this.informHearing(actor, fired.origin, 'gunshot');
    }
    const pending: PendingHit[] = [];
    for (const shot of shots) this.resolveShot(shot.actor, shot.fired, shot.shotId, pending);
    for (const {victim, weapon, event} of pending) {
      if (!victim.alive) continue;
      event.healthDamage = Math.min(victim.health, event.healthDamage);
      event.armorDamage = Math.min(victim.armor, event.armorDamage);
      const lethal = victim.alive && victim.health <= event.healthDamage;
      victim.health = Math.max(0, victim.health - event.healthDamage);
      victim.armor = Math.max(0, victim.armor - event.armorDamage);
      if (victim.health === 0) victim.alive = false;
      if (victim.alive && event.healthDamage > 0) applyTagging(victim, weapon, victim.weapon.id);
      if (victim.alive && victim.side === 'enemy') {
        const brain = this.brains.get(victim.id);
        if (brain instanceof TacticalBrain) brain.hurt(this.time, victim.health);
      }
      if (lethal && victim.side === 'enemy') for (const peer of this.actors.slice(1)) {
        if (!peer.alive || peer.id === victim.id) continue;
        const brain = this.brains.get(peer.id);
        if (brain instanceof TacticalBrain) brain.teammateCallout(victim.position, this.time);
      }
      event.lethal = lethal;
      this.coach.hit(event, this.time, this.actors[event.shooter].weapon.id === 'knife');
      this.emit(event);
    }
    if (!this.actors[0].alive || this.actors.slice(1).every(actor => !actor.alive) || this.time >= this.config.roundSeconds) {
      const playerAlive = this.actors[0].alive, botsAlive = this.actors.slice(1).some(actor => actor.alive);
      this.outcome = playerAlive && !botsAlive ? 'won' : !playerAlive && botsAlive ? 'lost' : 'draw';
      this.phase = 'result';
      this.emit({kind: 'round', tick: this.tick, outcome: this.outcome, seconds: this.time});
    }
  }

  private commandBot(actor: CombatActor, patch: Partial<ActorCommand>) {
    actor.command = {...actor.command, ...patch};
  }

  private resolveShot(shooter: CombatActor, fired: FiredRound, shotId: number, pending: PendingHit[]) {
    const stats = equipmentStats(fired.weapon);
    const range = fired.weapon === 'knife' ? 48 * UNIT : stats.range * UNIT;
    const surface = traceSolid(fired.origin, fired.direction, this.arena, range);
    let nearest = {distance: surface.distance, actor: undefined as CombatActor | undefined, group: undefined as Hitgroup | undefined};
    for (const actor of this.actors) {
      if (actor.id === shooter.id || !actor.alive) continue;
      const feet = {...actor.position, y: actor.position.y - actor.eyeHeight};
      const hit = traceActor(fired.origin, fired.direction, feet, actor.duckAmount ?? 0, Math.min(range, nearest.distance));
      if (hit.group && hit.distance < nearest.distance) nearest = {distance: hit.distance, actor, group: hit.group};
    }
    if (nearest.actor && nearest.group) {
      if (nearest.actor.side === shooter.side) return;
      const damage = resolveDamage(fired.weapon, nearest.group, nearest.distance, nearest.actor.armor, nearest.actor.helmet);
      pending.push({victim: nearest.actor, weapon: fired.weapon, event: {kind: 'hit', tick: this.tick, shooter: shooter.id,
        victim: nearest.actor.id, shotId, group: nearest.group,
        point: pointOnRay(fired.origin, fired.direction, nearest.distance), ...damage, lethal: false}});
    } else if (Number.isFinite(surface.distance)) {
      this.emit({kind: 'surface', tick: this.tick, shooter: shooter.id, shotId,
        point: pointOnRay(fired.origin, fired.direction, surface.distance), surfaceId: surface.surfaceId});
    }
  }

  snapshot(): DuelActorSnapshot[] {
    return this.actors.map(actor => ({
      id: actor.id, generation: actor.generation, side: actor.side, position: {...actor.position}, velocity: {...actor.velocity},
      feet: actor.feet, grounded: actor.grounded ?? actor.feet === 0, yaw: actor.yaw, pitch: actor.pitch, crouched: (actor.duckAmount ?? 0) >= .5,
      duckAmount: actor.duckAmount ?? 0, health: actor.health, armor: actor.armor,
      helmet: actor.helmet, alive: actor.alive, equipment: actor.weapon.id, ammo: actor.weapon.ammo,
      reloading: actor.weapon.reloadUntil > 0,
    }));
  }

  botDecision(actorId: number) {
    const brain = this.brains.get(actorId);
    return brain instanceof TacticalBrain ? brain.decisionSnapshot() : undefined;
  }

  renderSnapshot() {
    const current = this.snapshot();
    if (this.paused || this.phase !== 'fighting') return current;
    const presented = interpolateActors(this.previous, current, this.accumulator);
    // Mouse look is immediate, even on frames between fixed simulation ticks.
    presented[0].yaw = current[0].yaw + this.actors[0].command.yawDelta;
    presented[0].pitch = Math.max(-89 * DEG, Math.min(89 * DEG, current[0].pitch + this.actors[0].command.pitchDelta));
    return presented;
  }

  drainEvents(): DuelEvent[] { const events = this.events; this.events = []; return events; }

  private emit(event: DuelEvent) {
    if (this.events.length === 512) this.events.shift();
    this.events.push(event);
  }

  private emitSound(actor: CombatActor, sound: 'footstep' | 'landing', point: Vec) {
    this.emit({kind: 'sound', tick: this.tick, actorId: actor.id, sound, point: {...point}});
    this.informHearing(actor, point, sound);
  }

  private informHearing(actor: CombatActor, point: Vec, sound: 'footstep' | 'landing' | 'gunshot') {
    if (actor.side !== 'player') return;
    for (const listener of this.actors.slice(1)) {
      if (!listener.alive) continue;
      const brain = this.brains.get(listener.id);
      if (!(brain instanceof TacticalBrain)) continue;
      const dx = point.x - listener.position.x, dy = point.y - listener.position.y, dz = point.z - listener.position.z;
      const distance = Math.hypot(dx, dy, dz);
      const range = sound === 'gunshot' ? 2200 * UNIT : FOOTSTEP_RANGE;
      if (distance > range || distance < .01) continue;
      const occluded = traceSolid(listener.position, {x: dx / distance, y: dy / distance, z: dz / distance},
        this.arena, distance - .1).distance < distance - .1;
      const threshold = .018 + (1 - proficiency(botConfig(this.config, listener.id - 1).skill)) * .03;
      if (sound !== 'gunshot' && footstepGain(distance) * (occluded ? .625 : 1) < threshold) continue;
      brain.hear(point, this.time, sound, occluded);
    }
  }
}
