import {describe,it,expect,vi} from 'vitest';
import {angleTo,createScenario,DrillCoach,headVisible,isDrillMode,moveWithCover,PEEK_WALLS,segmentBlocked,HEAD_HEIGHT,readDrillMetrics,type CoachSample} from './drills';
import {Simulation,STEP,UNIT,idleInput} from './simulation';
import {defaults} from './config';

function seeded(seed=943) {return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
describe('Peeking geometry',()=>{
  it('spawns hidden, exposes heads from the firing lane, and covers about 65% of targets',()=>{
    const random=seeded();let covered=0;
    for(let i=0;i<1000;i++){
      const s=createScenario('peek',i,'mixed',random);covered+=+s.covered;
      expect(headVisible(s.spawn,s.target,s.covers)).toBe(false);
      const origin={...s.spawn,x:s.spawn.x+s.side*2.3};
      expect(headVisible(origin,s.target,s.covers)).toBe(true);
      if(s.covered)expect(segmentBlocked(origin,{...s.target,y:s.target.y+.45},s.covers)).toBe(true);
    }
    expect(covered).toBeGreaterThan(610);expect(covered).toBeLessThan(690);
  });
  it('creates left/right, near/deep, elevated and off-angle variants',()=>{
    const random=seeded();const s=Array.from({length:80},(_,i)=>createScenario('peek',i,'mixed',random));
    expect(new Set(s.map(s=>s.kind)).size).toBe(4);
    expect(new Set(s.map(s=>s.side)).size).toBe(2);
    expect(s.some(s=>s.target.y>.4)).toBe(true);
    expect(s.some(s=>s.target.z===-99)).toBe(true);
  });
  it('blocks hull movement at walls but allows strafing along them and movement above low cover',()=>{
    const from={x:-7.5,y:1.6256,z:-80.5};
    expect(moveWithCover(from,{...from,z:-85},PEEK_WALLS,0,1.83).z).toBeCloseTo(-82.6+16*UNIT);
    expect(moveWithCover(from,{...from,x:-6.5},PEEK_WALLS,0,1.83).x).toBe(-6.5);
    const box=[{id:'box',center:{x:0,y:.4,z:-2},size:{x:2,y:.8,z:1}}];
    expect(moveWithCover({x:0,y:2,z:0},{x:0,y:2,z:-3},box,1,1.8).z).toBe(-3);
  });
  it('handles parallel rays and ignores boxes behind the endpoint',()=>{
    const box=[{id:'wall',center:{x:0,y:1,z:-5},size:{x:2,y:2,z:1}}];
    expect(segmentBlocked({x:0,y:1,z:0},{x:0,y:1,z:-10},box)).toBe(true);
    expect(segmentBlocked({x:2,y:1,z:0},{x:2,y:1,z:-10},box)).toBe(false);
    expect(segmentBlocked({x:0,y:1,z:0},{x:0,y:1,z:-3},box)).toBe(false);
  });
});
function coachFixture(){
  const scenario=createScenario('peek',0,'common',()=>.2);
  const coach=new DrillCoach('peek',scenario,0);
  const sample:CoachSample={time:0,position:{...scenario.spawn},yaw:scenario.yaw,pitch:scenario.pitch,velocity:{x:0,z:0},speedCap:215*UNIT,input:idleInput(),feet:0};
  return{scenario,coach,sample};
}
describe('Evidence-based drill feedback',()=>{
  it('ignores malformed saved coaching metrics without losing the rest of the history',()=>{
    const {coach,sample}=coachFixture();const m=coach.record(sample,false,false);
    expect(readDrillMetrics(m)).toEqual(m);
    expect(readDrillMetrics({...m,shotError:'bad'})).toBeUndefined();
    expect(readDrillMetrics({...m,entryError:undefined})).toBeUndefined();
    expect(readDrillMetrics(null)).toBeUndefined();
  });
  it('rewards braking from a strafe, alignment at the stop, and an accurate head hit',()=>{
    const {scenario,coach,sample}=coachFixture();
    coach.update(sample);
    sample.position={...sample.position,x:sample.position.x+2.1};sample.velocity.x=5;sample.input.side=1;sample.time=.4;
    Object.assign(sample,angleTo(sample.position,{...scenario.target,y:scenario.target.y+HEAD_HEIGHT}));coach.update(sample);
    sample.input.side=-1;sample.velocity.x=3;sample.time=.43;coach.update(sample);
    sample.velocity.x=.7;sample.time=.49;coach.update(sample);
    sample.velocity.x=.1;sample.input.side=0;sample.time=.51;
    const m=coach.record(sample,true,true);
    expect(m.counterStrafed).toBe(true);expect(m.stoppedOnTarget).toBe(true);expect(m.passed).toBe(true);
    expect(m.stopToShotMs).toBeCloseTo(20);expect(m.exposureMs).toBeCloseTo(110);
  });
  it('does not call a stationary hit or coasting stop a successful counter-strafe',()=>{
    const {coach,sample}=coachFixture();sample.position.x+=2.2;
    expect(coach.record(sample,true,true).counterStrafed).toBe(false);
    expect(coach.result().passed).toBe(false);
  });
  it('does not mistake a pause for braking with the opposite key',()=>{
    const sim=new Simulation({...defaults,mode:'peek'});
    sim.position.x+=2.2;sim.velocity.x=5;sim.input.side=1;sim.drill!.update(sim.coachSample());
    sim.velocity.x=3;sim.input.side=-1;sim.time=.1;sim.drill!.update(sim.coachSample());
    expect(sim.drill!.counterAt).not.toBeNull();
    sim.cancel();sim.active=true;sim.step(STEP);
    expect(sim.drill!.record(sim.coachSample(),true,true).counterStrafed).toBe(false);
    expect(sim.drill!.stopAt).toBeNull();
  });
  it('flags firing while moving and does not reward a lucky hit',()=>{
    const {coach,sample}=coachFixture();sample.position.x+=2.2;sample.velocity.x=5;sample.input.side=1;
    const m=coach.record(sample,true,true);
    expect(m.accurateShots).toBe(0);expect(m.passed).toBe(false);expect(m.verdict).toBe('Shot before stopping');
  });
  it('counts deliberate off-angle correction separately from excess mouse travel',()=>{
    const {coach,sample}=coachFixture();sample.position.x+=2.2;sample.yaw+=.12;coach.update(sample);
    const error=coach.entryError!;expect(error).toBeGreaterThan(4);
    coach.mouse(error);expect(coach.record(sample,true,true).excessCorrection).toBeCloseTo(0);
  });
  it('a jump cannot qualify as an accurate shot even at zero horizontal speed',()=>{
    const {coach,sample}=coachFixture();sample.feet=.1;sample.position.x+=2.2;
    expect(coach.record(sample,true,true).accurateShots).toBe(0);
  });
});
describe('Drill lifecycle',()=>{
  it('limits precision to one shot, stores feedback and advances to the next target',()=>{
    const sim=new Simulation({...defaults,mode:'precision'});
    const results=vi.fn();sim.onResult=results;
    sim.onShot=s=>sim.samples.push({x:0,y:0,hit:true,head:true,bullet:s.index+1});
    sim.start(true);expect(sim.drill?.shots).toBe(1);expect(results).toHaveBeenCalledOnce();
    expect(sim.latest?.drill?.passed).toBe(true);
    sim.advance(.25);expect(sim.start()).toBe(false);
    for(let i=0;i<8;i++)sim.advance(.2);
    expect(sim.drillRound).toBe(2);expect(sim.drill?.finished).toBe(false);
  });
  it('requires repositioning between three-round bursts',()=>{
    const sim=new Simulation({...defaults,mode:'burst'});
    sim.onShot=s=>sim.samples.push({x:0,y:0,hit:true,head:false,bullet:s.index+1});
    sim.start(true);sim.advance(.25);expect(sim.drill?.shots).toBe(3);
    for(let i=0;i<10;i++)sim.advance(.2);
    expect(sim.drillRound).toBe(1);expect(sim.start()).toBe(false);
    sim.input.forward=1;for(let i=0;i<80;i++)sim.step(STEP);
    expect(sim.drillRound).toBe(1);
    sim.input.forward=0;
    sim.input.side=1;for(let i=0;i<80;i++)sim.step(STEP);
    expect(sim.drillRound).toBe(2);
  });
  it('does not expire a peek while the player is still behind cover',()=>{
    const sim=new Simulation({...defaults,mode:'peek',drillPace:'challenge'});sim.active=true;
    for(let i=0;i<2000;i++)sim.step(STEP);
    expect(sim.drillCompleted).toBe(0);expect(sim.drill?.seenAt).toBeNull();
    sim.input.side=1;for(let i=0;i<300;i++)sim.step(STEP);
    expect(sim.drillCompleted).toBeGreaterThan(0);
  });
  it('restores the normal firing line when leaving the drill',()=>{
    const sim=new Simulation({...defaults,mode:'peek'});sim.configure(defaults);
    expect(sim.drill).toBeUndefined();expect(sim.position.z).toBe(-88);expect(sim.position.x).toBe(0);
    expect(isDrillMode('tracking')).toBe(false);
  });
});
