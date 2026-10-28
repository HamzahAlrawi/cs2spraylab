import type {Vec} from '../actor-physics';
import type {Arena} from './geometry';
import {observeBot, type VisibleEnemy} from './perception';
import type {DuelActorSnapshot} from './types';
import {Mesh, Vector3, type Object3D} from 'three';

export type RadarContact = {id: number; position: Vec; seenAt: number; dead: boolean};
export type RadarSettings = {radarEnabled: boolean; radarRotate: boolean; radarScale: number};
export const RADAR_MEMORY_SECONDS = 5;
export type RadarBounds = Pick<Arena, 'minX' | 'maxX' | 'minZ' | 'maxZ'>;
export type RadarOverview = {image: CanvasImageSource; bounds: RadarBounds;
  source?: {x: number; y: number; width: number; height: number}};
const mapSpan = (arena: RadarBounds) => Math.max(1, arena.maxX - arena.minX, arena.maxZ - arena.minZ);
const radarZoom = (scale: number) => Number.isFinite(scale) ? Math.max(.25, Math.min(1, scale)) : .7;

function clipFloor(polygon: readonly Vec[], height: number, above: boolean): Vec[] {
  const clipped: Vec[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const from = polygon[i], to = polygon[(i+1)%polygon.length];
    const inside = above ? from.y >= height : from.y <= height;
    if (inside) clipped.push(from);
    if (inside === (above ? to.y >= height : to.y <= height)) continue;
    const t = (height-from.y)/(to.y-from.y);
    clipped.push({x:from.x+(to.x-from.x)*t,y:height,z:from.z+(to.z-from.z)*t});
  }
  return clipped;
}

export class RadarMemory {
  private contacts = new Map<number, RadarContact>();
  observe(now: number, self: DuelActorSnapshot, opponents: DuelActorSnapshot[], arena: Arena, aspect: number) {
    const visible: VisibleEnemy[] = [];
    for (const opponent of opponents) {
      if (opponent.side === self.side || !opponent.alive) continue;
      const contact = observeBot(now, self, [opponent], arena, {aspect, verticalFov: 2 * Math.atan(.75)}).visible;
      if (contact) visible.push(contact);
    }
    this.observeVisible(now,visible);
  }
  observeVisible(now: number, visible: readonly VisibleEnemy[]) {
    for (const contact of visible) this.contacts.set(contact.id,
      {id: contact.id, position: {...contact.position}, seenAt: now, dead: false});
    for (const [id, contact] of this.contacts) if (now - contact.seenAt >= RADAR_MEMORY_SECONDS) this.contacts.delete(id);
  }
  confirmDeath(id: number, now: number) {
    const contact = this.contacts.get(id);
    if (contact) this.contacts.set(id, {...contact, dead: true, seenAt: now - 3});
  }
  snapshot(now: number): RadarContact[] {
    return [...this.contacts.values()].filter(contact => now >= contact.seenAt && now - contact.seenAt < RADAR_MEMORY_SECONDS)
      .map(contact => ({...contact, position: {...contact.position}}));
  }
  reset() {this.contacts.clear();}
}

export function radarPoint(point: Vec, player: Vec, yaw: number, rotate: boolean, scale: number,
  arena: RadarBounds, size: number) {
  const span = mapSpan(arena) / radarZoom(scale);
  const x = point.x - player.x, z = point.z - player.z;
  const cosine = rotate ? Math.cos(yaw) : 1, sine = rotate ? Math.sin(yaw) : 0;
  return {x: size / 2 + (x * cosine - z * sine) * size / span,
    y: size / 2 + (x * sine + z * cosine) * size / span};
}

