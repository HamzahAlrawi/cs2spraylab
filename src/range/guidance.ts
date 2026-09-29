import {DEG, type Vec} from './actor-physics';
import {HEAD_HEIGHT, angleTo} from './drills';
import type {RecoilAngle} from './recoil';
import {recoilView} from './view-recoil';

// A centered crosshair follows the rendered view, not the unrecoiled input ray.
// Invert the physical shot first, then apply the same view transform as rendering.
export function guidanceAngles(origin: Vec, target: Vec, recoil: RecoilAngle, displayed: RecoilAngle = recoil, follow = false) {
  const head = angleTo(origin, {...target, y: target.y + HEAD_HEIGHT});
  if (follow) return {yaw: head.yaw + (recoil.yaw - displayed.yaw) * DEG,
    pitch: head.pitch - (recoil.pitch - displayed.pitch) * DEG};
  return recoilView(head.yaw + recoil.yaw * DEG, head.pitch - recoil.pitch * DEG, displayed);
}
