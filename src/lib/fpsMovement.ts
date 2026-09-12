import { RecoilPoint } from '../types';

export const REFERENCE_TARGET_DISTANCE = 10.25;
const WALL_PATTERN_VISUAL_MULTIPLIER = 1.62;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Camera local forward projected to the X/Z plane.
 * Three.js cameras look down local -Z, so yaw sign must be inverted here.
 */
export function cameraForwardFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Camera local right projected to the X/Z plane. */
export function cameraRightFromYaw(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/**
 * Wall-space pattern size is angular: a spray deflects by an angle, so the
 * physical mark painted on a wall grows with distance. After perspective
 * projection, the guide should appear roughly the same size on screen whether
 * the player is close or far.
 */
export function distanceBasedPatternScale(distance: number, referenceDistance = REFERENCE_TARGET_DISTANCE): number {
  const safeDistance = Number.isFinite(distance) ? distance : referenceDistance;
  const ratio = safeDistance / referenceDistance;
  return clamp(ratio * WALL_PATTERN_VISUAL_MULTIPLIER, 0.78, 2.35);
}

export function scaleRecoilPattern(pattern: RecoilPoint[], scale: number): RecoilPoint[] {
  return pattern.map((point) => ({ ...point, x: point.x * scale, y: point.y * scale }));
}

export function spawnZForDistance(distance: 'close' | 'mid' | 'long'): number {
  switch (distance) {
    case 'close': return -2.25;
    case 'long': return 3.7;
    case 'mid':
    default: return 0.4;
  }
}
