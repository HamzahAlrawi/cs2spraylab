import {describe,expect,it} from 'vitest';
import {sampleShotState} from './shot-time';
import {DuelWeaponState} from './weapon-state';
import {idleCommand} from './types';
import {STEP,UNIT} from '../actor-physics';
const actor=()=>({position:{x:0,y:64*UNIT,z:0},velocity:{x:0,z:0},yaw:0,pitch:0,feet:0,verticalVelocity:0,grounded:true});
describe('within-step shot state',()=>{
  it('keeps exact cadence and samples recovery/origin at a fractional scheduled shot',()=>{
    const w=new DuelWeaponState('ak47',()=>0,{spread:false}),a=actor(),command={...idleCommand(),fireHeld:true};
    let previousTime=0,shots=0;
    for(let tick=1;tick<80;tick++) {
      const time=tick*STEP;
      const fired=w.advance(time,STEP,command,{...a,sampleAt:at=>({...a,position:{...a.position,x:at*2}})});
      if(fired){if(shots)expect(fired.at!-previousTime).toBeCloseTo(w.actions.base.cycle,9);
        expect(fired.origin.x).toBeCloseTo(fired.at!*2,10);expect(fired.at).toBeLessThanOrEqual(time);
        previousTime=fired.at!;shots++;}
      expect(w.recovery.time).toBeCloseTo(time,10);
    }
    expect(shots).toBeGreaterThan(4);
  });
  it('clamps samples and interpolates yaw over the short arc',()=>{
    const before={...actor(),yaw:Math.PI-.01},after={...actor(),position:{x:2,y:1,z:1},yaw:-Math.PI+.01};
    expect(sampleShotState(before,after,-10,STEP).position).toEqual(before.position);
    expect(sampleShotState(before,after,10,STEP).position).toEqual(after.position);
    expect(sampleShotState(before,after,STEP/2,STEP).yaw).toBeCloseTo(Math.PI);
  });
});
