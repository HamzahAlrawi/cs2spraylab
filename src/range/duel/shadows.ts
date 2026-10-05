import {DEG, type Vec} from '../actor-physics';
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

export function pointInView(self: DuelActorSnapshot, point: Vec, view?: SensorView) {
  const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
  if (view) {
    const sy = Math.sin(self.yaw), cy = Math.cos(self.yaw), sp = Math.sin(self.pitch), cp = Math.cos(self.pitch);
    const forward = -dx * sy * cp + dy * sp - dz * cy * cp;
    const right = dx * cy - dz * sy, up = dx * sy * sp + dy * cp + dz * cy * sp;
    const height = forward * Math.tan(view.verticalFov / 2);
    return forward > 0 && view.aspect > 0 && view.verticalFov > 0 && view.verticalFov < Math.PI &&
      Math.abs(right) <= height * view.aspect && Math.abs(up) <= height;
  }
  const yaw = Math.atan2(-dx, -dz);
  return Math.abs(Math.atan2(Math.sin(yaw - self.yaw), Math.cos(yaw - self.yaw))) <= 60 * DEG;
}

export function observeShadows(time: number, self: DuelActorSnapshot, proxies: readonly EnemyShadowProxy[],
  arena: Arena, view?: SensorView): ShadowCue[] {
  const cues: ShadowCue[] = [];
  for (const proxy of proxies.slice(0, 24)) {
    if (proxy.side === self.side || !Number.isFinite(proxy.contrast) || proxy.contrast < .18) continue;
    for (const point of proxy.samples.slice(0, 12)) {
      if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
      const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
      const length = Math.hypot(dx, dy, dz);
      if (length < .1 || length > 35 || !pointInView(self, point,
        view ?? {aspect: 16 / 9, verticalFov: 75 * DEG})) continue;
      if (Number.isFinite(traceSolid(self.position, {x: dx / length, y: dy / length, z: dz / length},
        arena, length - .02).distance)) continue;
      cues.push({id: proxy.id, point: {...point}, observedAt: time, uncertainty: 1 + length * .035});
      break;
    }
  }
  return cues;
}
