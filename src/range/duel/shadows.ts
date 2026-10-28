import {DEG, type Vec} from '../actor-physics';
import {scopeVerticalFov} from '../weapon-actions';
import {traceSolid, type Arena} from './geometry';
import type {DuelActorSnapshot} from './types';

// World-space samples of the rendered shadow surface, not its caster's pose.
export type EnemyShadowProxy = {
  id: string;
  side: DuelActorSnapshot['side'];
  samples: readonly Vec[];
  contrast: number;
};
export type ShadowCue = {id: string; point: Vec; observedAt: number; uncertainty: number};
export type SensorView = {aspect: number; verticalFov: number};
export type VisibilityFilter = (from: Vec, to: Vec) => boolean;

// A fixed human-screen aspect, never the visitor's browser dimensions. The FOV
// input is the weapon action state's 4:3-reference horizontal FOV in degrees.
export function botSensorView(horizontalFov = 90): SensorView {
  return {aspect: 16 / 9, verticalFov: scopeVerticalFov(horizontalFov) * DEG};
}
export const validSensorView = (view: SensorView) => Number.isFinite(view.aspect) && view.aspect > 0 &&
  Number.isFinite(view.verticalFov) && view.verticalFov > 0 && view.verticalFov < Math.PI;

export function pointInView(self: Pick<DuelActorSnapshot, 'position' | 'yaw' | 'pitch'>, point: Vec, view?: SensorView) {
  const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
  if (![dx, dy, dz, self.yaw, self.pitch].every(Number.isFinite)) return false;
  if (view) {
    if (!validSensorView(view)) return false;
    const sy = Math.sin(self.yaw), cy = Math.cos(self.yaw), sp = Math.sin(self.pitch), cp = Math.cos(self.pitch);
    const forward = -dx * sy * cp + dy * sp - dz * cy * cp;
    const right = dx * cy - dz * sy, up = dx * sy * sp + dy * cp + dz * cy * sp;
    const height = forward * Math.tan(view.verticalFov / 2);
    return forward > 0 && Math.abs(right) <= height * view.aspect && Math.abs(up) <= height;
  }
  const yaw = Math.atan2(-dx, -dz);
  return Math.abs(Math.atan2(Math.sin(yaw - self.yaw), Math.cos(yaw - self.yaw))) <= 60 * DEG;
}

export function observeShadows(time: number, self: DuelActorSnapshot, proxies: readonly EnemyShadowProxy[],
  arena: Arena, view?: SensorView, visibilityFilter?: VisibilityFilter): ShadowCue[] {
  const cues: ShadowCue[] = [];
  for (const proxy of proxies.slice(0, 24)) {
    if (proxy.side === self.side || !Number.isFinite(proxy.contrast) || proxy.contrast < .18) continue;
    for (const point of proxy.samples.slice(0, 12)) {
      if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
      const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
      const length = Math.hypot(dx, dy, dz);
      if (length < .1 || length > 35 || !pointInView(self, point,
        view ?? {aspect: 16 / 9, verticalFov: 75 * DEG}) ||
        visibilityFilter && !visibilityFilter(self.position, point)) continue;
      if (Number.isFinite(traceSolid(self.position, {x: dx / length, y: dy / length, z: dz / length},
        arena, length - .02).distance)) continue;
      cues.push({id: proxy.id, point: {...point}, observedAt: time, uncertainty: 1 + length * .035});
      break;
    }
  }
  return cues;
}
