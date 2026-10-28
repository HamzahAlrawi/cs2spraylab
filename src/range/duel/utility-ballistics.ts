import {type Vec} from '../actor-physics';
import {direction as aimDirection} from '../shot-model';
import {pointOnRay, type Arena} from './geometry';
import {sweepGrenadeHull} from './grenade-contact';
import {UTILITY_RULES} from './utilities';
import {UNIT} from '../actor-physics';
import {grenadeStrength,nativeGrenadePitch,NATIVE_GRENADE_LAUNCH} from './grenade-native-launch';

export function utilityLaunchPose(eye: Vec, yaw: number, pitch: number, arena: Arena, strength=1) {
  const c=NATIVE_GRENADE_LAUNCH,direction=aimDirection(yaw,nativeGrenadePitch(pitch));
  const source={...eye,y:eye.y+(grenadeStrength(strength)*c.strengthHeight-c.strengthHeight)*UNIT};
  const distance=c.forwardSweep*UNIT,radius=c.hullRadius*UNIT,to=pointOnRay(source,direction,distance);
  const sweep=sweepGrenadeHull(source,to,radius,arena);
  return{origin:sweep.startSolid?source:sweep.position,direction};
}

/** Solve against the same eye-to-release transform as player throws, not the camera origin. */
export function solveUtilityThrow(eye: Vec, target: Vec, arena: Arena, high = false) {
  const yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  let pitch = 0;
  for (let iteration = 0; iteration < 4; iteration++) {
    const {origin} = utilityLaunchPose(eye, yaw, pitch, arena);
    const d = Math.hypot(target.x - origin.x, target.z - origin.z), dy = target.y - origin.y;
    const speed2 = UTILITY_RULES.throwSpeed ** 2, g = UTILITY_RULES.gravity;
    const discriminant = speed2 * speed2 - g * (g * d * d + 2 * dy * speed2);
    if (d < .1 || discriminant < 0 || !Number.isFinite(discriminant)) return;
    const launch = Math.atan((speed2 + (high ? 1 : -1) * Math.sqrt(discriminant)) / (g * d));
    pitch = (launch - Math.PI / 18) / (launch >= Math.PI / 18 ? 8 / 9 : 10 / 9);
  }
  if (Math.abs(pitch) > 89 * Math.PI / 180) return;
  return {yaw, pitch, ...utilityLaunchPose(eye, yaw, pitch, arena)};
}
