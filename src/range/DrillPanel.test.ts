import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {DrillReview} from './DrillPanel';
import {createScenario,DrillCoach} from './drills';

it('does not invent poor stop alignment when a stationary precision rep has no stopping event',()=>{
  const m=new DrillCoach('precision',createScenario('precision',0,'common',()=>.5),0).result();
  expect(renderToStaticMarkup(createElement(DrillReview,{value:m}))).toContain('<dt>Aimed at stop</dt><dd>Not recorded</dd>');
  expect(renderToStaticMarkup(createElement(DrillReview,{value:{...m,stopError:1,stoppedOnTarget:false}}))).toContain('<dt>Aimed at stop</dt><dd>Needs correction</dd>');
  expect(renderToStaticMarkup(createElement(DrillReview,{value:{...m,stopError:.01,stoppedOnTarget:true}}))).toContain('<dt>Aimed at stop</dt><dd>On head</dd>');
});
