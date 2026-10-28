import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto(process.env.PREFIRE_URL ?? 'http://127.0.0.1:5176/');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine} = await import(url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(t) {window.aimEngine = this; return tick.call(this, t);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await page.getByLabel('Prefire route').waitFor({timeout: 90000});
  await page.waitForFunction(() => window.aimEngine?.models?.get(1)?.getObjectByName('head_0'));
  const result = await page.evaluate(async () => {
    const e = window.aimEngine; e.paused = true; e.sim.pause();
    const {Vector3} = await import('/node_modules/.vite/deps/three.js');
    const {actorHeadPoint, traceActor, rayCapsuleInterval} = await import('/src/range/duel/geometry.ts');
    const samples = [], pitchDirections = [];
    const actor = e.sim.snapshot()[1], model = e.models.get(1), animator = e.animators.get(1);
    for (const duck of [0, .25, .5, .75, 1]) for (const yaw of [0, .8, Math.PI / 2, Math.PI]) for (const speed of [0, 73, 225]) for (const pitch of [-.6, 0, .6]) {
      const a = {...actor, position: {x: 0, y: 1.6256, z: -15}, feet: 0, duckAmount: duck,
        yaw, pitch, velocity: {x: speed * .0254, z: 0}};
      model.visible = true; model.position.set(0, 0, -15); model.rotation.y = yaw - Math.PI;
      animator.update(a, .016); model.updateWorldMatrix(true, true);
      const head = model.getObjectByName('head_0').getWorldPosition(new Vector3());
      const origin = {x: 0, y: 1.6256, z: 0};
      const dir = head.clone().sub(new Vector3(origin.x, origin.y, origin.z)).normalize();
      const legacy = traceActor(origin, dir, {...a.position, y: 0}, duck, Infinity, yaw);
      const pose = e.sampleActorHitPose(a), capsule = pose?.capsules.find(c => c.group === 'head');
      const center = new Vector3().copy(capsule.point0).add(new Vector3().copy(capsule.point1)).multiplyScalar(.5);
      const headRay = center.sub(new Vector3().copy(origin)).normalize();
      const capsuleHit = rayCapsuleInterval(origin, headRay, capsule.point0, capsule.point1, capsule.radius);
      const hit = traceActor(origin, headRay, {...a.position, y: 0}, duck, Infinity, yaw, pose);
      samples.push({duck, yaw, speed, pitch, head: head.toArray(), hit: hit.group ?? 'miss', legacy: legacy.group ?? 'miss',
        capsuleHit: !!capsuleHit,
        headCenterError: head.distanceTo(new Vector3().copy(actorHeadPoint({...a.position, y: 0}, duck, yaw)))});
    }
    for (const pitch of [-.6, 0, .6]) {
      e.sampleActorHitPose({...actor, position: {x: 0, y: 1.6256, z: -15}, feet: 0, duckAmount: 0,
        yaw: Math.PI, pitch, velocity: {x: 0, z: 0}});
      const muzzle = e.botMuzzles.get(1)?.getWorldPosition(new Vector3());
      const hand = model.getObjectByName('hand_R')?.getWorldPosition(new Vector3());
      pitchDirections.push({pitch, barrelY: muzzle && hand ? muzzle.sub(hand).normalize().y : null});
    }
    return {samples, missCount: samples.filter(s => !s.capsuleHit || s.hit === 'miss').length,
      maxHeadCenterError: Math.max(...samples.map(s => s.headCenterError)), pitchDirections};
  });
  console.log(JSON.stringify({cases: result.samples.length, legacyHeadAnchorMisses: result.samples.filter(s => s.legacy === 'miss').length,
    nativeCapsuleMisses: result.missCount, groups: Object.fromEntries(['head', 'chest', 'arm'].map(group => [group, result.samples.filter(s => s.hit === group).length])),
    maxHeadCenterError: result.maxHeadCenterError, pitchDirections: result.pitchDirections, errors,
    ...(process.argv.includes('--verbose') ? {samples: result.samples} : {})}, null, 2));
  assert.deepEqual(errors, []);
  if (process.argv.includes('--assert')) {
    assert.equal(result.missCount, 0, 'Live native head capsules must be physically hittable; nearer body capsules are legitimate blockers');
    const directions = result.pitchDirections.map(value => value.barrelY);
    assert.ok(directions.every(Number.isFinite) && directions[0] < directions[1] && directions[1] < directions[2], 'The barrel must rise as physical pitch rises');
  }
} finally {await browser.close();}
