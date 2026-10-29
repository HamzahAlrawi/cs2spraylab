import {advanceActor, DEG, STEP, UNIT, type ActorKinematics, type Vec} from '../actor-physics';
import {gameData, pistolIds, type Weapon, type Pistol} from '../config';
import {botConfig, rosterBehaviors, sanitizeDuelConfig, type DuelConfig, type SkillLevel} from './config';
import {BotBrain} from './brain';
import {TacticalBrain} from './tactics';
import {isKnifeBackstab,resolveDamage} from './damage';
import {canFitInArena, moveInArena, pointOnRay, rayCapsuleInterval, testArena, traceActor, traceSolid, type Arena} from './geometry';
import {observeBot, type VisibleEnemy} from './perception';
import {randomStream} from './rng';
import {interpolateActors} from './presentation';
import {createBotTraits} from './skill';
import {idleCommand, type ActorCommand, type DuelActorSnapshot, type DuelEvent, type Hitgroup} from './types';
import {DuelWeaponState, type FiredRound} from './weapon-state';
import {verticalContact} from '../actor-collision';
import {FOOTSTEP_RANGE, footstepGain, gunshotGain, gunshotRange, audibleLanding} from '../sound-model';
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
import {AcousticScene, retainSoundOcclusion} from '../spatial-audio';
import {surfaceFootstepMaterial} from '../prefire/native-surfaces';
import {deathSoundReport, deathTradeOrders, type ThreatReport, type TradeOrder} from './trading';
import {CombatReplay, type ReplayDecision} from './combat-replay';
import {BodyTurnTimeline} from './body-turn';
import {recoilView} from '../view-recoil';
import {scopeVerticalFov} from '../weapon-actions';
import {sampleShotState} from './shot-time';
import {configureArenaAcoustics} from './native-acoustics';
import {botLoadoutDecision} from './bot-loadout';
import {UtilitySimulation, type UtilityEvent} from './utilities';
import {utilityInventory, canCarryUtility, type UtilityInventory, type UtilityKind} from './utility-loadout';
import {BotUtilityPlanner} from './utility-tactics';
import {BotUtilityDefense} from './utility-defense';
import {botSensorView, pointInView} from './shadows';
import {direction as aimDirection} from '../shot-model';
import {utilityLaunchPose} from './utility-ballistics';
import {TeamUtilityCoordinator} from './team-utility';
import {utilityNativeTiming} from './utility-presentation';
import {approachGrenadeStrength,releasedGrenadeStrength,nativeGrenadeReleaseAt} from './grenade-native-input';
import {applyNativeFlash,type NativeBlindState} from './grenade-native-flash';
import {nativeFlashClient} from './grenade-flash-client';

