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
  expect(makeRepFeedback('precision',mouse,[]).message).toContain('Your aim needed extra correction');
  expect(makeRepFeedback('precision',mouse,[]).tip).toContain('unexpected');
});

it('allows twenty percent more excess mouse movement before coaching it',()=>{
  const base=new DrillCoach('peek',createScenario('peek',0,'common',()=>.9),0).result();
  const metrics={...base,shots:1,hits:1,heads:1,settledShots:1,entryError:1,counterStrafed:true,passed:true};
  expect(EXCESS_MOUSE_LIMIT).toBe(2.4);
  expect(makeRepFeedback('peek',{...metrics,excessCorrection:2.4},[]).message).toBe('Clean rep');
  expect(makeRepFeedback('peek',{...metrics,excessCorrection:2.401},[]).message).toBe('Your aim needed extra correction');
});

it('always gives an actionable tip and emphasizes three consecutive matching issues',()=>{
  const base=new DrillCoach('peek',createScenario('peek',0,'common',()=>.9),0).result();
  const moving={...base,shots:6,hits:2,entryError:1,settledShots:0};
  expect(makeRepFeedback('peek',moving,[])).toMatchObject({message:'You fired while still moving',passed:false});
  expect(makeRepFeedback('peek',moving,[]).tip).toContain('Release D, tap A');
  expect(makeRepFeedback('peek',moving,[moving,moving]).tip).toMatch(/^Try this next:/);
  const clean={...moving,passed:true,settledShots:6,counterStrafed:true};
  expect(makeRepFeedback('peek',moving,[clean,moving]).tip).not.toMatch(/^Try this next:/);
  expect(makeRepFeedback('peek',clean,[moving,moving]).message).toBe('Clean rep');
});

it('does not diagnose a stationary miss as movement inaccuracy',()=>{
  const base=new DrillCoach('precision',createScenario('precision',0,'common',()=>.9),0).result();
  const miss={...base,shots:1,hits:0,settledShots:1,accurateShots:0,entrySpeedRatio:1,counterStrafed:true};
  expect(makeRepFeedback('precision',miss,[miss,miss]).message).toContain('Your shot missed the target');
});

it.each<[DrillMode,Partial<DrillMetrics>,string]>([
  ['peek',{shots:0},'No shot before the timer ended'],
  ['peek',{entryError:null},'Your shot was blocked by cover'],
  ['peek',{counterStrafed:false},'You stopped without counter-strafing'],
  ['peek',{diagonal:true},'You moved diagonally around the corner'],
  ['peek',{hits:0,heads:0},'Your shot missed the target'],
  ['peek',{heads:0},'Body hit: start your aim higher'],
  ['burst',{hits:3},'Too many shots missed the burst'],
  ['peek',{},'Your aim settled after your movement']
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
  expect(makeRepFeedback('peek',metrics,[metrics,metrics]).tip).toBe('Try this next: Aim at the exposed part of the target, not through cover.');
});
