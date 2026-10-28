import type {Vec} from '../actor-physics';
import {traceSolid,type Arena} from './geometry';

const gap=(a:Vec,b:Vec)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const clear=(eye:Vec,point:Vec,arena:Arena)=>{
  const distance=gap(eye,point);
  return distance>.75 && !Number.isFinite(traceSolid(eye,{x:(point.x-eye.x)/distance,y:(point.y-eye.y)/distance,
    z:(point.z-eye.z)/distance},arena,distance-.02).distance);
};

/** Pre-aim a known approach, not the closest waypoint or an unseen actor. */
export class ApproachAim {
  private nextAt=-Infinity;
  private origin?:Vec;
  private expected?:Vec;
  private selected?:Vec;
  focus(eye:Vec,time:number,expected:Vec,candidates:readonly Vec[],arena:Arena):Vec {
    if(time>=this.nextAt || !this.origin || gap(eye,this.origin)>.6 || !this.expected || gap(expected,this.expected)>.35) {
      this.nextAt=time+.25;this.origin={...eye};this.expected={...expected};this.selected={...expected};
      if(!clear(eye,expected,arena)) {
        const dx=expected.x-eye.x,dz=expected.z-eye.z,length=Math.hypot(dx,dz);
        const ranked=candidates.map(point=>{
          const x=point.x-eye.x,z=point.z-eye.z,range=Math.hypot(x,z);
          const cosine=length>.01 && range>.75?(dx*x+dz*z)/(length*range):-1;
          return {point,score:cosine>.35?(1-cosine)*8+gap(point,expected)*.06:Infinity};
        }).filter(row=>Number.isFinite(row.score)).sort((a,b)=>a.score-b.score).slice(0,12);
        this.selected={...(ranked.find(row=>clear(eye,row.point,arena))?.point ?? expected)};
      }
    }
    return this.selected!;
  }
}
