import {GRAVITY, JUMP_SPEED, UNIT, type Vec} from '../actor-physics';
import {gameData, sniperIds, type Weapon} from '../config';
import type {BotBehavior, SkillLevel} from './config';
import type {CoverLane} from './geometry';
import type {ActorCommand, DuelActorSnapshot} from './types';

export type TacticalPeer = {
  actor: DuelActorSnapshot;
  level: SkillLevel;
  behavior?: BotBehavior;
  lastShotAt?: number;
  lastHurtAt?: number;
  lastDownAt?: number;
  contactAt?: number;
  busy?: boolean;
};
export type TeamContact = {
  reporterId: number;
  point: Vec;
  observedAt: number;
  source: 'sight' | 'callout' | 'sound' | 'shadow';
};
export type TeamAssignment = {
  actorId: number;
  generation: number;
  role: 'entry' | 'trade' | 'crossfire' | 'anchor';
  partnerId?: number;
  lane: CoverLane;
  point: Vec;
  contactAt: number;
  peekAt: number;
  expiresAt: number;
  waitForPartner?: boolean;
};
const gap = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const experienced = (level: SkillLevel, minimum = 6) => level === '10+' || level >= minimum;
const MAX_BOOST_LIFT = 54 * UNIT + JUMP_SPEED * JUMP_SPEED / (2 * GRAVITY) - .08;
const firearm = (actor: DuelActorSnapshot) => actor.equipment !== 'knife' && !!gameData.weapons[actor.equipment];
const available = (peer: TacticalPeer) => peer.actor.alive && !peer.busy && !peer.actor.reloading &&
  peer.actor.ammo > 0 && firearm(peer.actor) && experienced(peer.level);
const copyLane = (lane: CoverLane): CoverLane => ({...lane, anchor: {...lane.anchor}, edge: {...lane.edge},
  retreat: {...lane.retreat}, axis: lane.axis ? {...lane.axis} : undefined});
export const copyTeamAssignment = (assignment: TeamAssignment): TeamAssignment => ({...assignment,
  lane: copyLane(assignment.lane), point: {...assignment.point}});

// Inputs contain allied state and reports of evidence only, never enemy actors.
// One planner per side/round; output can be polled at motor frequency.
export class TeamTacticsPlanner {
  private nextPlanAt = -Infinity;
  private assignments: TeamAssignment[] = [];
  private leaderId?: number;
  private contactAt = -Infinity;

