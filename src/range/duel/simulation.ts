import {advanceActor, DEG, STEP, UNIT, type ActorKinematics, type Vec} from '../actor-physics';
import {gameData, pistolIds, type Weapon, type Pistol} from '../config';
import {botConfig, rosterBehaviors, sanitizeDuelConfig, type DuelConfig} from './config';
import {BotBrain} from './brain';
import {TacticalBrain} from './tactics';
import {isKnifeBackstab,resolveDamage} from './damage';
import {canFitInArena, moveInArena, pointOnRay, testArena, traceActor, traceSolid, type Arena} from './geometry';
import {observeBot} from './perception';
import {randomStream} from './rng';
import {interpolateActors} from './presentation';
import {createBotTraits} from './skill';
import {idleCommand, type ActorCommand, type DuelActorSnapshot, type DuelEvent, type Hitgroup} from './types';
import {DuelWeaponState, type FiredRound} from './weapon-state';
import {verticalContact} from '../actor-collision';
import {FOOTSTEP_RANGE, footstepGain, gunshotGain, gunshotRange} from '../sound-model';
import {proficiency} from './awareness';
import {equipmentForSlot, equipmentStats, type Equipment, type Slot} from '../equipment';
import {DuelCoach} from './coaching';
import {coveredSpawns} from './spawns';
import {applyTagging, recoverTagging, type TaggingState} from '../tagging';
import {DamagePunch} from '../aim-punch';
import {RadarMemory} from './radar';
import {resolveBulletRay} from './penetration';
import {traceMelee} from './melee';
import {advanceEnvironment,createEnvironmentState,damageEnvironmentPiece,environmentPieceId,environmentSolids,
  useEnvironmentPiece,arenaBoostPOIs,type EnvironmentState,type EnvironmentResult} from './environment';
import {actorBody,arenaMovementEnvironment,canWalkTo} from './traversal';
import {TeamTacticsPlanner,BoostPlanner,type TacticalPeer,type TeamContact,type BoostPlan,type BoostPOI} from './coordination';
import {TerrainTactics} from './terrain-tactics';
import {actorShadows} from './shadow-scene';
import {AcousticScene} from '../spatial-audio';