// Read only the static scenario map, never the engine scene containing actors.
// Slice walls at body height so roofs do not obscure tunnels and doorways.
export function drawNativeRadarMap(ctx: CanvasRenderingContext2D, root: Object3D, bounds: RadarBounds,
  feet: number, size: number) {
  const pixels = size / mapSpan(bounds), a = new Vector3(), b = new Vector3(), c = new Vector3();
  const wall: number[] = [], slice = feet + 1;
  const px = (x: number) => (x - bounds.minX) * pixels;
  const pz = (z: number) => (z - bounds.minZ) * pixels;
  root.updateWorldMatrix(true, true);
  ctx.save();ctx.beginPath();
  ctx.rect(0, 0, (bounds.maxX - bounds.minX) * pixels, (bounds.maxZ - bounds.minZ) * pixels);ctx.clip();
  ctx.fillStyle = '#536d63';ctx.beginPath();
  root.traverse(object => {
    if (!(object instanceof Mesh) || 'isSkinnedMesh' in object || 'isInstancedMesh' in object) return;
    const geometry = object.geometry, positions = geometry.getAttribute('position'), indices = geometry.index;
    if (!positions) return;
    const end = Math.min(indices?.count ?? positions.count, geometry.drawRange.start + geometry.drawRange.count);
    for (let i = geometry.drawRange.start; i + 2 < end; i += 3) {
      a.fromBufferAttribute(positions, indices ? indices.getX(i) : i).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2).applyMatrix4(object.matrixWorld);
      if (Math.max(a.x,b.x,c.x) < bounds.minX || Math.min(a.x,b.x,c.x) > bounds.maxX ||
        Math.max(a.z,b.z,c.z) < bounds.minZ || Math.min(a.z,b.z,c.z) > bounds.maxZ) continue;
      const low = Math.min(a.y,b.y,c.y), high = Math.max(a.y,b.y,c.y);
      const abx = b.x-a.x, aby = b.y-a.y, abz = b.z-a.z, acx = c.x-a.x, acy = c.y-a.y, acz = c.z-a.z;
      const nx = aby*acz-abz*acy, ny = abz*acx-abx*acz, nz = abx*acy-aby*acx;
      const length = Math.hypot(nx,ny,nz);
      if (!length) continue;
      if (ny/length >= .7) {
        if (high < feet-3 || low > feet+.65) continue;
        if (low >= feet-3 && high <= feet+.65) {
          ctx.moveTo(px(a.x),pz(a.z));ctx.lineTo(px(b.x),pz(b.z));ctx.lineTo(px(c.x),pz(c.z));
        } else {
          const polygon = clipFloor(clipFloor([a,b,c],feet-3,true),feet+.65,false);
          polygon.forEach((p,index)=>index ? ctx.lineTo(px(p.x),pz(p.z)) : ctx.moveTo(px(p.x),pz(p.z)));
        }
        ctx.closePath();
      } else if (Math.abs(ny)/length < .7 && low <= slice && high > slice) {
        // A half-open slice avoids double-counting vertices on the plane.
        for (const [from,to] of [[a,b],[b,c],[c,a]]) {
          if ((from.y <= slice) === (to.y <= slice)) continue;
          const t = (slice-from.y)/(to.y-from.y);
          wall.push(px(from.x+(to.x-from.x)*t),pz(from.z+(to.z-from.z)*t));
        }
      }
    }
  });
  ctx.fill();ctx.strokeStyle = '#afc7bc';ctx.lineWidth = 3;ctx.beginPath();
  for (let i = 0; i + 3 < wall.length; i += 4) {ctx.moveTo(wall[i],wall[i+1]);ctx.lineTo(wall[i+2],wall[i+3]);}
  ctx.stroke();ctx.restore();
}

