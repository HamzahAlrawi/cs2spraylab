import {it,expect} from 'vitest';
import {createScenario,DrillCoach,EXCESS_MOUSE_LIMIT,type DrillMetrics,type DrillMode} from './drills';
import {makeRepFeedback} from './rep-feedback';

it('immediately coaches stationary-only reps and excess mouse correction, with movement scores',()=>{
  const base=new DrillCoach('precision',createScenario('precision',0,'common',()=>.9),0).result();
  const stationary={...base,shots:1,hits:1,heads:1,settledShots:1,entrySpeedRatio:0,movementScore:0};
  const feedback=makeRepFeedback('precision',stationary,[]);
  expect(feedback.message).toContain('Move, then counter-strafe');expect(feedback.message).toContain('0/100');
  expect(feedback.tip).toBeTruthy();
  const mouse={...stationary,entrySpeedRatio:1,counterStrafed:true,excessCorrection:3,passed:true};
  expect(makeRepFeedback('precision',mouse,[]).message).toContain('Less mouse');
  expect(makeRepFeedback('precision',mouse,[]).tip).toContain('unexpected');
});

it('allows twenty percent more excess mouse movement before coaching it',()=>{
  const base=new DrillCoach('peek',createScenario('peek',0,'common',()=>.9),0).result();
  const metrics={...base,shots:1,hits:1,heads:1,settledShots:1,entryError:1,counterStrafed:true,passed:true};
  expect(EXCESS_MOUSE_LIMIT).toBe(2.4);
  expect(makeRepFeedback('peek',{...metrics,excessCorrection:2.4},[]).message).toBe('Clean rep');
  expect(makeRepFeedback('peek',{...metrics,excessCorrection:2.401},[]).message).toBe('Less mouse, more pre-aim');
});

it('gives an immediate verdict and adds a targeted tip only after three consecutive matching issues',()=>{
  const base=new DrillCoach('peek',createScenario('peek',0,'common',()=>.9),0).result();
  const moving={...base,shots:6,hits:2,entryError:1,settledShots:0};
  expect(makeRepFeedback('peek',moving,[])).toEqual({message:'Stop before firing',passed:false,tip:undefined});
  expect(makeRepFeedback('peek',moving,[moving,moving]).tip).toContain('opposite key');
  const clean={...moving,passed:true,settledShots:6,counterStrafed:true};
  expect(makeRepFeedback('peek',moving,[clean,moving]).tip).toBeUndefined();
  expect(makeRepFeedback('peek',clean,[moving,moving]).message).toBe('Clean rep');
});

it('does not diagnose a stationary miss as movement inaccuracy',()=>{
  const base=new DrillCoach('precision',createScenario('precision',0,'common',()=>.9),0).result();
  const miss={...base,shots:1,hits:0,settledShots:1,accurateShots:0,entrySpeedRatio:1,counterStrafed:true};
  expect(makeRepFeedback('precision',miss,[miss,miss]).message).toContain('Settle on the target');
});

it.each<[DrillMode,Partial<DrillMetrics>,string]>([
  ['peek',{shots:0},'Commit to the shot'],
  ['peek',{entryError:null},'Clear the wall first'],
  ['peek',{counterStrafed:false},'Counter-strafe first'],
  ['peek',{diagonal:true},'Use a lateral entry'],
  ['peek',{hits:0,heads:0},'Settle on the target'],
  ['peek',{heads:0},'Hold head height'],
  ['burst',{hits:3},'Control the spray'],
  ['peek',{},'Prepare the angle']
])('selects useful %s feedback for %j', (mode,patch,message)=>{
  const base=new DrillCoach(mode,createScenario(mode,0,'common',()=>.9),0).result();
  const metrics={...base,shots:6,hits:4,heads:1,settledShots:6,entryError:1,counterStrafed:true,...patch};
  const result=makeRepFeedback(mode,metrics,[metrics,metrics]);
  expect(result.message).toBe(message);
  expect(result.tip?.length).toBeGreaterThan(10);
});

it('gives a cover-aware miss tip that also applies to head-only cover',()=>{
  const base=new DrillCoach('peek',createScenario('peek',0,'common',()=>.7),0).result();
  const metrics={...base,shots:1,settledShots:1,entryError:1,counterStrafed:true};
  expect(makeRepFeedback('peek',metrics,[metrics,metrics]).tip).toBe('Aim at the exposed part of the target, not through cover.');
});
