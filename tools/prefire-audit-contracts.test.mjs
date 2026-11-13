import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pointFromEvidence,boundedAimCommand,watchOnAuthoredRoute,anySilhouetteSight,physicalStepDistance} from './prefire-audit-contracts.mjs';

test('hidden preaim accepts only retained evidence or static course openings',()=>{
  const watch={x:1,y:2,z:3};
  assert.ok(pointFromEvidence({...watch},[undefined,watch]));
  assert.ok(!pointFromEvidence({x:20,y:2,z:3},[watch]));
  assert.ok(!pointFromEvidence({x:NaN,y:2,z:3},[watch]));
});
test('aim audit checks motor bounds, not an obsolete fixed-turn controller',()=>{
  assert.ok(boundedAimCommand({yawDelta:.000001,pitchDelta:-.000002}));
  assert.ok(!boundedAimCommand({yawDelta:1,pitchDelta:0}));
  assert.ok(!boundedAimCommand({yawDelta:NaN,pitchDelta:0}));
});
test('supported dense route views are authored views; unrelated locations are not',()=>{
  const a={x:0,y:2,z:0},b={x:2,y:2,z:0},middle={x:1,y:2,z:0};
  assert.ok(watchOnAuthoredRoute(middle,[a,b],[a,middle,b]));
  assert.ok(!watchOnAuthoredRoute({x:1,y:2,z:1},[a,b],[a,middle,b]));
});
test('body visibility remains valid with an occluded head, but complete cover rejects fire',()=>{
  const origin={x:0,y:2,z:0},points=[{x:0,y:2,z:10},{x:0,y:1,z:10}];
  assert.ok(anySilhouetteSight(origin,points,(_o,d)=>d.y===0?{distance:1}:undefined));
  assert.ok(!anySilhouetteSight(origin,points,()=>({distance:1})));
});
test('physical displacement checks use active gear and switch momentum, while rejecting teleports and invalid caps',()=>{
  const u=.0254,step=1/128;
  const rifle=physicalStepDistance({speed:225*u,velocity:200*u},225*u,step,250*u);
  const utility=physicalStepDistance({speed:245*u,velocity:235*u},225*u,step,250*u);
  assert.ok(rifle<utility);assert.ok(.04671821432161304<=utility);
  assert.ok(1>utility);
  assert.ok(Number.isNaN(physicalStepDistance({speed:NaN,velocity:0},225*u,step,250*u)));
  assert.ok(Number.isNaN(physicalStepDistance({speed:1000*u,velocity:0},225*u,step,250*u)));
});
