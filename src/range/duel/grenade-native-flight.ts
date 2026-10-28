import {UNIT,type Vec} from '../actor-physics';

// Installed build 2000935: docs/native-grenade-flight-findings.md.
export const NATIVE_GRENADE_FLIGHT=Object.freeze({gravity:Math.fround(800*Math.fround(.4)),elasticity:Math.fround(.45),
  maximumElasticity:Math.fround(.9),normalBias:.03125,stopSpeedSquared:400,highSpeedSquared:96000,
  floorNormal:Math.fround(.7),slowSlopeNormal:Math.fround(.1),timerInterval:Math.fround(.2),tickRate:64});
const f=Math.fround;
const nativeDot=(a:Vec,b:Vec)=>f(f(f(a.y*b.y)+f(a.z*b.z))+f(a.x*b.x));
export function clipNativeGrenadeVelocity(velocityUnits:Vec,normal:Vec) {
  normal={x:f(normal.x),y:f(normal.y),z:f(normal.z)};
  const v={x:f(velocityUnits.x),y:f(velocityUnits.y),z:f(velocityUnits.z)};
  const bias=f(Math.max(f(-nativeDot(v,normal)*2),0)+NATIVE_GRENADE_FLIGHT.normalBias);
  return{x:f(v.x+f(normal.x*bias)),y:f(v.y+f(normal.y*bias)),z:f(v.z+f(normal.z*bias))};
}
/** Ordinary static-world branch. Moving supports/breakables have additional native paths. */
export function nativeGrenadeContact(velocity:Vec,normal:Vec,supportEligible=true,elasticity=NATIVE_GRENADE_FLIGHT.elasticity) {
  normal={x:f(normal.x),y:f(normal.y),z:f(normal.z)};
  const rules=NATIVE_GRENADE_FLIGHT,e=Math.max(0,Math.min(rules.maximumElasticity,f(elasticity)));
  const clipped=clipNativeGrenadeVelocity({x:velocity.x/UNIT,y:velocity.y/UNIT,z:velocity.z/UNIT},normal);
  let out={x:f(clipped.x*e),y:f(clipped.y*e),z:f(clipped.z*e)};
  const speed2=nativeDot(out,out),support=supportEligible&&(normal.y>rules.floorNormal||normal.y>rules.slowSlopeNormal&&speed2<rules.stopSpeedSquared);
  if(support&&speed2>rules.highSpeedSquared) {
    const speed=f(Math.sqrt(speed2)),d=nativeDot({x:f(out.x/speed),y:f(out.y/speed),z:f(out.z/speed)},normal);
    if(d>.5){const factor=f(1.5-d);out={x:f(out.x*factor),y:f(out.y*factor),z:f(out.z*factor)};}
  }
  const resting=support&&speed2<rules.stopSpeedSquared;
  return{velocity:resting?{x:0,y:0,z:0}:{x:out.x*UNIT,y:out.y*UNIT,z:out.z*UNIT},resting};
}
export const nativeGrenadeThinkTick=(requestedTime:number)=>Math.trunc(f(f(f(requestedTime)*64)+.5));
export const nativeGrenadeNextThinkTick=(now:number)=>nativeGrenadeThinkTick(f(f(now)+NATIVE_GRENADE_FLIGHT.timerInterval));
