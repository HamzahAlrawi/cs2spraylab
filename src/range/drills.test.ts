import {describe,it,expect,vi} from 'vitest';
import {angleTo,createScenario,DrillCoach,headVisible,isDrillMode,moveWithCover,PEEK_WALLS,RANGE_WALLS,segmentBlocked,HEAD_HEIGHT,readDrillMetrics,exposedHead,type CoachSample} from './drills';
import {Simulation,STEP,UNIT,idleInput} from './simulation';
import {defaults,sanitizeSettings} from './config';

function seeded(seed=943) {return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
describe('Peeking geometry',()=>{
  it('adds usable cover to ordinary modes without blocking the central and transfer firing lanes',()=>{
    const sim=new Simulation({...defaults});
    for(const x of [0,-3.25,3.25])expect(segmentBlocked(sim.position,{x,y:HEAD_HEIGHT,z:-100},RANGE_WALLS)).toBe(false);
    const cover=RANGE_WALLS[1];
    sim.position.x=cover.center.x;sim.active=true;sim.input.forward=1;
    for(let i=0;i<200;i++)sim.step(STEP);
    expect(sim.position.z).toBeCloseTo(cover.center.z+cover.size.z/2+16*UNIT);
    expect(segmentBlocked(sim.position,{x:cover.center.x,y:HEAD_HEIGHT,z:-100},RANGE_WALLS)).toBe(true);
    sim.input.forward=0;sim.input.side=1;
    for(let i=0;i<64;i++)sim.step(STEP);
    expect(sim.position.x).toBeGreaterThan(cover.center.x+cover.size.x/2+16*UNIT);
  });
  it('spawns hidden, exposes the intended half or head, and gives 65% lateral cover plus head-only cases',()=>{
    const random=seeded();const counts={open:0,left:0,right:0,head:0};
    for(let i=0;i<1000;i++){
      const s=createScenario('peek',i,'mixed',random);counts[s.exposure]++;
      expect(headVisible(s.spawn,s.target,s.covers)).toBe(false);
      const origin={...s.spawn,x:s.spawn.x+s.side*2.05};
      expect(headVisible(origin,s.target,s.covers)).toBe(true);
      expect(segmentBlocked(origin,exposedHead(s),s.covers)).toBe(false);
      if(s.exposure==='head')expect(segmentBlocked(origin,{...s.target,y:s.target.y+1.35},s.covers)).toBe(true);
      if(s.exposure==='left'||s.exposure==='right'){
        const visible=s.exposure==='left'?-1:1;
        expect(segmentBlocked(origin,{...s.target,x:s.target.x+visible*.2,y:s.target.y+1.1},s.covers)).toBe(false);
        expect(segmentBlocked(origin,{...s.target,x:s.target.x-visible*.2,y:s.target.y+1.1},s.covers)).toBe(true);
      }
    }
    expect(counts.left+counts.right).toBeGreaterThan(610);expect(counts.left+counts.right).toBeLessThan(690);
    expect(counts.head).toBeGreaterThan(110);expect(counts.head).toBeLessThan(190);
    expect(counts.left).toBeGreaterThan(250);expect(counts.right).toBeGreaterThan(250);expect(counts.open).toBeGreaterThan(150);
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
  it('counts accurate hits separately from stationary misses and moving hits',()=>{
    const {coach,sample}=coachFixture();sample.position.x+=2.2;
    coach.record(sample,false,false);
    expect(coach.result().accurateShots).toBe(0);expect(coach.result().settledShots).toBe(1);
    coach.record(sample,true,true);
    sample.velocity.x=5;coach.record(sample,true,false);
    const m=coach.result();expect(m.shots).toBe(3);expect(m.hits).toBe(2);expect(m.accurateShots).toBe(1);expect(m.settledShots).toBe(2);expect(m.passed).toBe(false);
  });
  it('does not invent accurate-hit counts for older history and survives saving it again',()=>{
    const {coach,sample}=coachFixture();const legacy={...coach.record(sample,false,false)} as Record<string,unknown>;
    delete legacy.settledShots;delete legacy.accuracyVerified;legacy.accurateShots=1;
    const migrated=readDrillMetrics(legacy)!;
    expect(migrated.settledShots).toBe(1);expect(migrated.accuracyVerified).toBe(false);
    expect(readDrillMetrics(migrated)).toEqual(migrated);
  });
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
  it('requires repositioning between six-round bursts',()=>{
    const sim=new Simulation({...defaults,mode:'burst'});
    sim.onShot=s=>sim.samples.push({x:0,y:0,hit:true,head:false,bullet:s.index+1});
    sim.start(true);for(let i=0;i<3;i++)sim.advance(.2);expect(sim.drill?.shots).toBe(6);
    for(let i=0;i<10;i++)sim.advance(.2);
    expect(sim.drillRound).toBe(1);expect(sim.start()).toBe(false);
    sim.input.forward=1;for(let i=0;i<80;i++)sim.step(STEP);
    expect(sim.drillRound).toBe(1);
    sim.input.forward=0;
    sim.input.side=1;for(let i=0;i<80;i++)sim.step(STEP);
    expect(sim.drillRound).toBe(2);
  });
  it('caps a reposition rep at six shots even across multiple trigger presses',()=>{
    const sim=new Simulation({...defaults,mode:'burst'});
    sim.onShot=s=>sim.samples.push({x:0,y:0,hit:true,head:false,bullet:s.index+1});
    sim.start();sim.advance(.15);sim.release('mouse');
    expect(sim.drill?.shots).toBe(2);
    sim.start(true);for(let i=0;i<4;i++)sim.advance(.2);
    expect(sim.drill?.shots).toBe(6);expect(sim.latest?.shots).toBe(6);expect(sim.drill?.finished).toBe(true);
  });
  it('starts the peeking timer at the first shot, not exposure, and advances automatically',()=>{
    const sim=new Simulation({...defaults,mode:'peek',drillPace:'challenge'});sim.active=true;
    for(let i=0;i<2000;i++)sim.step(STEP);
    expect(sim.drillCompleted).toBe(0);expect(sim.drill?.seenAt).toBeNull();
    sim.input.side=1;for(let i=0;i<300;i++)sim.step(STEP);
    expect(sim.drillCompleted).toBe(0);expect(sim.drill?.seenAt).not.toBeNull();
    sim.input=idleInput();sim.start(true);
    for(let i=0;i<140;i++)sim.step(STEP);
    expect(sim.drillCompleted).toBe(1);expect(sim.drillRound).toBe(2);
  });
  it('keeps headshots and accurate-shot totals accumulating for the whole configured peeking window',()=>{
    const sim=new Simulation({...defaults,mode:'peek',peekDuration:2.5,burst:5});
    sim.onShot=s=>sim.samples.push({x:0,y:0,hit:true,head:true,bullet:s.index+1});
    sim.start(true);for(let i=0;i<6;i++)sim.advance(.2);
    expect(sim.drill?.shots).toBeGreaterThan(10);expect(sim.drill?.finished).toBe(false);
    expect(sim.drill?.result().accurateShots).toBe(sim.drill?.shots);
    expect(sim.drill?.heads).toBe(sim.drill?.shots);
    sim.cancel();const time=sim.time;sim.advance(10);expect(sim.time).toBe(time);
    sim.active=true;sim.start(true);for(let i=0;i<8;i++)sim.advance(.2);
    expect(sim.drillCompleted).toBe(1);expect(sim.drillRound).toBe(2);
    expect(sim.latest?.drill?.accurateShots).toBeGreaterThan(20);
  });
  it('migrates and bounds the peeking-only duration setting',()=>{
    expect(sanitizeSettings({}).peekDuration).toBe(1);
    expect(sanitizeSettings({peekDuration:NaN}).peekDuration).toBe(1);
    expect(sanitizeSettings({peekDuration:-1}).peekDuration).toBe(.5);
    expect(sanitizeSettings({peekDuration:100}).peekDuration).toBe(10);
    expect(sanitizeSettings({peekDuration:4.25}).peekDuration).toBe(4.25);
  });
  it('restores the normal firing line when leaving the drill',()=>{
    const sim=new Simulation({...defaults,mode:'peek'});sim.configure(defaults);
    expect(sim.drill).toBeUndefined();expect(sim.position.z).toBe(-88);expect(sim.position.x).toBe(0);
    expect(isDrillMode('tracking')).toBe(false);
  });
});
