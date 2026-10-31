import {DEG, STEP, UNIT, clamp, type Vec} from '../actor-physics';
import {gameData, pistolIds, sniperIds, type Weapon} from '../config';
import type {RecoilAngle} from '../recoil';
import type {BotBehavior, SkillLevel} from './config';
import {canFitInArena,traceSolid, type Arena, type CoverLane} from './geometry';
import {clearSegment, routeTo} from './navigation';
import {currentVisible, type BotObservation, type VisibleEnemy} from './perception';
import {combatStyle, peekDistribution, peekTypes, sampleCombatPlan, samplePeek, type BotTraits, type PeekChoice} from './skill';
import {idleCommand, type ActorCommand, type DuelActorSnapshot} from './types';
import {aimStep, type AimMotor, type AimMotorMode} from './motor';
import {AngleAwareness, CueAngleChecks, proficiency, SightingMemory} from './awareness';
import {randomStream} from './rng';
import {copyTeamAssignment, passageReservations, type PassageDecision, type TeamAssignment} from './coordination';
import {knifeModel} from '../equipment';
import {activeTrade, copyTradeOrder, type ThreatReport, type TradeOrder} from './trading';
import {ApproachAim} from './approach-aim';
import {laneThreatAlignment, nativeLaneRole} from './tactical-geometry';
import {arbitrateGaze, firingVeto, type AimIntent, type FireBlockedReason, type TacticalReadiness} from './aim-intent';
import {TravelProgress} from './travel-progress';
import {tacticalPersonality} from './tactical-personality';
import {narrowPassage, type NarrowPassage} from './narrow-passage';
import {FlankPlan} from './flank-plan';
import {combatMovement, type CombatMovement} from './combat-movement';

type Phase = 'approach' | 'setup' | 'expose' | 'brake' | 'attack' | 'return' | 'push' | 'investigate' | 'microstrafe' | 'reload' | 'close';
type FightIntent = 'seek' | 'contest' | 'hold-angle' | 'reset' | 'change-angle' | 'close';
const peekTravel: Record<PeekChoice, number> = {hold: 0, shoulder: -.45, quick: 0, wide: .95,
  ferrari: 1.65, crouch: -.05, prefire: 0, slice: -.35, jump: -.15, run: .8, crouchWide: .95};
