import {describe,it,expect,vi} from 'vitest';
import native from './native-grenade-latch-fixture.json';
import current from '../../../tests/fixtures/native-grenade-latch-2000943.json';
import {GrenadeJumpLatch,GRENADE_LATCH_WINDOW,nativeGrenadeLatchAge} from './grenade-jump-latch';
import {nativeGrenadeReleaseAt} from './grenade-native-input';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {STEP,UNIT} from '../actor-physics';

const pose=(t:number)=>({position:{x:t,y:2+t,z:0},velocity:{x:1,z:0},yaw:t,pitch:.3,feet:t,
  verticalVelocity:7-20*t,grounded:false,jumpedAt:0});
describe('installed grenade jump-pose cache integration',()=>{
  it('keeps current native cache timing constants',()=>{
    expect(GRENADE_LATCH_WINDOW).toBe(native.constants.window);
    expect(nativeGrenadeReleaseAt(0)).toBe(native.constants.delay);
  });
  it.each([...native.cases,...current.cases])('matches isolated native age gate $elapsed',sample=>{
    expect(nativeGrenadeLatchAge(sample.elapsed)).toBe(sample.usedCache);
  });
  it('retains the current-build timing evidence separately from the historical fixture',()=>{
    expect(current.build).toBe('2000943');
    expect(current.constants).toEqual(native.constants);
    expect(current.clientSha256).not.toBe(native.clientSha256);
    expect(current.fields.m_vecStashedVelocity).toBe('pawn+0x1f7c');
  });
  it('captures the actual fractional movement pose once, not a guessed jump impulse or release pose',()=>{
    const latch=new GrenadeJumpLatch();latch.observe({...pose(0),jumpedAt:undefined},pose(0),0);
    for(let tick=1;tick<50;tick++)latch.observe(pose((tick-1)*STEP),pose(tick*STEP),tick*STEP);
    for(const t of [.12,.2,.29]){
      const cached=latch.sample(t)!;expect(cached.position.x).toBeCloseTo(native.constants.delay,10);
      expect(cached.verticalVelocity).toBeCloseTo(7-20*native.constants.delay,10);
    }
    expect(latch.sample(.31)).toBeUndefined();
  });
  it('does not schedule from an airborne jump-key press without a real takeoff',()=>{
    const latch=new GrenadeJumpLatch();
    latch.observe({...pose(0),jumpedAt:undefined},{...pose(STEP),jumpedAt:undefined},STEP);
    expect(latch.eligible(.12)).toBe(false);
  });
  it.each([false,true])('manual jump throws retain one pose across different release offsets, crouch=%s',crouch=>{
    const launches=[0,.04,.08,.12].map(delay=>{
      const sim=new DuelSimulation(sanitizeDuelConfig({botUtilities:false,utilityLoadout:['smoke']}),24,testArena());
      sim.command(1,{});sim.selectUtility('smoke');sim.start();sim.command(0,{fireHeld:true});sim.step();
      const thrown=vi.spyOn(sim.utilities,'throw');
      sim.command(0,{jump:true,crouch});sim.step();
      for(let i=0;i<Math.round(delay/STEP);i++)sim.step();
      sim.command(0,{fireHeld:false});
      for(let i=0;i<64&&!thrown.mock.calls.length;i++)sim.step();
      expect(thrown).toHaveBeenCalledOnce();const input=thrown.mock.calls[0][0];
      expect(input.velocity!.y).toBeGreaterThan(200*UNIT);return {origin:input.origin,velocity:input.velocity};
    });
    for(const launch of launches)expect(launch).toEqual(launches[0]);
  });
  it.each([false,true])('keeps the forgiving release window, including release before takeoff, crouch=%s',crouch=>{
    const launches=Array.from({length:37},(_,i)=>i-12).map(offset=>{
      const sim=new DuelSimulation(sanitizeDuelConfig({botUtilities:false,utilityLoadout:['smoke']}),24,testArena());
      sim.command(1,{});sim.selectUtility('smoke');sim.start();sim.command(0,{fireHeld:true});
      for(let i=0;i<16;i++)sim.step();
      const thrown=vi.spyOn(sim.utilities,'throw');
      for(let tick=-12;tick<64&&!thrown.mock.calls.length;tick++){
        if(tick===0)sim.command(0,{jumpPressed:true,crouch});
        if(tick===offset)sim.command(0,{fireHeld:false});
        sim.step();
      }
      expect(thrown).toHaveBeenCalledOnce();
      const input=thrown.mock.calls[0][0];
      return {offset,origin:input.origin,velocity:input.velocity};
    });
    const reference=launches.find(sample=>sample.offset===0)!;
    for(const launch of launches){
      expect(launch.origin,`release offset ${launch.offset} ticks`).toEqual(reference.origin);
      expect(launch.velocity,`release offset ${launch.offset} ticks`).toEqual(reference.velocity);
    }
  });
});