  plan(time: number, peers: readonly TacticalPeer[], lanes: readonly CoverLane[], contacts: readonly TeamContact[]) {
    const fresh = contacts.filter(contact => time >= contact.observedAt && time - contact.observedAt < 2 &&
      [contact.point.x, contact.point.y, contact.point.z].every(Number.isFinite) &&
      peers.some(peer => peer.actor.id === contact.reporterId))
      .sort((a, b) => b.observedAt - a.observedAt || a.reporterId - b.reporterId)[0];
    if (!fresh || !lanes.length) {this.assignments = []; return [];}
    const reporter = peers.find(peer => peer.actor.id === fresh.reporterId)!;
    const allies = peers.filter(peer => peer.actor.side === reporter.actor.side && available(peer));
    const leader = peers.find(peer => peer.actor.id === this.leaderId);
    // A teammate's shot/down cue accelerates an already planned trade, but
    // cannot supply a new enemy position or bypass personal sight recognition.
    const release = leader && ((leader.lastShotAt ?? -Infinity) >= this.contactAt &&
      time >= (leader.lastShotAt ?? Infinity) && time - (leader.lastShotAt ?? -Infinity) < .35 ||
      !leader.actor.alive && time >= (leader.lastDownAt ?? Infinity) && time - (leader.lastDownAt ?? -Infinity) < .6);
    if (release && leader && !leader.actor.alive) {
      const trades = this.assignments.filter(assignment => assignment.role === 'trade' && time < assignment.expiresAt &&
        allies.some(peer => peer.actor.id === assignment.actorId && peer.actor.generation === assignment.generation));
      if (trades.length) {
        for (const trade of trades) {trade.peekAt = Math.min(trade.peekAt, time + .04); trade.waitForPartner = false;}
        this.assignments = trades;
        return trades.map(copyTeamAssignment);
      }
    }
    if (time < this.nextPlanAt && !this.assignments.length) return [];
    if (time < this.nextPlanAt && this.assignments.length) {
      const valid = this.assignments.filter(assignment => time < assignment.expiresAt && allies.some(peer =>
        peer.actor.id === assignment.actorId && peer.actor.generation === assignment.generation));
      if (release) for (const assignment of valid) if (assignment.role === 'trade')
        {assignment.peekAt = Math.min(assignment.peekAt, time + .04); assignment.waitForPartner = false;}
      this.assignments = valid;
      return valid.map(copyTeamAssignment);
    }
    this.nextPlanAt = time + .25;
    if (allies.length < 2) {this.assignments = []; return [];}
    const previous = this.assignments;
    const score = (peer: TacticalPeer) => peer.actor.health + peer.actor.armor * .2 +
      Math.min(peer.actor.ammo, 12) * 2 - gap(peer.actor.position, fresh.point) * 1.5 -
      (sniperIds.includes(peer.actor.equipment as Weapon) ? 70 : 0) -
      (peer.actor.equipment === 'zeus' ? 50 : 0) -
      (time - (peer.lastHurtAt ?? -Infinity) < .7 ? 35 : 0);
    const order = [...allies].sort((a, b) => score(b) - score(a) || a.actor.id - b.actor.id);
    const oldLead = order.find(peer => peer.actor.id === this.leaderId);
    const entry = oldLead && score(oldLead) >= score(order[0]) - 20 ? oldLead : order[0];
    const others = order.filter(peer => peer !== entry);
    const trader = [...others].filter(peer => gap(peer.actor.position, entry.actor.position) <= 8 &&
      !sniperIds.includes(peer.actor.equipment as Weapon)).sort((a, b) =>
      gap(a.actor.position, entry.actor.position) - gap(b.actor.position, entry.actor.position) || a.actor.id - b.actor.id)[0];
    const nearLane = (peer: TacticalPeer, role: TeamAssignment['role'], opposite = false) => {
      const ranked = [...lanes].sort((a, b) => {
        const cost = (lane: CoverLane) => gap(peer.actor.position, lane.anchor) + gap(lane.edge, fresh.point) * .25 +
          (opposite && lane.side === entryLane.side ? 8 : 0) +
          (role === 'anchor' && lane.role !== 'camp' && lane.role !== 'offAngle' ? 5 : 0) +
          (role === 'entry' && lane.role !== 'entry' ? 4 : 0);
        return cost(a) - cost(b);
      });
      return copyLane(ranked[0]);
    };
    const entryLane = nearLane(entry, 'entry');
    this.leaderId = entry.actor.id;
    if (!previous.length || gap(previous[0].point, fresh.point) >= 2) this.contactAt = fresh.observedAt;
    const synchronized = fresh.source === 'sight' || fresh.source === 'callout';
    this.assignments = order.map(peer => {
      const role: TeamAssignment['role'] = peer === entry ? 'entry' : peer === trader ? 'trade'
        : sniperIds.includes(peer.actor.equipment as Weapon) || peer.actor.health < 40 ? 'anchor' : 'crossfire';
      const lane = role === 'trade' ? copyLane(entryLane) : peer === entry ? entryLane : nearLane(peer, role, role === 'crossfire');
      if (role === 'trade') {
        const axis = lane.axis ?? {x: lane.side, z: 0};
        lane.anchor.x -= axis.x * 1.15; lane.anchor.z -= axis.z * 1.15;
      }
      const old = previous.find(assignment => assignment.actorId === peer.actor.id && assignment.role === role &&
        gap(assignment.point, fresh.point) < 2 && time < assignment.expiresAt);
      const traderAnchor = {x: entryLane.anchor.x - (entryLane.axis?.x ?? entryLane.side) * 1.15,
        y: entryLane.anchor.y, z: entryLane.anchor.z - (entryLane.axis?.z ?? 0) * 1.15};
      const waitForPartner = !!trader && synchronized && (role === 'entry' || role === 'trade') && !release &&
        (gap(entry.actor.position, entryLane.anchor) > .7 || gap(trader.actor.position, traderAnchor) > .7);
      return {actorId: peer.actor.id, generation: peer.actor.generation, role,
        partnerId: role === 'trade' ? entry.actor.id : role === 'entry' ? trader?.actor.id : undefined,
        lane, point: {...fresh.point}, contactAt: fresh.observedAt,
        peekAt: old && !old.waitForPartner ? old.peekAt : time + (synchronized ? .22 : .45) + (role === 'trade' ? .1 : 0),
        expiresAt: fresh.observedAt + 2, waitForPartner};
    });
    if (release) for (const assignment of this.assignments) if (assignment.role === 'trade')
      {assignment.peekAt = Math.min(assignment.peekAt, time + .04); assignment.waitForPartner = false;}
    return this.assignments.map(copyTeamAssignment);
  }
}

