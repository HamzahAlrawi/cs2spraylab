import type {Vec} from '../actor-physics';
import type {Arena} from './geometry';
import {observeBot} from './perception';
import type {DuelActorSnapshot} from './types';

export type RadarContact = {id: number; position: Vec; seenAt: number; dead: boolean};
export type RadarSettings = {radarEnabled: boolean; radarRotate: boolean; radarScale: number};
export const RADAR_MEMORY_SECONDS = 5;

export class RadarMemory {
  private contacts = new Map<number, RadarContact>();
  observe(now: number, self: DuelActorSnapshot, opponents: DuelActorSnapshot[], arena: Arena, aspect: number) {
    for (const opponent of opponents) {
      if (opponent.side === self.side || !opponent.alive) continue;
      if (observeBot(now, self, [opponent], arena, {aspect, verticalFov: 2 * Math.atan(.75)}).visible)
        this.contacts.set(opponent.id, {id: opponent.id, position: {...opponent.position}, seenAt: now, dead: false});
    }
    for (const [id, contact] of this.contacts) if (now - contact.seenAt >= RADAR_MEMORY_SECONDS) this.contacts.delete(id);
  }
  confirmDeath(id: number, now: number) {
    const contact = this.contacts.get(id);
    if (contact) this.contacts.set(id, {...contact, dead: true, seenAt: now - 3});
  }
  snapshot(now: number): RadarContact[] {
    return [...this.contacts.values()].filter(contact => now - contact.seenAt < RADAR_MEMORY_SECONDS)
      .map(contact => ({...contact, position: {...contact.position}}));
  }
  reset() {this.contacts.clear();}
}

export function radarPoint(point: Vec, player: Vec, yaw: number, rotate: boolean, scale: number,
  arena: Pick<Arena, 'minX' | 'maxX' | 'minZ' | 'maxZ'>, size: number) {
  const span = Math.max(arena.maxX - arena.minX, arena.maxZ - arena.minZ) / Math.max(.25, scale);
  const x = point.x - player.x, z = point.z - player.z;
  const cosine = rotate ? Math.cos(yaw) : 1, sine = rotate ? Math.sin(yaw) : 0;
  return {x: size / 2 + (x * cosine - z * sine) * size / span,
    y: size / 2 + (x * sine + z * cosine) * size / span};
}

export class DuelRadar {
  readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private readonly size = 144;
  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas'); this.canvas.className = 'duel-radar';
    this.canvas.setAttribute('aria-label', 'Radar: visible enemies and last known positions');
    this.canvas.width = this.canvas.height = this.size * 2;
    this.context = this.canvas.getContext('2d'); host.append(this.canvas);
  }
  update(player: DuelActorSnapshot, contacts: RadarContact[], now: number, arena: Arena, settings: RadarSettings) {
    this.canvas.hidden = !settings.radarEnabled;
    const ctx = this.context;
    if (!ctx || !settings.radarEnabled) return;
    const size = this.size;
    ctx.setTransform(2, 0, 0, 2, 0, 0);ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#152421df';ctx.fillRect(0, 0, size, size);
    ctx.save();ctx.beginPath();ctx.rect(1,1,size-2,size-2);ctx.clip();
    const project = (point: Vec) => radarPoint(point,player.position,player.yaw,settings.radarRotate,settings.radarScale,arena,size);
    ctx.fillStyle = '#a3b7ae';ctx.globalAlpha = .45;
    for(const solid of arena.solids) {
      if(solid.active===false||solid.passable)continue;
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => project({x: solid.center.x+x*solid.size.x/2,y:0,z:solid.center.z+z*solid.size.z/2}));
      ctx.beginPath();corners.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.closePath();ctx.fill();
    }
    ctx.globalAlpha = 1;
    for(const contact of contacts) {
      const point=project(contact.position),age=now-contact.seenAt;
      const x=Math.max(6,Math.min(size-6,point.x)),y=Math.max(6,Math.min(size-6,point.y));
      ctx.globalAlpha = contact.dead ? .4 : Math.max(.2,1-age/RADAR_MEMORY_SECONDS);
      ctx.fillStyle=age<.2?'#ff655e':'#d89687';ctx.strokeStyle='#f99987';
      if(contact.dead) {ctx.beginPath();ctx.moveTo(x-3,y-3);ctx.lineTo(x+3,y+3);ctx.moveTo(x+3,y-3);ctx.lineTo(x-3,y+3);ctx.stroke();}
      else {ctx.beginPath();ctx.arc(x,y,age<.2?4:3,0,Math.PI*2);ctx.fill();
        if(contact.position.y-player.position.y>.7) {ctx.beginPath();ctx.moveTo(x-3,y-7);ctx.lineTo(x,y-10);ctx.lineTo(x+3,y-7);ctx.stroke();}}
    }
    ctx.globalAlpha=1;ctx.translate(size/2,size/2);ctx.rotate(settings.radarRotate?0:-player.yaw);
    ctx.fillStyle='#90efd5';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,4);ctx.lineTo(0,2);ctx.lineTo(-4,4);ctx.closePath();ctx.fill();
    ctx.restore();ctx.strokeStyle='#afc7bc80';ctx.strokeRect(.5,.5,size-1,size-1);
  }
  dispose() {this.canvas.remove();}
}
