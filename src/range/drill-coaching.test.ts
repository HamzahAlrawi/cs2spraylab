import {describe,expect,it} from 'vitest';
import {angleTo,createScenario,DrillCoach,drillCoaching,exposedHead,readDrillMetrics,type CoachSample,type DrillMetrics,type DrillMode} from './drills';
import {defaults,gameData} from './config';
import {idleInput,Simulation,UNIT} from './simulation';
import {accuracySpeedUnits} from './shot-model';
import {movementInaccuracy} from './ballistics';

function fixture(mode:DrillMode='precision',range=12,equipment?:string){
  const scenario=createScenario(mode,0,'common',()=>.9);
  scenario.spawn={x:0,y:64*UNIT,z:0};scenario.target={x:0,y:0,z:-range};scenario.covers=[];
  const sample:CoachSample={time:0,position:{...scenario.spawn},yaw:0,pitch:0,velocity:{x:0,z:0},speedCap:215*UNIT,input:idleInput(),feet:0,grounded:true,equipment};
  Object.assign(sample,angleTo(sample.position,exposedHead(scenario)));
  const coach=new DrillCoach(mode,scenario,0);coach.update(sample);
  return {coach,sample,scenario};
}
function brake(f:ReturnType<typeof fixture>,entry=1,counter=true){
  const {coach,sample,scenario}=f;
  sample.position.x=.7;sample.velocity.x=sample.speedCap*entry;sample.input.side=1;sample.time=.1;
  Object.assign(sample,angleTo(sample.position,exposedHead(scenario)));coach.update(sample);
  sample.input.side=counter?-1:0;sample.time=.2;coach.update(sample);
  sample.velocity.x=0;sample.time=.3;coach.update(sample);
  sample.input.side=0;sample.time=.34;
  return f;
}

