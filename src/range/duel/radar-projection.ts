import type {Vec} from '../actor-physics';

export const RADAR_SIZE = 216;
export const RADAR_MEMORY_SECONDS = 5;
export const RADAR_HEIGHT_THRESHOLD = 1.25;
// Presentation range, not a claim about the native HUD's dynamic zoom rules.
export const RADAR_DEFAULT_SPAN_METRES = 48;
export const radarZoom = (scale: number) => Number.isFinite(scale) ? Math.max(.25, Math.min(1, scale)) : .7;
export const radarSpan = (scale: number) => RADAR_DEFAULT_SPAN_METRES * .7 / radarZoom(scale);
export const radarPixelsPerMetre = (scale: number, size: number) => size / radarSpan(scale);
export const radarHeading = (yaw: number, rotate: boolean) => rotate ? 0 : -yaw;

export function projectRadarPoint(point: Vec, player: Vec, yaw: number, rotate: boolean, scale: number, size: number) {
  const x = point.x - player.x, z = point.z - player.z;
  const cosine = rotate ? Math.cos(yaw) : 1, sine = rotate ? Math.sin(yaw) : 0;
  const pixels = radarPixelsPerMetre(scale, size);
  return {x: size / 2 + (x * cosine - z * sine) * pixels,
    y: size / 2 + (x * sine + z * cosine) * pixels};
}

export function radarBearing(point: {x: number; y: number}, size: number, inset = 14) {
  const dx = point.x-size/2, dy = point.y-size/2, distance = Math.hypot(dx, dy);
  const radius = Math.max(0, size/2-inset), fit = distance > radius ? radius/distance : 1;
  return {x: size/2+dx*fit, y: size/2+dy*fit, offscreen: distance > radius,
    angle: Math.atan2(dy, dx)};
}

export function radarContactStyle(seenAt: number, now: number, dead: boolean, heightDelta: number) {
  const age = now-seenAt;
  if (!Number.isFinite(age) || age < 0 || age >= RADAR_MEMORY_SECONDS || !Number.isFinite(heightDelta)) return;
  return {fresh: !dead && age < .25, alpha: dead ? .55 : Math.max(.25, 1-age/RADAR_MEMORY_SECONDS),
    height: dead || Math.abs(heightDelta) <= RADAR_HEIGHT_THRESHOLD ? 0 : Math.sign(heightDelta)};
}
