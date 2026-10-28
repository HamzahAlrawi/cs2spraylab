import {describe,it,expect,vi} from 'vitest';
import {DEG,STEP,UNIT,type Vec} from '../actor-physics';
import {ApproachAim} from './approach-aim';
import {testArena,traceSolid,type Arena} from './geometry';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';
import type {DuelActorSnapshot} from './types';

const delta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const bearing=(a:Vec,b:Vec)=>Math.atan2(-(b.x-a.x),-(b.z-a.z));
const actor=():DuelActorSnapshot=>({id:1,generation:0,side:'enemy',position:{x:3.8,y:64*UNIT,z:-1.5},feet:0,
  grounded:true,velocity:{x:0,z:0},yaw:Math.PI,pitch:0,crouched:false,duckAmount:0,health:100,armor:100,
  helmet:true,alive:true,equipment:'ak47',ammo:30,reloading:false});
function map():Arena {
  const watch={x:3.8,y:64*UNIT,z:10};
  return {...testArena(),solids:[{center:{x:0,y:1.5,z:0},size:{x:6,y:3,z:1.2}}],
    lanes:[{side:1,role:'camp',anchor:{x:3.8,y:0,z:-1.5},edge:{x:3.8,y:0,z:-1.5},retreat:{x:2.8,y:0,z:-1.5},watch}]};
}
function brain(arena:Arena) {
  return new TacticalBrain({...createBotTraits(10,17,1),preaimErrorDegrees:0,lowAimTendency:0},'holder',1,()=>.5,arena,10,'ak47',1);
}

describe('contextual angle preference and facing',()=>{
  it('holds a useful covered common angle without needing to see the player first',()=>{
    const arena=map(),policy=brain(arena),bot=actor();policy.phase='setup';
    for(let tick=1;tick<4/STEP;tick++) {
      const time=tick*STEP;if(tick%4===0)policy.perceive({time,self:bot,visible:null});
      const command=policy.command(bot,time);bot.yaw+=command.yawDelta??0;bot.pitch+=command.pitchDelta??0;
      expect(policy.phase).toBe('setup');expect(command.fireHeld).toBe(false);
      expect(command.forward).toBeCloseTo(0,10);expect(command.side).toBeCloseTo(0,10);
    }
  });
  it('does not treat an exposed camp-labelled point as useful cover',()=>{
    const arena=map();arena.solids=[];const policy=brain(arena),bot=actor();policy.phase='setup';
    policy.perceive({time:1,self:bot,visible:null});policy.command(bot,1);
    expect(policy.phase).not.toBe('setup');
  });
  it('keeps pre-aim on the authored approach while traveling in another direction',()=>{
    const arena=map(),bot=actor();arena.lanes![0].anchor={x:-8,y:0,z:-5};
    arena.tactical={entry:{x:0,y:0,z:10},watchPoints:[{x:3.8,y:64*UNIT,z:-8},arena.lanes![0].watch!],searchPoints:[]};
    const policy=brain(arena);
    for(let tick=0;tick<.7/STEP;tick++) {
      const time=tick*STEP;if(tick%4===0)policy.perceive({time,self:bot,visible:null});
      const command=policy.command(bot,time);bot.yaw+=command.yawDelta??0;bot.pitch+=command.pitchDelta??0;
    }
    expect(Math.abs(delta(bot.yaw,bearing(bot.position,arena.lanes![0].watch!)))).toBeLessThan(12*DEG);
  });
  it('preserves the native map height of sound and shadow evidence',()=>{
    const arena=map();arena.native={ray:()=>undefined,fits:()=>true,sweep:()=>{throw Error('unused');},
      vertical:(_p,from)=>({feet:from,grounded:false,ceiling:false})};
    const policy=brain(arena),bot=actor(),point={x:4,y:15,z:8};
    policy.hear(point,0,'footstep',false);
    expect(policy['cueChecks']['cue']?.point.y).toBe(15);
    expect(policy.threatReport(.5)!.point.y).toBe(15);
    policy.perceive({time:.1,self:bot,visible:null,shadowCues:[{id:'shadow',point:{...point,y:13},observedAt:.1,uncertainty:1}]});
    expect(policy['shadowPoint']!.y).toBeCloseTo(13+64*UNIT,8);
  });
  it('retains the observed approach area after precise sight memory expires, without permission to shoot',()=>{
    const arena=map(),bot=actor();arena.solids=[];
    arena.lanes![0].watch={x:3.8,y:64*UNIT,z:12};
    const seen={x:-8,y:64*UNIT,z:-1.5};
    arena.tactical={entry:{x:0,y:0,z:12},watchPoints:[arena.lanes![0].watch!,seen],searchPoints:[]};
    const policy=brain(arena);
    policy.perceive({time:0,self:bot,visible:{id:0,position:{...seen},aimPoint:{...seen}}});
    bot.yaw=bearing(bot.position,seen);
    for(let tick=4/STEP;tick<5/STEP;tick++) {
      const time=tick*STEP;if(tick%4===0)policy.perceive({time,self:bot,visible:null});
      const command=policy.command(bot,time);bot.yaw+=command.yawDelta??0;bot.pitch+=command.pitchDelta??0;
      expect(command.fireHeld).toBe(false);expect(policy.contactReport(time)).toBeNull();
    }
    expect(Math.abs(delta(bot.yaw,bearing(bot.position,seen)))).toBeLessThan(12*DEG);
  });
});

describe('bounded primary approach selection',()=>{
  it('ignores nearer rear waypoints and preserves an open expected angle',()=>{
    const choose=new ApproachAim(),eye={x:0,y:1.6,z:-8},expected={x:0,y:1.6,z:8};
    expect(choose.focus(eye,0,expected,[{x:0,y:1.6,z:-10}],testArena())).toEqual(expected);
  });
  it('finds the visible opening beside blocked pre-aim instead of selecting an unrelated rear point',()=>{
    const arena=map(),eye={x:0,y:1.6,z:-8},expected={x:0,y:1.6,z:8},opening={x:5,y:1.6,z:0};
    const choose=new ApproachAim(),candidates=[{x:0,y:1.6,z:-10},opening];
    expect(choose.focus(eye,0,expected,candidates,arena)).toEqual(opening);
    const p=choose.focus(eye,.1,expected,candidates,arena),range=Math.hypot(p.x-eye.x,p.z-eye.z);
    expect(traceSolid(eye,{x:(p.x-eye.x)/range,y:0,z:(p.z-eye.z)/range},arena,range-.02).distance).toBe(Infinity);
  });
  it('bounds native ray work at motor frequency and invalidates for a changed approach',()=>{
    const arena=map(),rays=vi.fn(()=>undefined);
    arena.native={ray:rays,fits:()=>true,sweep:()=>{throw Error('unused');},vertical:(_p,from)=>({feet:from,grounded:false,ceiling:false})};
    const choose=new ApproachAim(),eye={x:3.8,y:1.6,z:-8},expected={x:3.8,y:1.6,z:8};
    for(let tick=0;tick<128;tick++)choose.focus(eye,tick/128,expected,[expected],arena);
    expect(rays).toHaveBeenCalledTimes(4);
    choose.focus(eye,1,{...expected,x:6},[],arena);expect(rays).toHaveBeenCalledTimes(5);
  });
});
