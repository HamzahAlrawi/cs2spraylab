import {DEG, type Vec} from '../actor-physics';
import type {Arena} from './geometry';
import {traceSolid} from './geometry';
import type {DuelActorSnapshot} from './types';

export type VisibleEnemy = {id: number; aimPoint: Vec; bodyPoint?: Vec; position: Vec};
export type BotObservation = {time: number; self: DuelActorSnapshot; visible: VisibleEnemy | null};

const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function observeBot(time: number, self: DuelActorSnapshot, opponents: DuelActorSnapshot[], arena: Arena,
  view?: {aspect: number; verticalFov: number}): BotObservation {
  let visible: VisibleEnemy | null = null;
  let nearest = Infinity;
  for (const opponent of opponents) {
    if (!opponent.alive || opponent.side === self.side) continue;
    const feet = opponent.feet;
    const duck = opponent.duckAmount;
    const samples = [[0, 1.62 - .45 * duck], [-.21, 1.3 - .38 * duck],
      [.21, 1.3 - .38 * duck], [0, .9 - .35 * duck]];
    let firstPoint: Vec | null = null;
    let bodyPoint: Vec | undefined;
    for (const [sampleIndex, [offsetX, height]] of samples.entries()) {
      const point = {x: opponent.position.x + offsetX, y: feet + height, z: opponent.position.z};
      const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= nearest || distance < 1e-6) continue;
      const yaw = Math.atan2(-dx, -dz);
      if (view) {
        const sy = Math.sin(self.yaw), cy = Math.cos(self.yaw), sp = Math.sin(self.pitch), cp = Math.cos(self.pitch);
        const forward = -dx * sy * cp + dy * sp - dz * cy * cp;
        const right = dx * cy - dz * sy, up = dx * sy * sp + dy * cp + dz * cy * sp;
        const halfHeight = forward * Math.tan(view.verticalFov / 2);
        if (forward <= 0 || Math.abs(right) > halfHeight * view.aspect || Math.abs(up) > halfHeight) continue;
      } else if (Math.abs(angleDifference(yaw, self.yaw)) > 60 * DEG) continue;
      const direction = {x: dx / distance, y: dy / distance, z: dz / distance};
      if (traceSolid(self.position, direction, arena, distance - .01).distance < distance - .01) continue;
      if (!firstPoint) firstPoint = point;
      if (sampleIndex > 0 && !bodyPoint) bodyPoint = point;
    }
    if (firstPoint) {
      nearest = Math.hypot(firstPoint.x - self.position.x, firstPoint.z - self.position.z);
      visible = {id: opponent.id, aimPoint: firstPoint, bodyPoint, position: {...opponent.position}};
    }
  }
  return {time, self, visible};
}