export class DuelRadar {
  readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private readonly size = 144;
  private nativeMaps = new WeakMap<object, {root: Object3D; bounds: string; layers: Map<number, HTMLCanvasElement>}>();
  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas'); this.canvas.className = 'duel-radar';
    this.canvas.setAttribute('aria-label', 'Radar: visible enemies and last known positions');
    this.canvas.width = this.canvas.height = this.size * 2;
    this.context = this.canvas.getContext('2d'); host.append(this.canvas);
  }
  private nativeMap(arena: Arena, root: Object3D, feet: number) {
    const key = arena.native!, bounds = [arena.minX,arena.maxX,arena.minZ,arena.maxZ].join(':');
    let cached = this.nativeMaps.get(key);
    if (!cached || cached.root !== root || cached.bounds !== bounds) {
      cached = {root,bounds,layers:new Map()};this.nativeMaps.set(key,cached);
    }
    const level = Math.round(feet);
    let canvas = cached.layers.get(level);
    if (!canvas) {
      canvas = document.createElement('canvas');canvas.width = canvas.height = 512;
      const context = canvas.getContext('2d');
      if (context) drawNativeRadarMap(context,root,arena,level,512);
      if (cached.layers.size >= 4) cached.layers.delete(cached.layers.keys().next().value!);
      cached.layers.set(level,canvas);
    }
    const span = mapSpan(arena);
    return {image:canvas,bounds:{minX:arena.minX,maxX:arena.minX+span,minZ:arena.minZ,maxZ:arena.minZ+span}};
  }
  // Prefer a loaded/baked overview. A static scenario root is a cached fallback;
  // neither source includes bot poses, holding lanes, or native physics queries.
  update(player: DuelActorSnapshot, contacts: readonly RadarContact[], now: number, arena: Arena, settings: RadarSettings,
    nativeMap?: Object3D | RadarOverview) {
    this.canvas.hidden = !settings.radarEnabled;
    const ctx = this.context;
    if (!ctx || !settings.radarEnabled) return;
    const size = this.size;
    ctx.setTransform(2, 0, 0, 2, 0, 0);ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#152421df';ctx.fillRect(0, 0, size, size);
    ctx.save();ctx.beginPath();ctx.rect(1,1,size-2,size-2);ctx.clip();
    const project = (point: Vec) => radarPoint(point,player.position,player.yaw,settings.radarRotate,settings.radarScale,arena,size);
    const pixels = size * radarZoom(settings.radarScale) / mapSpan(arena);
    ctx.save();ctx.translate(size/2,size/2);ctx.rotate(settings.radarRotate ? player.yaw : 0);
    ctx.scale(pixels,pixels);ctx.translate(-player.position.x,-player.position.z);
    if (arena.native && nativeMap) {
      const overview:RadarOverview = 'image' in nativeMap ? nativeMap : this.nativeMap(arena,nativeMap,player.feet);
      const bounds = overview.bounds;
      ctx.save();ctx.beginPath();ctx.rect(arena.minX,arena.minZ,arena.maxX-arena.minX,arena.maxZ-arena.minZ);ctx.clip();
      const source=overview.source;
      if(source)ctx.drawImage(overview.image,source.x,source.y,source.width,source.height,
        bounds.minX,bounds.minZ,bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ);
      else ctx.drawImage(overview.image,bounds.minX,bounds.minZ,bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ);
      ctx.restore();
    }
    ctx.strokeStyle = '#afc7bc80';ctx.lineWidth = 1/pixels;
    ctx.strokeRect(arena.minX,arena.minZ,arena.maxX-arena.minX,arena.maxZ-arena.minZ);ctx.restore();
    ctx.fillStyle = '#a3b7ae';ctx.globalAlpha = .45;
    for(const solid of arena.solids) {
      if(solid.active===false||solid.passable)continue;
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => project({x: solid.center.x+x*solid.size.x/2,y:0,z:solid.center.z+z*solid.size.z/2}));
      ctx.beginPath();corners.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.closePath();ctx.fill();
    }
    ctx.globalAlpha = 1;
    for(const contact of contacts) {
      const point=project(contact.position),age=now-contact.seenAt;
      if (age < 0 || age >= RADAR_MEMORY_SECONDS || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const elevated = !contact.dead && contact.position.y-player.position.y>.7;
      // Intersect the center-to-contact ray with the inset viewport. Clamping
      // axes separately changes bearings, especially near native chunk edges.
      const dx=point.x-size/2,dy=point.y-size/2,inset=elevated?12:6;
      const fit=Math.min(1,(size/2-inset)/Math.max(Math.abs(dx),Math.abs(dy)));
      const x=size/2+dx*fit,y=size/2+dy*fit;
      ctx.globalAlpha = contact.dead ? .4 : Math.max(.2,1-age/RADAR_MEMORY_SECONDS);
      ctx.fillStyle=age<.2?'#ff655e':'#d89687';ctx.strokeStyle='#f99987';
      if(contact.dead) {ctx.beginPath();ctx.moveTo(x-3,y-3);ctx.lineTo(x+3,y+3);ctx.moveTo(x+3,y-3);ctx.lineTo(x-3,y+3);ctx.stroke();}
      else {ctx.beginPath();ctx.arc(x,y,age<.2?4:3,0,Math.PI*2);ctx.fill();
        if(elevated) {ctx.beginPath();ctx.moveTo(x-3,y-7);ctx.lineTo(x,y-10);ctx.lineTo(x+3,y-7);ctx.stroke();}}
    }
    ctx.globalAlpha=1;ctx.translate(size/2,size/2);ctx.rotate(settings.radarRotate?0:-player.yaw);
    ctx.fillStyle='#90efd5';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,4);ctx.lineTo(0,2);ctx.lineTo(-4,4);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#102a23';ctx.lineWidth=1.5;ctx.stroke();
    ctx.restore();ctx.strokeStyle='#afc7bc80';ctx.strokeRect(.5,.5,size-1,size-1);
  }
  dispose() {this.nativeMaps = new WeakMap();this.canvas.remove();}
}