const difference = (target: number, current: number) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
const normal = (random: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

// Motor inputs run at simulation tick rate; tactical choices happen at action
// boundaries and cached geometry checks. This class
// never receives the hidden player's live position: only sensed observations.
export class TacticalBrain {
  phase: Phase = 'approach';
  activePeek: PeekChoice = 'hold';
  private observation: BotObservation | null = null;
  private firstVisible = -1;
  private readyAt = Infinity;
  private phaseAt = 0;
  private nextShotAt = 0;
  private aimError = {yaw: 0, pitch: 0};
  private aimDrift = {yaw: 0, pitch: 0};
  private driftAt = 0;
  private compensation = {yaw: 0, pitch: 0};
  private targetVelocity = {x: 0, z: 0};
  private nextBurstAt = 0;
  private stopThisPeek = true;
  private route: Vec[] = [];
  private routeGoal = '';
  private routeTarget: Vec | null = null;
  private routeAt = -Infinity;
  private routeCheckAt = -Infinity;
  private shortcutAt = -Infinity;
  private readonly travelProgress = new TravelProgress();
  private recoveryGoal: Vec | null = null;
  private recoveryUntil = -Infinity;
  private gaze: AimIntent | null = null;
  private fireBlockedReason: FireBlockedReason | null = 'no-sight';
  private readonly personality: ReturnType<typeof tacticalPersonality>;
  private readonly flankPlan: FlankPlan;
  private passage: NarrowPassage | null = null;
  private passageCheckAt = -Infinity;
  private passageWaypoint: Vec | null = null;
  private passageDecision: PassageDecision | null = null;
  private motorMode: AimMotorMode = 'clearing';
  private equipped: DuelActorSnapshot['equipment'];
  private repeat: PeekChoice = 'hold';
  private readonly preaimHeight: number;
  private bodyAim = false;
  private lane: CoverLane;
  private readonly lanes: CoverLane[];
  private peekCount = 0;
  private setupWait = .5;
  private coverRecheckAt = Infinity;
  private attackWait = .8;
  private attackFiredAt = -1;
  private attackRounds = 1;
  private attackShots = 0;
  private previousAmmo?: number;
  private burstRecovery = .25;
  private intent: FightIntent = 'seek';
  private commitUntil = -Infinity;
  private holdUntil = -Infinity;
  private engagementAt = -Infinity;
  private resetGoal: Vec | null = null;
  private resetCovered = false;
  private resetPlannedAt = -Infinity;
  private holdGeometryAt = -Infinity;
  private holdGeometryResult = false;
  private readonly visitedLanes = new Map<string, number>();
  private readonly cornerPressure = new Map<string, {at: number; count: number}>();
  private lastDodgeSign = 0;
  private combatStrafes = 0;
  private microGoal: Vec | null = null;
  private combatMotion?: CombatMovement;
  private motionRetryAt = -Infinity;
  private forceReposition = false;
  private lastHurtAt = -Infinity;
  private scanAim: Vec;
  private readonly approachAim=new ApproachAim();
  private brakeFromMicro = false;
  private arrivedGoal = '';
  private readonly motor: AimMotor = {yawRate: 0, pitchRate: 0};
  private heard: Vec | null = null;
  private heardSource: 'sound' | 'teammate' = 'sound';
  private heardAt = -Infinity;
  private heardReadyAt = Infinity;
  private actedOnSoundAt = -Infinity;
  private soundDecisionAt = -Infinity;
  private readonly stagger: number;
  private readonly stealthRoll: number;
  private readonly hearingRandom: () => number;
  private sightEdge: Vec | null = null;
  private peekWidth = 1;
  private readonly scanPoints: Vec[];
  private readonly searchPoints: Vec[];
  private knownApproach:Vec|null=null;
  private knownApproachUntil=-Infinity;
  private readonly style: ReturnType<typeof combatStyle>;
  private readonly awareness: AngleAwareness;
  private readonly memory: SightingMemory;
  private crouchSpray = false;
  private crouchTap = false;
  private tapDelay = .4;
  private tapUntil = -Infinity;
  private controlVariation = 1;
  private searchGoal?: Vec;
  private searchIndex = 0;
  private readonly cueChecks: CueAngleChecks;
  private shadowAt = -Infinity;
  private shadowReadyAt = Infinity;
  private shadowId?: string;
  private shadowPoint: Vec | null = null;
  private teamAssignment: TeamAssignment | null = null;
  private appliedTeamLane = '';
  private teamLaneCheckAt = -Infinity;
  private teamPeekCheckAt = -Infinity;
  private teamReportAt = -Infinity;
  private trade?: TradeOrder;
  private tradeArmed = false;

  constructor(private readonly traits: BotTraits, private readonly behavior: BotBehavior,
    private readonly accuracy: number, private readonly random: () => number,
    private readonly arena: Arena, private readonly level: SkillLevel,
    private weapon: Weapon, actorId: number, laneOffset = 0) {
    // Classify pinned native catalogs at consumption time without rebaking or
    // mutating shared arena lanes. Procedural roles remain authored as before.
    const lanes = this.lanes = (arena.lanes ?? []).map(lane => arena.native
      ? {...lane, role: nativeLaneRole(lane, arena.tactical?.watchPoints ?? [])} : lane);
    if (!lanes.length) throw new Error('Tactical brain needs cover lanes');
    this.stagger = Math.floor((actorId - 1) / 2) * .18;
    this.style = combatStyle(level);
    this.personality = tacticalPersonality(traits, behavior, actorId);
    this.flankPlan = new FlankPlan(this.personality);
    this.equipped = weapon;
    this.awareness = new AngleAwareness(level, random);
    this.cueChecks = new CueAngleChecks(level);
    this.memory = new SightingMemory(level, arena);
    const role = behavior === 'holder' ? 'camp' : behavior === 'patient' ? 'flank' : 'entry';
    const opening = lanes.filter(lane => lane.role === role);
    let candidates = opening.length ? opening : lanes;
    if (level !== '10+' && level <= 3 && this.random() < .45 - proficiency(level) * .6) {
      const ordinary = lanes.filter(lane => lane.role === 'entry' || lane.role === 'camp');
      if (ordinary.length) candidates = ordinary;
    }
    const authoredLane = arena.spawns?.bots[actorId-1]?.lane;
    this.lane = this.makeLane(authoredLane === undefined ? candidates[(actorId + laneOffset) % candidates.length] : lanes[authoredLane]);
    if (this.lane.role === 'flank') this.flankPlan.begin(this.laneKey(this.lane), 0, -Infinity, null);
    this.preaimHeight = this.random() < traits.lowAimTendency ? 1 : 1.58;
    this.scanAim = this.lane.watch ?? arena.tactical?.watchPoints[0] ?? {
      x: (arena.minX + arena.maxX) / 2 + this.lane.side * (arena.maxX - arena.minX) * .2,
      y: this.lane.edge.y + this.preaimHeight, z: arena.minZ + (arena.maxZ - arena.minZ) * .75};
    this.scanPoints = arena.tactical?.watchPoints ?? arena.solids.flatMap(solid => [-1, 1].map(side => ({
      x: solid.center.x + side * (solid.size.x / 2 + .45), y: this.preaimHeight,
      z: solid.center.z - solid.size.z / 2 - .2,
    })));
    this.searchPoints = arena.tactical?.searchPoints ?? arena.solids.filter(solid => solid.center.z > 5 && solid.size.x >= 3)
      .flatMap(solid => [-1, 1].map(side => ({
        x: clamp(solid.center.x + side * (solid.size.x / 2 + .9), arena.minX + 1, arena.maxX - 1),
        y: 0, z: Math.min(arena.maxZ - 1, solid.center.z + solid.size.z / 2 + 1.2),
      })));
    this.stealthRoll = this.random();
    // Hearing must not perturb route/peek rolls before its reaction deadline.
    this.hearingRandom = randomStream(Math.floor(this.random() * 0x100000000), 'auditory-localization');
  }

  private get lastSeen() {return this.memory.seen;}
  private get lastSeenAt() {return this.memory.seenAt;}

  private makeLane(base: CoverLane): CoverLane {
    return {side: base.side, role: this.arena.native ? nativeLaneRole(base, this.arena.tactical?.watchPoints ?? []) : base.role,
      watch: base.watch && {...base.watch}, axis: {...base.axis ?? {x: base.side, z: 0}},
      anchor: {...base.anchor}, edge: {...base.edge}, retreat: {...base.retreat}};
  }

  private get defensive() {return this.behavior !== 'aggressive';}
  private get staticLane() {return !!this.arena.native && distance(this.lane.anchor, this.lane.edge) < .15;}

  hurt(time: number, healthRemaining: number) {
    if (!Number.isFinite(time) || !Number.isFinite(healthRemaining)) return;
    const key = this.laneKey(this.lane), prior = this.cornerPressure.get(key);
    if (this.cornerPressure.size >= 64 && !this.cornerPressure.has(key)) this.cornerPressure.delete(this.cornerPressure.keys().next().value!);
    this.cornerPressure.set(key, {at: time, count: prior && time >= prior.at && time - prior.at < 6 ? Math.min(3, prior.count + 1) : 1});
    const repeatedDamage = time - this.lastHurtAt < .35;
    this.lastHurtAt = time;
    const experienced = this.level === '10+' || Number(this.level) >= 6;
    const contesting = !!this.observation?.visible && ['attack', 'brake', 'microstrafe'].includes(this.phase);
    this.forceReposition = healthRemaining < 35 || this.random() <
      (experienced ? contesting ? repeatedDamage ? .22 : .07 : .65 : .3);
    if (this.forceReposition && this.phase !== 'return' && this.phase !== 'reload') {
      this.intent = 'reset'; this.transition('return', time);
    }
  }

  decisionSnapshot(time = this.observation?.time ?? 0) {
    return {phase: this.phase, peek: this.activePeek, role: this.lane.role, side: this.lane.side,
      intent: this.intent, burstRounds: this.attackRounds, attention: this.memory.decision(time),
      cueAttention: this.cueChecks.decision(), gazeOwner: this.gaze?.owner ?? null,
      aimIntent: this.gaze ? {...this.gaze, point: {...this.gaze.point}} : null,
      fireBlockedReason: this.fireBlockedReason,
      sensorAge: this.observation && time >= this.observation.time ? time - this.observation.time : null,
      routeProgress: this.travelProgress.snapshot(), personality: {...this.personality},
      passage: this.passageDecision && {...this.passageDecision}, flankPlan: this.flankPlan.snapshot(),
      motorMode: this.motorMode, equipment: this.equipped, combatMovement: this.combatMotion?.style ?? null};
  }

  coordinate(assignment: TeamAssignment | null) {
    if (!assignment) {this.teamAssignment = null; this.appliedTeamLane = ''; return;}
    this.teamAssignment = copyTeamAssignment(assignment);
  }

  contactReport(time: number): Vec | null {
    return this.lastSeen && time >= this.readyAt && currentVisible(this.observation, time)
      ? {...this.lastSeen.position} : null;
  }

  teammateCallout(point: Vec, time: number) {
    if (!Number.isFinite(time) || ![point.x, point.y, point.z].every(Number.isFinite) ||
      time - this.lastSeenAt < .7 || time - this.heardAt < .35) return;
    // A report already locates the observed enemy, not the speaker's footsteps.
    // Keep its uncertainty in memory rather than adding acoustic error again.
    this.heard = {...point}; this.heardSource = 'teammate'; this.heardAt = time;
    this.heardReadyAt = time + this.traits.recognitionMedianMs / 1000 * 1.35;
    this.memory.noteEvidence({source: 'teammate', point, observedAt: time,
      readyAt: this.heardReadyAt, uncertainty: .75, lifetime: 3.5, confidence: .75});
  }

  threatReport(time: number): ThreatReport | null {
    const sight: ThreatReport | null = this.lastSeen && time >= this.readyAt && time >= this.lastSeenAt && time - this.lastSeenAt < 1.5
      ? {point: {...this.lastSeen.aimPoint}, observedAt: this.lastSeenAt, readyAt: time, source: 'sight'} : null;
    const sound: ThreatReport | null = this.heard && time >= this.heardAt && time - this.heardAt < 1.5
      ? {point: this.heardAim!, observedAt: this.heardAt, readyAt: this.heardReadyAt,
        source: this.heardSource === 'sound' ? 'sound' : 'sight'} : null;
    return sound && (!sight || sound.observedAt > sight.observedAt) ? sound : sight;
  }
  orderTrade(order: TradeOrder) {
    if (this.trade && this.trade.generation === order.generation && this.trade.victimId === order.victimId &&
      this.trade.observedAt >= order.observedAt) return;
    this.trade = copyTradeOrder(order); this.tradeArmed = false;
  }
  trading(time: number) {return !!this.trade && time < this.trade.expiresAt;}

  private stageTrade(self: DuelActorSnapshot, order: TradeOrder, time: number, teammates: readonly DuelActorSnapshot[]) {
    const ranked = this.lanes.map(lane => ({lane,
      cost: Math.min(distance(self.position, lane.anchor), distance(self.position, lane.edge)) / this.personality.tradeWillingness +
        distance(lane.edge, order.point) * .15 +
        teammates.filter(peer => peer.id !== self.id && peer.alive && peer.side === self.side &&
          distance(peer.position, lane.edge) < 1.4).length * 5 / this.personality.tradeWillingness}))
      .sort((a, b) => a.cost - b.cost);
    for (const {lane} of ranked.slice(0, 8)) {
      const eye = {...lane.edge, y: lane.edge.y + self.position.y - self.feet};
      // An imprecise sound may fall inside cover. Test its bounded area, not an
      // exact hidden actor point, when choosing an opening to check.
      const samples = order.source === 'sound' ? [order.point, ...[[-2, 0], [2, 0], [0, -2], [0, 2]].map(([x, z]) =>
        ({...order.point, x: order.point.x + x, z: order.point.z + z}))] : [order.point];
      if (!samples.some(point => {
        const length = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
        return length > .1 && !Number.isFinite(traceSolid(eye, {x: (point.x - eye.x) / length,
          y: (point.y - eye.y) / length, z: (point.z - eye.z) / length}, this.arena, length - .02).distance);
      })) continue;
      const direct = clearSegment(self.position, lane.edge, this.arena);
      const route = direct ? [lane.edge] : routeTo(self.position, lane.anchor, this.arena);
      if (!route.length || !clearSegment(lane.anchor, lane.edge, this.arena)) continue;
      const travel = route.reduce((total, point, index) => total + distance(index ? route[index - 1] : self.position, point), 0) +
        (direct ? 0 : distance(lane.anchor, lane.edge));
      if (travel / (gameData.weapons[this.weapon].speed * UNIT) + .3 / this.personality.tradeWillingness >= order.expiresAt - time) continue;
      this.lane = this.makeLane(lane); this.sightEdge = null;
      this.flankPlan.clear();
      this.holdGeometryAt = -Infinity; this.intent = 'contest';
      this.activePeek = 'quick'; this.peekWidth = 1; this.stopThisPeek = true;
      this.nextBurstAt = Math.min(this.nextBurstAt, time);
      this.transition(direct ? 'expose' : distance(self.position, lane.anchor) < .35 ? 'setup' : 'approach', time);
      break;
    }
    this.tradeArmed = true;
  }

  private get heardAim(): Vec | null {
    return this.heard ? {...this.heard,
      y: this.arena.native || this.heardSource === 'teammate' ? this.heard.y : this.preaimHeight} : null;
  }

  hear(point: Vec, time: number, kind: 'footstep' | 'landing' | 'gunshot', occluded: boolean) {
    if (!Number.isFinite(time) || time < this.heardAt || ![point.x, point.y, point.z].every(Number.isFinite)) return;
    const error = (kind === 'gunshot' ? .85 : kind === 'landing' ? 1.25 : 1.8) * (occluded ? 1.7 : 1) * (1.35 - proficiency(this.level) * .65);
    const continuingCue = this.heardSource === 'sound' && time - this.heardAt < .65 && this.heard && distance(point, this.heard) < 6;
    const estimate = {x: point.x + normal(this.hearingRandom) * error,
      y: point.y, z: point.z + normal(this.hearingRandom) * error};
    this.heard = continuingCue ? {x: this.heard!.x + (estimate.x - this.heard!.x) * .35,
      y: point.y, z: this.heard!.z + (estimate.z - this.heard!.z) * .35} : estimate;
    this.heardAt = time; this.heardSource = 'sound';
    const readyAt = time + this.traits.recognitionMedianMs / 1000 *
      (kind === 'gunshot' ? .65 : 1) * (occluded ? 1.35 : 1);
    this.heardReadyAt = continuingCue ? Math.min(this.heardReadyAt, readyAt) : readyAt;
    const aim=this.heardAim!;
    this.cueChecks.observe({source: 'sound', point: aim, observedAt: time,
      readyAt: this.heardReadyAt, uncertainty: error, lifetime: 3.5});
    this.memory.noteEvidence({source: 'sound', point: aim, observedAt: time,
      readyAt: this.heardReadyAt, uncertainty: error, lifetime: 3.5, confidence: .65});
  }

  perceive(observation: BotObservation) {
    if (observation.time < (this.observation?.time ?? -Infinity)) return;
    const previousSeenAt = this.lastSeenAt;
    const previousEnemyId = this.lastSeen?.id;
    const trade = activeTrade(this.trade, observation.time, observation.self.generation) ? this.trade : undefined;
    this.memory.observe(observation, trade ? [{source: 'teammate', point: trade.point, observedAt: trade.observedAt,
      readyAt: trade.readyAt, uncertainty: trade.source === 'sound' ? 3 : .75,
      confidence: trade.source === 'sound' ? .55 : .85, lifetime: trade.expiresAt - trade.observedAt}] : []);
    this.cueChecks.observeEmpty(observation, this.arena);
    this.observation = {...observation, visible: observation.visible ? this.memory.seen : null};
    this.targetVelocity = observation.visible ? this.memory.velocity : {x: 0, z: 0};
    if(observation.visible) {
      const point=observation.visible.aimPoint;
      const approach=this.scanPoints.reduce<Vec|null>((best,p)=>!best ||
        Math.hypot(p.x-point.x,p.y-point.y,p.z-point.z)<Math.hypot(best.x-point.x,best.y-point.y,best.z-point.z)?p:best,null);
      this.knownApproach={...(approach && distance(approach,point)<6?approach:point)};
      this.knownApproachUntil=observation.time+6+proficiency(this.level)*4;
    }
    const shadow = observation.shadowCues?.find(cue => cue.observedAt <= observation.time &&
      observation.time - cue.observedAt < .075 && cue.observedAt >= this.shadowAt &&
      [cue.point.x, cue.point.y, cue.point.z, cue.uncertainty].every(Number.isFinite));
    if (shadow && (this.level === '10+' || this.level >= 4)) {
      const continuing = shadow.id === this.shadowId && shadow.observedAt - this.shadowAt < .2;
      this.shadowReadyAt = continuing ? this.shadowReadyAt
        : shadow.observedAt + this.traits.recognitionMedianMs / 1000 * .8;
      this.shadowAt = shadow.observedAt; this.shadowId = shadow.id;
      this.shadowPoint = {...shadow.point, y:this.arena.native?shadow.point.y+64*UNIT:this.preaimHeight};
      this.cueChecks.observe({source: 'shadow', point: this.shadowPoint,
        observedAt: shadow.observedAt, readyAt: this.shadowReadyAt, uncertainty: shadow.uncertainty, lifetime: .85});
      this.memory.noteEvidence({source: 'shadow', point: this.shadowPoint,
        observedAt: shadow.observedAt, readyAt: this.shadowReadyAt, uncertainty: shadow.uncertainty, lifetime: .85,
        confidence: .45});
    }
    if (!observation.visible) {
      if (observation.time - this.lastSeenAt > .28) this.firstVisible = -1;
      return;
    }
    if (this.firstVisible < 0 || previousEnemyId !== observation.visible.id) {
      this.firstVisible = observation.time;
      const recent = previousEnemyId === observation.visible.id && observation.time - previousSeenAt < 1.2;
      this.readyAt = observation.time + this.traits.recognitionMedianMs / 1000 *
        (recent ? .58 : 1) * Math.exp(.18 * normal(this.random));
      this.aimError = {yaw: normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG,
        pitch: normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG};
      this.bodyAim = this.random() < this.traits.lowAimTendency;
      this.stopThisPeek = this.random() < this.traits.stopTendency;
      if (!recent) {
        const style = this.style, roll = this.random();
        this.crouchSpray = roll < style.crouchSpray;
        this.crouchTap = !this.crouchSpray && roll < style.crouchSpray + style.crouchTap;
        this.tapDelay = .12 + this.random() * .12;
        this.tapUntil = -Infinity;
        this.controlVariation = clamp(1 + normal(this.random) * style.recoilVariation, .5, 1.08);
        this.engagementAt = -Infinity; this.commitUntil = -Infinity; this.holdUntil = -Infinity;
        this.combatMotion = undefined; this.motionRetryAt = -Infinity;
      }
    }
  }

  private transition(phase: Phase, time: number) {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase; this.phaseAt = time;
    this.route = []; this.routeGoal = ''; this.arrivedGoal = '';
    if (phase === 'return' || phase === 'reload') this.resetPlannedAt = -Infinity;
    if (phase === 'brake') this.brakeFromMicro = previous === 'microstrafe';
    if (phase === 'setup') {
      const contact = time - this.lastSeenAt < 2.5 ||
        time >= this.heardReadyAt && time >= this.heardAt && time - this.heardAt < 2.5;
      const baseline = this.behavior === 'holder' ? 1.1 : this.behavior === 'patient' ? .65 : .28;
      const wait = (baseline + this.random() * (contact ? .8 : 1.7) + this.stagger) * (contact ? .65 : 1);
      this.setupWait = Math.min(baseline + 1.7 + this.stagger, wait * this.personality.patience);
      const longHold = this.behavior === 'holder' && this.lane.role === 'offAngle' && this.stealthRoll < .22;
      this.coverRecheckAt = time + this.setupWait + (longHold ? 2.8 + this.random() * 1.8 : .35 + this.random() * .7);
    }
    if (phase === 'attack') {
      this.beginBurst(time);
    }
  }

  private beginBurst(time: number) {
    this.phaseAt = time;
    const self = this.observation?.self;
    const range = this.lastSeen && self ? distance(this.lastSeen.position, self.position) : 16;
    const plan = sampleCombatPlan(this.level, this.weapon, range, self?.ammo ?? 30, this.crouchSpray, this.random);
    this.attackRounds = Math.min(plan.rounds, this.combatMotion?.maxRounds ?? Infinity); this.burstRecovery = plan.recovery;
    this.attackWait = sniperIds.includes(this.weapon) && !gameData.weapons[this.weapon].fullAuto ? .18 + this.random() * .12
      : (this.attackRounds - .5) * gameData.weapons[this.weapon].cycle;
    this.attackFiredAt = -1; this.attackShots = 0;
    if (time >= this.commitUntil) this.commitUntil = time + plan.commitment * this.personality.riskTolerance;
    if (this.engagementAt === -Infinity) {
      this.engagementAt = time;
      this.holdUntil = time + (this.defensive ? 1.5 + this.random() * .9 : 4.4 + this.random() * 1.6);
    }
    if (this.intent !== 'hold-angle') this.intent = 'contest';
  }

  private laneKey(lane: CoverLane) {return `${lane.anchor.x}:${lane.anchor.z}`;}

  private laneForSound(point: Vec, role: CoverLane['role']) {
    const candidates = this.lanes.filter(lane => lane.role === role);
    const facing = candidates.filter(lane => laneThreatAlignment(lane, point, this.lanes) >= 0);
    return [...(facing.length ? facing : candidates)]
      .sort((a, b) => distance(a.edge, point) - distance(b.edge, point))[0];
  }

  private usefulHold(self: DuelActorSnapshot, point: Vec, time: number) {
    if (this.behavior !== 'holder' && this.lane.role !== 'camp' && this.lane.role !== 'offAngle') return false;
    if (time - this.lastHurtAt < 1.2 || self.health < 40 || distance(self.position, point) < 6) return false;
    if (Math.min(distance(self.position, this.lane.anchor), distance(self.position, this.exposurePoint())) > .9) return false;
    if (distance(self.position, this.lane.retreat) > 2) return false;
    if (time < this.holdGeometryAt) return this.holdGeometryResult;
    this.holdGeometryAt = time + .2;
    this.holdGeometryResult = false;
    const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
    const length = Math.hypot(dx, dy, dz);
    if(Number.isFinite(traceSolid(self.position,{x:dx/length,y:dy/length,z:dz/length},this.arena,length-.02).distance))return false;
    const eyeHeight=self.position.y-self.feet,horizontal=Math.hypot(dx,dz),height=(self.duckAmount>.5?54:72)*UNIT;
    const shelters=[this.lane.retreat,...[-1,1].map(side=>({x:self.position.x+dz/horizontal*side*1.1,
      y:self.feet,z:self.position.z-dx/horizontal*side*1.1}))];
    this.holdGeometryResult=shelters.some(feet=>{
      if(distance(self.position,feet)<.15 || !canFitInArena(feet,feet.y,height,this.arena))return false;
      const eye={...feet,y:feet.y+eyeHeight},range=Math.hypot(eye.x-point.x,eye.y-point.y,eye.z-point.z);
      return Number.isFinite(traceSolid(point,{x:(eye.x-point.x)/range,y:(eye.y-point.y)/range,z:(eye.z-point.z)/range},
        this.arena,range-.02).distance) && clearSegment(self.position,feet,this.arena);
    });
    return this.holdGeometryResult;
  }

  private chooseLane(self: DuelActorSnapshot, teammates: DuelActorSnapshot[], time: number, force = false) {
    const recent = time - this.lastSeenAt < 4 ? this.lastSeen?.position ?? null :
      time >= this.heardReadyAt && time - this.heardAt < 4 ? this.heard : null;
    if (!force && this.flankPlan.retains(this.laneKey(this.lane), time, Math.max(this.lastSeenAt, this.heardAt), recent)) return;
    const roleWeights: Record<NonNullable<CoverLane['role']>, number> = this.behavior === 'holder'
      ? {entry: .65, flank: 1.15, camp: 3.8, offAngle: 1.9}
      : this.behavior === 'patient' ? {entry: 1, flank: 2, camp: 1.6, offAngle: 2.4}
        : {entry: 2.4, flank: 1.6, camp: .55, offAngle: 1.25};
    if (self.health < 40) {roleWeights.camp *= 2; roleWeights.entry *= .55;}
    if (self.armor === 0 && self.health < 65) {roleWeights.entry *= .7; roleWeights.offAngle *= 1.3;}
    if (sniperIds.includes(this.weapon)) {roleWeights.camp *= 1.5; roleWeights.offAngle *= 1.3; roleWeights.entry *= .6;}
    if (this.level !== '10+' && this.level <= 3) {
      roleWeights.offAngle *= .4; roleWeights.flank *= .6;
    }
    if (time - Math.max(this.lastSeenAt, this.heardAt) > 5) {
      roleWeights.camp *= this.defensive ? .65 : .12;
      roleWeights.entry *= this.defensive ? 1.25 : 2.3; roleWeights.flank *= this.defensive ? 1.15 : 1.6;
    }
    const choices = [...this.lanes].sort((a, b) => distance(self.position, a.anchor) - distance(self.position, b.anchor))
      .slice(0, 24).filter(lane =>
      clearSegment(lane.anchor, lane.edge, this.arena) &&
      (!force || distance(lane.anchor, this.lane.anchor) > 1.2));
    const weighted = choices.map(lane => {
      let weight = roleWeights[lane.role ?? 'entry'] * (lane.role === 'flank' ? this.personality.flankCommitment : 1);
      if (distance(lane.anchor, this.lane.anchor) < 1.2) weight *= force ? .08 : .35;
      const visitedAt = this.visitedLanes.get(this.laneKey(lane)) ?? -Infinity;
      if (time - visitedAt < 6) weight *= .18 + Math.max(0, time - visitedAt) / 15;
      const pressure = this.cornerPressure.get(this.laneKey(lane));
      if (pressure && time >= pressure.at && time - pressure.at < 8) {
        // Remember our own punishment, not the hidden opponent. This changes a
        // later reposition choice, never interrupts a live firing commitment.
        const strength = pressure.count / 3 * (1 - (time - pressure.at) / 8);
        weight *= 1 - (.2 + .55 * proficiency(this.level)) * strength;
      }
      if (recent) {
        const alignment = laneThreatAlignment(lane, recent, this.lanes);
        weight *= alignment > 0 ? 1.6 : alignment < 0 ? .65 : 1;
      }
      if (recent) {
        const eye = {...lane.edge, y: lane.edge.y+self.position.y-self.feet};
        const dx = recent.x - eye.x, dy = recent.y - eye.y, dz = recent.z - eye.z;
        const length = Math.hypot(dx, dy, dz);
        if (length > .01 && Number.isFinite(traceSolid(eye,
          {x: dx / length, y: dy / length, z: dz / length}, this.arena, length - .02).distance)) weight *= .35;
      }
      const nearby = teammates.filter(peer => peer.id !== self.id && peer.alive && distance(peer.position, lane.anchor) < 2.4).length;
      weight *= Math.pow(.42, nearby);
      weight *= clamp(1.3 - distance(self.position, lane.anchor) / 24, .45, 1.2);
      if (force && recent) weight *= Math.exp(-Math.max(0, distance(self.position, lane.anchor) - 3.5) / 4);
      return weight;
    });
    const sum = weighted.reduce((total, weight) => total + weight, 0);
    let roll = this.random() * sum;
    for (let index = 0; index < choices.length; index++) {
      roll -= weighted[index];
      if (roll <= 0) {
        this.visitedLanes.set(this.laneKey(this.lane), time);
        this.lane = this.makeLane(choices[index]); this.sightEdge = null;
        this.flankPlan.clear();
        if (this.lane.role === 'flank') this.flankPlan.begin(this.laneKey(this.lane), time,
          Math.max(this.lastSeenAt, this.heardAt), recent);
        this.holdGeometryAt = -Infinity;
        return;
      }
    }
  }

  private choosePeek(time: number) {
    if (this.staticLane) {this.activePeek = 'hold'; return;}
    this.peekCount++;
    const known = !!this.memory.anticipation(time)?.prefireReady && time >= this.readyAt;
    // A firing corner depends on the expected angle, not just a waypoint beside
    // a box. Scan geometry using memory/common angles, never a hidden actor.
    const memoryAim = this.memory.focus(time);
    const soundAim = time >= this.heardAt && time >= this.heardReadyAt && time - this.heardAt < 3 && this.heard
      ? this.heardAim : null;
    const expected = (soundAim && this.heardAt > this.lastSeenAt && time - this.lastSeenAt > .18
      ? soundAim : memoryAim ?? soundAim) ??
      this.lane.watch ?? this.arena.tactical?.watchPoints[0] ?? {
        x: (this.arena.minX + this.arena.maxX) / 2, y: this.lane.edge.y + this.preaimHeight,
        z: this.arena.minZ + (this.arena.maxZ - this.arena.minZ) * .875};
    const axis = this.lane.axis ?? {x: this.lane.side, z: 0};
    this.sightEdge = {...this.lane.edge};
    for (let offset = -.25; offset <= 2.5; offset += .25) {
      const candidate = {...this.lane.edge, x: this.lane.edge.x + axis.x * offset,
        z: this.lane.edge.z + axis.z * offset};
      if (!clearSegment(this.lane.anchor, candidate, this.arena)) continue;
      const eye = {...candidate, y: (this.arena.native ? candidate.y : 0) + 64 * UNIT};
      const dx = expected.x - eye.x, dy = expected.y - eye.y, dz = expected.z - eye.z;
      const length = Math.hypot(dx, dy, dz);
      if (traceSolid(eye, {x: dx / length, y: dy / length, z: dz / length}, this.arena, length).distance < length) continue;
      this.sightEdge = candidate; break;
    }
    this.scanAim = expected;
    this.peekWidth = .85 + this.random() * .35;
    const close = this.lastSeen ? distance(this.lastSeen.position, this.lane.edge) < 10 : false;
    const eligible = Object.fromEntries(peekTypes.map(type => [type,
      clearSegment(this.lane.anchor, this.exposurePoint(type), this.arena)]));
    const sniper = sniperIds.includes(this.weapon);
    const distribution = peekDistribution(this.level, pistolIds.some(id => id === this.weapon) ? 'cz75a' : this.weapon, {
      ...eligible,
      prefire: eligible.prefire && known,
      run: eligible.run && !sniper && (close || this.behavior === 'aggressive'),
      jump: eligible.jump && this.behavior !== 'holder',
    }, {
      run: this.behavior === 'aggressive' ? 1.8 : .7,
      quick: (sniper ? 2 : 1) * (known ? 1.4 : 1),
      ferrari: sniper ? .35 : 1,
      wide: this.lane.role === 'flank' ? 1.7 : this.behavior === 'aggressive' ? 1.4 : .8,
      slice: this.behavior === 'patient' || this.lane.role === 'offAngle' ? 1.6 : .7,
      shoulder: (this.behavior === 'holder' ? 1.5 : 1) * (known ? .35 : 1),
      jump: known ? .15 : 1,
      [this.repeat]: .42,
    });
    this.activePeek = samplePeek(distribution, this.random);
    this.repeat = this.activePeek;
    this.transition(this.activePeek === 'hold' ? 'setup' : 'expose', time);
  }

  private exposurePoint(type: PeekChoice = this.activePeek): Vec {
    const axis = this.lane.axis ?? {x: this.lane.side, z: 0};
    const edge = this.sightEdge ?? this.lane.edge;
    return {...edge, x: edge.x + axis.x * peekTravel[type] * this.peekWidth,
      z: edge.z + axis.z * peekTravel[type] * this.peekWidth};
  }

  private travel(self: DuelActorSnapshot, goal: Vec, time: number) {
    const key = `${goal.x.toFixed(2)}:${goal.z.toFixed(2)}`;
    const native = !!this.arena.native;
    // Failed native paths used to retry at motor frequency. Static cover does
    // not change every tick; keep motor/aim updates fast, bound route work.
    const heightChanged = native && this.routeTarget !== null && Math.abs(this.routeTarget.y-goal.y) > .5;
    const changed = heightChanged || key !== this.routeGoal && (!native || !this.routeTarget || !this.routeGoal ||
      distance(this.routeTarget,goal) > .5 || time-this.routeAt >= .15);
    const missing = !this.route.length && (!native || time-this.routeAt >= .5);
    const checkRoute = native ? time >= this.routeCheckAt : time-this.routeAt > .65;
    if(native && checkRoute)this.routeCheckAt=time+.2;
    if (changed || missing || checkRoute && this.route.length > 0 &&
      !clearSegment(self.position, this.route[0], this.arena)) {
      this.routeGoal = key; this.routeAt = time;this.routeTarget={...goal};
      if(native)this.routeCheckAt=time+.2;
      this.route = clearSegment(self.position, goal, this.arena) ? [goal] : routeTo(self.position, goal, this.arena);
    }
    const checkShortcut = time >= this.shortcutAt;
    if (checkShortcut) this.shortcutAt = time + .12;
    while (this.route.length > 1 && (distance(self.position, this.route[0]) < .35 ||
      checkShortcut && clearSegment(self.position, this.route[1], this.arena))) this.route.shift();
    return this.route[0] ?? (this.arena.native ? self.position : goal);
  }

  private recoverTravel(self: DuelActorSnapshot, goal: Vec, waypoint: Vec, time: number,
    intended: boolean, teammates: readonly DuelActorSnapshot[]) {
    const board = passageReservations(this.arena);
    const peers = teammates.filter(peer => peer.id !== self.id && peer.alive && peer.side === self.side &&
      Math.abs(peer.feet - self.feet) < .75);
    const passageIntent = intended && self.alive && self.grounded !== false &&
      peers.some(peer => distance(self.position, peer.position) < 4);
    if (!passageIntent) {
      board.release(self.id, self.generation, self.side);
      this.passage = null; this.passageDecision = null; this.passageCheckAt = -Infinity;
    } else {
      if (time >= this.passageCheckAt || !this.passageWaypoint ||
        Math.hypot(waypoint.x - this.passageWaypoint.x, waypoint.y - this.passageWaypoint.y,
          waypoint.z - this.passageWaypoint.z) > .5) {
        this.passageCheckAt = time + .2; this.passageWaypoint = {...waypoint};
        this.passage = narrowPassage(self, waypoint, this.arena);
      }
      if (this.passage) this.passageDecision = board.request(time, self, this.passage, teammates);
      else {board.release(self.id, self.generation, self.side); this.passageDecision = null;}
    }
    const waitingPeer = teammates.some(peer => peer.alive && peer.side === self.side && peer.id < self.id &&
      Math.abs(peer.feet - self.feet) < 1 && distance(self.position, peer.position) < 1.35);
    const progress = this.travelProgress.update(time, {...self.position, y: self.feet}, goal,
      distance(self.position, waypoint) < .14 ? goal : waypoint, intended && self.grounded !== false, waitingPeer,
      this.passageDecision?.waiting);
    if (progress.stage === 'idle' || progress.stage === 'travel') {
      this.recoveryGoal = null; this.recoveryUntil = -Infinity;
      return null;
    }
    if (progress.stage === 'replan') {
      // Invalidate only the route. The tactical task and threat gaze survive.
      this.route = []; this.routeGoal = ''; this.routeAt = -Infinity;
      this.recoveryGoal = null;
    }
    if (progress.stage === 'backoff' && time >= this.recoveryUntil) {
      this.recoveryUntil = time + .35;
      const dx = waypoint.x - self.position.x, dz = waypoint.z - self.position.z;
      const length = Math.hypot(dx, dz) || 1;
      const sign = self.id % 2 ? 1 : -1;
      const offsets = [[-dx / length * .65, -dz / length * .65],
        [dz / length * .6 * sign, -dx / length * .6 * sign],
        [-dz / length * .6 * sign, dx / length * .6 * sign]];
      this.recoveryGoal = null;
      for (const [x, z] of offsets) {
        const candidate = {x: self.position.x + x, y: self.feet, z: self.position.z + z};
        if (teammates.some(peer => peer.id !== self.id && peer.alive && Math.abs(peer.feet - self.feet) < 1 &&
          distance(candidate, peer.position) < .65)) continue;
        if (clearSegment(self.position, candidate, this.arena)) {this.recoveryGoal = candidate; break;}
      }
    }
    return progress.stage === 'backoff' && time < this.recoveryUntil && this.recoveryGoal
      ? this.recoveryGoal : self.position;
  }

  private dodge(self: DuelActorSnapshot, target: VisibleEnemy, time: number, teammates: readonly DuelActorSnapshot[] = []) {
    const dx = target.position.x - self.position.x, dz = target.position.z - self.position.z;
    const length = Math.hypot(dx, dz);
    if (length < .1) return false;
    const sign = this.lastDodgeSign && this.random() < .75 ? -this.lastDodgeSign : this.random() < .5 ? -1 : 1;
    const preferredWidth = (this.combatMotion?.stepWidth ?? 1) * (.8 + this.random() * .4);
    for (const width of [preferredWidth, Math.min(.45, preferredWidth)]) for (const direction of [sign, -sign]) {
      const candidate = {x: self.position.x - dz / length * direction * width,
        y: self.position.y, z: self.position.z + dx / length * direction * width};
      if (teammates.some(peer => {
        if (peer.id === self.id || !peer.alive || Math.abs(peer.feet - self.feet) >= 1) return false;
        const x = candidate.x - self.position.x, z = candidate.z - self.position.z;
        const t = clamp(((peer.position.x - self.position.x) * x + (peer.position.z - self.position.z) * z) / (width * width), 0, 1);
        return t > .1 && Math.hypot(self.position.x + x * t - peer.position.x, self.position.z + z * t - peer.position.z) < .85;
      })) continue;
      if (!clearSegment(self.position, candidate, this.arena)) continue;
      this.lastDodgeSign = direction;
      this.microGoal = candidate;
      this.combatStrafes++;
      this.transition('microstrafe', time);
      // Continuing a moving engagement starts a fresh leg, not an expired timer.
      this.phaseAt = time; this.route = []; this.routeGoal = ''; this.arrivedGoal = '';
      return true;
    }
    return false;
  }

  private prepareReset(self: DuelActorSnapshot, time: number) {
    if (this.resetPlannedAt === this.phaseAt) return;
    this.resetPlannedAt = this.phaseAt;
    this.resetGoal = {...this.lane.retreat};
    this.resetCovered = false;
    const threat = this.memory.focus(time) ?? (time >= this.heardReadyAt && time - this.heardAt < 3.5 ? this.heard : null);
    if (!threat) return;
    let best = Infinity;
    // Pick a reachable nearby shelter from authored cover, not a distant
    // opening waypoint. Geometry is checked once per reset, not each tick.
    const nearby = [...this.lanes].sort((a, b) =>
      distance(self.position, a.anchor) - distance(self.position, b.anchor)).slice(0, 12);
    for (const lane of nearby) for (const point of [lane.retreat, lane.anchor]) {
      const travel = distance(self.position, point);
      if (travel < .45 || travel > 7 || !clearSegment(self.position, point, this.arena)) continue;
      const eye = {...point, y: point.y+self.position.y-self.feet};
      const dx = threat.x - eye.x, dy = threat.y - eye.y, dz = threat.z - eye.z;
      const length = Math.hypot(dx, dy, dz);
      const covered = traceSolid(eye, {x: dx / length, y: dy / length, z: dz / length}, this.arena, length - .02).distance < length - .02;
      const score = travel + (covered ? 0 : 12);
      if (score < best) {best = score; this.resetGoal = {...point};}
    }
    const eye = {...this.resetGoal, y: this.resetGoal.y+self.position.y-self.feet};
    const dx = threat.x - eye.x, dy = threat.y - eye.y, dz = threat.z - eye.z;
    const length = Math.hypot(dx, dy, dz);
    this.resetCovered = length > .01 && Number.isFinite(traceSolid(eye,
      {x: dx / length, y: dy / length, z: dz / length}, this.arena, length - .02).distance);
  }

  private finishBurst(self: DuelActorSnapshot, target: VisibleEnemy | null, time: number,
    holdingUsefulAngle: boolean, teammates: readonly DuelActorSnapshot[] = []) {
    this.nextBurstAt = time + this.burstRecovery;
    if (self.ammo === 0) {this.intent = 'reset'; this.transition('reload', time); return;}
    if (!target) {
      if (this.memory.focus(time) && time - this.lastSeenAt < .65) {
        this.intent = 'hold-angle'; this.beginBurst(time);
      } else {
        this.intent = this.defensive ? 'reset' : 'change-angle'; this.forceReposition = !this.defensive;
        this.transition('return', time);
      }
      return;
    }
    if (this.combatMotion && this.combatMotion.style !== 'commit' && !this.forceReposition &&
      self.health >= 35 && this.combatStrafes < 4 && this.dodge(self, target, time, teammates)) {
      this.intent = 'contest';
      if (this.combatMotion.style === 'run') this.beginBurst(time);
      return;
    }
    const sniper = sniperIds.includes(this.weapon);
    if (!sniper && (this.combatMotion?.style === 'commit' || this.combatStrafes < 4) &&
      (holdingUsefulAngle && this.defensive ? time < Math.min(this.commitUntil, this.holdUntil)
      : time < this.commitUntil || holdingUsefulAngle && time < this.holdUntil)) {
      this.intent = holdingUsefulAngle ? 'hold-angle' : 'contest';
      this.beginBurst(time);
      return;
    }
    // The next decision is taken after a real burst, not a fresh coin flip
    // each frame. Open duels change aim line; covered duels can reset/re-peek.
    const pressured = time - this.lastHurtAt < 1.2 || self.health < 45;
    const reposition = pressured || holdingUsefulAngle || this.combatStrafes >= 2 ||
      sniper || distance(self.position, target.position) > 20 && this.behavior !== 'aggressive';
    if (!reposition && this.dodge(self, target, time, teammates)) {
      this.intent = 'contest'; this.commitUntil = time + .9 + this.random() * .7;
      return;
    }
    this.intent = holdingUsefulAngle && this.defensive && !pressured ? 'reset' : 'change-angle';
    this.forceReposition = this.intent === 'change-angle';
    this.transition('return', time);
    // Lane selection occurs at cover arrival, keeping this route committed.
  }

  private knifeCommand(self:DuelActorSnapshot,time:number,readiness:TacticalReadiness,
    teammates:readonly DuelActorSnapshot[]):Partial<ActorCommand> {
    const visible=currentVisible(this.observation,time);
    const memoryAim=this.memory.focus(time);
    const sound=this.heard&&time>=this.heardAt&&time>=this.heardReadyAt&&time-this.heardAt<3.5?this.heard:null;
    const newerSound=!!sound&&(!memoryAim||this.heardAt>this.lastSeenAt);
    const cue=newerSound?sound:memoryAim??sound;
    const cueAt=newerSound?this.heardAt:memoryAim?this.lastSeenAt:-Infinity;
    const trade=activeTrade(this.trade,time,self.generation)?this.trade:undefined;
    const tradeAim=trade&&trade.observedAt>=cueAt?trade.point:null;
    const known=visible?.bodyPoint??visible?.aimPoint??tradeAim??cue??this.lane.edge;
    const aimPoint=visible?.bodyPoint??visible?.aimPoint??known;
    const yaw=Math.atan2(-(aimPoint.x-self.position.x),-(aimPoint.z-self.position.z));
    const pitch=Math.atan2(aimPoint.y-self.position.y,distance(self.position,aimPoint));
    const yawError=difference(yaw,self.yaw),pitchError=pitch-self.pitch;
    const acquired=!!visible&&time>=this.readyAt;
    this.motorMode=visible?acquired?'tracking':'acquiring':'clearing';
    const aim=aimStep(this.motor,yawError,pitchError,this.traits.motorSettlingMs,this.motorMode);
    const gap=distance(self.position,known),ready=!!visible&&time>=this.readyAt+this.traits.motorSettlingMs/1000;
    const close=gap<knifeModel.primaryRangeUnits*UNIT*.95;
    const fire=ready&&close&&Math.hypot(yawError,pitchError)<.2&&time>=(readiness.weaponReadyAt??-Infinity);
    this.gaze=arbitrateGaze(time,[{owner:visible?'combat':tradeAim?'support':newerSound?'audio':memoryAim?'repeek':'clearing',
      point:aimPoint,observedAt:visible?this.observation!.time:time,expiresAt:time+STEP*2,confidence:visible?1:.5}]);
    this.fireBlockedReason=firingVeto({visible:!!visible,stale:!!this.observation?.visible&&time>this.observation.time+.075,
      recognized:!!visible&&time>=this.readyAt,settled:ready,ammo:1,reloading:false,
      weaponReady:time>=(readiness.weaponReadyAt??-Infinity),informationPeek:false,disengaging:false,closing:false,
      inRange:close,burstReady:true,firingPhase:true,aligned:Math.hypot(yawError,pitchError)<.2,
      accurateMovement:true,cycleReady:true});
    this.transition(fire?'attack':'close',time);
    const waypoint=this.travel(self,known,time),dx=waypoint.x-self.position.x,dz=waypoint.z-self.position.z;
    const length=Math.hypot(dx,dz),moving=gap>.6&&length>.05;
    const recovery=this.recoverTravel(self,known,waypoint,time,moving,teammates);
    const movePoint=recovery??waypoint,mx=movePoint.x-self.position.x,mz=movePoint.z-self.position.z;
    const moveLength=Math.hypot(mx,mz),speed=Math.hypot(self.velocity.x,self.velocity.z);
    const wishX=recovery&&moveLength<.14&&speed>.15?-self.velocity.x/speed:moving&&moveLength>.14?mx/moveLength:0;
    const wishZ=recovery&&moveLength<.14&&speed>.15?-self.velocity.z/speed:moving&&moveLength>.14?mz/moveLength:0;
    const nextYaw=self.yaw+aim.yawDelta;
    const secondary=fire&&gap<knifeModel.secondaryRangeUnits*UNIT*.9&&(this.level==='10+'||this.level>=4)&&Math.floor(time*2+self.id)%3===0;
    return {...idleCommand(),forward:-wishX*Math.sin(nextYaw)-wishZ*Math.cos(nextYaw),
      side:wishX*Math.cos(nextYaw)-wishZ*Math.sin(nextYaw),
      walk:!visible&&this.behavior==='patient',yawDelta:aim.yawDelta,pitchDelta:aim.pitchDelta,
      fireHeld:fire&&!secondary,secondaryHeld:secondary};
  }

  command(self: DuelActorSnapshot, time: number, recoil: RecoilAngle = {yaw: 0, pitch: 0},
    teammates: DuelActorSnapshot[] = [], readiness: TacticalReadiness = {}): Partial<ActorCommand> {
    if (this.equipped !== self.equipment) {
      this.equipped = self.equipment; this.previousAmmo = undefined;
      this.combatMotion = undefined;
      this.attackShots = 0; this.attackFiredAt = -1;
      this.nextShotAt = time; this.nextBurstAt = Math.min(this.nextBurstAt, time);
      if (this.phase === 'attack') this.transition('brake', time);
    }
    if (self.equipment === 'knife') return this.knifeCommand(self,time,readiness,teammates);
    if (gameData.weapons[self.equipment] && this.weapon !== self.equipment) {
      this.weapon = self.equipment; this.previousAmmo = undefined;
      this.attackShots = 0; this.attackFiredAt = -1;
      if (this.phase === 'attack') this.transition('brake', time);
    }
    if (this.previousAmmo !== undefined && self.ammo < this.previousAmmo) {
      this.attackShots += this.previousAmmo - self.ammo;
      if (this.attackFiredAt < 0) this.attackFiredAt = time - STEP;
      this.nextShotAt = Math.max(this.nextShotAt, time - STEP + gameData.weapons[this.weapon].cycle);
    }
    this.previousAmmo = self.ammo;
    const assignment = this.teamAssignment;
    const team = assignment && assignment.actorId === self.id && assignment.generation === self.generation &&
      time >= assignment.contactAt && time < assignment.expiresAt ? assignment : null;
    const teamLaneKey = team ? `${team.role}:${team.lane.anchor.x}:${team.lane.anchor.y}:${team.lane.anchor.z}:` +
      `${team.lane.edge.x}:${team.lane.edge.y}:${team.lane.edge.z}` : '';
    const teamReadyAt = team ? Math.max(team.peekAt, team.contactAt + this.traits.recognitionMedianMs / 1000 * 1.35) : Infinity;
    if (team && team.contactAt > this.teamReportAt) {
      this.teamReportAt = team.contactAt; this.teammateCallout(team.point, team.contactAt);
    }
    const visible = currentVisible(this.observation, time);
    const trade = activeTrade(this.trade, time, self.generation) ? this.trade : undefined;
    const pendingTrade = this.trade && time >= this.trade.observedAt &&
      activeTrade(this.trade, Math.max(time, this.trade.readyAt), self.generation);
    if (trade && !this.tradeArmed && !visible && !self.reloading && !this.forceReposition) this.stageTrade(self, trade, time, teammates);
    const identified = !!visible && time >= this.readyAt;
    const stats = gameData.weapons[this.weapon];
    const closeWeapon = this.weapon === 'zeus' || stats.pellets > 1;
    const closing = identified && !!visible && closeWeapon && distance(self.position, visible.position) >
      (this.weapon === 'zeus' ? stats.range * UNIT * .85 : 8);
    if (identified && !this.combatMotion) {
      this.combatMotion = combatMovement(this.level, this.weapon, distance(self.position, visible!.position), this.crouchSpray, this.random);
    }
    if (this.combatMotion?.style === 'stutter' && (this.level === '10+' || this.level >= 6)) this.stopThisPeek = true;
    const memoryAge = time - this.lastSeenAt;
    const memoryAim = this.memory.focus(time);
    const sound = this.heard && time >= this.heardAt && time >= this.heardReadyAt &&
      time - this.heardAt < 3.5 ? this.heard : null;
    if (team && !trade && !visible && !self.reloading && self.ammo > 0 && !this.forceReposition &&
      ['approach', 'setup'].includes(this.phase)) {
      if (teamLaneKey !== this.appliedTeamLane && time >= this.teamLaneCheckAt) {
        this.teamLaneCheckAt = time + .25;
        if (clearSegment(team.lane.anchor, team.lane.edge, this.arena)) {
          this.appliedTeamLane = teamLaneKey; this.lane = this.makeLane(team.lane); this.sightEdge = null;
          this.flankPlan.clear();
          this.holdGeometryAt = -Infinity;
          this.transition(distance(self.position, this.lane.anchor) < .35 ? 'setup' : 'approach', time);
        }
      }
    }
    if (team?.role === 'trade' && !team.waitForPartner && time >= teamReadyAt && !trade && !visible &&
      !self.reloading && self.ammo > 0 && !this.forceReposition && !this.staticLane &&
      this.appliedTeamLane === teamLaneKey && time >= this.teamPeekCheckAt && ['approach', 'setup'].includes(this.phase)) {
      this.teamPeekCheckAt = time + .2;
      if (clearSegment(self.position, this.lane.edge, this.arena)) {
        this.sightEdge = {...this.lane.edge}; this.activePeek = 'quick'; this.peekWidth = 1; this.stopThisPeek = true;
        this.intent = 'contest'; this.transition('expose', time);
      }
    }
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    if (sound && time >= this.soundDecisionAt && this.heardAt > this.actedOnSoundAt && this.heardAt > this.lastSeenAt && !visible && memoryAge > .35 &&
      this.phase !== 'reload' && !this.forceReposition && !team && !trade) {
      this.actedOnSoundAt = this.heardAt;
      this.soundDecisionAt = time + .35 / this.personality.adaptation;
      if (this.behavior === 'aggressive' || this.behavior === 'mixed') {
        if (this.phase !== 'investigate') this.transition('investigate', time);
      } else if (this.behavior === 'patient') {
        const flank = this.laneForSound(sound, 'flank');
        if (flank && this.laneKey(flank) !== this.laneKey(this.lane) &&
          !this.flankPlan.retains(this.laneKey(this.lane), time, this.heardAt, sound)) {
          this.lane = this.makeLane(flank);
          this.flankPlan.begin(this.laneKey(this.lane), time, this.heardAt, sound);
          this.holdGeometryAt = -Infinity;
          this.transition('approach', time);
        } else if (this.phase === 'setup') this.phaseAt = Math.min(this.phaseAt, time - .3);
      } else {
        const angle = this.laneForSound(sound, this.lane.role === 'offAngle' ? 'offAngle' : 'camp');
        if (angle && !this.usefulHold(self, this.heardAim!, time) &&
          this.laneKey(angle) !== this.laneKey(this.lane)) {
          this.lane = this.makeLane(angle); this.sightEdge = null;
          this.holdGeometryAt = -Infinity;
          this.transition('approach', time);
        } else if (this.phase === 'setup') this.phaseAt = Math.min(this.phaseAt, time - .55);
      }
    }
    if (self.ammo === 0 && this.phase !== 'reload') this.transition('reload', time);
    if (this.phase === 'reload' && self.ammo > 0 && !self.reloading) this.transition('setup', time);
    if (this.phase === 'setup' && !pendingTrade && !identified && !self.reloading && self.ammo < gameData.weapons[this.weapon].magazine * .22 &&
      time - this.lastSeenAt > 1.5) this.transition('reload', time);
    if (this.phase === 'approach' && distance(self.position, this.lane.anchor) < .35) this.transition('setup', time);
    if (closing && self.ammo > 0 && !self.reloading && !this.forceReposition &&
      this.phase !== 'reload' && this.phase !== 'return' && this.phase !== 'close') {
      this.intent = 'close'; this.transition('close', time);
    }
    if (this.phase === 'close' && !visible) this.transition('setup', time);
    if (identified && !closing && ['approach', 'setup', 'push', 'investigate', 'close'].includes(this.phase) && self.ammo > 0) {
      this.activePeek = 'hold';
      this.combatStrafes = 0;
      this.transition(speed > .4 && this.combatMotion?.style !== 'run' ? 'brake' : 'attack', time);
    }
    const blindFor = time - Math.max(this.lastSeenAt, this.heardAt);
    const searchDelay = (this.behavior === 'holder' ? 10 : this.behavior === 'patient' ? 7 : 4.5) *
      this.personality.patience / this.personality.adaptation;
    if (!trade && !team && !identified && !sound && time > searchDelay && blindFor > searchDelay &&
      ['setup', 'return'].includes(this.phase) && !this.forceReposition) {
      this.chooseLane(self, teammates, time, true);
      this.transition('push', time);
    }
    if (this.phase === 'push' && (!this.searchGoal || distance(self.position, this.searchGoal) < .5)) {
      this.searchGoal = this.searchPoints.length ? this.searchPoints[this.searchIndex++ % this.searchPoints.length]
        : this.arena.tactical?.entry ?? {...this.scanAim, y: self.feet};
      this.scanAim = {...this.searchGoal, y: (this.arena.native ? this.searchGoal.y : 0) + this.preaimHeight};
    }
    const soundAim = sound ? this.heardAim : null;
    const tradeAim = trade && Math.max(memoryAim ? this.lastSeenAt : -Infinity, sound ? this.heardAt : -Infinity) <= trade.observedAt ? trade.point : null;
    const informationAim = tradeAim ?? (soundAim && this.heardAt > this.lastSeenAt && memoryAge > .18 ? soundAim : memoryAim ?? soundAim);
    const primaryWatch=time>=this.lastSeenAt && time<this.knownApproachUntil && this.knownApproach ? this.knownApproach :
      this.phase==='push'?this.scanAim:this.lane.watch??this.scanAim;
    const commonAim=informationAim || visible?primaryWatch:this.approachAim.focus(self.position,time,primaryWatch,this.scanPoints,this.arena);
    const holdAim = visible?.aimPoint ?? informationAim ?? commonAim;
    const holdingUsefulAngle = !!holdAim && this.usefulHold(self, holdAim, time);
    if (this.phase === 'setup' && !this.staticLane && (!holdingUsefulAngle || time >= this.coverRecheckAt || !!trade ||
      team?.role === 'trade' || team?.role === 'entry') && (team && !trade
      ? !team.waitForPartner && time >= teamReadyAt && time - this.phaseAt > .08
      : time - this.phaseAt > (trade ? .04 : this.setupWait))) {
      if (trade) {
        this.activePeek = 'quick'; this.peekWidth = 1; this.intent = 'contest';
        this.transition('expose', time);
      } else this.choosePeek(time);
    }
    const exposure = this.exposurePoint();
    const informationPeek = this.activePeek === 'shoulder' || this.activePeek === 'jump';
    const movingFire = !sniperIds.includes(this.weapon) && (this.combatMotion?.style === 'run' ||
      this.combatMotion?.style !== 'stutter' && !this.crouchSpray &&
      (this.activePeek === 'run' || this.activePeek === 'ferrari' && !this.stopThisPeek));
    // Once contact is recognized, a combat swing needs a firing stop even when
    // its planned waypoint is farther away. Wide swings keep a short commitment.
    const swingDelay = this.activePeek === 'ferrari' ? .2
      : this.activePeek === 'wide' || this.activePeek === 'crouchWide' ? .12 : 0;
    if (this.phase === 'expose' && identified && !closing && !informationPeek && !movingFire &&
      self.ammo > 0 && !self.reloading && time >= Math.max(this.phaseAt, this.readyAt) + swingDelay)
      this.transition('brake', time);
    if (this.phase === 'expose' && distance(self.position, exposure) < .24) {
      this.transition(informationPeek ? 'return' : 'brake', time);
    }
    if (this.phase === 'expose' && time - this.phaseAt > 3) {
      this.intent = 'change-angle'; this.forceReposition = true; this.transition('return', time);
    }
    const brakeDelay = this.traits.brakeErrorMs / 1000;
    if (this.phase === 'brake' && time - this.phaseAt >= brakeDelay &&
      (speed < .3 || time - this.phaseAt > .28 + brakeDelay)) this.transition('attack', time);
    const runningCombat = this.combatMotion?.style === 'run' && !informationPeek;
    const attackExpired = this.attackFiredAt >= 0 && this.attackShots > 0 ?
      time - this.attackFiredAt > this.attackWait || this.attackShots >= this.attackRounds &&
        (!sniperIds.includes(this.weapon) || time - this.attackFiredAt > .18) ||
        time - this.attackFiredAt >= (this.combatMotion?.stationarySeconds ?? Infinity)
      : !visible && time - this.phaseAt > .55;
    if ((this.phase === 'attack' || runningCombat && this.phase === 'microstrafe') && (attackExpired || self.ammo === 0)) {
      this.finishBurst(self, visible, time, holdingUsefulAngle, teammates);
    }
    if (this.phase === 'microstrafe' && (this.microGoal && distance(self.position, this.microGoal) < .25 ||
      time - this.phaseAt > .65)) {
      const cycling = this.combatMotion?.style === 'stutter' && time + .18 < Math.max(this.nextShotAt, this.nextBurstAt);
      if (!((runningCombat || cycling) && identified && visible && this.combatStrafes < 4 && this.dodge(self, visible, time, teammates)))
        this.transition('brake', time);
    }
    if (runningCombat && identified && visible && this.combatStrafes < 4 && this.phase === 'attack' && time >= this.motionRetryAt) {
      this.motionRetryAt = time + .4;
      this.dodge(self, visible, time, teammates);
    }
    // A short reset can reach nearby cover. If still exposed, contest the duel
    // instead of silently following a distant retreat waypoint through open space.
    if (this.phase === 'return' || this.phase === 'reload') this.prepareReset(self, time);
    const exposedReset = this.intent === 'change-angle' &&
      (!this.resetCovered || time - this.phaseAt > .65);
    if (this.phase === 'return' && identified && !informationPeek && (!this.forceReposition || exposedReset) &&
      (this.intent !== 'reset' || !this.resetCovered || time - this.phaseAt > .9) &&
      self.ammo > 0 && !self.reloading && time - this.phaseAt > .2) {
      this.forceReposition = false; this.intent = 'contest';
      this.transition(speed > .3 ? 'brake' : 'attack', time);
    }
    if (this.phase === 'return' && distance(self.position, this.resetGoal ?? this.lane.retreat) < .35) {
      const moveAgain = this.forceReposition || blindFor > searchDelay ||
        (this.peekCount > 0 && this.peekCount % (this.defensive ? 4 : 2) === 0) || this.random() < (this.defensive ? .08 : .22);
      if (moveAgain) this.chooseLane(self, teammates, time, this.forceReposition);
      this.forceReposition = false;
      this.combatStrafes = 0;
      this.intent = 'seek'; this.engagementAt = -Infinity;
      if (time > 12 && memoryAge > 6 && this.behavior === 'aggressive' && this.random() < .35) this.transition('push', time);
      else this.transition(distance(self.position, this.lane.anchor) > .55 ? 'approach' : 'setup', time);
    }
    if (this.phase === 'investigate' && (identified || distance(self.position, sound ?? self.position) < 1.3 ||
      time - this.phaseAt > 3.5 || !sound)) {
      const next = this.laneForSound(sound ?? self.position, 'entry');
      if (next) this.lane = this.makeLane(next);
      this.transition(identified ? 'attack' : 'approach', time);
    }
    if (this.phase === 'push' && identified && !closing) this.transition('attack', time);

    const lateBrake = this.phase === 'brake' && !this.brakeFromMicro && time - this.phaseAt < brakeDelay;
    const axis = this.lane.axis ?? {x: this.lane.side, z: 0};
    const goal = this.phase === 'close' && visible ? {...visible.position, y: self.feet}
      : this.phase === 'approach' ? this.lane.anchor : this.phase === 'expose' ? exposure
      : lateBrake ? {...exposure, x: exposure.x + axis.x * .45, z: exposure.z + axis.z * .45}
      : this.phase === 'return' || this.phase === 'reload' ? this.resetGoal ?? this.lane.retreat
        : this.phase === 'microstrafe' && this.microGoal ? this.microGoal : this.phase === 'investigate' && sound ?
        (this.arena.native ? sound : {x: clamp(sound.x, this.arena.minX + 2, this.arena.maxX - 2), y: 0, z: clamp(sound.z, this.arena.minZ + 2, this.arena.maxZ - 2)}) : this.phase === 'push' ?
        this.arena.tactical ? this.searchGoal ?? this.arena.tactical.entry :
        this.searchGoal ?? (this.heard && time - this.heardAt < 3 ? {x: clamp(this.heard.x, this.arena.minX + 2, this.arena.maxX - 2), y: 0, z: clamp(this.heard.z, this.arena.minZ + 2, this.arena.maxZ - 2)}
          : this.lastSeen && memoryAge < 8 ? {x: clamp(this.lastSeen.position.x, this.arena.minX + 2, this.arena.maxX - 2), y: 0,
            z: clamp(this.lastSeen.position.z, this.arena.minZ + 2, this.arena.maxZ - 2)} : this.lane.edge)
        : self.position;
    const moving = lateBrake || ['approach', 'expose', 'return', 'push', 'investigate', 'microstrafe', 'reload', 'close'].includes(this.phase);
    const goalKey = `${this.phase}:${goal.x.toFixed(2)}:${goal.z.toFixed(2)}`;
    const remaining = distance(self.position, goal);
    if (remaining < .24) this.arrivedGoal = goalKey;
    const arrived = this.arrivedGoal === goalKey;
    const waypoint = moving && !arrived ? this.travel(self, goal, time) : self.position;
    const dx = waypoint.x - self.position.x, dz = waypoint.z - self.position.z;
    const separation = Math.hypot(dx, dz);
    let wishX = moving && separation > .14 ? dx / separation : 0;
    let wishZ = moving && separation > .14 ? dz / separation : 0;
    // Soft local avoidance changes desired input, never actor velocity or position.
    for (const peer of teammates) {
      if (peer.id === self.id || !peer.alive) continue;
      const deltaX = self.position.x - peer.position.x, deltaZ = self.position.z - peer.position.z;
      const gap = Math.hypot(deltaX, deltaZ);
      if (gap > 1.35 || gap < 1e-4) continue;
      const weight = (1.35 - gap) * 1.7;
      wishX += deltaX / gap * weight; wishZ += deltaZ / gap * weight;
    }
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1) {wishX /= wishLength; wishZ /= wishLength;}
    const finalLeg = distance(waypoint, goal) < .01;
    const stoppingDistance = speed * speed / (2 * 9 * gameData.weapons[this.weapon].speed * UNIT);
    const shouldBrake = !moving || arrived || finalLeg && remaining < Math.max(.24, stoppingDistance + .14);
    if (shouldBrake && speed > .15) {
      wishX = -self.velocity.x / speed; wishZ = -self.velocity.z / speed;
    } else if (shouldBrake) {wishX = 0; wishZ = 0;}
    const recovery = this.recoverTravel(self, goal, waypoint, time, moving && !shouldBrake, teammates);
    if (recovery) {
      const rx = recovery.x - self.position.x, rz = recovery.z - self.position.z;
      const length = Math.hypot(rx, rz);
      wishX = length > .14 ? rx / length : speed > .15 ? -self.velocity.x / speed : 0;
      wishZ = length > .14 ? rz / length : speed > .15 ? -self.velocity.z / speed : 0;
    }
    const target = visible;
    const finishSpray = identified && this.attackFiredAt >= 0 && time - this.attackFiredAt > .32 &&
      target && distance(self.position, target.position) < 12;
    const travelLook = !this.lane.watch && !this.arena.tactical && moving && ['approach', 'push', 'investigate'].includes(this.phase) && remaining > 2 && separation > .2;
    // Deliberate low aim remains a skill trait. The generic late-spray fallback
    // must not erase a weapon-aware visible-part selection from perception.
    const bodyAimPoint = (this.bodyAim || !target?.aimCandidate && finishSpray) && target?.bodyPoint;
    const expectedAim = target ? bodyAimPoint || target.aimPoint
      : informationAim ?? (travelLook ? {x: self.position.x + dx / separation * 5, y: this.arena.native ? self.feet + this.preaimHeight : this.preaimHeight,
          z: self.position.z + dz / separation * 5} : commonAim);
    const soundIsFocus = !!soundAim && informationAim === soundAim;
    const experienced = this.level === '10+' || this.level >= 6;
    const cueAim = !visible && (!memoryAim || soundIsFocus) &&
      (sound ? this.heardSource === 'sound' : time - this.shadowAt < .85) &&
      this.cueChecks.focus(self.position, time, this.scanPoints, this.arena);
    const shadowFocus = !informationAim && time >= this.shadowReadyAt && time >= this.shadowAt && time - this.shadowAt < .85;
    const checkedAim = cueAim && (soundIsFocus || shadowFocus) ? cueAim
      : shadowFocus && this.shadowPoint ? this.shadowPoint : expectedAim;
    const ordinaryAim = visible || tradeAim || (memoryAim && (!soundIsFocus || memoryAge < .65)) || ['expose', 'brake', 'attack'].includes(this.phase)
      ? expectedAim : this.awareness.look(self.position, time, checkedAim, this.scanPoints, this.arena,
        !!shadowFocus || soundIsFocus && (experienced || time - this.heardAt < 1.2));
    const intents: AimIntent[] = [{owner: travelLook && !informationAim && !shadowFocus ? 'travel' : 'clearing',
      point: ordinaryAim, observedAt: time, expiresAt: time + STEP * 2, confidence: .35}];
    if (target) intents.push({owner: 'combat', point: expectedAim, observedAt: this.observation!.time,
      expiresAt: this.observation!.time + .075 + Number.EPSILON, confidence: 1});
    if (memoryAim && memoryAge < .65) intents.push({owner: 'repeek', point: memoryAim,
      observedAt: this.lastSeenAt, expiresAt: this.lastSeenAt + .65, confidence: Math.exp(-memoryAge / 1.4)});
    if (soundAim) intents.push({owner: this.heardSource === 'sound' ? 'audio' : 'support', point: cueAim || soundAim,
      observedAt: this.heardAt, expiresAt: this.heardAt + 3.5, confidence: .65});
    // tradeAim is offered only for a recognized report at least as fresh as
    // local evidence. A confirmed death trade can interrupt an older re-peek.
    if (tradeAim) intents.push({owner: trade!.source === 'sight' ? 'trade' : 'support', point: tradeAim, observedAt: trade!.observedAt,
      expiresAt: trade!.expiresAt, confidence: .75});
    if (shadowFocus && this.shadowPoint) intents.push({owner: 'shadow', point: cueAim || this.shadowPoint,
      observedAt: this.shadowAt, expiresAt: this.shadowAt + .85, confidence: .45});
    this.gaze = arbitrateGaze(time, intents);
    const observedAim = this.gaze?.point ?? ordinaryAim;
    const proficiency = this.level === '10+' ? 1 : (Number(this.level) - 1) / 10;
    const lead = identified ? Math.min(.11, time - (this.observation?.time ?? time) +
      this.traits.motorSettlingMs / 2000 * proficiency) : 0;
    // Own strafing changes the apparent angle too; predict relative motion.
    const aimPoint = {...observedAim, x: observedAim.x + (this.targetVelocity.x - self.velocity.x) * lead,
      z: observedAim.z + (this.targetVelocity.z - self.velocity.z) * lead};
    if (identified) {
      if (time >= this.driftAt) {
        const amplitude = this.traits.endpointErrorDegrees * (.55 - proficiency * .32) / this.accuracy * DEG;
        this.aimDrift = {yaw: normal(this.random) * amplitude, pitch: normal(this.random) * amplitude};
        this.driftAt = time + .12 + this.random() * .16;
      }
      const correction = 1 - Math.exp(-STEP / (.3 - proficiency * .2));
      this.aimError.yaw += (this.aimDrift.yaw - this.aimError.yaw) * correction;
      this.aimError.pitch += (this.aimDrift.pitch - this.aimError.pitch) * correction;
    }
    const preaimYaw = this.traits.preaimErrorDegrees * DEG * (this.lane.side > 0 ? 1 : -1);
    const yawGoal = Math.atan2(-(aimPoint.x - self.position.x), -(aimPoint.z - self.position.z)) +
      (target ? this.aimError.yaw : informationAim === memoryAim && memoryAim ? 0 : preaimYaw);
    const pitchGoal = Math.atan2(aimPoint.y - self.position.y,
      Math.hypot(aimPoint.x - self.position.x, aimPoint.z - self.position.z)) +
      (target ? this.aimError.pitch : 0);
    const punchYaw = (self.aimPunch?.yaw ?? 0) * DEG, punchPitch = (self.aimPunch?.pitch ?? 0) * DEG;
    // A bot senses its own displaced view and corrects it through its finite
    // aim motor. Damage punch is not folded into instantaneous recoil control.
    const yawError = difference(yawGoal, self.yaw - this.compensation.yaw - punchYaw);
    const pitchError = pitchGoal - (self.pitch - this.compensation.pitch + punchPitch);
    this.motorMode = target ? identified ? 'tracking' : 'acquiring'
      : this.gaze?.owner === 'travel' ? 'travel' : moving ? 'clearing' : 'holding';
    const aim = aimStep(this.motor, yawError, pitchError,
      this.traits.motorSettlingMs, this.motorMode);
    // Learned recoil correction is a separate mouse input, not a second delayed target acquisition.
    const style = this.style;
    const control = style.recoilControl * this.controlVariation;
    const recoilResponse = 1 - Math.exp(-STEP / style.recoilResponse);
    const recoilYaw = (recoil.yaw * DEG * control - this.compensation.yaw) * recoilResponse;
    const recoilPitch = (-recoil.pitch * DEG * control - this.compensation.pitch) * recoilResponse;
    this.compensation.yaw += recoilYaw; this.compensation.pitch += recoilPitch;
    const yawDelta = aim.yawDelta + recoilYaw, pitchDelta = aim.pitchDelta + recoilPitch;
    const nextYaw = self.yaw + yawDelta;
    const forward = -wishX * Math.sin(nextYaw) - wishZ * Math.cos(nextYaw);
    const side = wishX * Math.cos(nextYaw) - wishZ * Math.sin(nextYaw);
    const directYaw = Math.atan2(-(observedAim.x - self.position.x), -(observedAim.z - self.position.z));
    const directPitch = Math.atan2(observedAim.y - self.position.y, distance(observedAim, self.position));
    // Gate the first shot against the visible target, not the leading motor setpoint.
    const aimError = Math.hypot(difference(directYaw, nextYaw - recoil.yaw * DEG - punchYaw),
      directPitch - (self.pitch + pitchDelta + recoil.pitch * DEG + punchPitch));
    const firingPhase = this.phase === 'attack' || runningCombat && this.phase === 'microstrafe' || this.phase === 'expose' &&
      (this.activePeek === 'prefire' || movingFire);
    const aimTolerance = Math.max((style.fireTolerance + this.traits.endpointErrorDegrees * .25) * DEG,
      Math.atan2(bodyAimPoint ? .2 : .12, distance(observedAim, self.position)));
    this.fireBlockedReason = firingVeto({visible: !!visible,
      stale: !!this.observation?.visible && time > this.observation.time + .075,
      recognized: identified, settled: time > this.readyAt + this.traits.motorSettlingMs / 1000,
      ammo: self.ammo, reloading: self.reloading, weaponReady: time >= (readiness.weaponReadyAt ?? -Infinity),
      informationPeek: informationPeek && ['expose', 'return'].includes(this.phase),
      disengaging: this.phase === 'return', closing, inRange: distance(observedAim, self.position) <= stats.range * UNIT,
      burstReady: time >= this.nextBurstAt, firingPhase,
      aligned: aimError < (this.attackFiredAt >= 0 ? Math.max(aimTolerance * 3, (3 + (1 - proficiency) * 5) * DEG) : aimTolerance),
      accurateMovement: movingFire || !this.stopThisPeek && !sniperIds.includes(this.weapon) || speed < stats.speed * UNIT * .2,
      cycleReady: time >= this.nextShotAt});
    const fire = this.fireBlockedReason === null || this.fireBlockedReason === 'cooldown';
    const press = fire && this.fireBlockedReason === null;
    if (press) this.nextShotAt = time + gameData.weapons[this.weapon].cycle;
    const lateCrouchWide = this.activePeek === 'crouchWide' &&
      (this.phase === 'brake' || this.phase === 'expose' && distance(self.position, exposure) < .65);
    const fightAge = this.attackFiredAt < 0 ? -1 : time - this.attackFiredAt;
    if (this.phase === 'attack' && this.crouchTap && fightAge >= this.tapDelay) {
      this.tapUntil = time + .24; this.crouchTap = false;
    }
    const fightingCrouch = this.phase === 'attack' && this.crouchSpray && fightAge > .16 || time < this.tapUntil;
    const botCount = 1 + teammates.filter(peer => peer.id !== self.id && peer.alive && peer.side === self.side).length;
    const quietChance = (this.behavior === 'patient' ? .9 : this.behavior === 'holder' ? .78 : .55) -
      (botCount <= 2 ? (botCount - 1) * .1 : .42);
    const quietTravel = !visible && time - this.lastHurtAt > 1.2 &&
      ['approach', 'push', 'investigate', 'return', 'reload'].includes(this.phase) && this.stealthRoll < quietChance &&
      !trade && (this.behavior !== 'aggressive' || this.phase !== 'approach' || remaining < 4);
    return {forward, side, walk: this.phase === 'expose' && this.activePeek === 'slice' || quietTravel ||
      this.phase === 'approach' && this.behavior === 'patient' && remaining < 3 && time > 1,
      crouch: this.activePeek === 'crouch' && ['expose', 'brake'].includes(this.phase) || lateCrouchWide || fightingCrouch,
      jump: this.activePeek === 'jump' && this.phase === 'expose' && time - this.phaseAt < .07,
      yawDelta, pitchDelta, fireHeld: fire, firePressed: press,
      reloadPressed: this.weapon !== 'zeus' && self.reserve !== 0 && this.phase === 'reload' &&
        distance(self.position, this.resetGoal ?? this.lane.retreat) < .7 && !self.reloading};
  }
}
