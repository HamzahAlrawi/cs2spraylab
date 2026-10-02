import {describe,it,expect,vi} from 'vitest';
import {WeaponRecovery,movementInaccuracy,recoveryTime,airborneInaccuracy} from './ballistics';
import {defaults,gameData,sanitizeSettings,weaponIds,recoilPattern} from './config';
import {Simulation,STEP,UNIT,type Shot} from './simulation';
const ak=gameData.weapons.ak47;
const advance=(s:Simulation,seconds:number)=>{for(let i=0;i<Math.round(seconds/STEP);i++)s.step(STEP);};

describe('Recovered accuracy formulas',()=>{
  it('uses a sharp running curve from 34% to 95%, and a separate walking branch',()=>{
    expect(movementInaccuracy(ak,.34)).toBe(0);
    expect(movementInaccuracy(ak,.35)).toBeCloseTo(ak.move*Math.pow(.01/.61,.25));
    expect(movementInaccuracy(ak,.65)).toBeCloseTo(ak.move*Math.pow(.31/.61,.25));
    expect(movementInaccuracy(ak,1)).toBe(ak.move);
    expect(movementInaccuracy(ak,.52,true)).toBeCloseTo(ak.move*.18/.61);
  });
  it('uses integer recoil-index recovery transitions and crouched/airborne parameters',()=>{
    expect(recoveryTime(ak,2.99,false)).toBe(ak.recovery);
    expect(recoveryTime(ak,3,false)).toBeCloseTo(ak.recovery+(ak.recoveryFinal-ak.recovery)/3);
    expect(recoveryTime(ak,10,true)).toBe(ak.recoveryCrouchFinal);
    expect(recoveryTime(ak,10,false,true)).toBe(ak.recoveryCrouch*4);
  });
  it('recovers 90% of excess accuracy penalty over the initial recovery time',()=>{
    const state=new WeaponRecovery(ak);state.fire();state.advance(ak.recovery);
    expect(state.penalty-ak.stand).toBeCloseTo(ak.fire*.1,10);
  });
  it('recovers recoil index only after cycle plus tick, at 10^(-2t)',()=>{
    const state=new WeaponRecovery(ak);state.fire();state.advance(ak.cycle+1/64);
    expect(state.index).toBe(1);state.advance(.2);
    expect(state.index).toBeCloseTo(Math.pow(10,-.4),10);
    state.advance(1);expect(state.index).toBe(0);
  });
  it('penalizes airborne shots even at the jump apex',()=>{
    expect(airborneInaccuracy(ak,0)).toBe(0);
    const state=new WeaponRecovery(ak);state.advance(STEP,false,true);
    expect(state.inaccuracy(0,false,true,0)).toBeCloseTo(ak.stand+ak.jump);
    expect(airborneInaccuracy(ak,301.993)).toBeCloseTo(ak.jumpInitial);
  });
  it('enables spread and larger impacts by default while preserving explicit spread-off choices',()=>{
    expect(defaults.spread).toBe(true);expect(sanitizeSettings({}).spread).toBe(true);
    expect(sanitizeSettings({spread:false}).spread).toBe(false);
    expect(sanitizeSettings({impactSize:Infinity}).impactSize).toBe(1.5);
    expect(sanitizeSettings({impactSize:100}).impactSize).toBe(4);
  });
});

describe('Persistent shot state',()=>{
  it.each(weaponIds.filter(id=>gameData.weapons[id].fullAuto))('%s guides predict the actual fixed-step next two trajectories',weapon=>{
    const s=new Simulation({...defaults,weapon,spread:false});const shots:Shot[]=[];
    s.onShot=shot=>shots.push(shot);s.start();
    while (!shots.length && s.time < 1) s.step(STEP);
    advance(s,STEP*3);
    const now=s.predictedRecoil(),next=s.predictedRecoil(true);
    for(let tick=0;tick<Math.ceil(3/STEP)&&shots.length<3;tick++)s.step(STEP);
    expect(shots).toHaveLength(3);
    expect(shots[1].recoil.yaw).toBeCloseTo(now.yaw,5);expect(shots[1].recoil.pitch).toBeCloseTo(now.pitch,5);
    expect(shots[2].recoil.yaw).toBeCloseTo(next.yaw,5);expect(shots[2].recoil.pitch).toBeCloseTo(next.pitch,5);
  });
  it.each(weaponIds)('%s rapid taps retain recoil and firing inaccuracy',weapon=>{
    const s=new Simulation({...defaults,weapon,spread:false});const shots:Shot[]=[];
    s.onShot=shot=>shots.push(shot);
    s.start(false,weapon==='revolver');s.release('mouse');advance(s,s.stats.cycle+STEP);
    const before=s.recovery.penalty;s.start(false,weapon==='revolver');s.release('mouse');
    expect(shots).toHaveLength(2);expect(shots[1].recoil.pitch).toBeGreaterThan(0);
    expect(s.recovery.penalty).toBeGreaterThan(before);
    advance(s,Math.max(3,s.stats.recovery*6));expect(s.recovery.index).toBe(0);
    expect(Math.hypot(s.recovery.recoil.yaw,s.recovery.recoil.pitch)).toBeLessThan(.001);
    expect(s.recovery.penalty).toBeCloseTo(s.stats.stand,5);
  });
  it('predicts guidance without mutating weapon state',()=>{
    const s=new Simulation(defaults);s.start();s.release('mouse');advance(s,.2);
    const before=JSON.stringify(s.recovery);
    const next=s.predictedRecoil(true);expect(next.pitch).toBeGreaterThan(0);
    expect(JSON.stringify(s.recovery)).toBe(before);
  });
  it('does not wipe recoil by pausing, changing equipment or starting a new trigger press',()=>{
    const s=new Simulation({...defaults,spread:false});s.start();advance(s,.4);s.release('mouse');
    const index=s.recovery.index;s.cancel();s.advance(10);expect(s.recovery.index).toBe(index);
    s.equip(2);s.equip(1);expect(s.recovery.index).toBe(index);
    s.reset();expect(s.recovery.index).toBe(0);
  });
  it('produces substantially wider running shots and honors spread-off explicitly',()=>{
    const random=vi.spyOn(Math,'random').mockReturnValue(.3);
    try{
      const shot=(running:boolean,spread:boolean)=>{
        const s=new Simulation({...defaults,mode:'guided',spread});if(running)s.velocity.x=ak.speed*UNIT;
        let result:Shot|undefined;s.onShot=x=>{result=x;};s.start();return result!.direction;
      };
      const idle=shot(false,true),moving=shot(true,true),off=shot(true,false);
      expect(Math.hypot(moving.x,moving.y)).toBeGreaterThan(Math.hypot(idle.x,idle.y)*15);
      expect(off).toEqual({x:-0,y:0,z:-1});
    }finally{random.mockRestore();}
  });
  it('fits a full-auto capture without resetting recovery on interrupted playback',()=>{
    const points=recoilPattern('ak47'),state=new WeaponRecovery(ak,points);
    for(let i=0;i<points.length-1;i++){
      const actual=state.fire();expect(actual.pitch).toBeCloseTo(points[i].pitch,3);expect(actual.yaw).toBeCloseTo(points[i].yaw,3);
      state.advance(ak.cycle);
    }
    state.advance(.4);expect(state.recoil.pitch).toBeGreaterThan(0);
  });
});
