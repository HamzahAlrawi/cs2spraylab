import {clamp, STEP} from '../actor-physics';
import type {DuelActorSnapshot} from './types';

export function interpolateActors(previous: DuelActorSnapshot[], current: DuelActorSnapshot[], remainder: number) {
  const alpha = clamp(remainder / STEP, 0, 1);
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  return current.map((actor, index) => {
    const before = previous[index];
    if (!before || before.generation !== actor.generation || !actor.alive) return actor;
    const yawDelta = Math.atan2(Math.sin(actor.yaw - before.yaw), Math.cos(actor.yaw - before.yaw));
    return {...actor,
      position: {x: lerp(before.position.x, actor.position.x), y: lerp(before.position.y, actor.position.y),
        z: lerp(before.position.z, actor.position.z)},
      velocity: {x: lerp(before.velocity.x, actor.velocity.x), z: lerp(before.velocity.z, actor.velocity.z)},
      feet: lerp(before.feet, actor.feet), duckAmount: lerp(before.duckAmount, actor.duckAmount),
      yaw: before.yaw + yawDelta * alpha, pitch: lerp(before.pitch, actor.pitch)};
  });
}
