import {describe,expect,it} from 'vitest';
import {LocomotionTransitions,type LocomotionInput} from './locomotion-transition';
const input=(patch:Partial<LocomotionInput>={}):LocomotionInput=>({id:1,generation:1,equipment:'ak47',
  weights:new Map([['idle_rifle',1]]),gait:0,idle:0,x:0,z:0,feet:0,bodyYaw:0,vx:0,vz:0,duck:0,airborne:false,supported:true,...patch});
const move=(vx:number)=>input({vx,weights:new Map([[vx>0?'run_e_rifle':'run_w_rifle',1]])});
describe('timestamped locomotion transitions',()=>{
  it('blends starts/stops and reversals rather than snapping pose weights',()=>{
    const t=new LocomotionTransitions();t.record(input(),0);t.record(move(3),.01);
    const start=t.sample(move(3),.01)!;expect(start.kind).toBe('start');
    expect(start.weights.get('idle_rifle')).toBeGreaterThan(.5);expect(start.weights.get('run_e_rifle')).toBeGreaterThan(0);
    t.record(move(-3),.02);const reverse=t.sample(move(-3),.02)!;expect(reverse.kind).toBe('reverse');
    expect(reverse.weights.get('run_e_rifle')).toBeGreaterThan(0);expect(reverse.weights.get('run_w_rifle')).toBeGreaterThan(0);
    t.record(input(),.03);expect(t.sample(input(),.03)!.kind).toBe('stop');
    for(let n=4;n<=80;n++)t.record(input(),n*.01);
    const stopped=t.sample(input(),.8)!;expect(stopped.weights.get('idle_rifle')).toBeGreaterThan(.999);
    expect([...stopped.weights.values()].reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);
  });
  it('repeated renders and rewinds never advance authoritative transition history',()=>{
    const t=new LocomotionTransitions();t.record(input(),0);t.record(move(3),.01);t.record(move(-3),.02);
    const sample=t.sample(move(-3),.021);for(let i=0;i<50;i++)expect(t.sample(move(-3),.021)).toEqual(sample);
    t.sample(input(),.005);expect(t.sample(move(-3),.021)).toEqual(sample);
  });
  it('releases support on a jump, ledge or large body turn',()=>{
    for(const patch of [{airborne:true},{supported:false},{bodyYaw:1}]) {
      const t=new LocomotionTransitions();t.record(move(3),0);t.record(input(),.01);t.record(input(),.04);
      expect(t.sample(input(),.04)?.contact?.weight).toBeGreaterThan(0);
      t.record(input(patch),.05);expect(t.sample(input(patch),.05)?.contact).toBeUndefined();
    }
  });
  it('resets on teleport, equipment changes and actor respawn',()=>{
    for(const patch of [{x:3},{generation:2},{equipment:'usp'}]) {
      const t=new LocomotionTransitions();t.record(move(3),0);t.record(input(patch),.01);
      expect(t.sample(input(patch),.01)?.weights).toEqual(input().weights);
      expect(t.sample(input(patch),.01)?.contact).toBeUndefined();
    }
  });
});
