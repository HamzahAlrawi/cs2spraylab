import {DEG, STEP, UNIT, clamp, type Vec} from '../actor-physics';
import {gameData, type Weapon} from '../config';
import type {RecoilAngle} from '../recoil';
import type {BotBehavior, SkillLevel} from './config';
import {traceSolid, type Arena, type CoverLane} from './geometry';
import {clearSegment, routeTo} from './navigation';
import type {BotObservation, VisibleEnemy} from './perception';
import {combatStyle, peekDistribution, peekTypes, samplePeek, weaponFamily, type BotTraits, type PeekChoice} from './skill';
import type {ActorCommand, DuelActorSnapshot} from './types';
import {aimStep, type AimMotor} from './motor';
import {AngleAwareness, proficiency} from './awareness';

type Phase = 'approach' | 'setup' | 'expose' | 'brake' | 'attack' | 'return' | 'push' | 'investigate' | 'microstrafe' | 'reload';
const difference = (target: number, current: number) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
const normal = (random: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

// Decisions are geometry-relative and run at simulation tick rate. This class
// never receives the hidden player's live position: only sensed observations.
export class TacticalBrain {
  phase: Phase = 'approach';
  activePeek: PeekChoice = 'hold';
  private observation: BotObservation | null = null;
  private firstVisible = -1;
  private readyAt = Infinity;
  private lastSeen: VisibleEnemy | null = null;
  private lastSeenAt = -Infinity;
  private phaseAt = 0;
  private nextShotAt = 0;
  private aimError = {yaw: 0, pitch: 0};
  private aimDrift = {yaw: 0, pitch: 0};
  private driftAt = 0;
  private compensation = {yaw: 0, pitch: 0};
  private seenSample: {point: Vec; time: number} | null = null;
  private targetVelocity = {x: 0, z: 0};
  private nextBurstAt = 0;
  private stopThisPeek = true;
  private route: Vec[] = [];
  private routeGoal = '';
  private routeAt = -Infinity;
  private stalledAt = 0;
  private previousPosition: Vec | null = null;
  private repeat: PeekChoice = 'hold';
  private readonly preaimHeight: number;
  private bodyAim = false;
  private lane: CoverLane;
  private peekCount = 0;
  private setupWait = .5;
  private attackWait = .8;
  private attackFiredAt = -1;
  private combatStrafes = 0;
  private microGoal: Vec | null = null;
  private forceReposition = false;
  private lastHurtAt = -Infinity;
  private scanAt = 0;
  private scanAim: Vec = {x: 0, y: 1.58, z: 7};
  private brakeFromMicro = false;
  private arrivedGoal = '';
  private readonly motor: AimMotor = {yawRate: 0, pitchRate: 0};
  private heard: Vec | null = null;
  private heardAt = -Infinity;
  private heardReadyAt = Infinity;
  private actedOnSoundAt = -Infinity;
  private readonly stagger: number;
  private sightEdge: Vec | null = null;
  private peekWidth = 1;
  private readonly scanPoints: Vec[];
  private readonly awareness: AngleAwareness;
  private crouchSpray = false;
  private crouchTap = false;
  private tapDelay = .4;
  private tapUntil = -Infinity;
  private controlVariation = 1;
  private searchGoal?: Vec;
  private searchIndex = 0;

  constructor(private readonly traits: BotTraits, private readonly behavior: BotBehavior,
    private readonly accuracy: number, private readonly random: () => number,
    private readonly arena: Arena, private readonly level: SkillLevel,
    private readonly weapon: Weapon, actorId: number, laneOffset = 0) {
    const lanes = arena.lanes;
    if (!lanes?.length) throw new Error('Tactical brain needs cover lanes');
    this.stagger = Math.floor((actorId - 1) / 2) * .18;
    this.awareness = new AngleAwareness(level, random);
    const role = behavior === 'holder' ? 'camp' : behavior === 'patient' ? 'flank' : 'entry';
    const opening = lanes.filter(lane => lane.role === role);
    const candidates = opening.length ? opening : lanes;
    this.lane = this.makeLane(candidates[(actorId + laneOffset) % candidates.length]);
    this.preaimHeight = this.random() < traits.lowAimTendency ? 1 : 1.58;
    this.scanAim = {x: this.lane.side * 4.8, y: this.preaimHeight, z: 4};
    this.scanPoints = arena.solids.flatMap(solid => [-1, 1].map(side => ({
      x: solid.center.x + side * (solid.size.x / 2 + .45), y: this.preaimHeight,
      z: solid.center.z - solid.size.z / 2 - .2,
    })));
  }

  private makeLane(base: CoverLane): CoverLane {
    return {side: base.side, role: base.role, axis: base.axis ?? {x: base.side, z: 0},
      anchor: {...base.anchor}, edge: {...base.edge}, retreat: {...base.retreat}};
  }

  hurt(time: number, healthRemaining: number) {
    const repeatedDamage = time - this.lastHurtAt < .35;
    this.lastHurtAt = time;
    const experienced = this.level === '10+' || Number(this.level) >= 6;
    const contesting = !!this.observation?.visible && ['attack', 'brake', 'microstrafe'].includes(this.phase);
    this.forceReposition = healthRemaining < 35 || this.random() <
      (experienced ? contesting ? repeatedDamage ? .22 : .07 : .65 : .3);
    if (this.forceReposition && this.phase !== 'return' && this.phase !== 'reload') this.transition('return', time);
  }

  decisionSnapshot() {
    return {phase: this.phase, peek: this.activePeek, role: this.lane.role, side: this.lane.side};
  }

  contactReport(time: number): Vec | null {
    return this.lastSeen && time - this.lastSeenAt < .12 && this.observation?.visible
      ? {...this.lastSeen.position} : null;
  }

  teammateCallout(point: Vec, time: number) {
    if (time - this.lastSeenAt < .7 || time - this.heardAt < .35) return;
    this.hear(point, time, 'footstep', true);
  }

  hear(point: Vec, time: number, kind: 'footstep' | 'landing' | 'gunshot', occluded: boolean) {
    const error = (kind === 'gunshot' ? .85 : kind === 'landing' ? 1.25 : 1.8) * (occluded ? 1.7 : 1) * (1.35 - proficiency(this.level) * .65);
    const continuingCue = time - this.heardAt < .65;
    this.heard = {x: point.x + normal(this.random) * error,
      y: point.y, z: point.z + normal(this.random) * error};
    this.heardAt = time;
    const readyAt = time + this.traits.recognitionMedianMs / 1000 *
      (kind === 'gunshot' ? .65 : 1) * (occluded ? 1.35 : 1);
    this.heardReadyAt = continuingCue ? Math.min(this.heardReadyAt, readyAt) : readyAt;
  }

  perceive(observation: BotObservation) {
    this.observation = observation;
    if (!observation.visible) {
      this.seenSample = null;
      this.targetVelocity = {x: 0, z: 0};
      if (observation.time - this.lastSeenAt > .28) this.firstVisible = -1;
      return;
    }
    const sample = this.seenSample;
    if (sample && observation.time > sample.time && observation.time - sample.time < .12) {
      const dt = observation.time - sample.time;
      const response = 1 - Math.exp(-dt / .07);
      // Estimate motion from visible observations only; never use hidden actor velocity.
      const dx = clamp((observation.visible.position.x - sample.point.x) / dt, -7, 7);
      const dz = clamp((observation.visible.position.z - sample.point.z) / dt, -7, 7);
      this.targetVelocity.x += (dx - this.targetVelocity.x) * response;
      this.targetVelocity.z += (dz - this.targetVelocity.z) * response;
    }
    this.seenSample = {point: {...observation.visible.position}, time: observation.time};
    if (this.firstVisible < 0) {
      this.firstVisible = observation.time;
      const recent = observation.time - this.lastSeenAt < 1.2;
      this.readyAt = observation.time + this.traits.recognitionMedianMs / 1000 *
        (recent ? .58 : 1) * Math.exp(.18 * normal(this.random));
      this.aimError = {yaw: normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG,
        pitch: normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG};
      this.bodyAim = this.random() < this.traits.lowAimTendency;
      this.stopThisPeek = this.random() < this.traits.stopTendency;
      const style = combatStyle(this.level), roll = this.random();
      this.crouchSpray = roll < style.crouchSpray;
      this.crouchTap = !this.crouchSpray && roll < style.crouchSpray + style.crouchTap;
      this.tapDelay = .12 + this.random() * .12;
      this.tapUntil = -Infinity;
      this.controlVariation = clamp(1 + normal(this.random) * style.recoilVariation, .5, 1.08);
    }
    if (observation.time >= this.readyAt) {
      this.lastSeen = observation.visible;
      this.lastSeenAt = observation.time;
    }
  }

  private transition(phase: Phase, time: number) {
    const previous = this.phase;
    this.phase = phase; this.phaseAt = time;
    this.route = []; this.routeGoal = ''; this.arrivedGoal = '';
    if (phase === 'brake') this.brakeFromMicro = previous === 'microstrafe';
    if (phase === 'setup') {
      const contact = time - Math.max(this.lastSeenAt, this.heardAt) < 2.5;
      const baseline = this.behavior === 'holder' ? 1.1 : this.behavior === 'patient' ? .65 : .28;
      this.setupWait = (baseline + this.random() * (contact ? .8 : 1.7) + this.stagger) * (contact ? .65 : 1);
    }
    if (phase === 'attack') {
      const range = this.lastSeen && this.observation ? distance(this.lastSeen.position, this.observation.self.position) : 16;
      const disciplined = this.level === '10+' || Number(this.level) >= 6;
      const family = weaponFamily(this.weapon);
      const rounds = family === 'smg' || family === 'lmg' ? 8 + this.random() * 8
        : disciplined ? range > 20 ? 3 + this.random() * 2 : range > 11 ? 5 + this.random() * 3
          : 8 + this.random() * 5 : 5 + this.random() * 8;
      this.attackWait = (Math.floor(this.crouchSpray ? Math.max(rounds, 12 + this.random() * 8) : rounds) - .5) * gameData.weapons[this.weapon].cycle;
      this.attackFiredAt = -1;
    }
  }

  private laneForSound(point: Vec, role: CoverLane['role']) {
    const candidates = this.arena.lanes?.filter(lane => lane.role === role) ?? [];
    const sameSide = candidates.filter(lane => lane.side === (point.x >= 0 ? 1 : -1));
    return (sameSide.length ? sameSide : candidates)[0];
  }

  private chooseLane(self: DuelActorSnapshot, teammates: DuelActorSnapshot[], time: number, force = false) {
    const recent = time - this.lastSeenAt < 4 ? this.lastSeen?.position :
      time >= this.heardReadyAt && time - this.heardAt < 4 ? this.heard : null;
    const roleWeights: Record<NonNullable<CoverLane['role']>, number> = this.behavior === 'holder'
      ? {entry: .65, flank: 1.15, camp: 3.2, offAngle: 1.6}
      : this.behavior === 'patient' ? {entry: 1, flank: 2, camp: 1.4, offAngle: 2.1}
        : {entry: 2.4, flank: 1.6, camp: .55, offAngle: 1.25};
    if (self.health < 40) {roleWeights.camp *= 2; roleWeights.entry *= .55;}
    if (this.level !== '10+' && this.level <= 3) {
      roleWeights.entry *= 1.4; roleWeights.offAngle *= .4; roleWeights.flank *= .6;
    }
    if (time - Math.max(this.lastSeenAt, this.heardAt) > 5) {
      roleWeights.camp *= .12; roleWeights.entry *= 2.3; roleWeights.flank *= 1.6;
    }
    const choices = (this.arena.lanes ?? []).filter(lane =>
      clearSegment(lane.anchor, lane.edge, this.arena) &&
      (!force || lane.role !== this.lane.role || lane.side !== this.lane.side));
    const weighted = choices.map(lane => {
      let weight = roleWeights[lane.role ?? 'entry'];
      if (lane.role === this.lane.role && lane.side === this.lane.side) weight *= force ? .08 : .35;
      if (recent) weight *= lane.side === (recent.x >= 0 ? 1 : -1) ? 1.6 : .65;
      const nearby = teammates.filter(peer => peer.id !== self.id && peer.alive && distance(peer.position, lane.anchor) < 2.4).length;
      weight *= Math.pow(.42, nearby);
      weight *= clamp(1.3 - distance(self.position, lane.anchor) / 24, .45, 1.2);
      return weight;
    });
    const sum = weighted.reduce((total, weight) => total + weight, 0);
    let roll = this.random() * sum;
    for (let index = 0; index < choices.length; index++) {
      roll -= weighted[index];
      if (roll <= 0) {this.lane = this.makeLane(choices[index]); this.sightEdge = null; return;}
    }
  }

  private choosePeek(time: number) {
    this.peekCount++;
    const known = time - this.lastSeenAt < 2;
    // A firing corner depends on the expected angle, not just a waypoint beside
    // a box. Scan geometry using memory/common angles, never a hidden actor.
    const expected = known && this.lastSeen ? this.lastSeen.aimPoint :
      time >= this.heardReadyAt && time - this.heardAt < 3 && this.heard
        ? {...this.heard, y: this.preaimHeight} : {x: 0, y: this.preaimHeight, z: 8};
    const axis = this.lane.axis ?? {x: this.lane.side, z: 0};
    this.sightEdge = {...this.lane.edge};
    for (let offset = -.25; offset <= 2.5; offset += .25) {
      const candidate = {...this.lane.edge, x: this.lane.edge.x + axis.x * offset,
        z: this.lane.edge.z + axis.z * offset};
      if (!clearSegment(this.lane.anchor, candidate, this.arena)) continue;
      const eye = {...candidate, y: 64 * UNIT};
      const dx = expected.x - eye.x, dy = expected.y - eye.y, dz = expected.z - eye.z;
      const length = Math.hypot(dx, dy, dz);
      if (traceSolid(eye, {x: dx / length, y: dy / length, z: dz / length}, this.arena, length).distance < length) continue;
      this.sightEdge = candidate; break;
    }
    this.scanAim = expected; this.scanAt = time + 1.8;
    this.peekWidth = .85 + this.random() * .35;
    const close = this.lastSeen ? distance(this.lastSeen.position, this.lane.edge) < 10 : false;
    const eligible = Object.fromEntries(peekTypes.map(type => [type,
      clearSegment(this.lane.anchor, this.exposurePoint(type), this.arena)]));
    const distribution = peekDistribution(this.level, this.weapon, {
      ...eligible,
      prefire: eligible.prefire && known,
      run: eligible.run && (close || this.behavior === 'aggressive'),
      jump: eligible.jump && this.behavior !== 'holder',
    }, {
      run: this.behavior === 'aggressive' ? 1.8 : .7,
      wide: this.lane.role === 'flank' ? 1.7 : this.behavior === 'aggressive' ? 1.4 : .8,
      slice: this.behavior === 'patient' || this.lane.role === 'offAngle' ? 1.6 : .7,
      shoulder: this.behavior === 'holder' ? 1.5 : 1,
      [this.repeat]: .42,
    });
    this.activePeek = samplePeek(distribution, this.random);
    this.repeat = this.activePeek;
    this.transition(this.activePeek === 'hold' ? 'setup' : 'expose', time);
  }

  private exposurePoint(type: PeekChoice = this.activePeek): Vec {
    const travel: Record<PeekChoice, number> = {hold: 0, shoulder: -.45, quick: 0, wide: .95,
      ferrari: 1.65, crouch: -.05, prefire: 0, slice: -.35, jump: -.15, run: .8, crouchWide: .95};
    const axis = this.lane.axis ?? {x: this.lane.side, z: 0};
    const edge = this.sightEdge ?? this.lane.edge;
    return {...edge, x: edge.x + axis.x * travel[type] * this.peekWidth,
      z: edge.z + axis.z * travel[type] * this.peekWidth};
  }

  private travel(self: DuelActorSnapshot, goal: Vec, time: number) {
    const key = `${goal.x.toFixed(2)}:${goal.z.toFixed(2)}`;
    if (key !== this.routeGoal || !this.route.length || time - this.routeAt > .65 &&
      !clearSegment(self.position, this.route[0], this.arena)) {
      this.routeGoal = key; this.routeAt = time;
      this.route = clearSegment(self.position, goal, this.arena) ? [goal] : routeTo(self.position, goal, this.arena);
    }
    while (this.route.length > 1 && (distance(self.position, this.route[0]) < .35 ||
      clearSegment(self.position, this.route[1], this.arena))) this.route.shift();
    return this.route[0] ?? goal;
  }

  private dodge(self: DuelActorSnapshot, target: VisibleEnemy, time: number) {
    const dx = target.position.x - self.position.x, dz = target.position.z - self.position.z;
    const length = Math.hypot(dx, dz);
    if (length < .1) return false;
    const sign = this.random() < .5 ? -1 : 1;
    for (const direction of [sign, -sign]) {
      const candidate = {x: self.position.x - dz / length * direction * .85,
        y: self.position.y, z: self.position.z + dx / length * direction * .85};
      if (!clearSegment(self.position, candidate, this.arena)) continue;
      this.microGoal = candidate;
      this.combatStrafes++;
      this.transition('microstrafe', time);
      return true;
    }
    return false;
  }

  command(self: DuelActorSnapshot, time: number, recoil: RecoilAngle = {yaw: 0, pitch: 0},
    teammates: DuelActorSnapshot[] = []): Partial<ActorCommand> {
    const visible = this.observation?.visible ?? null;
    const identified = !!visible && time >= this.readyAt;
    const memoryAge = time - this.lastSeenAt;
    const remembered = memoryAge < 1.6 ? this.lastSeen : null;
    const sound = this.heard && time >= this.heardReadyAt && time - this.heardAt < 3.5 ? this.heard : null;
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    if (this.previousPosition && distance(self.position, this.previousPosition) < .08 && speed < .12) {
      if (!this.stalledAt) this.stalledAt = time;
    } else this.stalledAt = 0;
    this.previousPosition = {...self.position};
    if (sound && this.heardAt > this.actedOnSoundAt && !identified && memoryAge > .7) {
      this.actedOnSoundAt = this.heardAt;
      if (this.behavior === 'aggressive') {
        if (this.phase !== 'investigate') this.transition('investigate', time);
      } else if (this.behavior === 'patient') {
        const flank = this.laneForSound(sound, 'flank');
        if (flank && (flank.side !== this.lane.side || this.lane.role !== 'flank')) {
          this.lane = this.makeLane(flank);
          this.transition('approach', time);
        } else if (this.phase === 'setup') this.phaseAt = Math.min(this.phaseAt, time - .3);
      } else if (this.phase === 'setup') this.phaseAt = Math.min(this.phaseAt, time - .55);
    }
    if (this.stalledAt && time - this.stalledAt > 1 &&
      ['approach', 'expose', 'return', 'push', 'investigate', 'microstrafe'].includes(this.phase)) {
      this.transition('return', time); this.stalledAt = 0;
    }

    if (!identified && !sound && time >= this.scanAt) {
      const scans = this.scanPoints.filter(point => point.x * this.lane.side > 0);
      if (!scans.length) scans.push({x: this.lane.side * 4, y: this.preaimHeight, z: 8});
      const choice = scans[Math.floor(this.random() * scans.length)];
      this.scanAim = {x: choice.x, y: this.preaimHeight, z: choice.z};
      this.scanAt = time + 1.1 + this.random() * 1.8;
    }
    if (self.ammo === 0 && this.phase !== 'reload') this.transition('reload', time);
    if (this.phase === 'reload' && self.ammo > 0 && !self.reloading) this.transition('setup', time);
    if (this.phase === 'setup' && !identified && !self.reloading && self.ammo < gameData.weapons[this.weapon].magazine * .22 &&
      time - this.lastSeenAt > 1.5) this.transition('reload', time);
    if (this.phase === 'approach' && distance(self.position, this.lane.anchor) < .35) this.transition('setup', time);
    if (identified && ['approach', 'setup', 'push', 'investigate'].includes(this.phase) && self.ammo > 0) {
      this.activePeek = 'hold';
      this.combatStrafes = 0;
      this.transition(speed > .4 ? 'brake' : 'attack', time);
    }
    const blindFor = time - Math.max(this.lastSeenAt, this.heardAt);
    const searchDelay = this.behavior === 'holder' ? 12 : this.behavior === 'patient' ? 10 : 8;
    if (!identified && !sound && time > searchDelay && blindFor > searchDelay &&
      ['setup', 'return'].includes(this.phase)) this.transition('push', time);
    if (this.phase === 'push' && (!this.searchGoal || distance(self.position, this.searchGoal) < .5)) {
      const search = this.arena.solids.filter(s => s.center.z > 5 && s.size.x >= 3).flatMap(s => [-1, 1].map(side => ({
        x: clamp(s.center.x + side * (s.size.x / 2 + .9), this.arena.minX + 1, this.arena.maxX - 1),
        y: 0, z: Math.min(this.arena.maxZ - 1, s.center.z + s.size.z / 2 + 1.2),
      })));
      this.searchGoal = search.length ? search[this.searchIndex++ % search.length] : {x: this.lane.side * 4, y: 0, z: 6};
      this.scanAim = {...this.searchGoal, y: this.preaimHeight};
    }
    if (this.phase === 'setup' && blindFor > 5 && this.lane.role === 'camp' && time - this.phaseAt > 1.1) {
      this.chooseLane(self, teammates, time, true);
      this.transition('approach', time);
    }
    if (this.phase === 'setup' && time - this.phaseAt > this.setupWait) this.choosePeek(time);
    const exposure = this.exposurePoint();
    if (this.phase === 'expose' && distance(self.position, exposure) < .24) {
      this.transition(this.activePeek === 'shoulder' || this.activePeek === 'jump' ? 'return' : 'brake', time);
    }
    if (this.phase === 'expose' && time - this.phaseAt > 3) {
      this.forceReposition = true; this.transition('return', time);
    }
    const brakeDelay = this.traits.brakeErrorMs / 1000;
    if (this.phase === 'brake' && time - this.phaseAt >= brakeDelay &&
      (speed < .3 || time - this.phaseAt > .28 + brakeDelay)) this.transition('attack', time);
    const aimDeadline = visible ? Math.max(this.phaseAt + .65,
      this.readyAt + this.traits.motorSettlingMs / 1000 + .35) : this.phaseAt + .55;
    const attackExpired = this.attackFiredAt >= 0 ? time - this.attackFiredAt > this.attackWait : time > aimDeadline;
    if (this.phase === 'attack' && (attackExpired || self.ammo === 0)) {
      this.nextBurstAt = time + .2 + this.random() * .15;
      if (self.ammo === 0) this.transition('reload', time);
      else if (identified && visible && this.combatStrafes < 2 && this.random() <
        (this.behavior === 'holder' ? .3 : .68) && this.dodge(self, visible, time)) {
        // Brief displacement followed by a real counter-strafe before the next burst.
      } else this.transition('return', time);
    }
    if (this.phase === 'microstrafe' && (this.microGoal && distance(self.position, this.microGoal) < .25 ||
      time - this.phaseAt > .65)) this.transition('brake', time);
    if (this.phase === 'return' && distance(self.position, this.lane.retreat) < .35) {
      const moveAgain = this.forceReposition || blindFor > 5 || this.peekCount % 2 === 0 || this.random() < .22;
      if (moveAgain) this.chooseLane(self, teammates, time, this.forceReposition);
      this.forceReposition = false;
      this.combatStrafes = 0;
      if (time > 12 && memoryAge > 6 && this.behavior === 'aggressive' && this.random() < .35) this.transition('push', time);
      else this.transition(distance(self.position, this.lane.anchor) > .55 ? 'approach' : 'setup', time);
    }
    if (this.phase === 'investigate' && (identified || distance(self.position, sound ?? self.position) < 1.3 ||
      time - this.phaseAt > 3.5 || !sound)) {
      const next = this.laneForSound(sound ?? self.position, 'entry');
      if (next) this.lane = this.makeLane(next);
      this.transition(identified ? 'attack' : 'approach', time);
    }
    if (this.phase === 'push' && identified) this.transition('attack', time);

    const lateBrake = this.phase === 'brake' && !this.brakeFromMicro && time - this.phaseAt < brakeDelay;
    const axis = this.lane.axis ?? {x: this.lane.side, z: 0};
    const goal = this.phase === 'approach' ? this.lane.anchor : this.phase === 'expose' ? exposure
      : lateBrake ? {...exposure, x: exposure.x + axis.x * .45, z: exposure.z + axis.z * .45}
      : this.phase === 'return' || this.phase === 'reload' ? this.lane.retreat
        : this.phase === 'microstrafe' && this.microGoal ? this.microGoal : this.phase === 'investigate' && sound ?
        {x: clamp(sound.x, this.arena.minX + 2, this.arena.maxX - 2), y: 0, z: clamp(sound.z, this.arena.minZ + 2, this.arena.maxZ - 2)} : this.phase === 'push' ?
        this.searchGoal ?? (this.heard && time - this.heardAt < 3 ? {x: clamp(this.heard.x, this.arena.minX + 2, this.arena.maxX - 2), y: 0, z: clamp(this.heard.z, 1, this.arena.maxZ - 2)}
          : this.lastSeen && memoryAge < 8 ? {x: clamp(this.lastSeen.position.x, this.arena.minX + 2, this.arena.maxX - 2), y: 0,
            z: clamp(this.lastSeen.position.z, 1, this.arena.maxZ - 2)} : {x: this.lane.side * this.arena.maxX * .367, y: 0, z: this.arena.maxZ * .417})
        : self.position;
    const moving = lateBrake || ['approach', 'expose', 'return', 'push', 'investigate', 'microstrafe', 'reload'].includes(this.phase);
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
    const target = identified ? visible : remembered;
    const finishSpray = identified && this.attackFiredAt >= 0 && time - this.attackFiredAt > .32 &&
      target && distance(self.position, target.position) < 12;
    const travelLook = moving && ['approach', 'push', 'investigate'].includes(this.phase) && remaining > 2 && separation > .2;
    const expectedAim = target ? (this.bodyAim || finishSpray) && target.bodyPoint ? target.bodyPoint : target.aimPoint
      : sound ? {x: sound.x, y: this.preaimHeight, z: sound.z}
        : travelLook ? {x: self.position.x + dx / separation * 5, y: this.preaimHeight,
          z: self.position.z + dz / separation * 5} : this.scanAim;
    const observedAim = identified || visible || ['expose', 'brake', 'attack'].includes(this.phase) ? expectedAim
      : this.awareness.look(self.position, time, expectedAim, this.scanPoints, this.arena,
        memoryAge < .5 || !!sound && time - this.heardReadyAt < .35);
    const proficiency = this.level === '10+' ? 1 : (Number(this.level) - 1) / 10;
    const lead = identified ? Math.min(.11, time - (this.observation?.time ?? time) +
      this.traits.motorSettlingMs / 2000 * proficiency) : 0;
    const aimPoint = {...observedAim, x: observedAim.x + this.targetVelocity.x * lead,
      z: observedAim.z + this.targetVelocity.z * lead};
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
      (target ? this.aimError.yaw : preaimYaw);
    const pitchGoal = Math.atan2(aimPoint.y - self.position.y,
      Math.hypot(aimPoint.x - self.position.x, aimPoint.z - self.position.z)) +
      (target ? this.aimError.pitch : 0);
    const yawError = difference(yawGoal, self.yaw - this.compensation.yaw);
    const pitchError = pitchGoal - (self.pitch - this.compensation.pitch);
    const aim = aimStep(this.motor, yawError, pitchError,
      this.traits.motorSettlingMs);
    // Learned recoil correction is a separate mouse input, not a second delayed target acquisition.
    const style = combatStyle(this.level);
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
    const aimError = Math.hypot(difference(directYaw, nextYaw - recoil.yaw * DEG),
      directPitch - (self.pitch + pitchDelta + recoil.pitch * DEG));
    const movingFire = this.activePeek === 'run' || this.activePeek === 'ferrari' && !this.stopThisPeek;
    const firingPhase = this.phase === 'attack' || this.phase === 'expose' &&
      (this.activePeek === 'prefire' || movingFire);
    const prefire = this.activePeek === 'prefire' && !!remembered && memoryAge < 2;
    const fire = time >= this.nextBurstAt && firingPhase && (identified && time > this.readyAt + this.traits.motorSettlingMs / 1000 || prefire) &&
      (this.attackFiredAt >= 0 || aimError < (style.fireTolerance + this.traits.endpointErrorDegrees * .25) * DEG) &&
      (movingFire || !this.stopThisPeek || speed < gameData.weapons[this.weapon].speed * UNIT * .2);
    const press = fire && time >= this.nextShotAt;
    if (fire && this.phase === 'attack' && this.attackFiredAt < 0) this.attackFiredAt = time;
    if (press) this.nextShotAt = time + gameData.weapons[this.weapon].cycle;
    const lateCrouchWide = this.activePeek === 'crouchWide' &&
      (this.phase === 'brake' || this.phase === 'expose' && distance(self.position, exposure) < .65);
    const fightAge = this.attackFiredAt < 0 ? -1 : time - this.attackFiredAt;
    if (this.phase === 'attack' && this.crouchTap && fightAge >= this.tapDelay) {
      this.tapUntil = time + .24; this.crouchTap = false;
    }
    const fightingCrouch = this.phase === 'attack' && this.crouchSpray && fightAge > .16 || time < this.tapUntil;
    return {forward, side, walk: this.phase === 'expose' && this.activePeek === 'slice' ||
      this.phase === 'approach' && this.behavior === 'patient' && remaining < 3 && time > 1,
      crouch: this.activePeek === 'crouch' && ['expose', 'brake'].includes(this.phase) || lateCrouchWide || fightingCrouch,
      jump: this.activePeek === 'jump' && this.phase === 'expose' && time - this.phaseAt < .07,
      yawDelta, pitchDelta, fireHeld: fire, firePressed: press,
      reloadPressed: this.phase === 'reload' && distance(self.position, this.lane.retreat) < .7 && !self.reloading};
  }
}
