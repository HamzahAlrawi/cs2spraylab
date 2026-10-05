import {integratePunch,recoilTable,type RecoilAngle,type RecoilParameters} from './recoil';

export type AccuracyParameters=RecoilParameters&{
  stand:number;crouch:number;move:number;fire:number;spread:number;recovery:number;
  recoveryFinal?:number;recoveryCrouch?:number;recoveryCrouchFinal?:number;
  recoveryStart?:number;recoveryEnd?:number;jump?:number;jumpInitial?:number;jumpApex?:number;
  spreadSeed?:number;pellets?:number;
};
const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const ZERO=()=>({yaw:0,pitch:0});

export function recoveryTime(w:AccuracyParameters,index:number,crouch:boolean,airborne=false){
  if(airborne)return 4*(w.recoveryCrouch ?? w.recovery);
  const initial=crouch?w.recoveryCrouch ?? w.recovery:w.recovery;
  const final=crouch?w.recoveryCrouchFinal:w.recoveryFinal;
  const start=w.recoveryStart ?? 2,end=w.recoveryEnd ?? 5;
  const blend=end>start?clamp((Math.floor(index)-start)/(end-start)):0;
  return final===undefined || final<0 ? initial : initial+(final-initial)*blend;
}

// Installed build 2000908: remap 34..95% of weapon cap, then x^0.25
// for running. The walking branch bypasses that exponent (RVA 0x7e71c6).
export function movementInaccuracy(w:AccuracyParameters,speedRatio:number,walking=false){
  const x=clamp((speedRatio-.34)/(.95-.34));
  return w.move*(walking?x:Math.pow(x,.25));
}
export function airborneInaccuracy(w:AccuracyParameters,verticalSpeedUnits:number){
  const initial=w.jumpInitial ?? 0,apex=w.jumpApex ?? 0;
  const fraction=(Math.sqrt(Math.abs(verticalSpeedUnits))/Math.sqrt(301.993)-.25)/.75;
  return clamp(apex+(initial-apex)*fraction,0,2*initial);
}

function evolve(angle:RecoilAngle,velocity:RecoilAngle,seconds:number){
  while(seconds>1e-9){const dt=Math.min(seconds,1/128);({angle,velocity}=integratePunch(angle,velocity,dt));seconds-=dt;}
  return {angle,velocity};
}

// A full-auto capture does not encode recovery. Fit impulses to its sample
// points, then use the same recovered damping for interrupted capture playback.
function captureImpulses(w:AccuracyParameters,points:RecoilAngle[]){
  let angle=ZERO(),velocity=ZERO();
  return points.map((_,i)=>{
    const desired=points[Math.min(i+1,points.length-1)];
    let guess={...velocity};
    for(let n=0;n<12;n++){
      const sample=evolve(angle,guess,w.cycle).angle;
      const error={yaw:desired.yaw/2-sample.yaw,pitch:desired.pitch/2-sample.pitch};
      if(Math.hypot(error.yaw,error.pitch)<1e-5)break;
      const a=evolve(angle,{...guess,yaw:guess.yaw+.1},w.cycle).angle;
      const b=evolve(angle,{...guess,pitch:guess.pitch+.1},w.cycle).angle;
      const xx=(a.yaw-sample.yaw)/.1,xy=(b.yaw-sample.yaw)/.1,yx=(a.pitch-sample.pitch)/.1,yy=(b.pitch-sample.pitch)/.1;
      const determinant=xx*yy-xy*yx;
      if(Math.abs(determinant)<1e-10)break;
      guess.yaw+=(error.yaw*yy-error.pitch*xy)/determinant;
      guess.pitch+=(error.pitch*xx-error.yaw*yx)/determinant;
    }
    const impulse={yaw:guess.yaw-velocity.yaw,pitch:guess.pitch-velocity.pitch};
    ({angle,velocity}=evolve(angle,guess,w.cycle));return impulse;
  });
}

export class WeaponRecovery {
  angle=ZERO();velocity=ZERO();index=0;penalty:number;lastShot=-Infinity;time=0;
  private impulses:RecoilAngle[];
  constructor(public weapon:AccuracyParameters,capture?:RecoilAngle[]){
    this.penalty=weapon.stand;
    this.impulses=capture?captureImpulses(weapon,capture):recoilTable(weapon).map(p=>{
      const radians=Math.fround(p.angle*Math.fround(Math.PI/180));
      return {yaw:Math.fround(Math.sin(radians)*p.magnitude),pitch:Math.fround(Math.cos(radians)*p.magnitude)};
    });
  }
  get recoil(){return{yaw:this.angle.yaw*2,pitch:this.angle.pitch*2};}
  setParameters(weapon: AccuracyParameters) {
    if (this.weapon === weapon) return;
    // Preserve accumulated firing error while switching stance/zoom baselines.
    this.penalty = Math.max(weapon.stand, this.penalty - this.weapon.stand + weapon.stand);
    this.weapon = weapon;
    this.impulses = recoilTable(weapon).map(p => {
      const radians = Math.fround(p.angle * Math.fround(Math.PI / 180));
      return {yaw: Math.fround(Math.sin(radians) * p.magnitude), pitch: Math.fround(Math.cos(radians) * p.magnitude)};
    });
  }
  advance(dt:number,crouch=false,airborne=false){
    const baseline=airborne?this.weapon.stand+(this.weapon.jump ?? 0):crouch?this.weapon.crouch:this.weapon.stand;
    const recovery=recoveryTime(this.weapon,this.index,crouch,airborne);
    const decay=dt===0?1:recovery>0?Math.pow(10,-dt/recovery):0;
    this.penalty=baseline+Math.max(0,this.penalty-baseline)*decay;
    // Native index decay starts after last shot + cycle + one 64 Hz tick.
    const decayTime=Math.max(0,this.time+dt-Math.max(this.time,this.lastShot+this.weapon.cycle+1/64));
    this.index*=Math.pow(10,-2*decayTime);
    if(this.index<=.1)this.index=0;
    ({angle:this.angle,velocity:this.velocity}=evolve(this.angle,this.velocity,dt));
    this.time+=dt;
  }
  fire(){
    const recoil=this.recoil;
    const impulse=this.impulses[Math.floor(this.index)%this.impulses.length];
    this.velocity={yaw:Math.fround(this.velocity.yaw+impulse.yaw),pitch:Math.fround(this.velocity.pitch+impulse.pitch)};
    this.penalty+=this.weapon.fire;this.index++;this.lastShot=this.time;
    return recoil;
  }
  predict(seconds:number,afterShot=false){
    const copy=Object.assign(Object.create(WeaponRecovery.prototype),this) as WeaponRecovery;
    copy.angle={...this.angle};copy.velocity={...this.velocity};
    if(afterShot)copy.fire();copy.advance(seconds);return copy.recoil;
  }
  inaccuracy(speedRatio:number,walking=false,airborne=false,verticalSpeedUnits=0){
    return Math.min(1,this.penalty+movementInaccuracy(this.weapon,speedRatio,walking)+(airborne?airborneInaccuracy(this.weapon,verticalSpeedUnits):0));
  }
}