describe('Contextual drill skill measures',()=>{
  it('separates the observed brake, opening speed and first physical hit',()=>{
    const {coach,sample}=brake(fixture());const rep=coach.record(sample,true,false);
    expect(rep).toMatchObject({firstSettled:true,firstHit:true,firstHead:false,counterStrafed:true,movementScore:100,passed:true});
    expect(rep.coaching?.score).toBe(100);
    expect(rep.coaching?.metrics.find(m=>m.label==='Opposite-key brake')).toMatchObject({value:'Observed',score:100});
    expect(rep.coaching?.evidence).toContain('0 u/s');
  });
  it('cannot score a lucky moving opening as a strong brake or clean entry',()=>{
    const {coach,sample}=fixture();sample.position.x=.7;sample.velocity.x=sample.speedCap;sample.time=.2;
    const rep=coach.record(sample,true,true);
    expect(rep.firstSettled).toBe(false);expect(rep.passed).toBe(false);
    expect(rep.movementScore).toBeLessThanOrEqual(30);expect(rep.coaching?.score).toBeLessThanOrEqual(35);
    expect(rep.coaching?.focus).toBe('Brake before the opening shot');
  });
  it.each([0,.33,.4,.64])('does not pass or highly score a %.2f precision entry speed ratio',entry=>{
    const {coach,sample}=brake(fixture(),entry);const rep=coach.record(sample,true,true);
    expect(rep.passed).toBe(false);expect(rep.coaching?.score).toBeLessThanOrEqual(30);
    expect(rep.coaching?.evidence).toContain('65%');
  });
  it('accepts exactly the 65% entry target rather than silently requiring a full sprint',()=>{
    const {coach,sample}=brake(fixture(),.65);const rep=coach.record(sample,true,true);
    expect(rep.passed).toBe(true);expect(rep.entrySpeedRatio).toBeCloseTo(.65);expect(rep.movementScore).toBe(100);
  });
  it('does not call coasting or already stationary shooting counter-strafing',()=>{
    const {coach,sample}=brake(fixture('peek'),1,false);const rep=coach.record(sample,true,true);
    expect(rep.firstSettled).toBe(true);expect(rep.counterStrafed).toBe(false);expect(rep.passed).toBe(false);
    expect(rep.coaching?.focus).toBe('Use the opposite key');expect(rep.coaching?.score).toBeLessThanOrEqual(65);
  });
  it('does not punish a diagonal entry after both velocity components settle',()=>{
    const a=brake(fixture('peek')),b=brake(fixture('peek'));
    b.coach.diagonal=true;
    const normal=a.coach.record(a.sample,true,true),diagonal=b.coach.record(b.sample,true,true);
    expect(diagonal.passed).toBe(true);expect(diagonal.coaching?.score).toBe(normal.coaching?.score);
    expect(diagonal.coaching?.focus).toBe(normal.coaching?.focus);
  });
  it('can observe a forward counter-brake without inventing it from low speed',()=>{
    const {coach,sample}=fixture();sample.position.z=-.7;sample.velocity.z=-sample.speedCap;sample.input.forward=1;sample.time=.1;coach.update(sample);
    sample.input.forward=-1;sample.time=.2;coach.update(sample);
    sample.velocity.z=0;sample.input.forward=0;sample.time=.3;coach.update(sample);
    expect(coach.record(sample,true,true).counterStrafed).toBe(true);
  });
  it('uses native float32 movement eligibility at the exact crouch-speed boundary',()=>{
    const {coach,sample}=fixture();const stats=gameData.weapons.ak47;
    sample.accuracyStats=stats;sample.velocity.x=stats.speed*.34*UNIT;
    const speed=accuracySpeedUnits(sample.velocity);
    expect(movementInaccuracy(stats,speed/stats.speed,false,speed)).toBe(0);
    const rep=coach.record(sample,true,true);
    expect(rep.firstSettled).toBe(true);expect(rep.speedAtShot).toBe(speed);expect(rep.settledShots).toBe(1);
  });
  it('uses the active accuracy stats rather than an unrelated speed cap',()=>{
    const {coach,sample}=fixture();sample.accuracyStats={...gameData.weapons.ak47,speed:100};
    sample.velocity.x=40*UNIT;sample.speedCap=260*UNIT;
    expect(coach.record(sample,true,true)).toMatchObject({firstSettled:false,accurateShots:0});
  });
  it('records landing requirements separately from horizontal movement',()=>{
    const {coach,sample}=brake(fixture());sample.grounded=false;sample.feet=.01;
    const rep=coach.record(sample,true,true);
    expect(rep.firstAirborne).toBe(true);expect(rep.firstSettled).toBe(false);
    expect(rep.coaching?.focus).toBe('Land before the opening shot');
  });
  it('normalizes aiming by the apparent target size at both near and far ranges',()=>{
    const shot=(range:number,ratio:number)=>{
      const f=brake(fixture('precision',range));
      const radius=Math.atan2(.115,Math.hypot(f.sample.position.x,1.63-f.sample.position.y,range));
      f.sample.yaw+=radius*ratio;return f.coach.record(f.sample,true,true);
    };
    const near=shot(6,2),far=shot(80,2);
    expect(near.shotError).toBeGreaterThan(far.shotError*10);
    expect(near.shotAimRatio).toBeCloseTo(2,4);expect(far.shotAimRatio).toBeCloseTo(2,4);
    expect(near.coaching?.score).toBe(far.coaching?.score);
    expect(far.coaching?.evidence).toContain('target radii');
  });
  it('permits deliberate off-angle correction without scoring raw mouse travel',()=>{
    const {coach,sample,scenario}=brake(fixture('peek'));
    scenario.name='Off-angle / right';coach.stopAimRatio=9;coach.mouse(20);
    const rep=coach.record(sample,true,true);
    expect(rep.excessCorrection).toBeGreaterThan(10);expect(rep.coaching?.score).toBe(100);
    expect(rep.coaching?.action).toContain('deliberate off-angle correction');
    expect(rep.coaching?.metrics.find(m=>m.label==='Aim at the opening shot')?.score).toBe(100);
  });
  it('uses chest preparation for body-focused weapons, with head-only cover overriding it',()=>{
    const f=brake(fixture('precision',12,'awp'));
    Object.assign(f.sample,angleTo(f.sample.position,{...f.scenario.target,y:1.15}));
    const rep=f.coach.record(f.sample,true,false);
    expect(rep.aimTarget).toBe('body');expect(rep.shotAimRatio).toBeCloseTo(0);expect(rep.passed).toBe(true);
    expect(rep.coaching?.score).toBe(100);expect(rep.coaching?.action).not.toContain('headshot');
    const onlyHead=fixture('peek',12,'awp');onlyHead.scenario.exposure='head';
    const head=onlyHead.coach.record(onlyHead.sample,true,true);
    expect(head.aimTarget).toBe('head');expect(head.shotAimRatio).toBeCloseTo(0);
  });
  it('does not diagnose body hits as low aim when the weapon is unknown',()=>{
    const a=brake(fixture()),b=brake(fixture());
    const head=a.coach.record(a.sample,true,true),body=b.coach.record(b.sample,true,false);
    expect(body.aimTarget).toBe('target');expect(body.passed).toBe(true);
    expect(body.coaching?.score).toBe(head.coaching?.score);expect(body.coaching?.focus).toBe(head.coaching?.focus);
  });
  it('does not let a good later spray overwrite a bad opening',()=>{
    const {coach,sample}=brake(fixture('peek'));coach.record(sample,false,false);
    for(let i=0;i<5;i++)coach.record(sample,true,true);
    const rep=coach.result();
    expect(rep.hits).toBe(5);expect(rep.firstHit).toBe(false);expect(rep.passed).toBe(false);
    expect(rep.coaching?.focus).toBe('Find the opening hit');expect(rep.coaching?.evidence).toContain('Opening shot missed');
  });
  it('only earns timing credit for a settled and aligned opening, not a fast miss',()=>{
    const {coach,sample}=brake(fixture('peek'));sample.yaw+=.1;
    const rep=coach.record(sample,false,false);
    expect(rep.stopToShotMs).toBeCloseTo(40);
    expect(rep.coaching?.metrics.find(m=>m.label==='Stop to opening shot')?.score).toBe(0);
    expect(rep.coaching?.focus).toBe('Finish the correction before firing');
  });
  it('gives slower but deliberate openings a timing goal, not a fake reaction-time diagnosis',()=>{
    const {coach,sample}=brake(fixture('peek'));sample.time=.58;
    const rep=coach.record(sample,true,true);
    expect(rep.stopToShotMs).toBeCloseTo(280);
    expect(rep.coaching?.focus).toBe('Commit after alignment');expect(rep.coaching?.goal).toContain('local 250 ms');
    expect(rep.coaching?.action).not.toMatch(/reaction|reflex/);
  });
});

