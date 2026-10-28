import * as THREE from 'three';
import {UNIT, type Vec} from '../actor-physics';

export type DeathCameraClip = (from: Vec, to: Vec) => Vec;

/** Prefer behind the victim, but orbit around cover instead of filling the view
 * with the wall the victim was holding. The callback must include camera skin. */
export function deathCameraGoal(focus: Vec, yaw: number, clip: DeathCameraClip, target = new THREE.Vector3()) {
  const distance = 76 * UNIT;
  let best = -Infinity;
  for (const offset of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const angle = yaw + offset;
    const desired = {x: focus.x + Math.sin(angle) * distance, y: focus.y + .55, z: focus.z + Math.cos(angle) * distance};
    const candidate = clip(focus, desired);
    const clearance = Math.hypot(candidate.x - focus.x, candidate.y - focus.y, candidate.z - focus.z);
    const score = clearance - Math.abs(offset) * .12;
    if (score > best) {best = score; target.copy(candidate);}
    if (!offset && clearance > distance * .9) break;
  }
  return target;
}
