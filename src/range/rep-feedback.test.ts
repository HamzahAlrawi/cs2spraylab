import {it,expect} from 'vitest';
import {createScenario,DrillCoach,type DrillMetrics,type DrillMode} from './drills';
import {makeRepFeedback} from './rep-feedback';

function fixture(mode:DrillMode,patch:Partial<DrillMetrics>={}):DrillMetrics{
  const base=new DrillCoach(mode,createScenario(mode,0,'common',()=>.9),0).result();
  delete base.coaching;
  return {...base,shots:1,hits:1,heads:1,accurateShots:1,settledShots:1,accuracyVerified:true,
    firstSettled:true,firstAirborne:false,firstHit:true,firstHead:true,speedLimit:73.1,speedAtShot:2,
    entryError:.1,entrySpeedRatio:1,movementScore:99,counterStrafed:true,passed:true,
    aimTarget:'head',aimRadiusDegrees:.5,entryAimRatio:.2,shotAimRatio:.2,stopAimRatio:.2,
    stopError:.1,stopToShotMs:40,earlyShots:1,earlyHits:1,lateShots:0,lateHits:0,...patch};
}

it('coaches stationary-only precision with measured entry speed and a specific goal',()=>{
  const stationary=fixture('precision',{entrySpeedRatio:0,movementScore:0,counterStrafed:false,passed:false});
  const feedback=makeRepFeedback('precision',stationary,[]);
  expect(feedback.message).toContain('Build a real entry');
  expect(feedback.evidence).toContain('0%');expect(feedback.evidence).toContain('65%');
  expect(feedback.goal).toContain('Next 5 reps');expect(feedback.goal).toContain('65%+');
  expect(feedback.coaching?.score).toBeLessThanOrEqual(30);
});

it('does not penalize settled diagonal entries, body hits or necessary mouse movement',()=>{
  const baseline=makeRepFeedback('peek',fixture('peek'),[]);
  const varied=makeRepFeedback('peek',fixture('peek',{diagonal:true,heads:0,firstHead:false,mouseCorrection:14,excessCorrection:8}),[]);
  expect(varied.message).toBe(baseline.message);expect(varied.coaching?.score).toBe(baseline.coaching?.score);
  expect(varied.tip).not.toMatch(/Body hit|diagonal|Over-corrected/);
  const offAngle=makeRepFeedback('peek',fixture('peek',{scenario:'Off-angle / right',stopAimRatio:12,shotAimRatio:.4,excessCorrection:8}),[]);
  expect(offAngle.tip).toContain('deliberate off-angle correction');
  expect(offAngle.coaching?.score).toBe(100);
});

it('emphasizes three matching issues with a smaller measurable practice task',()=>{
  const moving=fixture('peek',{firstSettled:false,settledShots:0,speedAtShot:180,accurateShots:0,passed:false});
  const feedback=makeRepFeedback('peek',moving,[]);
  expect(feedback.message).toContain('Brake before the opening shot');expect(feedback.passed).toBe(false);
  expect(feedback.evidence).toContain('180 u/s');expect(feedback.evidence).toContain('73 u/s');
  expect(feedback.tip).toContain('Counter-strafe before firing');
  expect(feedback.tip).not.toMatch(/\b[A-DW]\b|W\/S/);
  expect(makeRepFeedback('peek',moving,[moving,moving]).tip).toContain('Try this next (3 similar reps): Take 3 grounded single-shot reps');
  expect(makeRepFeedback('peek',moving,[moving,moving]).coaching?.action).toContain('Take 3 grounded single-shot reps');
  const clean=fixture('peek');
  expect(makeRepFeedback('peek',moving,[clean,moving]).tip).not.toContain('Try this next');
  expect(makeRepFeedback('peek',clean,[moving,moving]).message).toContain('Repeat the controlled entry');
});

it('does not diagnose a settled miss as movement inaccuracy or low head height',()=>{
  const miss=fixture('precision',{hits:0,heads:0,firstHit:false,firstHead:false,accurateShots:0,passed:false});
  const feedback=makeRepFeedback('precision',miss,[]);
  expect(feedback.message).toContain('Find the opening hit');
  expect(feedback.tip).toContain('weapon recovery');
  expect(feedback.tip).toContain('not proof of bad movement');
});

