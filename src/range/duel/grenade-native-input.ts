import fixture from './native-grenade-input-fixture.json';

export const NATIVE_GRENADE_INPUT=Object.freeze(fixture.constants);
const f=Math.fround;
export function approachGrenadeStrength(current:number,target:number,seconds:number) {
  current=f(current);target=f(target);
  const step=f(NATIVE_GRENADE_INPUT.strengthStepPer64Tick*64*Math.max(0,seconds)),delta=f(target-current);
  return delta>step?f(current+step):delta < -step?f(current-step):target;
}
export function releasedGrenadeStrength(strength:number) {
  const value=f(Math.max(0,Math.min(1,strength))),middle=NATIVE_GRENADE_INPUT.middleStrength;
  return Math.abs(f(value-middle))<=NATIVE_GRENADE_INPUT.middleSnapTolerance?middle:value;
}
export const nativeGrenadeReleaseAt=(releasedAt:number)=>f(f(releasedAt)+NATIVE_GRENADE_INPUT.releaseDelay);