type CombatActor = ActorKinematics & TaggingState & {
  id: number;
  generation: number;
  side: 'player' | 'enemy';
  pitch: number;
  punch: DamagePunch;
  deathDirection?: Vec;
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
type PendingHit = {victim: CombatActor; weapon: Equipment; direction: Vec; event: Extract<DuelEvent, {kind: 'hit'}>};
export type DroppedWeapon = {id: number; equipment: Weapon; ammo: number; reserve?:number; position: Vec; picked: boolean};

const makeActor = (id: number, side: CombatActor['side'], x: number, z: number, weapon: Equipment,
  health: number, armored: boolean, seed: number): CombatActor => ({
  id, generation: 1, side,
  position: {x, y: 64 * UNIT, z}, velocity: {x: 0, z: 0}, yaw: side === 'player' ? 0 : Math.PI,
  pitch: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false,
  health, armor: armored ? 100 : 0, helmet: armored, alive: true,
  flinchStack: 1, velocityModifier: 1,
  punch: new DamagePunch(randomStream(seed, `damage-punch:${id}`)),
  weapon: new DuelWeaponState(weapon, randomStream(seed, `shot:${id}`)), command: idleCommand(),
  stepDistance: 0,
  inventory: new Map(), equipReadyAt: 0,
});

export class DuelSimulation {
  readonly config: DuelConfig;
  readonly arena: Arena;
  readonly authoredArena: Arena;
  environment: EnvironmentState;
  readonly actors: CombatActor[];
  readonly drops: DroppedWeapon[] = [];
  readonly radar = new RadarMemory();
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
  private combatActions = new Map<number,{action:DuelActorSnapshot['action'];at:number}>();
  private usedAt = new Map<number,number>();
  private hasSidearm = true;
  private dropSequence = 1000;
  private readonly teamPlanner=new TeamTacticsPlanner();
  private readonly boostPlanner=new BoostPlanner();
  private readonly terrainTactics:TerrainTactics;
  private terrainCommand?:{actorId:number;command:Partial<ActorCommand>};
  private boostPlan:BoostPlan|null=null;
  private teamContacts:TeamContact[]=[];
  private lastShotAt=new Map<number,number>();
  private lastHurtAt=new Map<number,number>();
  private lastDownAt=new Map<number,number>();
  private lastContactAt=new Map<number,number>();
  private readonly acoustics=new AcousticScene();
  private boostFeasibility=new Map<string,boolean>();
  readonly coach = new DuelCoach();
  playerAspect = 16 / 9;

  constructor(config: DuelConfig = sanitizeDuelConfig({}), private seed = 1, arena: Arena = testArena(), private playerWeapon: Weapon = 'ak47', private sidearm: Pistol = 'usp', private hasPrimary = true) {
    this.config = sanitizeDuelConfig(config);
    this.terrainTactics=new TerrainTactics(seed);
    this.authoredArena = arena;
    this.environment = createEnvironmentState(arena);
    this.arena = {...arena,solids:environmentSolids(arena,this.environment)};
    this.acoustics.setBoxes(this.arena.solids);
    this.actors = [makeActor(0, 'player', 0, 8, hasPrimary ? playerWeapon : sidearm, this.config.playerHealth, this.config.playerArmor, seed)];
    this.actors[0].armor = this.config.playerArmor ? this.config.playerArmorPoints : 0;
    this.actors[0].helmet = this.config.playerArmor && this.config.playerHelmet;
    this.actors[0].position.z *= this.config.arenaScale;
    const spawns = this.arena.solids.length ? coveredSpawns(this.arena, seed, this.config.botCount) : undefined;
    if (spawns) this.actors[0].position = {...spawns.player};
    const behaviors = rosterBehaviors(this.config, seed);
    for (let index = 0; index < this.config.botCount; index++) {
      const bot = botConfig(this.config, index);
      this.actors.push(makeActor(index + 1, 'enemy', (index - (this.config.botCount - 1) / 2) * .88,
        -8 * this.config.arenaScale, bot.weapon, bot.health, bot.armor, seed));
      this.actors[index+1].armor = bot.armor ? bot.armorPoints : 0;
      this.actors[index+1].helmet = bot.armor && bot.helmet;
      if (spawns) this.actors[index + 1].position = {...spawns.bots[index]};
      const traits = createBotTraits(bot.skill, seed, index + 1);
      const random = randomStream(seed, `brain:${index + 1}`);
      this.brains.set(index + 1, arena.lanes?.length
        ? new TacticalBrain(traits, behaviors[index], bot.accuracy, random, this.arena, bot.skill, bot.weapon==='knife'?'ak47':bot.weapon, index + 1, seed % 2)
        : new BotBrain(traits, behaviors[index], bot.accuracy, random));
    }
  }

  start() { if (this.phase === 'ready') this.phase = 'fighting'; }
  get loadout() {return {primary: this.hasPrimary ? this.playerWeapon : null, sidearm: this.hasSidearm ? this.sidearm : null};}
  nearestPickup() {
    const player = this.actors[0];
    if (!player.alive || this.phase !== 'fighting') return;
    return this.drops.filter(drop => !drop.picked && Math.hypot(drop.position.x - player.position.x,
      drop.position.z - player.position.z, drop.position.y - player.feet) < 2)
      .filter(drop => {
        const dy = drop.position.y + .2 - player.position.y;
        const dx = drop.position.x - player.position.x, dz = drop.position.z - player.position.z;
        const distance = Math.hypot(dx, dy, dz);
        return !Number.isFinite(traceSolid(player.position, {x: dx / distance, y: dy / distance, z: dz / distance}, this.arena, distance - .05).distance);
      }).sort((a, b) => Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z) -
        Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z))[0];
  }
  pickupPlayer() {
    const drop = this.nearestPickup(), actor = this.actors[0];
    if (!drop) return false;
    const slot: Slot = pistolIds.includes(drop.equipment as Pistol) ? 2 : 1;
    const old = equipmentForSlot(slot, this.playerWeapon, this.sidearm);
    const replaced=actor.weapon.id===old?actor.weapon:actor.inventory.get(old);
    actor.inventory.delete(old);
    if(replaced) this.drops.push({id:this.dropSequence++,equipment:old as Weapon,ammo:replaced.ammo,reserve:replaced.reserve,
      position:{...actor.position,y:actor.feet+.08},picked:false});
    if (slot === 2) {this.sidearm = drop.equipment as Pistol;this.hasSidearm=true;} else {this.playerWeapon = drop.equipment; this.hasPrimary = true;}
    const picked = new DuelWeaponState(drop.equipment, randomStream(this.seed, `pickup:${drop.id}`));
    picked.ammo = drop.ammo;
    if(drop.reserve!==undefined)picked.reserve=drop.reserve;
    actor.inventory.set(drop.equipment, picked);
    actor.weapon.holster();
    if (actor.weapon.id !== old) actor.inventory.set(actor.weapon.id, actor.weapon);
    actor.weapon = picked;
    actor.equipReadyAt = this.time + equipmentStats(drop.equipment).deploy;
    actor.command.fireHeld = actor.command.firePressed = actor.command.secondaryHeld = false;
    drop.picked = true;
    this.emit({kind: 'pickup', tick: this.tick, actorId: 0, dropId: drop.id, equipment: drop.equipment});
    return true;
  }
  equipPlayer(slot: Slot) {
    if (slot === 1 && !this.hasPrimary) return;
    if (slot === 2 && !this.hasSidearm) return;
    const actor = this.actors[0], id = equipmentForSlot(slot, this.playerWeapon, this.sidearm);
    if (!actor.alive || actor.weapon.id === id) return;
    actor.weapon.holster();
    actor.inventory.set(actor.weapon.id, actor.weapon);
    actor.weapon = actor.inventory.get(id) ?? new DuelWeaponState(id, randomStream(this.seed, `equipment:${id}`));
    actor.inventory.set(id, actor.weapon);
    actor.equipReadyAt = this.time + (this.phase === 'ready' ? 0 : equipmentStats(id).deploy);
    actor.command.fireHeld = actor.command.firePressed = false;
  }
  pause() { this.paused = true; for (const actor of this.actors) actor.command = idleCommand(); }
  resume() { this.paused = false; for (const actor of this.actors) actor.command = idleCommand(); }

  command(actorId: number, patch: Partial<ActorCommand>) {
    const actor = this.actors[actorId];
    if (!actor || !actor.alive) return;
    if (actorId !== 0) this.controlledBots.add(actorId);
    this.applyCommand(actorId,patch);
  }

  private applyCommand(actorId: number,patch: Partial<ActorCommand>) {
    const actor=this.actors[actorId];
    if(!actor?.alive)return;
    actor.command = {
      ...actor.command, ...patch,
      yawDelta: actor.command.yawDelta + (patch.yawDelta ?? 0),
      pitchDelta: actor.command.pitchDelta + (patch.pitchDelta ?? 0),
      firePressed: actor.command.firePressed || patch.firePressed === true,
      reloadPressed: actor.command.reloadPressed || patch.reloadPressed === true,
      secondaryPressed: actor.command.secondaryPressed || patch.secondaryPressed === true,
      jumpPressed: actor.command.jumpPressed || patch.jumpPressed === true,
      usePressed: actor.command.usePressed || patch.usePressed === true,
      pickupPressed:actor.command.pickupPressed||patch.pickupPressed===true,
      dropPressed: actor.command.dropPressed || patch.dropPressed === true,
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
    this.applyEnvironment(advanceEnvironment(this.authoredArena,this.environment,STEP,this.actors.filter(actor=>actor.alive).map(actorBody)),0);
    const actorView = this.snapshot();
    this.previous = actorView;
    if (this.tick % 4 === 1) {
      const shadows=actorShadows(actorView,this.arena);
      this.coach.observe(this.time, actorView[0], actorView.slice(1).flatMap(opponent => {
        const visible = observeBot(this.time, actorView[0], [opponent], this.arena,
          {aspect: this.playerAspect, verticalFov: 2 * Math.atan(.75)}).visible;
        return visible ? [visible] : [];
      }));
      for (const actor of actorView.slice(1)) {
        if (!actor.alive || this.controlledBots.has(actor.id)) continue;
        const observation=observeBot(this.time, actor, actorView, this.arena, undefined, shadows);
        this.brains.get(actor.id)?.perceive(observation);
        if(observation.visible)this.lastContactAt.set(actor.id,this.time);
      }
      this.radar.observe(this.time,actorView[0],actorView.slice(1),this.arena,this.playerAspect);
      for (const actor of actorView.slice(1)) {
        const brain = this.brains.get(actor.id);
        if (!actor.alive || !(brain instanceof TacticalBrain) ||
          this.time - (this.lastCalloutAt.get(actor.id) ?? -Infinity) < 1.5) continue;
        const report = brain.contactReport(this.time);
        if (!report) continue;
        this.lastCalloutAt.set(actor.id, this.time);
        this.teamContacts.push({reporterId:actor.id,point:report,observedAt:this.time,source:'sight'});
        for (const peer of actorView.slice(1)) {
          if (!peer.alive || peer.id === actor.id) continue;
          const listener = this.brains.get(peer.id);
          if (listener instanceof TacticalBrain) listener.teammateCallout(report, this.time);
        }
      }
      this.teamContacts=this.teamContacts.filter(contact=>this.time-contact.observedAt<2);
      const peers:TacticalPeer[]=actorView.slice(1).filter(actor=>!this.controlledBots.has(actor.id)).map(actor=>({actor,
        level:botConfig(this.config,actor.id-1).skill,behavior:botConfig(this.config,actor.id-1).behavior,
        lastShotAt:this.lastShotAt.get(actor.id),lastHurtAt:this.lastHurtAt.get(actor.id),lastDownAt:this.lastDownAt.get(actor.id),contactAt:this.lastContactAt.get(actor.id)}));
      const assignments=this.teamPlanner.plan(this.time,peers,this.arena.lanes??[],this.teamContacts);
      for(const peer of peers) {
        const brain=this.brains.get(peer.actor.id);
        if(brain instanceof TacticalBrain)brain.coordinate(assignments.find(assignment=>assignment.actorId===peer.actor.id)??null);
      }
      const opportunities:BoostPOI[]=arenaBoostPOIs(this.authoredArena,this.environment).map(poi=>{
        const approach=this.arena.traversalLinks?.find(link=>link.id===poi.approachLinkId);
        return {...poi,approachFrom:approach?.from,approachTo:approach?.to};
      });
      this.boostPlan=this.boostPlanner.plan(this.time,peers,opportunities,(poi,base,climber)=>{
        if(this.boostPlan?.poiId===poi.id)return true;
        const key=`${this.environment.revision}:${poi.id}:${base.actor.id}:${climber.actor.id}:`+
          [base.actor,climber.actor].map(actor=>`${Math.round(actor.position.x)}:${Math.round(actor.position.z)}:${Math.round(actor.feet)}`).join(':');
        const cached=this.boostFeasibility.get(key);if(cached!==undefined)return cached;
        const reachable=canWalkTo({...base.actor.position,y:base.actor.feet},base.actor.feet<poi.base.y-.15?poi.approachFrom??poi.base:poi.base,this.arena)&&
          canWalkTo({...climber.actor.position,y:climber.actor.feet},climber.actor.feet<poi.mount.y-.15?poi.approachFrom??poi.mount:poi.mount,this.arena);
        if(this.boostFeasibility.size>=128)this.boostFeasibility.clear();this.boostFeasibility.set(key,reachable);return reachable;
      });
      this.terrainCommand=this.terrainTactics.plan(this.time,peers,this.arena,this.environment,this.boostPlan?.assignments.map(item=>item.actorId));
    }
    for (const actor of this.actors.slice(1)) {
      if (!actor.alive || this.controlledBots.has(actor.id)) continue;
      const brain = this.brains.get(actor.id);
      const patch = brain instanceof TacticalBrain
        ? brain.command(actorView[actor.id], this.time, actor.weapon.recovery.recoil, actorView.slice(1))
        : brain?.command(actorView[actor.id], this.time);
      if (patch) this.commandBot(actor,{...patch,...(this.terrainCommand?.actorId===actor.id?this.terrainCommand.command:{}),
        ...this.boostPlan?.commands.find(command=>command.actorId===actor.id)?.command});
    }
    const shots: {actor: CombatActor; fired: FiredRound; shotId: number}[] = [];
    const movementActors=this.boostPlan?[this.actors[0],...this.actors.slice(1).sort((a,b)=>
      Number(b.id===this.boostPlan!.assignments[0].actorId)-Number(a.id===this.boostPlan!.assignments[0].actorId))]:this.actors;
    for (const actor of movementActors) {
      if (!actor.alive) continue;
      actor.punch.advance(STEP, actor.weapon.recovery.angle);
      const command = actor.command;
      if(command.dropPressed)this.dropWeapon(actor);
      if(command.usePressed)this.useEnvironment(actor.id);
      if(command.pickupPressed&&actor.id===0)this.pickupPlayer();
      if (actor.id === 0 && command.equipSlot) {this.equipPlayer(command.equipSlot); command.equipSlot = undefined;}
      actor.yaw += command.yawDelta;
      actor.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, actor.pitch + command.pitchDelta));
      recoverTagging(actor, STEP, actor.grounded ?? actor.feet === 0);
      const zoomBefore=actor.weapon.actions.zoom;
      // Bots scope before firing. They use the same mode-specific speed/accuracy
      // data as the player, without learning anything about hidden positions.
      if (actor.id !== 0 && actor.weapon.id !== 'knife' && gameData.weapons[actor.weapon.id].zoomLevels && !actor.weapon.actions.zoom && !actor.weapon.actions.pendingZoom && command.fireHeld) {
        actor.weapon.actions.secondary(this.time);
      }
      const next = advanceActor(actor, command, actor.weapon.actions.stats.speed * UNIT, STEP,
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
        (position, from, to, height) => verticalContact(position, from, to, height, this.arena.solids),
        arenaMovementEnvironment(this.arena,this.actors.map(other=>({...other,previous:this.previous[other.id]})),actor.id,this.time-STEP,actor.pitch));
      const traveled = Math.hypot(next.position.x - actor.position.x, next.position.z - actor.position.z);
      const landed=next.grounded&&!(actor.grounded??actor.feet===0);
      Object.assign(actor,next);
      if (landed) this.emitSound(actor, 'landing', next.position);
      const audible = Math.hypot(next.velocity.x, next.velocity.z) > equipmentStats(actor.weapon.id).speed * UNIT * .54;
      if (next.grounded && audible && traveled > 0) {
        actor.stepDistance += traveled;
        if (actor.stepDistance >= 1.35) {
          actor.stepDistance %= 1.35;
          this.emitSound(actor, 'footstep', next.position);
        }
      } else if (!audible) actor.stepDistance = 0;
      if(actor.id!==0 && (command.forward||command.side)) {
        const door=this.nearestDoor(actor.id);
        if(door && !this.environment.pieces[door.id]?.open && this.time-(this.usedAt.get(actor.id)??-Infinity)>1)
          this.useEnvironment(actor.id);
      }
      for (const state of actor.inventory.values()) if (state !== actor.weapon) state.advancePassive(this.time,STEP, (actor.duckAmount ?? 0) >= .95, !actor.grounded);
      const fired = actor.weapon.advance(this.time, STEP, this.time < actor.equipReadyAt
        ? {...command, fireHeld: false, firePressed: false, secondaryHeld: false, secondaryPressed: false} : command, actor);
      if(zoomBefore!==actor.weapon.actions.zoom)this.emit({kind:'action',tick:this.tick,actorId:actor.id,equipment:actor.weapon.id,
        action:actor.weapon.actions.zoom?'scope-in':'scope-out'});
      for(const action of actor.weapon.drainActionEvents()) {
        this.emit({kind:'action',tick:this.tick,actorId:actor.id,equipment:actor.weapon.id,action:action.kind,silent:'silent' in action?action.silent:false});
        if(action.kind==='reload-start')this.combatActions.set(actor.id,{action:'reload',at:this.time});
      }
      command.yawDelta = command.pitchDelta = 0;
      command.firePressed = command.reloadPressed = command.secondaryPressed = false;
      command.usePressed=command.pickupPressed=command.dropPressed=command.jumpPressed=false;
      command.jumpPressOffset=0;
      if (!fired) continue;
      if (actor.id === 0) this.coach.shot(this.snapshot()[0]);
      const shotId = this.shotId++;
      shots.push({actor, fired, shotId});
      this.lastShotAt.set(actor.id,this.time);
      this.combatActions.set(actor.id,{action:'fire',at:this.time});
      this.emit({kind: 'fire', tick: this.tick, actorId: actor.id, shotId,
        equipment: fired.weapon, origin: fired.origin, direction: fired.direction,
        pelletDirections:fired.pelletDirections,alternate:fired.attack==='secondary',ordinal:fired.ordinal});
      this.informHearing(actor, fired.origin, 'gunshot');
    }
    const pending: PendingHit[] = [];
    for (const shot of shots) this.resolveShot(shot.actor, shot.fired, shot.shotId, pending);
    const combined:PendingHit[]=[];
    for(const hit of pending) {
      const prior=combined.find(other=>other.event.shotId===hit.event.shotId&&other.victim.id===hit.victim.id);
      if(prior) {
        prior.event.healthDamage+=hit.event.healthDamage;prior.event.armorDamage+=hit.event.armorDamage;
        if(hit.event.group==='head'){prior.event.group='head';prior.event.point=hit.event.point;}
      } else combined.push(hit);
    }
    for (const {victim, weapon, direction, event} of combined) {
      if (!victim.alive) continue;
      const rawDamage = event.healthDamage + event.armorDamage * 2, armorBeforeHit = victim.armor;
      event.healthDamage = Math.min(victim.health, event.healthDamage);
      event.armorDamage = Math.min(victim.armor, event.armorDamage);
      const lethal = victim.alive && victim.health <= event.healthDamage;
      victim.health = Math.max(0, victim.health - event.healthDamage);
      victim.armor = Math.max(0, victim.armor - event.armorDamage);
      if (victim.health === 0) victim.alive = false;
      if (lethal) victim.deathDirection = {...direction};
      this.lastHurtAt.set(victim.id,this.time);if(lethal)this.lastDownAt.set(victim.id,this.time);
      if (victim.alive && event.healthDamage > 0) applyTagging(victim, weapon, victim.weapon.id);
      if (victim.alive && event.healthDamage > 0) victim.punch.hit({group: event.group, rawDamage, armor: armorBeforeHit, helmet: victim.helmet});
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
      if(lethal && event.shooter===0) this.radar.confirmDeath(victim.id,this.time);
      if (lethal && victim.side === 'enemy' && victim.weapon.id !== 'knife') this.drops.push({
        id: victim.id, equipment: victim.weapon.id, ammo: victim.weapon.ammo,
        reserve:victim.weapon.reserve,
        position: {...victim.position, y: victim.feet + .08}, picked: false,
      });
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
    const targets=this.snapshot().map(current=>({...current,
      armor:Math.max(0,current.armor-pending.filter(hit=>hit.victim.id===current.id).reduce((sum,hit)=>sum+hit.event.armorDamage,0))}));
    const addHit=(victim:CombatActor,group:Hitgroup,point:Vec,direction:Vec,damage:{healthDamage:number;armorDamage:number})=>{
      pending.push({victim,weapon:fired.weapon,direction,event:{kind:'hit',tick:this.tick,shooter:shooter.id,victim:victim.id,shotId,group,point,
        healthDamage:damage.healthDamage,armorDamage:damage.armorDamage,lethal:false}});
    };
    if(fired.kind==='melee'||fired.kind==='zeus') {
      const range=fired.maxDistance;
      const surface=traceSolid(fired.origin,fired.direction,this.arena,range);
      let nearest={distance:surface.distance,target:undefined as DuelActorSnapshot|undefined,group:undefined as Hitgroup|undefined};
      for(const target of targets) {
        if(!target.alive||target.id===shooter.id)continue;
        const hit=fired.kind==='melee'?traceMelee(fired.origin,fired.direction,target,Math.min(range,nearest.distance)):
          traceActor(fired.origin,fired.direction,{...target.position,y:target.feet},target.duckAmount,Math.min(range,nearest.distance));
        if(hit.group&&hit.distance<nearest.distance)nearest={distance:hit.distance,target,group:hit.group};
      }
      if(nearest.target&&nearest.group&&nearest.target.side!==shooter.side) {
        const victim=this.actors[nearest.target.id];
        const damage=resolveDamage(fired.weapon,nearest.group,nearest.distance,nearest.target.armor,nearest.target.helmet,
          {attack:fired.attack,firstSlash:fired.firstSlash,backstab:isKnifeBackstab(fired.origin,nearest.target.position,nearest.target.yaw)});
        addHit(victim,nearest.group,pointOnRay(fired.origin,fired.direction,nearest.distance),fired.direction,damage);
      }
      if(fired.kind==='melee')shooter.weapon.resolveMeleeHit(fired.ordinal,!!nearest.target);
      return;
    }
    for(const direction of fired.pelletDirections??[fired.direction]) {
      const ray=resolveBulletRay({origin:fired.origin,direction,range:fired.maxDistance,equipment:fired.weapon,
        arena:this.arena,actors:targets,shooterId:shooter.id,shooterSide:shooter.side});
      for(const contact of ray.contacts) {
        if(contact.kind==='surface') {
          this.emit({kind:'surface',tick:this.tick,shooter:shooter.id,shotId,point:contact.point,surfaceId:contact.surfaceId,
            phase:contact.phase,material:contact.material,residualDamage:contact.residualDamage});
          if(contact.phase==='entry'&&contact.environmentId) {
            this.applyEnvironment(damageEnvironmentPiece(this.authoredArena,this.environment,contact.environmentId,contact.residualDamage,
              {x:direction.x*contact.residualDamage*.2,y:0,z:direction.z*contact.residualDamage*.2}),shooter.id);
          }
        } else if(contact.kind==='actor'&&!contact.friendly) {
          const victim=this.actors[contact.actorId];
          addHit(victim,contact.group,contact.point,direction,contact);
          const target=targets[contact.actorId];if(target)target.armor=Math.max(0,target.armor-contact.armorDamage);
        }
      }
    }
  }

  snapshot(): DuelActorSnapshot[] {
    return this.actors.map(actor => ({
      id: actor.id, generation: actor.generation, side: actor.side, position: {...actor.position}, velocity: {...actor.velocity},
      feet: actor.feet, grounded: actor.grounded ?? actor.feet === 0, verticalVelocity:actor.verticalVelocity, yaw: actor.yaw, pitch: actor.pitch, crouched: (actor.duckAmount ?? 0) >= .5,
      aimPunch: actor.punch.shotFor(actor.weapon.recovery.angle),
      deathDirection: actor.deathDirection ? {...actor.deathDirection} : undefined,
      duckAmount: actor.duckAmount ?? 0, health: actor.health, armor: actor.armor,
      helmet: actor.helmet, alive: actor.alive, equipment: actor.weapon.id, ammo: actor.weapon.ammo,
      reloading: actor.weapon.reloadUntil > 0,
      reserve: actor.weapon.reserve,reloadSilent:actor.weapon.reloadSilent,
      action:this.combatActions.get(actor.id)?.action,actionAt:this.combatActions.get(actor.id)?.at,
      supportingActor:typeof actor.supportId==='number'?actor.supportId:undefined,
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

  nearestDoor(actorId=0) {
    const actor=this.actors[actorId];if(!actor?.alive)return;
    const forward={x:-Math.sin(actor.yaw),z:-Math.cos(actor.yaw)};
    return this.authoredArena.solids.flatMap((solid,index)=>{
      if(solid.interaction?.kind!=='door')return[];
      const id=environmentPieceId(solid,index),piece=this.environment.pieces[id];
      if(!piece?.active)return[];
      const dx=solid.center.x-actor.position.x,dz=solid.center.z-actor.position.z;
      const distance=Math.hypot(dx,dz);
      return distance<solid.interaction.useRadius+Math.max(solid.size.x,solid.size.z)/2 &&
        (distance<.01||(dx*forward.x+dz*forward.z)/distance>.3)?[{id,distance,open:piece.open}]:[];
    }).sort((a,b)=>a.distance-b.distance)[0];
  }

  useEnvironment(actorId=0) {
    const door=this.nearestDoor(actorId),actor=this.actors[actorId];if(!door)return false;
    const result=useEnvironmentPiece(this.authoredArena,this.environment,door.id,actor.position,this.actors.filter(other=>other.alive).map(actorBody));
    this.applyEnvironment(result,actorId);if(result.changed)this.usedAt.set(actorId,this.time);
    return result.changed;
  }

  private applyEnvironment(result:EnvironmentResult,actorId:number) {
    if(!result.changed)return;
    this.environment=result.state;this.arena.solids=environmentSolids(this.authoredArena,this.environment);
    this.acoustics.setBoxes(this.arena.solids);
    for(const event of result.events) {
      if(event.kind==='damaged')continue;
      this.emit({kind:'environment',tick:this.tick,actorId,environmentId:event.id,action:event.kind==='opened'?'open':
        event.kind==='closed'?'close':event.kind==='destroyed'?'break':'move',point:event.position});
    }
  }

  private dropWeapon(actor:CombatActor) {
    if(actor.weapon.id==='knife'||actor.weapon.id==='zeus')return false;
    const equipment=actor.weapon.id,stats=equipmentStats(equipment);
    const point={x:actor.position.x-Math.sin(actor.yaw)*.75,y:actor.feet+.08,z:actor.position.z-Math.cos(actor.yaw)*.75};
    const id=this.dropSequence++;
    this.drops.push({id,equipment,ammo:actor.weapon.ammo,reserve:actor.weapon.reserve,position:point,picked:false});
    actor.weapon.holster();actor.inventory.delete(equipment);
    if(actor.id===0) {
      if(pistolIds.includes(equipment as Pistol)){this.hasSidearm=false;this.equipPlayer(this.hasPrimary?1:3);}
      else {this.hasPrimary=false;this.equipPlayer(this.hasSidearm?2:3);}
      actor.inventory.delete(equipment);
    }
    else {
      actor.weapon=new DuelWeaponState('knife',randomStream(this.seed,`drop:${id}`));actor.equipReadyAt=this.time+stats.deploy;
    }
    return true;
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
      const range = sound === 'gunshot' ? gunshotRange(actor.weapon.id) : FOOTSTEP_RANGE;
      if (distance > range || distance < .01) continue;
      const path=this.acoustics.resolve(listener.position,point,this.time);
      const occluded=path.gain<1;
      const threshold = .018 + (1 - proficiency(botConfig(this.config, listener.id - 1).skill)) * .03;
      const gain = sound === 'gunshot' ? gunshotGain(actor.weapon.id, distance) : footstepGain(distance);
      if (gain*path.gain < threshold) continue;
      this.lastContactAt.set(listener.id,this.time);
      brain.hear(path.apparentPosition, this.time, sound, occluded);
    }
  }
}
