import {clamp,STEP,type Vec} from '../actor-physics';
export type ShotSampleState={position:Vec;velocity:{x:number;z:number};yaw:number;pitch:number;feet:number;duckAmount?:number;
  grounded?:boolean;verticalVelocity?:number;landedAt?:number};
/** Sample the bounded authoritative interval, never extrapolate another actor. */
export function sampleShotState(before:ShotSampleState,after:ShotSampleState,time:number,end:number,duration=STEP) {
  const alpha=duration>0?clamp((time-(end-duration))/duration,0,1):1,lerp=(a:number,b:number)=>a+(b-a)*alpha;
  return {position:{x:lerp(before.position.x,after.position.x),y:lerp(before.position.y,after.position.y),z:lerp(before.position.z,after.position.z)},
    velocity:{x:lerp(before.velocity.x,after.velocity.x),z:lerp(before.velocity.z,after.velocity.z)},
    yaw:before.yaw+Math.atan2(Math.sin(after.yaw-before.yaw),Math.cos(after.yaw-before.yaw))*alpha,
    pitch:lerp(before.pitch,after.pitch),feet:lerp(before.feet,after.feet),duckAmount:lerp(before.duckAmount??0,after.duckAmount??0),
    verticalVelocity:lerp(before.verticalVelocity??0,after.verticalVelocity??0),
    grounded:before.grounded===after.grounded?after.grounded:after.grounded&&after.landedAt!==undefined
      ?time>=after.landedAt:alpha>=1?after.grounded:before.grounded};
}
