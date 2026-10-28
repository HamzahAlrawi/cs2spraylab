import fixture from './native-grenade-blast-fixture.json';
import {nativeUtilityWeaponField} from './native-utility-rules';
import type {DamageResult} from './damage';

export const NATIVE_HE=Object.freeze(fixture.constants);
const f=Math.fround;
function field(name:string) {
  const value=nativeUtilityWeaponField('he',name);
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Missing native HE field: ${name}`);
  return value;
}
export const nativeHEStats=Object.freeze({damage:field('m_nDamage'),radiusUnits:field('m_flRange'),armorRatio:field('m_flArmorRatio')});
/** Curve only: candidate selection, exposure and body-target sampling are separate. */
export function nativeHEBlastDamage(distanceUnits:number,exposure=1):number {
  if(!Number.isFinite(distanceUnits)||distanceUnits<0||!Number.isFinite(exposure))return 0;
  const distance=f(distanceUnits),sigma=f(nativeHEStats.radiusUnits/NATIVE_HE.sigmaDivisor);
  const exponent=f(f(-distance*distance)/f(f(sigma+sigma)*sigma));
  return f(f(f(Math.exp(exponent))*nativeHEStats.damage)*f(Math.max(0,Math.min(1,exposure))));
}
/** Ordinary eligible blast branch; unlike bullet armor, blast armor costs 1.0. */
export function nativeHEArmorDamage(raw:number,armor:number):DamageResult {
  if(!Number.isFinite(raw)||raw<=0)return{healthDamage:0,armorDamage:0};
  const damage=f(raw),available=Math.max(0,Math.trunc(Number.isFinite(armor)?armor:0));
  if(!available)return{healthDamage:damage,armorDamage:0};
  let health=f(damage*f(f(nativeHEStats.armorRatio)*.5));
  const cost=f(f(damage-health)*NATIVE_HE.blastArmorCost);
  if(cost>available){health=f(damage-f(available/NATIVE_HE.blastArmorCost));return{healthDamage:health,armorDamage:available};}
  return{healthDamage:health,armorDamage:Math.trunc(cost)};
}
