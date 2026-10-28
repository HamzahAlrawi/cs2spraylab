import type {Vec} from '../actor-physics';
import type {Arena} from './geometry';
import type {TeamAssignment} from './coordination';
import type {SkillLevel} from './config';
import type {DuelActorSnapshot} from './types';
import type {ThreatReport} from './trading';
import type {UtilityKind} from './utility-loadout';

type Setup = {thrower: number; generation: number; kind: UtilityKind; point: Vec; startedAt: number; expiresAt: number;
  peers: {id: number; generation: number; readyAt: number}[]; projectile?: number; poppedAt?: number};
const gap = (a: Vec, b: Vec) => Math.hypot(a.x-b.x, a.z-b.z);
const rank = (level: SkillLevel) => level === '10+' ? 10 : level;

/** Team knowledge comes only from a caller's recognized contact and allied state. */
export class TeamUtilityCoordinator {
  private setups: Setup[] = [];
  private prune(time: number, actors: readonly DuelActorSnapshot[]) {
    this.setups = this.setups.filter(setup => time < setup.expiresAt &&
      (setup.projectile !== undefined || actors.some(actor => actor.id===setup.thrower&&actor.generation===setup.generation&&actor.alive)));
  }
  claim(time: number, actor: DuelActorSnapshot, kind: UtilityKind, report: ThreatReport,
    peers: readonly DuelActorSnapshot[], skill: (id: number) => SkillLevel) {
    this.prune(time, peers);
    const current = this.setups.find(setup => setup.thrower===actor.id&&setup.generation===actor.generation&&setup.projectile===undefined);
    if (current) return current.kind===kind;
    if (report.readyAt>time || time-report.observedAt>2.2 || this.setups.some(setup =>
      gap(setup.point, report.point)<8&&(setup.kind===kind||setup.kind==='flash'&&kind==='flash'))) return false;
    if (this.setups.length>=2) return false;
    const partners = rank(skill(actor.id)) < 4 ? [] : peers.filter(peer => peer.id!==actor.id&&peer.side===actor.side&&peer.alive&&
      !peer.reloading&&peer.ammo>0&&peer.equipment!=='knife'&&gap(peer.position,actor.position)<14&&rank(skill(peer.id))>=4)
      .sort((a,b)=>gap(a.position,actor.position)-gap(b.position,actor.position)).slice(0,2)
      .map(peer=>({id:peer.id,generation:peer.generation,readyAt:time+.25+(10-rank(skill(peer.id)))*.055}));
    this.setups.push({thrower:actor.id,generation:actor.generation,kind,point:{...report.point},startedAt:time,expiresAt:time+5,peers:partners});
    return true;
  }
  cancel(actorId: number) {this.setups=this.setups.filter(setup=>setup.thrower!==actorId||setup.projectile!==undefined);}
  thrown(actorId: number, projectile: number, time: number) {
    const setup=this.setups.find(item=>item.thrower===actorId&&item.projectile===undefined);
    if(setup){setup.projectile=projectile;setup.expiresAt=time+6;}
  }
  detonated(projectile: number, time: number) {
    const setup=this.setups.find(item=>item.projectile===projectile);
    if(setup){setup.poppedAt=time;setup.expiresAt=time+2.5;}
  }
  assignment(time: number, actor: DuelActorSnapshot, arena: Arena): TeamAssignment | null {
    const setup=this.setups.find(item=>time<item.expiresAt&&item.peers.some(peer=>peer.id===actor.id&&peer.generation===actor.generation&&time>=peer.readyAt));
    if(!setup||!actor.alive)return null;
    const lane=[...(arena.lanes??[])].filter(lane=>gap(lane.anchor,actor.position)<12)
      .sort((a,b)=>gap(a.anchor,actor.position)-gap(b.anchor,actor.position))[0];
    if(!lane)return null;
    const offensive=setup.kind==='flash'||setup.kind==='he';
    return {actorId:actor.id,generation:actor.generation,role:offensive?'trade':'crossfire',partnerId:setup.thrower,
      lane,point:{...setup.point},contactAt:setup.startedAt,peekAt:setup.poppedAt===undefined?setup.expiresAt:setup.poppedAt+.12,
      expiresAt:setup.expiresAt,waitForPartner:setup.poppedAt===undefined};
  }
  waiting(time: number, actor: DuelActorSnapshot) {
    return this.setups.some(setup=>time<setup.expiresAt&&setup.poppedAt===undefined&&setup.peers.some(peer=>
      peer.id===actor.id&&peer.generation===actor.generation&&time>=peer.readyAt));
  }
  diagnostics(time: number) {return this.setups.filter(setup=>time<setup.expiresAt).map(setup=>({thrower:setup.thrower,kind:setup.kind,
    stage:setup.poppedAt!==undefined?'execute':setup.projectile!==undefined?'flight':'prepare',partners:setup.peers.map(peer=>peer.id)}));}
}
