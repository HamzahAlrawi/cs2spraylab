import {describe,expect,it} from 'vitest';
import {Simulation,type Shot} from './simulation';
import {defaults} from './config';
import {STEP} from './actor-physics';
import {sampleShotState,type ShotSampleState} from './duel/shot-time';

describe('range scheduled shot positions',()=>{
  it('samples moving origins at the actual shot time, without moving past shot records',()=>{
    const sim=new Simulation({...defaults,mode:'spray',weapon:'ak47',spread:false,burst:0});sim.position.z=-60;
    let before:ShotSampleState=sim;const shots:Shot[]=[];let fractional=0;
    sim.onShot=shot=>{
      if(shots.length){const expected=sampleShotState(before,sim,shot.at,sim.time,STEP);
        expect(shot.origin).toEqual(expected.position);
        if(shot.at<sim.time-1e-8){fractional++;expect(shot.origin.x).not.toBe(sim.position.x);}}
      shots.push(shot);
    };
    sim.start(true);
    for(let tick=0;tick<90;tick++) {
      before={position:{...sim.position},velocity:{...sim.velocity},yaw:sim.yaw,pitch:sim.pitch,feet:sim.feet,
        duckAmount:sim.duckAmount,grounded:sim.grounded,verticalVelocity:sim.verticalVelocity,landedAt:sim.landedAt};
      sim.input.side=1;sim.step(STEP);
    }
    expect(fractional).toBeGreaterThan(2);const past=JSON.stringify(shots);
    sim.position.x+=20;sim.yaw+=1;expect(JSON.stringify(shots)).toBe(past);
  });
  it('samples the moving target on the same clock, including its turnaround',()=>{
    const sim=new Simulation({...defaults,mode:'spray',weapon:'ak47',spread:false,moving:true,targetSpeed:'knife',burst:0});
    const shots:Shot[]=[];let beforeX=sim.targetX,velocity=0,start=0;
    sim.onShot=shot=>{
      if(shots.length){let expected=beforeX+velocity*(shot.at-start);if(Math.abs(expected)>3)expected=Math.sign(expected)*(6-Math.abs(expected));
        expect(shot.targetX).toBeCloseTo(expected,10);expect(sim.targetPosition(0,shot.targetX).x).toBeCloseTo(expected,10);}
      shots.push(shot);
    };
    sim.start(true);sim.targetX=2.8;
    for(let tick=0;tick<80;tick++) {beforeX=sim.targetX;velocity=sim.targetSign*250*.0254;start=sim.time;sim.step(STEP);}
    expect(shots.length).toBeGreaterThan(5);expect(sim.targetSign).toBe(-1);
  });
});