export type BoostPOI = {id: string; base: Vec; mount: Vec; perch: Vec; dismount: Vec; lookAt: Vec;
  approachFrom?:Vec;approachTo?:Vec};
export type BoostAssignment = {actorId: number; generation: number; role: 'base' | 'climber'; goal: Vec};
export type BoostPlan = {poiId: string; phase: 'assemble' | 'mount' | 'hold' | 'release';
  mountStage?: 'partner' | 'perch'; lookAt: Vec;
  assignments: BoostAssignment[]; commands: {actorId: number; command: Partial<ActorCommand>}[]};
export type BoostFeasible = (poi: BoostPOI, base: TacticalPeer, climber: TacticalPeer) => boolean;

const boostSafe = (peer: TacticalPeer, time: number) => available(peer) && experienced(peer.level, 7) &&
  peer.actor.health >= 45 && time - (peer.lastHurtAt ?? -Infinity) > 2.5 &&
  time - (peer.lastShotAt ?? -Infinity) > 2.5 && time - (peer.contactAt ?? -Infinity) > 2.5;
const moveToward = (self: DuelActorSnapshot, goal: Vec, crouch: boolean): Partial<ActorCommand> => {
  const dx = goal.x - self.position.x, dz = goal.z - self.position.z, length = Math.hypot(dx, dz);
  const speed = Math.hypot(self.velocity.x, self.velocity.z);
  const braking = length < .2 && speed > .12;
  const x = braking ? -self.velocity.x / speed : length >= .2 ? dx / length : 0;
  const z = braking ? -self.velocity.z / speed : length >= .2 ? dz / length : 0;
  return {forward: -x * Math.sin(self.yaw) - z * Math.cos(self.yaw),
    side: x * Math.cos(self.yaw) - z * Math.sin(self.yaw), walk: true, crouch, jump: false};
};

export class BoostPlanner {
  private active: {poi: BoostPOI; base: number; climber: number; generations: number[];
    phase: BoostPlan['phase']; startedAt: number; phaseAt: number; jumped: boolean;
    mountStage: 'partner' | 'perch'; supportedAt: number} | null = null;
  private nextPlanAt = -Infinity;
  private cooldownUntil = -Infinity;

  cancel(time: number) {this.active = null; this.cooldownUntil = time + 4;}

