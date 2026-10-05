import {type Vec} from '../actor-physics';
import type {Arena} from './geometry';
import {traceSolid} from './geometry';
import type {DuelActorSnapshot} from './types';
import {observeShadows, pointInView, type EnemyShadowProxy, type SensorView, type ShadowCue} from './shadows';

export type VisibleEnemy = {id: number; aimPoint: Vec; bodyPoint?: Vec; position: Vec};
export type BotObservation = {time: number; self: DuelActorSnapshot; visible: VisibleEnemy | null;
  shadowCues?: readonly ShadowCue[]};

export const copyVisibleEnemy = (enemy: VisibleEnemy): VisibleEnemy => ({...enemy,
  position: {...enemy.position}, aimPoint: {...enemy.aimPoint},
  bodyPoint: enemy.bodyPoint ? {...enemy.bodyPoint} : undefined});

// Sight normally updates every four simulation ticks. A stalled sensor must
// not leave a live target (and permission to fire) cached indefinitely.
export const currentVisible = (observation: BotObservation | null, time: number) =>
  observation && time >= observation.time && time - observation.time <= .075 ? observation.visible : null;

export function observeBot(time: number, self: DuelActorSnapshot, opponents: DuelActorSnapshot[], arena: Arena,
  view?: SensorView, shadows: readonly EnemyShadowProxy[] = []): BotObservation {
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
      if (!pointInView(self, point, view)) continue;
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
  return shadows.length ? {time, self, visible, shadowCues: observeShadows(time, self, shadows, arena, view)}
    : {time, self, visible};
}
