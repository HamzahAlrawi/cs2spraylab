import {UNIT,type Vec} from '../actor-physics';
import {nativeUtilityDefault as value} from './native-utility-defaults';
import {DuelRandom} from './rng';

const f=Math.fround;
export const NATIVE_INFERNO=Object.freeze({rampSeconds:2,spawnWindow:value('inferno_per_flame_spawn_duration'),
  initialInterval:value('inferno_initial_spawn_interval'),childMultiplier:value('inferno_child_spawn_interval_multiplier'),
  maxChildInterval:value('inferno_max_child_spawn_interval'),maxDepth:value('inferno_child_spawn_max_depth'),
  maxFlames:value('inferno_max_flames'),maxTraces:value('inferno_max_trace_per_tick'),spacing:value('inferno_flame_spacing')*UNIT,
  spawnAngle:value('inferno_spawn_angle')*Math.PI/180});
/** Spawn-relative native ramp. This is raw damage, before player modifiers/health accounting. */
export function nativeInfernoDamage(now:number,spawnAt:number,dps:number,interval:number,rampDuration=2) {
  now=f(now);rampDuration=f(rampDuration);
  const expiry=f(f(spawnAt)+rampDuration),base=f(f(dps)*f(interval));
  const factor=now>=expiry||rampDuration===0?1:Math.max(0,Math.min(1,f(f(f(now-expiry)+rampDuration)/rampDuration)));
  return f(base*factor);
}
type Flame={point:Vec;parent?:number;depth:number;interval:number;nextAttempt:number;spawnUntil:number;expiresAt:number;credit:number;active:boolean};
export class InfernoSpread {
  private readonly flames:Flame[]=[];
  private nextPass:number;
  private readonly period:number;
  private readonly random:DuelRandom;
  cells:Vec[]=[];
  expiresAt:number;
  constructor(readonly origin:Vec,readonly spawnedAt:number,readonly radius:number,readonly lifetime:number,
    incendiary:boolean,seed:number,id:number) {
    this.period=f(.1)/value(incendiary?'inferno_spread_speed_mult_ct':'inferno_spread_speed_mult');
    this.nextPass=spawnedAt+this.period;this.random=new DuelRandom(seed,`inferno:${id}`);
    this.expiresAt=spawnedAt+lifetime;this.add({...origin},spawnedAt);
  }
  private add(point:Vec,time:number,parent?:number) {
    const old=parent===undefined?undefined:this.flames[parent],interval=old?Math.min(old.interval*NATIVE_INFERNO.childMultiplier,NATIVE_INFERNO.maxChildInterval):NATIVE_INFERNO.initialInterval;
    this.flames.push({point,parent,depth:old?old.depth+1:0,interval,nextAttempt:time+interval,
      spawnUntil:time+NATIVE_INFERNO.spawnWindow,expiresAt:time+this.lifetime,credit:0,active:true});
    this.expiresAt=Math.max(this.expiresAt,time+this.lifetime);
  }
  suppress(cells:readonly Vec[]) {
    for(const flame of this.flames)if(cells.includes(flame.point))flame.active=false;
    this.cells=this.cells.filter(point=>!cells.includes(point));
  }
  /** Native timers/caps; trainer placement adapter, not the complete native terrain/RNG solver.
   * A projection attempt may use at most two queries, bounded by the extracted trace budget. */
  advance(time:number,project:(from:Vec,candidate:Vec)=>Vec|undefined) {
    let changed=false;
    for(const flame of this.flames)if(flame.active&&time>=flame.expiresAt){flame.active=false;changed=true;}
    if(time>=this.nextPass) {
      this.nextPass+=this.period;
      if(this.nextPass<time)this.nextPass+=Math.ceil((time-this.nextPass)/this.period)*this.period;
      const count=this.flames.length;
      for(let i=0;i<count;i++) {
        const flame=this.flames[i];
        if(flame.active&&time<flame.spawnUntil&&time>=flame.nextAttempt){flame.credit++;flame.nextAttempt=time+flame.interval;}
      }
      let budget=NATIVE_INFERNO.maxTraces;
      for(let i=0;i<count&&budget>=2&&this.flames.length<NATIVE_INFERNO.maxFlames;i++) {
        const flame=this.flames[i];
        if(!flame.active||!flame.credit)continue;
        flame.credit--;
        if(flame.depth+1>=NATIVE_INFERNO.maxDepth)continue;
        const quarter=Math.floor(this.random.next()*4),parent=flame.parent===undefined?undefined:this.flames[flame.parent];
        for(let attempt=0;attempt<4&&budget>=2;attempt++) {
          const angle=parent?Math.atan2(flame.point.z-parent.point.z,flame.point.x-parent.point.x)+
            (this.random.next()*2-1)*NATIVE_INFERNO.spawnAngle+(attempt%2)*Math.PI:
            ((quarter+attempt)%4+this.random.next())*Math.PI/2;
          const candidate={x:flame.point.x+Math.cos(angle)*NATIVE_INFERNO.spacing,y:flame.point.y,z:flame.point.z+Math.sin(angle)*NATIVE_INFERNO.spacing};
          if(Math.hypot(candidate.x-this.origin.x,candidate.z-this.origin.z)>this.radius||
            this.flames.some(other=>other.active&&Math.hypot(candidate.x-other.point.x,candidate.z-other.point.z)<NATIVE_INFERNO.spacing-1e-7))continue;
          budget-=2;
          const point=project(flame.point,candidate);
          if(point){this.add(point,time,i);changed=true;break;}
        }
      }
    }
    if(changed||!this.cells.length)this.cells=this.flames.filter(flame=>flame.active).map(flame=>flame.point);
    return this.cells;
  }
}
