import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gazeError, lateralAlignment, parseOptions, summarize, visiblePlayerPoint} from '../audit-prefire-encounters.mjs';

test('visible gaze measures physical player bearing, not chosen controller aim', () => {
  const actor = {position: {x: 0, y: 1.6, z: 0}, yaw: 0, pitch: 0};
  assert.equal(gazeError(actor, {x: 0, y: 1.6, z: -10}).yaw, 0);
  assert.equal(gazeError(actor, {x: 0, y: 1.6, z: 10}).yaw, 180);
  assert.equal(gazeError({...actor, yaw: Math.PI * 2}, {x: 0, y: 1.6, z: -10}).yaw < 1e-12, true);
});

test('lateralness distinguishes side strafes, oblique exits, forward/back steps', () => {
  const home = {x: 0, y: 0, z: 0}, threat = {x: 0, y: 0, z: -10};
  assert.deepEqual(lateralAlignment(home, {x: 1, y: 0, z: 0}, threat), {signedRadial: 0, radial: 0, lateral: 1});
  assert.equal(lateralAlignment(home, {x: 0, y: 0, z: -1}, threat).radial, 1);
  assert.equal(lateralAlignment(home, {x: 0, y: 0, z: 1}, threat).signedRadial, -1);
  assert.equal(lateralAlignment(home, home, threat), null);
  assert.equal(lateralAlignment(home, {x: Math.sqrt(3), y: 0, z: -1}, threat).radial, .5);
});

test('visibility ignores controller FOV, requires real hit geometry and cover clearance', () => {
  const actor = {position: {x: 0, y: 1.6, z: 0}, yaw: Math.PI};
  const player = {position: {x: 0, y: 1.6, z: -10}, feet: 0, duckAmount: 0, yaw: 0, alive: true};
  const head = feet => ({...feet, y: 1.6});
  const hit = () => ({group: 'head', distance: 9.865});
  assert.equal(visiblePlayerPoint(actor, player, {ray: () => undefined}, hit, head).hitgroup, 'head');
  assert.equal(visiblePlayerPoint(actor, player, {ray: () => ({distance: 5})}, hit, head), undefined);
  assert.equal(visiblePlayerPoint(actor, player, {ray: () => undefined}, () => ({distance: Infinity}), head), undefined);
  assert.equal(visiblePlayerPoint(actor, {...player, alive: false}, {ray: () => undefined}, hit, head), undefined);
});

test('audit summary preserves worst tail and explicitly represents no observations', () => {
  assert.deepEqual(summarize([]), {samples: 0, p50: null, p95: null, max: null});
  assert.deepEqual(summarize([180, 0, 5, NaN, 10]), {samples: 4, p50: 5, p95: 10, max: 180});
});

test('audit option validation never silently normalizes an invalid native run', () => {
  assert.deepEqual(parseOptions([]).returnFire, ['off', 'on']);
  assert.deepEqual(parseOptions([]).populations, ['all', 'random']);
  assert.throws(() => parseOptions(['--seconds=Infinity']));
  assert.throws(() => parseOptions(['--seeds=7,7']));
  assert.throws(() => parseOptions(['--return-fire=maybe']));
  assert.throws(() => parseOptions(['--reaction-ms=0']));
});
