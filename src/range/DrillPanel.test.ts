import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {DrillPanel,DrillReview} from './DrillPanel';
import {createScenario,DrillCoach} from './drills';
import type {RangeStatus} from './engine';

it('does not invent poor stop alignment when a stationary precision rep has no stopping event',()=>{
  const m=new DrillCoach('precision',createScenario('precision',0,'common',()=>.5),0).result();
  expect(renderToStaticMarkup(createElement(DrillReview,{value:m}))).toContain('<dt>Aim when you stopped</dt><dd>Not recorded</dd>');
  expect(renderToStaticMarkup(createElement(DrillReview,{value:{...m,stopError:1,stoppedOnTarget:false}}))).toContain('<dt>Aim when you stopped</dt><dd>Needs correction</dd>');
  expect(renderToStaticMarkup(createElement(DrillReview,{value:{...m,stopError:.01,stoppedOnTarget:true}}))).toContain('<dt>Aim when you stopped</dt><dd>On head</dd>');
});

it('shows the evidence, action, goal and transparent skill components without discarding the raw measurements',()=>{
  const m=new DrillCoach('precision',createScenario('precision',0,'common',()=>.5),0).result();
  const markup=renderToStaticMarkup(createElement(DrillReview,{value:m}));
  expect(markup).toContain('aria-label="Skill review"');expect(markup).toContain('No shot was recorded');
  expect(markup).toContain('<b>Next rep</b>');expect(markup).toContain('<b>Goal</b>');
  expect(markup).toContain('Movement sequence');expect(markup).toContain('not rank benchmarks');
  expect(markup).toContain('<summary>Rep measurements</summary>');
});

it('keeps old reviews readable and does not relabel a body-focused stop as a head aim',()=>{
  const m=new DrillCoach('peek',createScenario('peek',0,'common',()=>.5),0).result();
  delete m.coaching;m.stopError=.01;m.stoppedOnTarget=true;m.aimTarget='body';m.feedback='Legacy saved advice';
  const markup=renderToStaticMarkup(createElement(DrillReview,{value:m}));
  expect(markup).toContain('<dt>Aim when you stopped</dt><dd>On chest</dd>');
  expect(markup).toContain('Legacy saved advice');expect(markup).toContain('<details open="">');
});

it('hides legacy coaching advice without discarding the verdict or measurements',()=>{
  const m=new DrillCoach('peek',createScenario('peek',0,'common',()=>.5),0).result();
  delete m.coaching;m.feedback='Legacy coaching instruction';
  const html=renderToStaticMarkup(createElement(DrillReview,{value:m,showTips:false}));
  expect(html).not.toContain('Legacy coaching instruction');
  expect(html).toContain('No shots recorded');expect(html).toContain('<dt>Speed at shot</dt>');
  expect(html).toContain('>Hits after stopping</dt>');expect(html).toContain('<details open="">');
});

it('keeps measured coaching evidence and score available with tips off',()=>{
  const m=new DrillCoach('precision',createScenario('precision',0,'common',()=>.5),0).result();
  const html=renderToStaticMarkup(createElement(DrillReview,{value:m,showTips:false}));
  expect(html).toContain('data-coaching-tips="false"');
  expect(html).toContain('No shot was recorded');expect(html).toContain('Movement sequence');
  expect(html).toContain('<summary>Rep measurements</summary>');expect(html).toContain('<details open="">');
});

it.each(['peek','precision','burst'] as const)('hides %s instructions while retaining rep and exposure state',mode=>{
  const status={drill:{round:3,completed:2,passed:1,scenario:'Common angle',covered:true,exposure:'left',side:1,
    phase:'exposed',accurate:false,error:0,remaining:.8}} as RangeStatus;
  const props={status,mode,challenge:true,peekDuration:1};
  const hidden=renderToStaticMarkup(createElement(DrillPanel,{...props,showTips:false}));
  const visible=renderToStaticMarkup(createElement(DrillPanel,props));
  expect(hidden).not.toContain('coach-instruction');expect(hidden).not.toContain('coach-awaiting');
  expect(hidden).not.toContain('Brake before shooting');expect(hidden).toContain('<b>Not settled</b>');
  expect(hidden).toContain('REP 3');expect(hidden).toContain('1/2 CLEAN');
  expect(hidden).toContain('Left half exposed');expect(hidden).toContain(mode==='peek'?'0.8 s remaining':'1.5 s exposure');
  expect(visible).toContain('coach-instruction');expect(visible).toContain('Brake before shooting');
});