  plan(time: number, peers: readonly TacticalPeer[], pois: readonly BoostPOI[], feasible: BoostFeasible): BoostPlan | null {
    if (this.active) {
      const a = this.active;
      const base = peers.find(peer => peer.actor.id === a.base), climber = peers.find(peer => peer.actor.id === a.climber);
      if (!base || !climber || !boostSafe(base, time) || !boostSafe(climber, time) ||
        base.actor.generation !== a.generations[0] || climber.actor.generation !== a.generations[1] ||
        !pois.some(poi => poi.id === a.poi.id) || time < a.startedAt || time - a.startedAt > 10 ||
        !feasible(a.poi, base, climber)) {this.cancel(time); return null;}
      const nearBase = gap(base.actor.position, a.poi.base) < .23 && Math.abs(base.actor.feet - a.poi.base.y) < .15;
      const baseReady = nearBase && base.actor.grounded === true && base.actor.duckAmount >= .85 &&
        Math.hypot(base.actor.velocity.x, base.actor.velocity.z) < .15;
      const mounted = gap(climber.actor.position, a.poi.perch) < .3 &&
        Math.abs(climber.actor.feet - a.poi.perch.y) < .18 && climber.actor.grounded === true;
      if (a.phase === 'assemble' && baseReady && gap(climber.actor.position, a.poi.mount) < .3 &&
        Math.abs(climber.actor.feet - a.poi.mount.y) < .15 &&
        climber.actor.grounded === true) {a.phase = 'mount'; a.phaseAt = time;}
      if (a.phase === 'mount' && mounted) {a.phase = 'hold'; a.phaseAt = time;}
      const partnerTop = {...a.poi.base, y: base.actor.feet + (72 - 18 * base.actor.duckAmount) * UNIT};
      const onPartner = climber.actor.grounded === true && gap(climber.actor.position, a.poi.base) < .35 &&
        (climber.actor.supportingActor === base.actor.id || Math.abs(climber.actor.feet - partnerTop.y) < .12);
      if (a.phase === 'mount' && a.mountStage === 'partner') {
        if (onPartner) {
          if (a.supportedAt < 0) a.supportedAt = time;
          if (time - a.supportedAt >= .08) {
            a.mountStage = 'perch'; a.phaseAt = time; a.jumped = false;
          }
        } else a.supportedAt = -1;
      }
      if ((a.phase === 'mount' || a.phase === 'hold') && !baseReady) {this.cancel(time); return null;}
      if (a.phase === 'mount' && time - a.phaseAt > 1.8) {this.cancel(time); return null;}
      if (a.phase === 'hold' && (!mounted || time - a.phaseAt > 2.5)) {a.phase = 'release'; a.phaseAt = time;}
      if (a.phase === 'release' && (gap(climber.actor.position, a.poi.dismount) < .35 &&
        climber.actor.grounded === true || time - a.phaseAt > 2)) {this.cancel(time); return null;}
      const approach=(actor:DuelActorSnapshot,destination:Vec)=>{
        if(actor.feet>=destination.y-.15||!a.poi.approachFrom||!a.poi.approachTo)return destination;
        return gap(actor.position,a.poi.approachFrom)>.35&&actor.feet<a.poi.approachFrom.y+.15?a.poi.approachFrom:a.poi.approachTo;
      };
      const goal = a.phase === 'assemble' ? approach(climber.actor,a.poi.mount) : a.phase === 'release' ? a.poi.dismount
        : a.phase === 'mount' && a.mountStage === 'partner' ? partnerTop : a.poi.perch;
      const climberCommand = moveToward(climber.actor, goal, false);
      if(a.phase==='assemble'&&a.poi.approachFrom&&base.actor.feet<a.poi.base.y-.15)
        {climberCommand.forward=0;climberCommand.side=0;}
      climberCommand.walk = a.phase === 'assemble';
      if (a.phase === 'mount' && !a.jumped && (a.mountStage==='partner'||time-a.phaseAt>=16/128))
        {climberCommand.jump = true; a.jumped = true;}
      return {poiId: a.poi.id, phase: a.phase, mountStage: a.phase === 'mount' ? a.mountStage : undefined,
        lookAt: {...a.poi.lookAt},
        assignments: [{actorId: a.base, generation: a.generations[0], role: 'base', goal: {...a.poi.base}},
          {actorId: a.climber, generation: a.generations[1], role: 'climber', goal: {...goal}}],
        commands: [{actorId: a.base, command: moveToward(base.actor, approach(base.actor,a.poi.base), nearBase)},
          {actorId: a.climber, command: climberCommand}]};
    }
    if (time < this.cooldownUntil || time < this.nextPlanAt) return null;
    this.nextPlanAt = time + .5;
    const eligible = peers.filter(peer => boostSafe(peer, time) && peer.actor.grounded === true);
    let best: {poi: BoostPOI; base: TacticalPeer; climber: TacticalPeer; score: number} | undefined;
    for (const poi of pois) {
      if (![poi.base, poi.mount, poi.perch, poi.dismount, poi.lookAt].every(point =>
        [point.x, point.y, point.z].every(Number.isFinite)) || poi.perch.y <= poi.base.y ||
        poi.perch.y - poi.base.y > MAX_BOOST_LIFT) continue;
      for (const base of eligible) for (const climber of eligible) {
        if (base === climber || base.actor.side !== climber.actor.side || !feasible(poi, base, climber)) continue;
        const score = gap(base.actor.position, poi.base) + gap(climber.actor.position, poi.mount) +
          (sniperIds.includes(base.actor.equipment as Weapon) ? 4 : 0) + (100 - base.actor.health) * .02;
        if (score > 16 || best && score >= best.score) continue;
        best = {poi, base, climber, score};
      }
    }
    if (!best) return null;
    const {poi, base, climber} = best;
    this.active = {poi: {...poi, base: {...poi.base}, mount: {...poi.mount}, perch: {...poi.perch},
      dismount: {...poi.dismount}, lookAt: {...poi.lookAt},approachFrom:poi.approachFrom&&{...poi.approachFrom},
      approachTo:poi.approachTo&&{...poi.approachTo}}, base: base.actor.id, climber: climber.actor.id,
      generations: [base.actor.generation, climber.actor.generation], phase: 'assemble', startedAt: time,
      phaseAt: time, jumped: false, mountStage: 'partner', supportedAt: -1};
    return this.plan(time, peers, pois, feasible);
  }
}
