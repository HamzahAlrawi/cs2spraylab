import {UNIT,type Vec} from '../actor-physics';
import {randomStream} from './rng';
import {routeTo} from './navigation';
import {availableTraversalLinks,type EnvironmentState,type TraversalLink} from './environment';
import type {Arena} from './geometry';
import type {ActorCommand} from './types';
import type {TacticalPeer} from './coordination';

const gap=(a:Vec,b:Vec)=>Math.hypot(a.x-b.x,a.z-b.z);
const move=(peer:TacticalPeer,goal:Vec):Partial<ActorCommand>=>{
  const self=peer.actor,dx=goal.x-self.position.x,dz=goal.z-self.position.z,length=Math.hypot(dx,dz);
  const speed=Math.hypot(self.velocity.x,self.velocity.z),brake=length<.16&&speed>.1;
  const x=brake?-self.velocity.x/speed:length>.16?dx/length:0,z=brake?-self.velocity.z/speed:length>.16?dz/length:0;
  return {forward:-x*Math.sin(self.yaw)-z*Math.cos(self.yaw),side:x*Math.cos(self.yaw)-z*Math.sin(self.yaw),
    walk:true,crouch:false,jump:false};
};

// Quiet repositioning uses authored routes and sensed contact only, never hidden player coordinates.
export class TerrainTactics {
  private random:()=>number;
  private nextAt=2;
  private active?:{id:number;generation:number;link:TraversalLink;phase:'approach'|'traverse'|'hold';started:number;phaseAt:number;route:Vec[];waypoint:number};
  constructor(seed:number){this.random=randomStream(seed,'terrain-tactics');}
  plan(time:number,peers:readonly TacticalPeer[],arena:Arena,state:EnvironmentState,reserved:readonly number[]=[]) {
    const links=availableTraversalLinks(arena,state).filter(link=>['stairs','ramp','ladder'].includes(link.kind)&&link.to.y-link.from.y>.35);
    const safe=(peer:TacticalPeer)=>peer.actor.alive&&!peer.actor.reloading&&!reserved.includes(peer.actor.id)&&
      (peer.level==='10+'||peer.level>=5)&&time-(peer.contactAt??-Infinity)>2&&time-(peer.lastHurtAt??-Infinity)>2;
    if(this.active) {
      const active=this.active,peer=peers.find(item=>item.actor.id===active.id);
      if(!peer||!safe(peer)||peer.actor.generation!==active.generation||time-active.started>12||!links.some(link=>link.id===active.link.id))
        {this.active=undefined;this.nextAt=time+4;return;}
      if(active.phase==='approach') {
        while(active.waypoint<active.route.length-1&&gap(peer.actor.position,active.route[active.waypoint])<.3)active.waypoint++;
        if(gap(peer.actor.position,active.link.from)<.28) {active.phase='traverse';active.phaseAt=time;}
        else return {actorId:active.id,command:move(peer,active.route[active.waypoint]??active.link.from)};
      }
      if(active.phase==='traverse') {
        if(peer.actor.grounded&&Math.abs(peer.actor.feet-active.link.to.y)<.15&&gap(peer.actor.position,active.link.to)<.3)
          {active.phase='hold';active.phaseAt=time;}
        else if(active.link.kind==='ladder'&&peer.actor.feet<active.link.to.y-.15) {
          const volume=arena.traversalVolumes?.find(item=>item.id===active.link.volumeId);
          const normal=volume?.ladder;
          if(normal) {
            const inward={...peer.actor.position,[normal.axis]:peer.actor.position[normal.axis]-normal.facing};
            return {actorId:active.id,command:{...move(peer,inward),walk:false}};
          }
        }
        if(active.phase==='traverse')return {actorId:active.id,command:{...move(peer,active.link.to),walk:false}};
      }
      if(time-active.phaseAt>2.5){this.active=undefined;this.nextAt=time+5;return;}
      return {actorId:active.id,command:move(peer,active.link.to)};
    }
    if(time<this.nextAt)return;
    this.nextAt=time+3+this.random()*2;
    for(const peer of peers.filter(safe)) {
      if(peer.behavior==='aggressive'||this.random()>.2)continue;
      const candidates=links.filter(link=>Math.abs(link.from.y-peer.actor.feet)<.15&&gap(peer.actor.position,link.from)<8)
        .sort((a,b)=>gap(peer.actor.position,a.from)-gap(peer.actor.position,b.from));
      for(const link of candidates) {
        const route=routeTo(peer.actor.position,link.from,arena);
        if(!route.length&&gap(peer.actor.position,link.from)>.28)continue;
        this.active={id:peer.actor.id,generation:peer.actor.generation,link,phase:'approach',started:time,phaseAt:time,route,waypoint:0};
        return {actorId:peer.actor.id,command:move(peer,route[0]??link.from)};
      }
    }
  }
}
