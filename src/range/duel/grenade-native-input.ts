// Keep offline execution fixtures out of the runtime bundle.
export const NATIVE_GRENADE_INPUT=Object.freeze({strengthStepPer64Tick: Math.fround(.0203125),
  releaseDelay: Math.fround(.1), middleStrength: .5, middleSnapTolerance: Math.fround(.1)});
// Arithmetic fixture remains pinned to 2000935. Static re-audit of 2000938 client
// 08a741030c1e569d8b854c5886a87fcafc21d0d0e2f05dfd380e8a351171501d:
// slot 403 -> 0x7d7de0; masks 1/0x800 at 0x7d7ec8..0x7d7f18.
// Undefined means neither button is held, not the valid right-only strength zero.
export function heldGrenadeStrength(primary: boolean, secondary: boolean): number | undefined {
  return primary ? secondary ? .5 : 1 : secondary ? 0 : undefined;
}
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
