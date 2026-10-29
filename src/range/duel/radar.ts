import type {Vec} from '../actor-physics';
import type {Arena} from './geometry';
import {observeBot, type VisibleEnemy} from './perception';
import type {DuelActorSnapshot} from './types';
import {Mesh, Vector3, type Object3D} from 'three';
import {projectRadarPoint, radarBearing, radarContactStyle, radarHeading, radarPixelsPerMetre,
  RADAR_MEMORY_SECONDS, RADAR_SIZE} from './radar-projection';

export type RadarContact = {id: number; position: Vec; seenAt: number; dead: boolean};
export type RadarSettings = {radarEnabled: boolean; radarRotate: boolean; radarScale: number};
export {RADAR_MEMORY_SECONDS} from './radar-projection';
export type RadarBounds = Pick<Arena, 'minX' | 'maxX' | 'minZ' | 'maxZ'>;
export type RadarOverview = {image: CanvasImageSource; bounds: RadarBounds;
  source?: {x: number; y: number; width: number; height: number}};
const mapSpan = (arena: RadarBounds) => Math.max(1, arena.maxX - arena.minX, arena.maxZ - arena.minZ);

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
    if (contact && !contact.dead && now >= contact.seenAt && now-contact.seenAt < RADAR_MEMORY_SECONDS)
      this.contacts.set(id, {...contact, dead: true, seenAt: now - 3});
  }
  snapshot(now: number): RadarContact[] {
    return [...this.contacts.values()].filter(contact => now >= contact.seenAt && now - contact.seenAt < RADAR_MEMORY_SECONDS)
      .map(contact => ({...contact, position: {...contact.position}}));
  }
  reset() {this.contacts.clear();}
}

export function radarPoint(point: Vec, player: Vec, yaw: number, rotate: boolean, scale: number,
  _arena: RadarBounds, size: number) {
  return projectRadarPoint(point, player, yaw, rotate, scale, size);
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
  private readonly size = RADAR_SIZE;
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
      canvas = document.createElement('canvas');canvas.width = canvas.height = 1024;
      const context = canvas.getContext('2d');
      if (context) drawNativeRadarMap(context,root,arena,level,1024);
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
    ctx.globalAlpha = 1;ctx.lineWidth = 2;
    ctx.beginPath();ctx.arc(size/2,size/2,size/2-2,0,Math.PI*2);
    ctx.fillStyle = '#11191ff2';ctx.fill();ctx.strokeStyle = '#d9e3e9b3';ctx.stroke();
    ctx.save();ctx.beginPath();ctx.arc(size/2,size/2,size/2-4,0,Math.PI*2);ctx.clip();
    const project = (point: Vec) => radarPoint(point,player.position,player.yaw,settings.radarRotate,settings.radarScale,arena,size);
    const pixels = radarPixelsPerMetre(settings.radarScale,size);
    ctx.save();ctx.translate(size/2,size/2);ctx.rotate(settings.radarRotate ? player.yaw : 0);
    ctx.scale(pixels,pixels);ctx.translate(-player.position.x,-player.position.z);
    if (arena.native && nativeMap) {
      const overview:RadarOverview = 'image' in nativeMap ? nativeMap : this.nativeMap(arena,nativeMap,player.feet);
      const bounds = overview.bounds;
      // The overview bounds describe its texels, not the playable chunk. Do not
      // distort it or discard surrounding map context at the chunk boundary.
      ctx.save();ctx.imageSmoothingEnabled = true;ctx.imageSmoothingQuality = 'high';
      ctx.filter = 'brightness(1.45) saturate(.65)';
      const source=overview.source;
      if(source)ctx.drawImage(overview.image,source.x,source.y,source.width,source.height,
        bounds.minX,bounds.minZ,bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ);
      else ctx.drawImage(overview.image,bounds.minX,bounds.minZ,bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ);
      ctx.restore();
    } else if (!arena.native) {
      ctx.fillStyle = '#54616c';ctx.fillRect(arena.minX,arena.minZ,arena.maxX-arena.minX,arena.maxZ-arena.minZ);
      ctx.strokeStyle = '#b4c3cc';ctx.lineWidth = 1.5/pixels;
      ctx.strokeRect(arena.minX,arena.minZ,arena.maxX-arena.minX,arena.maxZ-arena.minZ);
    }
    ctx.restore();
    ctx.fillStyle = '#26313a';ctx.strokeStyle = '#ced8df';ctx.lineWidth = 1.25;
    // Native imagery already includes geometry. Procedural solids are map
    // features only; no lanes, bot anchors, or actor scene objects are drawn.
    for(const solid of arena.native ? [] : arena.solids) {
      if(solid.active===false||solid.passable)continue;
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => project({x: solid.center.x+x*solid.size.x/2,y:0,z:solid.center.z+z*solid.size.z/2}));
      ctx.beginPath();corners.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.closePath();ctx.fill();ctx.stroke();
    }
    ctx.save();ctx.translate(size/2,size/2);ctx.rotate(radarHeading(player.yaw,settings.radarRotate));
    ctx.globalAlpha = .18;ctx.fillStyle = '#a9ddff';ctx.beginPath();ctx.moveTo(0,0);
    ctx.arc(0,0,48,-Math.PI/2-Math.PI/4,-Math.PI/2+Math.PI/4);ctx.closePath();ctx.fill();ctx.restore();
    ctx.globalAlpha = 1;
    for(const contact of contacts) {
      const point=project(contact.position),style=radarContactStyle(contact.seenAt,now,contact.dead,contact.position.y-player.position.y);
      if (!style || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const {x,y,offscreen,angle}=radarBearing(point,size,style.height?19:14);
      ctx.globalAlpha = style.alpha;ctx.lineWidth = 2;
      ctx.fillStyle=style.fresh?'#ff655a':'#ffc49e';ctx.strokeStyle=ctx.fillStyle;
      if(contact.dead) {ctx.beginPath();ctx.moveTo(x-4,y-4);ctx.lineTo(x+4,y+4);ctx.moveTo(x+4,y-4);ctx.lineTo(x-4,y+4);ctx.stroke();}
      else {
        if(offscreen) {
          ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.beginPath();
          ctx.moveTo(5,0);ctx.lineTo(-4,-4);ctx.lineTo(-4,4);ctx.closePath();
          if(style.fresh)ctx.fill();else ctx.stroke();ctx.restore();
        } else {
          ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);
          if(style.fresh)ctx.fill();else ctx.stroke();
        }
        if(style.height) {const dy=style.height>0?-1:1;
          ctx.beginPath();ctx.moveTo(x-3,y+dy*8);ctx.lineTo(x,y+dy*11);ctx.lineTo(x+3,y+dy*8);ctx.stroke();}
      }
    }
    ctx.globalAlpha=1;ctx.translate(size/2,size/2);ctx.rotate(radarHeading(player.yaw,settings.radarRotate));
    ctx.fillStyle='#f1faff';ctx.strokeStyle='#111c26';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,6);ctx.lineTo(0,3);ctx.lineTo(-6,6);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.restore();
  }
  dispose() {this.nativeMaps = new WeakMap();this.canvas.remove();}
}