describe('Six-shot control and compatible stored repetitions',()=>{
  const burst=(hits:boolean[])=>{const {coach,sample}=brake(fixture('burst'));for(const hit of hits)coach.record(sample,hit,false);return coach.result();};
  it('distinguishes late control from a weak opening using real shot partitions',()=>{
    const lateLoss=burst([true,true,true,false,false,false]);
    expect(lateLoss).toMatchObject({earlyShots:3,earlyHits:3,lateShots:3,lateHits:0,passed:false});
    expect(lateLoss.coaching?.focus).toBe('Hold the last three shots');
    expect(lateLoss.coaching?.evidence).toContain('3/3 hits');expect(lateLoss.coaching?.evidence).toContain('0/3 hits');
    const weakOpening=burst([false,false,false,true,true,true]);
    expect(weakOpening.coaching?.focus).toBe('Find the opening hit');
    expect(lateLoss.coaching?.action).toContain('do not tell whether');
  });
  it('does not demand headshots for six-shot burst control and passes the explicit late-shot goal',()=>{
    const rep=burst([true,true,false,true,true,false]);
    expect(rep).toMatchObject({shots:6,hits:4,heads:0,earlyHits:2,lateHits:2,passed:true});
    expect(rep.coaching?.goal).toContain('at least 2 of the final 3');
  });
  it('does not prescribe a head correction for a deliberate body-targeted rifle burst',()=>{
    const {coach,sample,scenario}=brake(fixture('burst',12,'ak47'));
    Object.assign(sample,angleTo(sample.position,{...scenario.target,y:1.1}));
    for(let i=0;i<6;i++)coach.record(sample,true,false);
    const rep=coach.result();
    expect(rep.shotAimRatio).toBeGreaterThan(1);expect(rep.passed).toBe(true);
    expect(rep.coaching?.score).toBe(100);expect(rep.coaching?.focus).toBe('Repeat the controlled burst');
    expect(rep.coaching?.metrics.some(m=>m.label==='Aim at the opening shot')).toBe(false);
  });
  it('does not call an incomplete burst or three early hits plus one late hit clean',()=>{
    const incomplete=burst([true,true,true,true]);expect(incomplete.passed).toBe(false);expect(incomplete.coaching?.score).toBeNull();
    expect(incomplete.coaching?.focus).toBe('Complete the six-shot sample');
    expect(burst([true,true,true,true,false,false]).passed).toBe(false);
    const complete=burst([true,true,true,true,true,true]);expect(complete.passed).toBe(true);expect(complete.coaching?.score).toBe(100);
  });
  it('persists a valid measured summary but drops invalid optional summaries without losing history',()=>{
    const rep=burst([true,true,true,true,true,true]);
    expect(readDrillMetrics(JSON.parse(JSON.stringify(rep)))).toEqual(JSON.parse(JSON.stringify(rep)));
    const repaired=readDrillMetrics({...rep,coaching:{...rep.coaching,score:Infinity}})!;
    expect(repaired.shots).toBe(6);expect(repaired.coaching).toBeUndefined();
    expect(readDrillMetrics({...rep,earlyShots:100,lateHits:20})).toMatchObject({shots:6});
    expect(readDrillMetrics({...rep,earlyShots:100})?.earlyHits).toBeUndefined();
  });
  it('does not invent opening, burst-segment or target-size measurements for legacy data',()=>{
    const rep=burst([true,true,true,true,true,true]) as DrillMetrics;
    for(const key of ['coaching','firstSettled','firstAirborne','firstHit','firstHead','speedLimit','aimRadiusDegrees','aimTarget','entryAimRatio','shotAimRatio','stopAimRatio','earlyShots','earlyHits','lateShots','lateHits'] as const)delete rep[key];
    const restored=readDrillMetrics(rep)!;
    const summary=drillCoaching('burst',restored);
    expect(summary.score).toBeNull();expect(summary.confidence).toContain('Partial rep');
    expect(summary.metrics.find(m=>m.label==='Last three shots')).toMatchObject({value:'Not measured',score:null});
  });
  it('reuses the stable completed summary instead of rebuilding metrics on every HUD update',()=>{
    const {coach,sample}=brake(fixture());coach.record(sample,true,true);
    const completed=coach.result(true);coach.finished=true;
    expect(completed.passed).toBe(false);
    expect(coach.result()).toBe(completed);expect(coach.result().coaching).toBe(completed.coaching);
  });
  it('preserves the sampler integration without changing simulation shot or impact coordinates',()=>{
    const sim=new Simulation({...defaults,mode:'precision'});
    expect(sim.coachSample().position).toBe(sim.position);expect(sim.coachSample().velocity).toBe(sim.velocity);
    const before={position:{...sim.position},velocity:{...sim.velocity},yaw:sim.yaw,pitch:sim.pitch};
    sim.drill!.record(sim.coachSample(),false,false);
    expect({position:sim.position,velocity:sim.velocity,yaw:sim.yaw,pitch:sim.pitch}).toEqual(before);
  });
});
