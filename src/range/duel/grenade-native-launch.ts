import fixture from './native-grenade-launch-fixture.json';
import {UNIT, DEG, type Vec} from '../actor-physics';
import {nativeUtilityWeaponField} from './native-utility-rules';
import type {UtilityKind} from './utility-loadout';

// Reproduced by tools/verify-native-grenades.py against the pinned installed client.
export const NATIVE_GRENADE_LAUNCH = Object.freeze(fixture.constants);
const f=Math.fround;
export const grenadeStrength=(value:number)=>Math.max(0,Math.min(1,value));
export function nativeGrenadePitch(pitchUp:number) {
  let pitch=f(-pitchUp/DEG);
  if(pitch>90)pitch=f(pitch-360);else if(pitch < -90)pitch=f(pitch+360);
  const lift=f(f(f(90-Math.abs(pitch))*10)/90);
  return -f(pitch-lift)*DEG;
}
export function nativeGrenadeSpeed(throwVelocity=750,strength=1) {
  const c=NATIVE_GRENADE_LAUNCH;
  const speed=Math.max(c.minimumSpeed,Math.min(c.maximumSpeed,f(f(throwVelocity)*c.velocityScale)));
  return f(f(f(grenadeStrength(strength))*c.strengthScale)+c.strengthBase)*speed;
}
export function nativeGrenadeVelocity(direction:Vec,strength:number,actorVelocity:Vec,throwVelocity=750):Vec {
  const speed=f(nativeGrenadeSpeed(throwVelocity,strength));
  const component=(axis:keyof Vec)=>f(f(f(direction[axis])*speed)+f(f(actorVelocity[axis]/UNIT)*NATIVE_GRENADE_LAUNCH.velocityInheritance))*UNIT;
  return {x:component('x'),y:component('y'),z:component('z')};
}
export function nativeGrenadeThrowVelocity(kind:UtilityKind) {
  const value=nativeUtilityWeaponField(kind,'m_flThrowVelocity');
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Missing extracted throw velocity: ${kind}`);
  return value;
}
