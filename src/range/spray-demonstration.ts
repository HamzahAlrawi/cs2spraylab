import * as THREE from 'three';
import { Angle, Weapon, weaponNames } from './config';
import { TARGET_Z } from './simulation';

export const GUIDE_COLORS = { now: '#55ffa4', next: '#ff75d7' };
const SIZE = 768;
export type PlotPoint = { x: number; y: number };
export type DemonstrationKind = 'impact' | 'mouse';
export function mouseCompensation(point: Angle, invertY = false): PlotPoint {
  return { x: -point.yaw, y: point.pitch * (invertY ? -1 : 1) };
}

export function layoutSprayPattern(pattern: readonly Angle[], kind: DemonstrationKind = 'impact', invertY = false): PlotPoint[] {
  if (!pattern.length) return [];
  // Fit each shape uniformly after applying its coordinate convention.
  const points = pattern.map(p => {
    if (kind === 'mouse') {
      // Mouse counts are proportional to angles, not perspective-projected impacts.
      const delta = mouseCompensation(p, invertY);
      return { x: delta.x * Math.PI / 180, y: delta.y * Math.PI / 180 };
    }
    return { x: Math.tan(p.yaw * Math.PI / 180), y: -Math.tan(p.pitch * Math.PI / 180) / Math.cos(p.yaw * Math.PI / 180) };
  });
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(560 / Math.max(maxX - minX, .001), 490 / Math.max(maxY - minY, .001));
  return points.map(p => ({ x: SIZE / 2 + (p.x - (minX + maxX) / 2) * scale, y: 380 + (p.y - (minY + maxY) / 2) * scale }));
}

export function sprayPlayback(time: number, count: number, cycle: number, reducedMotion = false) {
  if (!count) return { index: 0, fraction: 0 };
  if (reducedMotion) return { index: count - 1, fraction: 0 };
  const duration = Math.max(.01, cycle) * Math.max(1, count - 1);
  const progress = Math.max(0, time) % (duration + 1.5);
  const bullet = Math.min(count - 1, progress / Math.max(.01, cycle));
  return { index: Math.floor(bullet), fraction: bullet % 1 };
}

export class SprayDemonstration {
  canvas = document.createElement('canvas');
  base = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  points: PlotPoint[] = [];
  cycle = .1; start = 0; lastFrame = -1;
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = this.motionQuery.matches;
  motionChanged = () => { this.reducedMotion = this.motionQuery.matches; this.lastFrame = -1; };
  constructor(public kind: DemonstrationKind = 'impact') {
    this.canvas.width = this.canvas.height = this.base.width = this.base.height = SIZE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.5), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.name = `wall-${kind}-demonstration`;
    // In front of the backplate, but behind its physical bullet-mark offset.
    this.mesh.position.set(kind === 'impact' ? -5.25 : 5.25, 2.25, TARGET_Z - 1.47);
    this.motionQuery.addEventListener('change', this.motionChanged);
  }
  setPattern(weapon: Weapon, pattern: readonly Angle[], cycle: number, time: number, invertY = false) {
    this.points = layoutSprayPattern(pattern, this.kind, invertY); this.cycle = cycle; this.start = time; this.lastFrame = -1;
    const ctx = this.base.getContext('2d')!;
    ctx.fillStyle = '#192b2c'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = '#536d6a'; ctx.lineWidth = 3; ctx.strokeRect(12, 12, SIZE - 24, SIZE - 24);
    ctx.strokeStyle = '#304745'; ctx.lineWidth = 1;
    for (let x = 64; x < SIZE; x += 64) { ctx.beginPath(); ctx.moveTo(x, 110); ctx.lineTo(x, 650); ctx.stroke(); }
    for (let y = 138; y < 650; y += 64) { ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(718, y); ctx.stroke(); }
    ctx.fillStyle = '#f0f5ef'; ctx.textAlign = 'left'; ctx.font = 'bold 40px Arial'; ctx.fillText(weaponNames[weapon], 44, 68);
    ctx.textAlign = 'right'; ctx.font = '22px Arial'; ctx.fillStyle = '#b5c9c5'; ctx.fillText(this.kind === 'impact' ? 'IMPACT PATTERN' : 'MOUSE MOVEMENT', 724, 65);
    this.path(ctx, this.points.length - 1, '#768d89', 4);
    for (const p of this.points) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#a9bbb4'; ctx.fill(); }
    const first = this.points[0];
    if (first) { ctx.fillStyle = '#eef5ee'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center'; ctx.fillText('1', first.x, first.y + (first.y < 380 ? -20 : 34)); }
    ctx.fillStyle = '#b5c9c5'; ctx.textAlign = 'left'; ctx.font = '21px Arial'; ctx.fillText(this.kind === 'mouse' && invertY ? 'INVERTED Y / SHAPE PREVIEW' : 'SHAPE PREVIEW', 44, 720);
    this.update(time);
  }
  private path(ctx: CanvasRenderingContext2D, end: number, color: string, width: number) {
    if (!this.points.length) return;
    ctx.beginPath(); ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i <= end; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke();
  }
  update(time: number) {
    if (!this.mesh.visible || !this.points.length) return;
    const frame = this.reducedMotion ? 0 : Math.floor((time - this.start) * 20);
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    const { index, fraction } = sprayPlayback(time - this.start, this.points.length, this.cycle, this.reducedMotion);
    const ctx = this.canvas.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0); this.path(ctx, index, GUIDE_COLORS.now, 7);
    const p = this.points[index], next = this.points[Math.min(index + 1, this.points.length - 1)];
    const cursor = { x: p.x + (next.x - p.x) * fraction, y: p.y + (next.y - p.y) * fraction };
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cursor.x, cursor.y); ctx.strokeStyle = GUIDE_COLORS.now; ctx.lineWidth = 7; ctx.stroke();
    ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 12, 0, Math.PI * 2); ctx.fillStyle = GUIDE_COLORS.next; ctx.fill();
    ctx.strokeStyle = '#122322'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#f0f5ef'; ctx.textAlign = 'right'; ctx.font = 'bold 26px Arial'; ctx.fillText(`${index + 1} / ${this.points.length}`, 724, 721);
    this.texture.needsUpdate = true;
  }
  dispose() { this.motionQuery.removeEventListener('change', this.motionChanged); }
}