export type CombatActor = ActorKinematics & TaggingState & {
  id: number;
  generation: number;
  side: 'player' | 'enemy';
  pitch: number;
  punch: DamagePunch;
  deathDirection?: Vec;
  deathGroup?:Hitgroup;
  recentHits?:import('./hit-reaction').HitReactionEvent[];
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
type PendingHit = {victim: CombatActor; weapon: Equipment; direction: Vec; event: Extract<DuelEvent, {kind: 'hit'}>;
  impulses:import('../aim-punch').PunchHit[]};
export type DroppedWeapon = {id: number; equipment: Weapon; ammo: number; reserve?:number; position: Vec; picked: boolean};
export type DroppedUtility = {id: number; utility: UtilityKind; position: Vec; picked: boolean; droppedAt: number; owner: number};

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
  readonly utilities: UtilitySimulation;
  private readonly utilityStocks = new Map<number, UtilityInventory>();
  private readonly heldUtilities = new Map<number, {kind: UtilityKind; selectedAt: number; readyAt: number; primedAt?: number;
    strength?: number; strengthUpdatedAt?:number; releaseAt?: number; throwStartedAt?: number}>();
  private readonly utilityPlanners = new Map<number, BotUtilityPlanner>();
  private readonly utilityDefenses = new Map<number, BotUtilityDefense>();
  private readonly flashes = new Map<number, NativeBlindState>();
  private readonly utilityWeapons = new Map<number, Equipment>();
  private readonly utilityTeam = new TeamUtilityCoordinator();
  private utilityReplayDirty = false;
  readonly config: DuelConfig;
  readonly arena: Arena;
  readonly authoredArena: Arena;
  environment: EnvironmentState;
  readonly actors: CombatActor[];
  readonly drops: DroppedWeapon[] = [];
  readonly utilityDrops: DroppedUtility[] = [];
  readonly radar = new RadarMemory();
  time = 0;
  tick = 0;
  accumulator = 0;
  phase: 'ready' | 'fighting' | 'result' = 'ready';
  outcome?: 'won' | 'lost' | 'draw';
  completedAt?:number;
  private victoryFreePlay=false;
  /** Presentation opts in only after the completed fight has been scored. */
  enablePostWinPlay() {this.victoryFreePlay=this.phase==='result'&&this.outcome==='won'&&this.actors[0].alive;}
  get postWinPlayable() {return this.victoryFreePlay&&this.phase==='result'&&this.outcome==='won'&&this.actors[0].alive;}
  get playable() {return this.phase==='fighting'||this.postWinPlayable;}
  private paused = false;
  private shotId = 0;
  private events: DuelEvent[] = [];
  private brains = new Map<number, BotBrain | TacticalBrain>();
  private controlledBots = new Set<number>();
  private spawnAuthoring = false;
  /** Isolated walk-only editor. Never feeds scores, rewards or combat recordings. */
  setSpawnAuthoring(enabled: boolean) {this.spawnAuthoring = enabled;}
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
  private readonly tradeRandom: () => number;
  private boostFeasibility=new Map<string,boolean>();
  readonly coach = new DuelCoach();
  readonly replay: CombatReplay;
  private readonly bodyTurns = new Map<number, BodyTurnTimeline>();
  private readonly perceivedEnemies = new Map<number, VisibleEnemy | null>();
  private readonly loadoutDecisionAt = new Map<number, number>();
  private readonly loadoutReasons = new Map<number, string>();
  playerAspect = 16 / 9;
  actorHitPose?: (actor: DuelActorSnapshot, time?: number) => import('./actor-hitboxes').ActorHitPose | undefined;
  actorSensorPose?: (actor: DuelActorSnapshot, time?: number) => import('./actor-hitboxes').ActorHitPose | undefined;
  actorPoseTick?: (actor: DuelActorSnapshot, time: number) => void;
  actorBodyYaw(actor: DuelActorSnapshot, time = this.time) {return this.bodyTurns.get(actor.id)?.sample(actor, time) ?? actor.yaw;}

  constructor(config: DuelConfig = sanitizeDuelConfig({}), private seed = 1, arena: Arena = testArena(), private playerWeapon: Weapon = 'ak47', private sidearm: Pistol = 'usp', private hasPrimary = true) {
    this.config = sanitizeDuelConfig(config);
    this.utilities = new UtilitySimulation(seed);
    this.utilityStocks.set(0, utilityInventory(this.config.utilitiesEnabled ? this.config.utilityLoadout : []));
    this.replay = new CombatReplay(seed, arena.design, 10, {gameBuild: gameData.build, config: this.config,
      loadout: {primary: hasPrimary ? playerWeapon : null, sidearm}, nativeBuild: arena.native?.build, geometrySha256: arena.native?.collisionSha256});
    this.tradeRandom = randomStream(seed, 'death-trades');
    this.terrainTactics=new TerrainTactics(seed);
    this.authoredArena = arena;
    this.environment = createEnvironmentState(arena);
    this.arena = {...arena,solids:environmentSolids(arena,this.environment)};
    configureArenaAcoustics(this.acoustics,this.arena);
    this.actors = [makeActor(0, 'player', 0, 8, hasPrimary ? playerWeapon : sidearm, this.config.playerHealth, this.config.playerArmor, seed)];
    this.actors[0].armor = this.config.playerArmor ? this.config.playerArmorPoints : 0;
    this.actors[0].helmet = this.config.playerArmor && this.config.playerHelmet;
    this.actors[0].position.z *= this.config.arenaScale;
    const spawns = this.arena.solids.length ? coveredSpawns(this.arena, seed, this.config.botCount) : undefined;
    if (spawns) this.actors[0].position = {...spawns.player};
    const place = (actor: CombatActor, spawn?: import('./geometry').ArenaSpawn) => {
      if (!spawn) return;
      actor.feet = spawn.feet.y; actor.duckAmount = spawn.crouched ? 1 : 0;
      actor.eyeHeight = (spawn.crouched ? 46 : 64) * UNIT;
      actor.position = {...spawn.feet, y: spawn.feet.y + actor.eyeHeight};
      actor.yaw = spawn.yaw; actor.pitch = spawn.pitch ?? 0; actor.grounded = true;
      actor.command.crouch = !!spawn.crouched;
    };
    place(this.actors[0], arena.spawns?.player);
    const behaviors = rosterBehaviors(this.config, seed);
    for (let index = 0; index < this.config.botCount; index++) {
      const bot = botConfig(this.config, index);
      this.actors.push(makeActor(index + 1, 'enemy', (index - (this.config.botCount - 1) / 2) * .88,
        -8 * this.config.arenaScale, bot.weapon, bot.health, bot.armor, seed));
      this.actors[index+1].armor = bot.armor ? bot.armorPoints : 0;
      this.actors[index+1].helmet = bot.armor && bot.helmet;
      if (bot.weapon !== 'knife' && bot.weapon !== 'zeus' && !pistolIds.includes(bot.weapon as Pistol))
        this.actors[index + 1].inventory.set('usp', new DuelWeaponState('usp', randomStream(seed, `backup:${index + 1}`)));
      if (spawns) this.actors[index + 1].position = {...spawns.bots[index]};
      place(this.actors[index + 1], arena.spawns?.bots[index]);
      const traits = createBotTraits(bot.skill, seed, index + 1);
      const random = randomStream(seed, `brain:${index + 1}`);
      this.utilityStocks.set(index + 1, utilityInventory(this.config.utilitiesEnabled && this.config.botUtilities
        ? ['he', 'flash', 'smoke', index % 2 ? 'incendiary' : 'molotov'] : []));
      this.utilityPlanners.set(index + 1, new BotUtilityPlanner(seed, index + 1, bot.skill));
      this.utilityDefenses.set(index + 1, new BotUtilityDefense(seed, index + 1, bot.skill));
      this.brains.set(index + 1, arena.lanes?.length
        ? new TacticalBrain(traits, behaviors[index], bot.accuracy, random, this.arena, bot.skill, bot.weapon==='knife'?'ak47':bot.weapon, index + 1, seed % 2)
        : new BotBrain(traits, behaviors[index], bot.accuracy, random));
    }
  }

  start() { if (this.phase === 'ready') {
    this.phase = 'fighting';
    this.replay.world(this.environment.revision, this.arena, this.environment);
    this.replay.frame(this.tick, this.time, this.replayActors(), undefined, true);
    this.replay.utility(this.tick,this.time,this.utilities.projectiles,this.utilities.effects,true,this.utilityDrops);
  } }
  protected weaponCommand(_actor: CombatActor, command: ActorCommand): ActorCommand {return command;}
  /** Shared by autonomous Duel and angle-authored Prefire controllers. */
  protected applyBotCombatPolicy(actorId: number, command: Partial<ActorCommand>, report: ThreatReport | null,
    visible: boolean, context: {allowUtility?: boolean; tradePending?: boolean} = {}): Partial<ActorCommand> {
    const actor = this.actors[actorId];
    if (!actor?.alive || actorId === 0) return command;
    const contact = report && this.time >= report.readyAt && this.time - report.observedAt < 2.2 ? report : null;
    const assignment=this.utilityTeam.assignment(this.time, this.previous[actorId]??this.snapshot()[actorId],this.arena);
    if (assignment&&!visible) {
      const brain=this.brains.get(actorId);if(brain instanceof TacticalBrain)brain.coordinate(assignment);
      const distance=Math.hypot(assignment.point.x-actor.position.x,assignment.point.y-actor.position.y,assignment.point.z-actor.position.z);
      if (assignment.waitForPartner&&Math.hypot(actor.position.x-assignment.lane.anchor.x,actor.position.z-assignment.lane.anchor.z)<1.2&&distance>.1&&
        traceSolid(actor.position,{x:(assignment.point.x-actor.position.x)/distance,y:(assignment.point.y-actor.position.y)/distance,
          z:(assignment.point.z-actor.position.z)/distance},this.arena,distance-.1).distance<distance-.1)
        return {...command,forward:0,side:0,fireHeld:false,firePressed:false};
    }
    const loadout = botLoadoutDecision(this.time, actor.weapon, actor.inventory, {
      visible: visible && contact?.source === 'sight',
      distance: contact ? Math.hypot(contact.point.x - actor.position.x, contact.point.z - actor.position.z) : Infinity,
    }, actor.equipReadyAt, this.loadoutDecisionAt.get(actorId) ?? 0);
    this.loadoutReasons.set(actorId, loadout.reason);
    if (loadout.equipment && this.equipBot(actor, loadout.equipment)) this.loadoutDecisionAt.set(actorId, this.time + 1.5);
    else if (loadout.cancelReload) {
      actor.weapon.reload.cancel(); actor.weapon.cancelInput(); this.loadoutDecisionAt.set(actorId, this.time + 1);
    }
    const held = this.heldUtilities.get(actorId);
    if (held?.releaseAt !== undefined) return {...command, forward: 0, side: 0, yawDelta: 0, pitchDelta: 0,
      fireHeld: false, firePressed: false, secondaryHeld: false, secondaryPressed: false, reloadPressed: false};
    if (!this.config.utilitiesEnabled || !this.config.botUtilities || this.flashAmount(actorId) >= .35 ||
      context.allowUtility === false || context.tradePending) {
      this.utilityPlanners.get(actorId)?.cancel(this.time);this.utilityTeam.cancel(actorId);
      if (held) this.selectActorUtility(actorId,null);
      return command;
    }
    const snapshot = this.previous.length ? this.previous : this.snapshot();
    const self = {...snapshot[actorId], equipment: actor.weapon.id, ammo: actor.weapon.ammo, reloading: actor.weapon.reload.active};
    const utility = this.utilityPlanners.get(actorId)?.command(this.time, self, this.utilityInventory(actorId), contact,
      this.arena, {visible, lastShotAt: this.lastShotAt.get(actorId) ?? -Infinity, teammates: snapshot.slice(1)});
    if (utility && this.selectActorUtility(actorId, utility.kind)) {
      if (contact&&!this.utilityTeam.claim(this.time,self,utility.kind,contact,snapshot.slice(1),id=>this.tradeSkill(id))) {
        this.utilityPlanners.get(actorId)?.cancel(this.time);this.selectActorUtility(actorId,null);return command;
      }
      if (utility.throw) this.queueUtilityThrow(actorId);
      return {...command, forward: 0, side: 0, yawDelta: utility.yawDelta, pitchDelta: utility.pitchDelta,
        fireHeld: false, firePressed: false, secondaryHeld: false, secondaryPressed: false, reloadPressed: false};
    }
    if (held) {this.selectActorUtility(actorId, null);this.utilityTeam.cancel(actorId);}
    return command;
  }
  get loadout() {return {primary: this.hasPrimary ? this.playerWeapon : null, sidearm: this.hasSidearm ? this.sidearm : null};}
  get selectedUtility(): UtilityKind | undefined {return this.heldUtilities.get(0)?.kind;}
  utilityPresentation(actorId = 0): import('./utility-view').UtilityPresentation | undefined {return this.heldUtilities.get(actorId);}
  configureUtilities(options: Pick<DuelConfig, 'utilitiesEnabled' | 'botUtilities' | 'utilityLoadout'>) {
    if (this.phase !== 'ready') return false;
    const config = sanitizeDuelConfig({...this.config, ...options});
    this.config.utilitiesEnabled = config.utilitiesEnabled; this.config.botUtilities = config.botUtilities;
    this.config.utilityLoadout = config.utilityLoadout;
    this.heldUtilities.clear(); this.utilities.reset(); this.flashes.clear(); this.utilityWeapons.clear();
    for (const actor of this.actors) this.utilityStocks.set(actor.id, utilityInventory(!config.utilitiesEnabled ? []
      : actor.id === 0 ? config.utilityLoadout : config.botUtilities ? ['he', 'flash', 'smoke', 'incendiary'] : []));
    return true;
  }
  utilityInventory(actorId = 0): UtilityInventory {return {...(this.utilityStocks.get(actorId) ?? utilityInventory([]))};}
  selectUtility(kind: UtilityKind | null) {return this.selectActorUtility(0, kind);}
  private selectActorUtility(actorId: number, kind: UtilityKind | null) {
    const actor = this.actors[actorId];
    if (!actor?.alive || !this.config.utilitiesEnabled || this.phase === 'result' && !this.postWinPlayable) return false;
    const held = this.heldUtilities.get(actorId);
    if (kind === null) {
      if (held) {
        this.heldUtilities.delete(actorId);
        actor.equipReadyAt = this.time + (this.phase === 'ready' ? 0 : equipmentStats(actor.weapon.id).deploy);
        actor.weapon.cancelInput();
      }
      return true;
    }
    if ((this.utilityStocks.get(actorId)?.[kind] ?? 0) <= 0) return false;
    if (held?.kind === kind) return true;
    actor.weapon.holster();
    const duration=utilityNativeTiming(kind).deployDuration;
    this.heldUtilities.set(actorId, {kind, selectedAt: this.phase==='ready'?this.time-duration:this.time,
      readyAt: this.time + (this.phase === 'ready' ? 0 : duration)});
    actor.command.fireHeld = actor.command.firePressed = actor.command.secondaryHeld = actor.command.secondaryPressed = false;
    return true;
  }
  flashAmount(actorId: number) {
    const flash = this.flashes.get(actorId);
    if (!flash || this.time >= flash.blindStart+flash.duration) return 0;
    return nativeFlashClient(flash.blindStart, this.time, flash.duration, flash.alpha).overlayAlpha;
  }
  canSeeUtility(actorId: number, from: Vec, to: Vec) {
    return this.flashAmount(actorId) < .35 && !this.utilities.obscuresSegment(from, to, this.time);
  }
  throwUtility(actorId: number, kind: UtilityKind, strength = 1) {
    const actor = this.actors[actorId], held = this.heldUtilities.get(actorId), stock = this.utilityStocks.get(actorId);
    if (!this.playable || !actor?.alive || !held || held.kind !== kind || this.time < held.readyAt || !stock?.[kind]) return false;
    strength=releasedGrenadeStrength(strength);
    const {origin, direction} = utilityLaunchPose(actor.position, actor.yaw, actor.pitch, this.arena,strength);
    const id = this.utilities.throw({actorId, side: actor.side, kind, origin, direction,
      velocity: {x: actor.velocity.x, y: actor.verticalVelocity, z: actor.velocity.z}, strength, time: this.time});
    if (id === undefined) return false;
    this.utilityWeapons.set(id, actor.weapon.id === 'knife' || actor.weapon.id === 'zeus' ? 'usp' : actor.weapon.id);
    this.utilityTeam.thrown(actorId,id,this.time);
    stock[kind]--; this.heldUtilities.delete(actorId);
    actor.weapon.cancelInput(); actor.equipReadyAt = Math.max(this.time, (held.throwStartedAt??this.time)+
      utilityNativeTiming(kind,strength).throwDuration) + equipmentStats(actor.weapon.id).deploy;
    actor.command.fireHeld = actor.command.firePressed = actor.command.secondaryHeld = actor.command.secondaryPressed = false;
    this.emit({kind: 'utility', tick: this.tick, actorId, utility: kind, action: 'throw', point: origin, strength,
      throwStartedAt:held.throwStartedAt});
    return true;
  }
  queueUtilityThrow(actorId: number, strength = 1) {
    const held = this.heldUtilities.get(actorId);
    if (!this.playable || !held || !this.actors[actorId]?.alive || !Number.isFinite(strength)) return false;
    if(held.releaseAt!==undefined)return true;
    held.primedAt ??= Math.max(this.time,held.readyAt); held.strength = releasedGrenadeStrength(strength);
    held.throwStartedAt=Math.max(this.time,held.readyAt);
    held.releaseAt = nativeGrenadeReleaseAt(held.throwStartedAt);
    return true;
  }
  private advanceUtilityInput(actor: CombatActor) {
    const held = this.heldUtilities.get(actor.id);
    if (!held) return;
    if (this.time<held.readyAt) return;
    if (held.releaseAt!==undefined) {
      if(this.time>=held.releaseAt)this.throwUtility(actor.id,held.kind,held.strength);
      return;
    }
    const command = actor.command;
    if (command.fireHeld || command.firePressed || command.secondaryHeld || command.secondaryPressed) {
      const target=command.fireHeld || command.firePressed ? command.secondaryHeld || command.secondaryPressed ? .5 : 1 : 0;
      held.strength=held.primedAt===undefined?target:approachGrenadeStrength(held.strength??target,target,
        this.time-(held.strengthUpdatedAt??this.time));
      held.primedAt ??= this.time;held.strengthUpdatedAt=this.time;
    } else if (held.primedAt !== undefined) {
      held.strength=releasedGrenadeStrength(held.strength??1);
      held.throwStartedAt=this.time;
      held.releaseAt = nativeGrenadeReleaseAt(held.throwStartedAt);
      if (this.time >= held.releaseAt && this.time >= held.readyAt) this.throwUtility(actor.id, held.kind, held.strength);
    }
  }
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
  nearestUtilityPickup() {
    const actor = this.actors[0], inventory = this.utilityStocks.get(0);
    if (!actor.alive || !this.playable || !inventory || !this.config.utilitiesEnabled) return;
    return this.utilityDrops.filter(drop => !drop.picked && canCarryUtility(inventory, drop.utility) &&
      (drop.owner !== 0 || this.time - drop.droppedAt > .3) &&
      Math.hypot(drop.position.x - actor.position.x, drop.position.y - actor.feet, drop.position.z - actor.position.z) < 2)
      .filter(drop => {
        const dx = drop.position.x - actor.position.x, dy = drop.position.y - actor.position.y, dz = drop.position.z - actor.position.z;
        const distance = Math.hypot(dx, dy, dz);
        return !Number.isFinite(traceSolid(actor.position, {x: dx / distance, y: dy / distance, z: dz / distance}, this.arena, Math.max(0, distance - .08)).distance);
      }).sort((a, b) => Math.hypot(a.position.x - actor.position.x, a.position.z - actor.position.z) -
        Math.hypot(b.position.x - actor.position.x, b.position.z - actor.position.z))[0];
  }
  pickupUtilityPlayer() {
    const drop = this.nearestUtilityPickup(), stock = this.utilityStocks.get(0);
    if (!drop || !stock || !canCarryUtility(stock, drop.utility)) return false;
    stock[drop.utility]++; drop.picked = true; this.utilityReplayDirty = true;
    this.emit({kind: 'utility-pickup', tick: this.tick, actorId: 0, dropId: drop.id, utility: drop.utility});
    return true;
  }
  pickupPlayer() {
    const item = this.nearestItemPickup(), actor = this.actors[0];
    if (item && 'utility' in item) return this.pickupUtilityPlayer();
    const drop = item;
    if (!drop) return false;
    this.selectUtility(null);
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

  nearestItemPickup() {
    const weapon = this.nearestPickup(), grenade = this.nearestUtilityPickup(), actor = this.actors[0];
    return grenade && (!weapon || Math.hypot(grenade.position.x - actor.position.x, grenade.position.z - actor.position.z) <=
      Math.hypot(weapon.position.x - actor.position.x, weapon.position.z - actor.position.z)) ? grenade : weapon;
  }
  equipPlayer(slot: Slot) {
    if (slot === 1 && !this.hasPrimary) return;
    if (slot === 2 && !this.hasSidearm) return;
    const actor = this.actors[0], id = equipmentForSlot(slot, this.playerWeapon, this.sidearm);
    this.selectUtility(null);
    if (!actor.alive || actor.weapon.id === id) return;
    actor.weapon.holster();
    actor.inventory.set(actor.weapon.id, actor.weapon);
    actor.weapon = actor.inventory.get(id) ?? new DuelWeaponState(id, randomStream(this.seed, `equipment:${id}`));
    actor.inventory.set(id, actor.weapon);
    actor.equipReadyAt = this.time + (this.phase === 'ready' ? 0 : equipmentStats(id).deploy);
    actor.command.fireHeld = actor.command.firePressed = false;
  }
  private equipBot(actor: CombatActor, equipment: Equipment) {
    const next = actor.inventory.get(equipment);
    if (!next || next === actor.weapon) return false;
    actor.weapon.holster(); actor.inventory.set(actor.weapon.id, actor.weapon);
    actor.weapon = next; actor.equipReadyAt = this.time + equipmentStats(equipment).deploy;
    actor.command.fireHeld = actor.command.firePressed = actor.command.secondaryHeld = actor.command.secondaryPressed = false;
    this.combatActions.set(actor.id, {action: 'draw', at: this.time});
    this.emit({kind: 'action', tick: this.tick, actorId: actor.id, equipment, action: 'draw'});
    return true;
  }
  pause() {
    this.paused = true;
    for (const held of this.heldUtilities.values()) {held.primedAt = undefined; held.releaseAt = undefined;held.throwStartedAt=undefined;}
    for (const actor of this.actors) {
      actor.command = idleCommand(); actor.weapon.cancelInput();
      for (const state of actor.inventory.values()) if (state !== actor.weapon) state.cancelInput();
    }
  }
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
    if (this.phase === 'ready' || this.paused) return;
    this.accumulator += Math.min(Math.max(elapsed, 0), .25);
    while (this.accumulator + 1e-10 >= STEP) {
      this.step(); this.accumulator -= STEP;
    }
  }

  step() {
    if (this.phase === 'ready' || this.paused) return;
    const competitive=this.phase==='fighting' && !this.spawnAuthoring;
    this.tick++;
    this.time = this.tick * STEP;
    this.applyEnvironment(advanceEnvironment(this.authoredArena,this.environment,STEP,this.actors.filter(actor=>actor.alive).map(actorBody)),0);
    const actorView = this.snapshot();
    this.previous = actorView;
    for (const actor of actorView) {
      if (!this.bodyTurns.has(actor.id)) this.bodyTurns.set(actor.id, new BodyTurnTimeline());
      this.bodyTurns.get(actor.id)!.record(actor, this.time - STEP);
    }
    if (competitive && this.tick % 4 === 1) {
      const sensedPoses = new Map<number, import('./actor-hitboxes').ActorHitPose | undefined>();
      const sensorPose = this.actorSensorPose ? (actor: DuelActorSnapshot) => {
        if (!sensedPoses.has(actor.id)) sensedPoses.set(actor.id, this.actorSensorPose?.(actor, this.time - STEP));
        return sensedPoses.get(actor.id);
      } : undefined;
      const shadows=actorShadows(actorView,this.arena);
      const playerContacts = actorView.slice(1).flatMap(opponent => {
        const visible = observeBot(this.time, actorView[0], [opponent], this.arena,
          {aspect: this.playerAspect, verticalFov: scopeVerticalFov(this.actors[0].weapon.actions.horizontalFov) * DEG}, [], sensorPose,
          (from, to) => this.canSeeUtility(0, from, to)).visible;
        return visible ? [visible] : [];
      });
      // actorView is the pre-step pose. End-step timestamps incorrectly made
      // fractional fire times look older than their own visibility sample.
      this.coach.observe(this.time - STEP, actorView[0], playerContacts, {
        weaponReady: !actorView[0].reloading && actorView[0].ammo > 0 && actorView[0].equipment !== 'knife' &&
          this.actors[0].equipReadyAt <= this.time - STEP && this.actors[0].weapon.nextShotAt <= this.time - STEP,
        triggerHeld: this.actors[0].command.fireHeld && !this.actors[0].command.firePressed,
      });
      for (const actor of actorView.slice(1)) {
        if (!actor.alive) continue;
        const utilityView = botSensorView(actor.scopeFov);
        const seenThrows = this.utilities.projectiles.filter(projectile => {
          if (projectile.kind !== 'flash' || !pointInView(actor, projectile.position, utilityView) ||
            !this.canSeeUtility(actor.id, actor.position, projectile.position)) return false;
          const dx = projectile.position.x - actor.position.x, dy = projectile.position.y - actor.position.y;
          const dz = projectile.position.z - actor.position.z, distance = Math.hypot(dx, dy, dz);
          return distance < 22 && distance > .01 && !Number.isFinite(traceSolid(actor.position,
            {x: dx / distance, y: dy / distance, z: dz / distance}, this.arena, distance - .03).distance);
        });
        this.utilityDefenses.get(actor.id)?.perceive(this.time, actor, seenThrows);
        if (this.controlledBots.has(actor.id)) continue;
        const observation=observeBot(this.time, actor, actorView, this.arena, undefined, shadows, sensorPose,
          (from, to) => this.canSeeUtility(actor.id, from, to),
          {horizontalFov: this.actors[actor.id].weapon.actions.horizontalFov, previousVisible: this.perceivedEnemies.get(actor.id)});
        this.perceivedEnemies.set(actor.id, observation.visible);
        this.brains.get(actor.id)?.perceive(observation);
        if(observation.visible)this.lastContactAt.set(actor.id,this.time);
      }
      if (this.config.radarEnabled) this.radar.observeVisible(this.time,playerContacts);
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
        busy: this.brains.get(actor.id) instanceof TacticalBrain && (this.brains.get(actor.id) as TacticalBrain).trading(this.time),
        lastShotAt:this.lastShotAt.get(actor.id),lastHurtAt:this.lastHurtAt.get(actor.id),lastDownAt:this.lastDownAt.get(actor.id),contactAt:this.lastContactAt.get(actor.id)}));
      const assignments=this.teamPlanner.plan(this.time,peers,this.arena.lanes??[],this.teamContacts, this.config.tradeEnabled);
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
    for (const actor of competitive?this.actors.slice(1):[]) {
      if (!actor.alive || this.controlledBots.has(actor.id)) continue;
      const brain = this.brains.get(actor.id);
      const contact = this.perceivedEnemies.get(actor.id);
      const recognized = brain?.threatReport(this.time);
      const self = {...actorView[actor.id], equipment: actor.weapon.id, ammo: actor.weapon.ammo, reloading: actor.weapon.reload.active};
      const patch = brain instanceof TacticalBrain
        ? brain.command(self, this.time, actor.weapon.recovery.recoil, actorView.slice(1),
          {weaponReadyAt: Math.max(actor.equipReadyAt, actor.weapon.actions.readyAt, actor.weapon.reload.fireReadyAt)})
        : brain?.command(self, this.time);
      if (patch) this.commandBot(actor, this.applyBotCombatPolicy(actor.id, {...patch,
        ...(this.terrainCommand?.actorId===actor.id?this.terrainCommand.command:{}),
        ...this.boostPlan?.commands.find(command=>command.actorId===actor.id)?.command}, recognized ?? null, !!contact));
    }
    const shots: {actor: CombatActor; fired: FiredRound; shotId: number}[] = [];
    const movementActors=!competitive?(this.playable?[this.actors[0]]:[]):this.boostPlan?[this.actors[0],...this.actors.slice(1).sort((a,b)=>
      Number(b.id===this.boostPlan!.assignments[0].actorId)-Number(a.id===this.boostPlan!.assignments[0].actorId))]:this.actors;
    for (const actor of movementActors) {
      if (!actor.alive) continue;
      if (competitive && actor.id !== 0) {
        const defense = this.utilityDefenses.get(actor.id)?.command(this.time, actorView[actor.id], this.arena, this.utilities.effects);
        if (defense) {
          this.utilityPlanners.get(actor.id)?.cancel(this.time);
          if (this.heldUtilities.has(actor.id)) this.selectActorUtility(actor.id, null);
          this.commandBot(actor, defense);
        }
      }
      actor.punch.advance(STEP, actor.weapon.recovery.angle);
      const command = actor.command;
      if(competitive)this.replay.input(this.tick, actor.id, command);
      if(command.dropPressed)this.dropWeapon(actor);
      if(command.usePressed)this.useEnvironment(actor.id);
      if(command.pickupPressed&&actor.id===0)this.pickupPlayer();
      if (command.utilityKind !== undefined && actor.id === 0) {this.selectUtility(command.utilityKind); command.utilityKind = undefined;}
      if (actor.id === 0 && command.equipSlot) {this.equipPlayer(command.equipSlot); command.equipSlot = undefined;}
      actor.yaw += command.yawDelta;
      actor.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, actor.pitch + command.pitchDelta));
      if (competitive && actor.id === 0) this.coach.movement(this.time - STEP, {...actorView[0], yaw: actor.yaw, pitch: actor.pitch}, command);
      recoverTagging(actor, STEP, actor.grounded ?? actor.feet === 0);
      const zoomBefore=actor.weapon.actions.zoom;
      if(!this.heldUtilities.has(actor.id)&&command.secondaryPressed&&actor.weapon.id!=='revolver'&&!actor.weapon.reloadUntil) {
        actor.weapon.actions.secondary(this.time);command.secondaryPressed=false;
      }
      // Bots scope before firing. They use the same mode-specific speed/accuracy
      // data as the player, without learning anything about hidden positions.
      if (actor.id !== 0 && actor.weapon.id !== 'knife' && gameData.weapons[actor.weapon.id].zoomLevels && !actor.weapon.actions.zoom && !actor.weapon.actions.pendingZoom && command.fireHeld) {
        actor.weapon.actions.secondary(this.time);
      }
      const next = advanceActor(actor, command, (this.heldUtilities.has(actor.id) ? 245 : actor.weapon.actions.stats.speed) * UNIT, STEP,
        (from, desired, feet, height) => {
          const staticPosition = moveInArena(from, desired, feet, height, this.arena);
          if (this.spawnAuthoring) return staticPosition;
          const clear = (position: Vec) => this.actors.every(other => other === actor || !other.alive ||
            Math.hypot(position.x - other.position.x, position.z - other.position.z) >= 32 * UNIT);
          if (clear(staticPosition)) return staticPosition;
          const xOnly = {...staticPosition, z: from.z};
          if (clear(xOnly)) return xOnly;
          const zOnly = {...staticPosition, x: from.x};
          return clear(zOnly) ? zOnly : from;
        }, (position, feet, height) => canFitInArena(position, feet, height, this.arena),
        (position, from, to, height) => verticalContact(position, from, to, height, this.arena.solids),
        arenaMovementEnvironment(this.arena,(this.spawnAuthoring?[actor]:this.actors).map(other=>({...other,previous:this.previous[other.id]})),actor.id,this.time-STEP,actor.pitch));
      const traveled = Math.hypot(next.position.x - actor.position.x, next.position.z - actor.position.z);
      const landed=audibleLanding(actor,next);
      Object.assign(actor,next);
      if (landed) {actor.stepDistance=0;this.emitSound(actor, 'landing', next.position);}
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
      const usingUtility = this.heldUtilities.has(actor.id);
      if (usingUtility) {
        actor.weapon.advancePassive(this.time, STEP, (actor.duckAmount ?? 0) >= .95, !actor.grounded);
        this.advanceUtilityInput(actor);
      }
      const sightBlocked = actor.id !== 0 && this.flashAmount(actor.id) >= .35;
      const fired = usingUtility || this.spawnAuthoring ? undefined : actor.weapon.advance(this.time, STEP, this.time < actor.equipReadyAt || sightBlocked
        ? {...command, fireHeld: false, firePressed: false, secondaryHeld: false, secondaryPressed: false}
        : this.weaponCommand(actor, command), {...actor,sampleAt:at=>sampleShotState(actorView[actor.id],actor,at,this.time)});
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
      const shotId = this.shotId++;
      if (competitive && actor.id === 0) this.coach.shot({...this.snapshot()[0],...sampleShotState(actorView[actor.id],actor,fired.at??this.time,this.time)}, shotId, fired.at??this.time,
        {stats: actor.weapon.recovery.weapon, walking: command.walk, aimDirection: fired.aimDirection, shotState: fired.accuracy});
      shots.push({actor, fired, shotId});
      this.lastShotAt.set(actor.id,this.time);
      this.combatActions.set(actor.id,{action:'fire',at:this.time});
      this.emit({kind: 'fire', tick: this.tick, actorId: actor.id, shotId,
        equipment: fired.weapon, origin: fired.origin, direction: fired.direction,
        pelletDirections:fired.pelletDirections,alternate:fired.attack==='secondary',ordinal:fired.ordinal,accuracy:fired.accuracy});
      this.informHearing(actor, fired.origin, 'gunshot');
    }
    for (const actor of this.snapshot()) {
      this.bodyTurns.get(actor.id)?.record(actor, this.time);
      this.actorPoseTick?.(actor, this.time);
    }
    const pending: PendingHit[] = [];
    for (const shot of shots) this.resolveShot(shot.actor, shot.fired, shot.shotId, pending);
    this.advanceUtilities(pending);
    const combined:PendingHit[]=[];
    for(const hit of pending) {
      const prior=combined.find(other=>other.event.shotId===hit.event.shotId&&other.victim.id===hit.victim.id);
      if(prior) {
        prior.event.healthDamage+=hit.event.healthDamage;prior.event.armorDamage+=hit.event.armorDamage;
        prior.impulses.push(...hit.impulses);
        if(hit.event.group==='head'){prior.event.group='head';prior.event.point=hit.event.point;}
      } else combined.push(hit);
    }
    const tradeReports = new Map<number, ThreatReport | null>();
    if (this.config.tradeEnabled && combined.some(hit => hit.victim.side === 'enemy')) {
      // Freeze sensed evidence before damage callbacks or trade orders mutate brains.
      for (const actor of this.actors.slice(1).filter(actor => actor.alive)) {
        const report = this.threatReport(actor.id);
        tradeReports.set(actor.id, report ? {...report, point: {...report.point}} : null);
      }
    }
    const tradeDeaths: number[] = [];
    for (const {victim, weapon, direction, event,impulses} of combined) {
      if (!victim.alive) continue;
      const armorBeforeHit = victim.armor;
      event.healthDamage = Math.min(victim.health, event.healthDamage);
      event.armorDamage = Math.min(victim.armor, event.armorDamage);
      const lethal = victim.alive && victim.health <= event.healthDamage;
      victim.health = Math.max(0, victim.health - event.healthDamage);
      victim.armor = Math.max(0, victim.armor - event.armorDamage);
      if (victim.health === 0) victim.alive = false;
      if (lethal) {victim.deathDirection = {...direction};victim.deathGroup=event.group;this.dropDeathUtility(victim);}
      else if(event.healthDamage>0) {
        victim.recentHits=[...(victim.recentHits??[]).filter(hit=>this.time-hit.time<.7),
          {time:this.time,region:event.group,helmet:victim.helmet,actorYaw:victim.yaw,incoming:{x:direction.x,z:direction.z}}].slice(-6);
      }
      this.lastHurtAt.set(victim.id,this.time);if(lethal)this.lastDownAt.set(victim.id,this.time);
      if (victim.alive && event.healthDamage > 0 && !event.utility) applyTagging(victim, weapon, victim.weapon.id);
      if (victim.alive && event.healthDamage > 0)for(const impulse of impulses)victim.punch.hit(impulse);
      event.armored=impulses.some(hit=>hit.armor>0&&['chest','stomach','arm'].includes(hit.group));
      event.helmet=victim.helmet;event.direction={...direction};
      if (victim.alive && victim.side === 'enemy') {
        const brain = this.brains.get(victim.id);
        if (brain instanceof TacticalBrain) brain.hurt(this.time, victim.health);
      }
      if (lethal && victim.side === 'enemy' && this.config.tradeEnabled) tradeDeaths.push(victim.id);
      event.lethal = lethal;
      if(lethal && event.shooter===0) this.radar.confirmDeath(victim.id,this.time);
      if (lethal && victim.side === 'enemy' && victim.weapon.id !== 'knife') this.drops.push({
        id: victim.id, equipment: victim.weapon.id, ammo: victim.weapon.ammo,
        reserve:victim.weapon.reserve,
        position: {...victim.position, y: victim.feet + .08}, picked: false,
      });
      const hitTime = shots.find(shot => shot.shotId === event.shotId)?.fired.at ?? this.time;
      const playerReload = this.actors[0].weapon.reload;
      if(competitive)this.coach.hit(event, hitTime, this.actors[event.shooter].weapon.id === 'knife',
        {reloading: playerReload.active && playerReload.startedAt <= hitTime});
      this.emit(event);
    }
    if (tradeDeaths.length) {
      const survivors = this.snapshot();
      // Stable casualty ordering keeps responder rolls independent of hit order.
      for (const victimId of tradeDeaths.sort((a, b) => a - b)) this.offerDeathTrade(victimId, survivors, tradeReports);
    }
    if (competitive && (this.tick % 4 === 0 || this.utilityReplayDirty)) {
      this.replay.utility(this.tick,this.time,this.utilities.projectiles,this.utilities.effects,this.utilityReplayDirty,this.utilityDrops);
      this.utilityReplayDirty = false;
    }
    if (competitive && this.tick % 4 === 0) {
      this.replay.world(this.environment.revision, this.arena, this.environment);
      this.replay.frame(this.tick, this.time, this.replayActors(), this.actors.slice(1).map(actor => ({
      actor: actor.id, decision: this.botDecision(actor.id) ?? {}})));
    }
    if (competitive && (!this.actors[0].alive || this.actors.slice(1).every(actor => !actor.alive) || this.time >= this.config.roundSeconds)) {
      const playerAlive = this.actors[0].alive, botsAlive = this.actors.slice(1).some(actor => actor.alive);
      this.outcome = playerAlive && !botsAlive && this.actors.length > 1 ? 'won' : !playerAlive && botsAlive ? 'lost' : 'draw';
      this.phase = 'result';
      this.completedAt=this.time;
      this.replay.world(this.environment.revision, this.arena, this.environment);
      this.replay.frame(this.tick, this.time, this.replayActors(), undefined, true);
      this.replay.utility(this.tick,this.time,this.utilities.projectiles,this.utilities.effects,true,this.utilityDrops);
      this.emit({kind: 'round', tick: this.tick, outcome: this.outcome, seconds: this.time});
    }
  }

  private commandBot(actor: CombatActor, patch: Partial<ActorCommand>) {
    actor.command = {...actor.command, ...patch};
  }

  private advanceUtilities(pending: PendingHit[]) {
    const active = this.utilities.projectiles.length > 0 || this.utilities.effects.length > 0;
    for (const event of this.utilities.advance(STEP, this.time, this.arena, active ? this.snapshot() : [])) {
      if(event.type!=='sound'&&event.type!=='damage'&&event.type!=='flash')this.utilityReplayDirty=true;
      if(this.phase==='fighting')this.replay.utilityEvent(event);
      if (event.type === 'damage') {
        const victim = this.actors[event.targetId], source = this.actors[event.actorId];
        if (!victim?.alive || !source) continue;
        // Normal team damage is disabled; self-damage still punishes a bad throw.
        if (source.id !== victim.id && source.side === victim.side) continue;
        pending.push({victim, weapon: source.weapon.id, direction: event.direction, impulses: [], event: {
          kind: 'hit', tick: this.tick, shooter: source.id, victim: victim.id, shotId: this.shotId++,
          group: 'chest', point: event.point, healthDamage: event.healthDamage, armorDamage: event.armorDamage,
          lethal: false, utility: event.kind,
        }});
      } else if (event.type === 'flash') {
        const old=this.flashes.get(event.targetId),fade=event.fade??event.duration*Math.fround(1.4),hold=event.hold??0;
        this.flashes.set(event.targetId,applyNativeFlash(old,hold,fade,event.time));
      } else if (event.type === 'sound') {
        const action = event.sound === 'bounce' ? 'bounce' : event.sound === 'decoy' ? 'decoy'
          : event.sound === 'extinguish' ? 'extinguish' : 'detonate';
        this.emit({kind: 'utility', tick: this.tick, actorId: event.actorId, utility: event.kind,
          action, point: event.position, sound: event.sound,
          equipment: event.sound === 'decoy' ? this.utilityWeapons.get(event.utilityId) : undefined});
        this.utilitySound(event);
      } else if (event.type === 'detonate' || event.type === 'extinguish') {
        if(event.type==='detonate')this.utilityTeam.detonated(event.utilityId,event.time);
        this.emit({kind: 'utility', tick: this.tick, actorId: event.actorId, utility: event.kind,
          action: event.type, point: event.position});
      } else if (event.type === 'expire') this.utilityWeapons.delete(event.utilityId);
    }
  }

  private utilitySound(event: Extract<UtilityEvent, {type: 'sound'}>) {
    const source = this.actors[event.actorId];
    if (!source || source.side !== 'player') return;
    for (const listener of this.actors.slice(1)) {
      if (!listener.alive) continue;
      const path = this.acoustics.resolve(listener.position, event.position, this.time);
      if (path.distance > event.radius || path.gain * (1 - path.distance / event.radius) < .06) continue;
      this.hearBot(listener.id, path.apparentPosition, event.sound === 'bounce' ? 'footstep' : 'gunshot', path.gain < 1);
    }
  }

  protected threatReport(actorId: number): ThreatReport | null {
    return this.brains.get(actorId)?.threatReport(this.time) ?? null;
  }
  protected orderTrade(actorId: number, order: TradeOrder) {
    this.brains.get(actorId)?.orderTrade(order);
  }
  protected tradeSkill(actorId: number): SkillLevel {return botConfig(this.config, actorId - 1).skill;}
  private offerDeathTrade(victimId: number, snapshot: readonly DuelActorSnapshot[], reports: ReadonlyMap<number, ThreatReport | null>) {
    const victim = snapshot[victimId];
    const peers = snapshot.slice(1).filter(actor => actor.alive).map(actor => {
      const level = this.tradeSkill(actor.id);
      let report = reports.get(actor.id) ?? null;
      // A nearby audible teammate death is a reason to check the fight area,
      // even when the victim died before identifying the attacker. It does
      // not reveal an unseen killer or bypass the listener's reaction delay.
      if (!report && Math.hypot(actor.position.x - victim.position.x, actor.position.z - victim.position.z) <= 18) {
        const path = this.acoustics.resolve(actor.position, victim.position, this.time);
        const skill = proficiency(level);
        if (footstepGain(path.distance) * path.gain >= .035 + (1 - skill) * .03)
          report = deathSoundReport(path.apparentPosition, this.time, .18 + (1 - skill) * .3, this.tradeRandom);
      }
      return {actor, level, report};
    });
    // The killer's current actor position is deliberately not an input. A
    // communicated sighting or a survivor's audible shot estimate is enough.
    const report = reports.get(victimId) ?? null;
    for (const {actorId, order} of deathTradeOrders(victim, peers, this.time, report, this.tradeRandom)) this.orderTrade(actorId, order);
  }

  private resolveShot(shooter: CombatActor, fired: FiredRound, shotId: number, pending: PendingHit[]) {
    const shotTime=fired.at??this.time;
    const targets=this.snapshot().map(current=>({...current,...sampleShotState(this.previous[current.id]??current,current,shotTime,this.time)})).map(current=>({...current,
      hitPose: current.alive && current.id !== shooter.id && this.actorHitPose &&
        [...(fired.pelletDirections ?? [fired.direction]), fired.aimDirection ?? fired.direction].some(direction => {
          // Conservative broad phase: do not evaluate rigs outside every shot
          // ray. The entire native actor fits in this sphere, including lean.
          const center = {...current.position, y: current.feet + 1};
          return !!rayCapsuleInterval(fired.origin, direction, center, center, 2.5, fired.maxDistance);
        }) ? this.actorHitPose(current, shotTime) : undefined,
      armor:Math.max(0,current.armor-pending.filter(hit=>hit.victim.id===current.id).reduce((sum,hit)=>sum+hit.event.armorDamage,0))}));
    if(this.phase==='fighting') {
    this.replay.world(this.environment.revision, this.arena, this.environment);
    this.replay.shot({id: shotId, tick: this.tick, time: shotTime, shooter: shooter.id, weapon: fired.weapon,
      origin: fired.origin, direction: fired.direction, aimDirection: fired.aimDirection ?? fired.direction,
      range: fired.maxDistance, pellets: fired.pelletDirections, accuracy: fired.accuracy, randomState: fired.randomState,
      targets: targets.filter(target => target.id !== shooter.id).map(target => ({actor: target, pose: target.hitPose}))});
    }
    const addHit=(victim:CombatActor,group:Hitgroup,point:Vec,direction:Vec,damage:{healthDamage:number;armorDamage:number})=>{
      const armor=Math.max(0,victim.armor-pending.filter(hit=>hit.victim.id===victim.id).reduce((sum,hit)=>sum+hit.event.armorDamage,0));
      pending.push({victim,weapon:fired.weapon,direction,impulses:[{group,rawDamage:damage.healthDamage+damage.armorDamage*2,armor,helmet:victim.helmet}],event:{kind:'hit',tick:this.tick,shooter:shooter.id,victim:victim.id,shotId,group,point,
        healthDamage:damage.healthDamage,armorDamage:damage.armorDamage,lethal:false}});
    };
    if(fired.kind==='melee'||fired.kind==='zeus') {
      const range=fired.maxDistance;
      const surface=traceSolid(fired.origin,fired.direction,this.arena,range);
      let nearest={distance:surface.distance,target:undefined as DuelActorSnapshot|undefined,group:undefined as Hitgroup|undefined};
      for(const target of targets) {
        if(!target.alive||target.id===shooter.id)continue;
        const hit=fired.kind==='melee'?traceMelee(fired.origin,fired.direction,target,Math.min(range,nearest.distance)):
          traceActor(fired.origin,fired.direction,{...target.position,y:target.feet},target.duckAmount,Math.min(range,nearest.distance),target.yaw,target.hitPose);
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
    const coachingTarget = this.phase==='fighting' && shooter.id === 0 ? targets.find(target => target.id === this.coach.shotTarget(shotId) && target.alive) : undefined;
    const aimOnTarget = coachingTarget ? !!traceActor(fired.origin, fired.aimDirection ?? fired.direction,
      {...coachingTarget.position, y: coachingTarget.feet}, coachingTarget.duckAmount, fired.maxDistance,
      coachingTarget.yaw, coachingTarget.hitPose).group : false;
    let rayOnTarget = false, blockedByCover = false, reachedTarget = false;
    for(const direction of fired.pelletDirections??[fired.direction]) {
      const ray=resolveBulletRay({origin:fired.origin,direction,range:fired.maxDistance,equipment:fired.weapon,
        arena:this.arena,actors:targets,shooterId:shooter.id,shooterSide:shooter.side});
      this.utilities.clearSmokeSegment(fired.origin, pointOnRay(fired.origin, direction,
        Math.min(fired.maxDistance, Number.isFinite(ray.distance) ? ray.distance : fired.maxDistance)), this.time);
      if(this.utilities.effects.some(effect=>effect.type==='smoke'))this.utilityReplayDirty=true;
      if (coachingTarget) {
        const geometric = traceActor(fired.origin, direction, {...coachingTarget.position, y: coachingTarget.feet},
          coachingTarget.duckAmount, fired.maxDistance, coachingTarget.yaw, coachingTarget.hitPose);
        if (geometric.group) {
          rayOnTarget = true;
          reachedTarget ||= ray.distance >= geometric.distance - .001 || ray.hits.some(hit => hit.actorId === coachingTarget.id);
          blockedByCover ||= ray.distance < geometric.distance - .001 && ray.surfaces.some(surface => surface.distance < geometric.distance);
        }
      }
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
    if (coachingTarget) this.coach.shotEvidence(shotId, {aimOnTarget, rayOnTarget,
      stoppedByCover: blockedByCover && !reachedTarget,
      recoilDegrees: fired.accuracy ? Math.hypot(fired.accuracy.recoil.yaw, fired.accuracy.recoil.pitch) : 0,
      recovering: (fired.accuracy?.recoveringInaccuracy ?? 0) > .00001});
  }

  private replayActors() {
    return this.snapshot().map(actor => {
      const weapon = this.actors[actor.id].weapon;
      const punch = this.actors[actor.id].punch.predict(0, weapon.recovery.angle);
      const view = recoilView(actor.yaw - punch.yaw * DEG, actor.pitch + punch.pitch * DEG, weapon.recovery.angle);
      return {...actor, utilityState:this.utilityPresentation(actor.id),flashAmount:this.flashAmount(actor.id),
        bodyYaw: this.actorBodyYaw(actor), view: {yaw: view.yaw, pitch: view.pitch, roll: punch.roll * DEG,
        fov: scopeVerticalFov(actor.alive ? weapon.actions.horizontalFov : 90)}};
    });
  }

  snapshot(): DuelActorSnapshot[] {
    return this.actors.map(actor => ({
      id: actor.id, generation: actor.generation, side: actor.side, position: {...actor.position}, velocity: {...actor.velocity},
      feet: actor.feet, grounded: actor.grounded ?? actor.feet === 0, verticalVelocity:actor.verticalVelocity, yaw: actor.yaw, pitch: actor.pitch, crouched: (actor.duckAmount ?? 0) >= .5,
      aimPunch: actor.punch.shotFor(actor.weapon.recovery.angle),
      deathDirection: actor.deathDirection ? {...actor.deathDirection} : undefined,
      deathGroup:actor.deathGroup,recentHits:actor.recentHits,
      duckAmount: actor.duckAmount ?? 0, health: actor.health, armor: actor.armor,
      helmet: actor.helmet, alive: actor.alive, equipment: actor.weapon.id, ammo: actor.weapon.ammo,
      reloading: actor.weapon.reloadUntil > 0,
      reserve: actor.weapon.reserve,reloadSilent:actor.weapon.reloadSilent,
      action:this.combatActions.get(actor.id)?.action,actionAt:this.combatActions.get(actor.id)?.at,
      supportingActor:typeof actor.supportId==='number'?actor.supportId:undefined,
      scopeFov: actor.weapon.actions.horizontalFov,
      utility: this.heldUtilities.get(actor.id)?.kind,
      flashAmount: this.flashAmount(actor.id),
    }));
  }

  botDecision(actorId: number): (ReplayDecision & {phase: string; peek: string}) | undefined {
    const brain = this.brains.get(actorId);
    return brain instanceof TacticalBrain ? {...brain.decisionSnapshot(this.time), loadoutReason: this.loadoutReasons.get(actorId),
      utilityIntent: `${this.utilityDefenses.get(actorId)?.decision() ?? 'none'} / ${this.utilityPlanners.get(actorId)?.decision() ?? 'none'}`}
      : brain ? {phase: 'hold', peek: 'none', ...brain.decisionSnapshot(this.time)} : undefined;
  }

  renderSnapshot() {
    const current = this.snapshot();
    if (this.paused || !this.playable || this.postWinPlayable&&this.time===this.completedAt) return current;
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
    configureArenaAcoustics(this.acoustics,this.arena);
    for(const event of result.events) {
      if(event.kind==='damaged')continue;
      this.emit({kind:'environment',tick:this.tick,actorId,environmentId:event.id,action:event.kind==='opened'?'open':
        event.kind==='closed'?'close':event.kind==='destroyed'?'break':'move',point:event.position});
    }
  }

  private dropWeapon(actor:CombatActor) {
    const utility = this.heldUtilities.get(actor.id);
    if (utility) return this.dropUtility(actor, utility.kind);
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

  private dropUtility(actor: CombatActor, kind: UtilityKind) {
    const stock = this.utilityStocks.get(actor.id);
    const held = this.heldUtilities.get(actor.id);
    if (!stock?.[kind] || held?.primedAt !== undefined && this.time >= held.primedAt) return false;
    const from = {...actor.position, y: actor.feet + .15}, direction = aimDirection(actor.yaw, 0);
    const hit = traceSolid(from, direction, this.arena, .65);
    const position = pointOnRay(from, direction, Math.max(0, Math.min(.65, hit.distance - .08)));
    const floor = traceSolid(position, {x: 0, y: -1, z: 0}, this.arena, 3);
    position.y = Number.isFinite(floor.distance) ? position.y - floor.distance + .06 : actor.feet + .06;
    stock[kind]--; this.heldUtilities.delete(actor.id);
    if (this.utilityDrops.length >= 64) this.utilityDrops.splice(this.utilityDrops.findIndex(drop => drop.picked) >= 0
      ? this.utilityDrops.findIndex(drop => drop.picked) : 0, 1);
    this.utilityDrops.push({id: this.dropSequence++, utility: kind, position, picked: false, droppedAt: this.time, owner: actor.id});
    this.utilityReplayDirty = true;
    actor.weapon.cancelInput(); actor.command.fireHeld = actor.command.secondaryHeld = false;
    actor.equipReadyAt = this.time + equipmentStats(actor.weapon.id).deploy;
    return true;
  }

  private dropDeathUtility(actor: CombatActor) {
    const held = this.heldUtilities.get(actor.id), stock = this.utilityStocks.get(actor.id);
    if (!stock) return;
    if (held?.primedAt !== undefined && this.time >= held.primedAt && stock[held.kind] > 0) {
      this.utilities.throw({actorId: actor.id, side: actor.side, kind: held.kind, origin: {...actor.position},
        direction: {x: 0, y: -1, z: 0}, velocity: {x: actor.velocity.x, y: actor.verticalVelocity, z: actor.velocity.z}, strength: 0, time: this.time});
      stock[held.kind]--; this.heldUtilities.delete(actor.id); this.utilityReplayDirty=true;return;
    }
    // Installed mp_death_drop_grenade=2: selected utility, otherwise best carried.
    const best = held?.kind ?? (['incendiary', 'molotov', 'smoke', 'he', 'flash', 'decoy'] as const).find(kind => stock[kind] > 0);
    if (best) this.dropUtility(actor, best);
  }

  drainEvents(): DuelEvent[] { const events = this.events; this.events = []; return events; }

  private emit(event: DuelEvent) {
    if(event.kind==='utility'&&this.phase==='fighting'){
      this.replay.utilityEvent(event);if(event.action==='throw')this.utilityReplayDirty=true;
    }
    if (event.kind === 'hit' || event.kind === 'surface') this.replay.contact(event);
    if (this.events.length === 512) this.events.shift();
    this.events.push(event);
  }

  private emitSound(actor: CombatActor, sound: 'footstep' | 'landing', point: Vec) {
    this.emit({kind: 'sound', tick: this.tick, actorId: actor.id, sound, point: {...point}});
    this.informHearing(actor, point, sound);
  }

  private informHearing(actor: CombatActor, point: Vec, sound: 'footstep' | 'landing' | 'gunshot') {
    // Enemy hearing consumes hostile audio only; friendly audio is still rendered.
    if (actor.side !== 'player') return;
    const floor=sound==='gunshot'?undefined:this.arena.native?.floorSurfaceAt?.(point.x,point.z,actor.feet+.25,.5);
    const material=surfaceFootstepMaterial(floor?.surface);
    for (const listener of this.actors.slice(1)) {
      if (!listener.alive) continue;
      const dx = point.x - listener.position.x, dy = point.y - listener.position.y, dz = point.z - listener.position.z;
      const distance = Math.hypot(dx, dy, dz);
      const range = sound === 'gunshot' ? gunshotRange(actor.weapon.id) : FOOTSTEP_RANGE;
      if (distance > range || distance < .01) continue;
      const nativeBlocked=!!this.arena.native?.ray(listener.position,{x:dx/distance,y:dy/distance,z:dz/distance},distance-.02);
      const path=retainSoundOcclusion(this.acoustics.resolve(listener.position,point,this.time),nativeBlocked);
      const occluded=path.gain<1;
      const threshold = .018 + (1 - proficiency(botConfig(this.config, listener.id - 1).skill)) * .03;
      const gain = sound === 'gunshot' ? gunshotGain(actor.weapon.id, path.distance)
        : footstepGain(path.distance, material, sound === 'landing');
      if (gain*path.gain < threshold) continue;
      this.lastContactAt.set(listener.id,this.time);
      this.hearBot(listener.id, path.apparentPosition, sound, occluded);
    }
  }
  protected hearBot(actorId: number, point: Vec, sound: 'footstep' | 'landing' | 'gunshot', occluded: boolean) {
    const brain = this.brains.get(actorId);
    if (brain instanceof TacticalBrain) brain.hear(point, this.time, sound, occluded);
  }
}