it('does not call the time spent correcting an off-angle unnecessary hesitation',()=>{
  const rep=fixture('peek',{scenario:'Off-angle / right',stopAimRatio:8,shotAimRatio:.4,stopToShotMs:650,mouseCorrection:12});
  const feedback=makeRepFeedback('peek',rep,[]);
  expect(feedback.message).not.toContain('Commit after alignment');
  expect(feedback.tip).toContain('deliberate off-angle correction');
  expect(feedback.tip).not.toMatch(/unnecessary|hesitat|mouse less/);
});

it.each<[DrillMode,Partial<DrillMetrics>,string]>([
  ['peek',{shots:0,hits:0,heads:0,settledShots:0,accurateShots:0},'Complete an observed opening'],
  ['peek',{entryError:null,firstHit:false,hits:0},'Clear the cover first'],
  ['peek',{counterStrafed:false},'Use the opposite key'],
  ['peek',{stopAimRatio:3,shotAimRatio:.3},'Prepare the common angle'],
  ['peek',{shotAimRatio:3,stopAimRatio:.3},'Finish the correction before firing'],
  ['peek',{firstAirborne:true,firstSettled:false},'Land before the opening shot'],
  ['peek',{stopToShotMs:600},'Commit after alignment'],
  ['burst',{shots:6,hits:4,settledShots:6,earlyShots:3,earlyHits:3,lateShots:3,lateHits:1},'Hold the last three shots']
])('selects useful %s feedback for %j', (mode,patch,message)=>{
  const metrics=fixture(mode,{passed:false,...patch});
  const result=makeRepFeedback(mode,metrics,[metrics,metrics]);
  expect(result.message).toContain(message);
  expect(result.evidence?.length).toBeGreaterThan(10);expect(result.goal?.length).toBeGreaterThan(10);
  expect(result.goal?.length).toBeGreaterThan(10);expect(result.coaching?.action).toContain('Try this next');
});

it('gives a cover-aware miss explanation without guessing that every covered shot is a wall hit',()=>{
  const metrics=fixture('peek',{hits:0,heads:0,firstHit:false,firstHead:false,accurateShots:0,passed:false,covered:true});
  const feedback=makeRepFeedback('peek',metrics,[]);
  expect(feedback.tip).toContain('covered body is hittable');
  expect(feedback.message).not.toContain('blocked');
  expect(makeRepFeedback('peek',metrics,[metrics,metrics]).tip).toContain('Take 3 deliberate one-shot entries');
});

it('keeps numeric evidence separate from popup action and stores the repeated exercise in the shared summary',()=>{
  const moving=fixture('precision',{firstSettled:false,settledShots:0,speedAtShot:200,accurateShots:0,passed:false});
  const feedback=makeRepFeedback('precision',moving,[moving,moving]);
  expect(feedback.evidence).toContain('200 u/s');expect(feedback.goal).toContain('zero moving opening shots');
  expect(feedback.tip).toBe(feedback.coaching?.action);expect(feedback.tip).not.toContain('200 u/s');
});

it('keeps repeated practice cues short, specific and independent of configured movement keys',()=>{
  for(const patch of [{firstSettled:false,settledShots:0}, {entrySpeedRatio:0}, {counterStrafed:false},
    {stopAimRatio:3}, {shotAimRatio:3}, {firstAirborne:true,firstSettled:false}, {stopToShotMs:600}]) {
    const rep=fixture('peek',{passed:false,...patch});
    const feedback=makeRepFeedback('peek',rep,[rep,rep]);
    expect(feedback.tip!.length).toBeLessThanOrEqual(260);
    expect(feedback.tip).not.toMatch(/Release [AD]|tap [AD]|hold [AD]|W\/S/);
    expect(feedback.evidence).toBeTruthy();expect(feedback.goal).toBeTruthy();
  }
});
