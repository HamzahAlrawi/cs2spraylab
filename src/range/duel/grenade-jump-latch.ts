import {STEP} from '../actor-physics';
import {sampleShotState,type ShotSampleState} from './shot-time';
import {nativeGrenadeReleaseAt} from './grenade-native-input';

// Current installed client: jump schedule 0x8e9b32, gate/copy 0x8cea9c.
// Offline reference: tools/verify-native-grenade-latch.py. No fixed launch vz.
export const GRENADE_LATCH_WINDOW=Math.fround(.2);
export const nativeGrenadeLatchAge=(age:number)=>age>0&&age<=GRENADE_LATCH_WINDOW;
type Sample=ShotSampleState&{jumpedAt?:number};
export class GrenadeJumpLatch {
  private at?:number;
  private pose?:ReturnType<typeof sampleShotState>;
  observe(before:Sample,after:Sample,end:number,duration=STEP){
    if(after.jumpedAt!==undefined&&after.jumpedAt!==before.jumpedAt){this.at=nativeGrenadeReleaseAt(after.jumpedAt);this.pose=undefined;}
    if(this.at!==undefined&&!this.pose&&this.at>=end-duration-1e-8&&this.at<=end+1e-8)
      this.pose=sampleShotState(before,after,this.at,end,duration);
  }
  eligible(now:number,lookAhead=0){
    if(this.at===undefined)return false;
    const elapsed=Math.fround(Math.fround(Math.fround(now)+Math.fround(lookAhead))-this.at);
    return nativeGrenadeLatchAge(elapsed);
  }
  sample(now:number){return this.eligible(now)&&this.pose?this.pose:undefined;}
}
