import {expect, test} from '@playwright/test';

async function captureEngine(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const urls = [...new Set(performance.getEntriesByType('resource').filter(entry => entry.name.includes('/duel/DuelEngine.ts')).map(entry => entry.name))];
    for (const url of urls) {
      const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
      if (tick.punchQA) continue;
      const wrapped = function(this: any, time: number) {(window as any).punchEngine = this; return tick.call(this, time);};
      wrapped.punchQA = true; DuelEngine.prototype.tick = wrapped;
    }
  });
}

async function enginePage(page: import('@playwright/test').Page, mode: 'duel' | 'prefire' = 'duel') {
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance', follow: true}));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, health: 500, playerHealth: 500}));
  });
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await captureEngine(page);
  await page.waitForFunction(() => (window as any).punchEngine?.motionReady);
  if (mode === 'prefire') {
    await page.getByLabel('Training mode').selectOption('prefire');
    await expect(page.locator('canvas[data-duel]')).toHaveAttribute('aria-label', 'Dust 2 prefire map', {timeout: 90000});
    await captureEngine(page);
    await page.waitForFunction(() => (window as any).punchEngine?.scenario && (window as any).punchEngine.motionReady, null, {timeout: 90000});
  }
}

for (const mode of ['duel', 'prefire'] as const) for (const armor of [0, 100]) {
test(`${mode}: ${armor ? 'armored' : 'bare'} damage moves the camera and Follow Recoil follows the physical shot ray`, async ({page}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enginePage(page, mode);
  const result = await page.evaluate(async armor => {
    const e = (window as any).punchEngine, player = e.sim.actors[0], bot = e.sim.actors[1];
    // Keep the real rendered mode but isolate hit mechanics from authored cover/AI.
    e.sim.arena.solids = []; e.sim.arena.native = undefined; e.sim.actorHitPose = undefined; e.covers.visible = false;
    for (const actor of e.sim.actors.slice(2)) actor.alive = false;
    for (const controller of e.sim.controllers ?? []) {
      controller.command = (_time: number, actor: any) => actor.command;
      controller.verifyShot = () => true;
    }
    player.position = {x: 0, y: 1.6256, z: 4}; player.yaw = 0; player.pitch = 0;
    player.health = 500; player.armor = armor; player.helmet = armor > 0;
    bot.position = {x: 0, y: 1.6256, z: -4}; bot.yaw = Math.PI;
    bot.health = 500;
    for (const actor of [player, bot]) {
      actor.feet = 0; actor.grounded = true; actor.duckAmount = 0; actor.eyeHeight = 1.6256;
      actor.velocity = {x: 0, z: 0}; actor.verticalVelocity = 0;
    }
    bot.pitch = Math.atan2(1.2 - 1.6256, 8); bot.weapon.random = () => 0;
    e.sim.command(1, {firePressed: true}); e.sim.start(); e.sim.step();
    const events = e.sim.drainEvents(), hit = events.find((event: any) => event.kind === 'hit');
    const beforeImpacts = e.shotEffects.impacts.count;
    e.processEvents(events); e.sim.pause(); e.paused = true;
    const impactDelta = e.shotEffects.impacts.count - beforeImpacts;
    const worldImpacts = events.filter((event: any) => event.kind === 'surface' || event.kind === 'hit' && event.victim !== 0).length;
    const punch = {...player.punch.shot}, aim = player.pitch, recoil = {...player.weapon.recovery.recoil};
    await new Promise(resolve => setTimeout(resolve, 180));
    const transform = new DOMMatrix(e.crosshair.style.transform);
    const threePath = '/node_modules/.vite/deps/three.js';
    const {Vector3} = await import(/* @vite-ignore */ threePath);
    const yaw = player.yaw - punch.yaw * Math.PI / 180, pitch = player.pitch + punch.pitch * Math.PI / 180;
    const projected = new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(10).add(e.camera.position).project(e.camera);
    return {hit, punch, aim, recoil, impactDelta, worldImpacts, cameraPitch: e.camera.rotation.x,
      expectedCrosshair: [projected.x * e.width / 2, -projected.y * e.height / 2],
      crosshair: [transform.m41, transform.m42], finite: e.camera.matrixWorld.elements.every(Number.isFinite)};
  }, armor);
  expect(result.hit).toMatchObject({victim: 0, group: 'chest', lethal: false});
  expect(result.impactDelta).toBe(result.worldImpacts);
  expect(result.punch.pitch).toBeGreaterThan(.5);
  expect(result.recoil).toEqual({pitch: 0, yaw: 0});
  expect(result.cameraPitch).toBeCloseTo(result.aim + result.punch.pitch * Math.PI / 180, 5);
  expect(result.crosshair[0]).toBeCloseTo(result.expectedCrosshair[0], 5);
  expect(result.crosshair[1]).toBeCloseTo(result.expectedCrosshair[1], 5);
  expect(result.finite).toBe(true);
  expect(errors).toEqual([]);
});
}

test('bare-head punch rolls the camera and a new round clears actor punch', async ({page}, info) => {
  await enginePage(page);
  await page.addStyleTag({content: '.duel-entry {display:none}'});
  const result = await page.evaluate(async () => {
    const e = (window as any).punchEngine, player = e.sim.actors[0];
    player.punch.random = () => .6;
    player.punch.hit({group: 'head', rawDamage: 20, armor: 0, helmet: false});
    const punch = {...player.punch.shot};
    await new Promise(resolve => setTimeout(resolve, 150));
    const roll = e.camera.rotation.z;
    e.restart(false);
    return {punch, roll, fresh: e.sim.actors[0].punch.shot};
  });
  expect(result.roll).toBeCloseTo(result.punch.roll * Math.PI / 180, 5);
  expect(result.fresh).toEqual({pitch: 0, yaw: 0, roll: 0});
  await page.locator('canvas[data-duel]').screenshot({path: info.outputPath('fresh-round.png')});
});

for (const mode of ['duel', 'prefire'] as const) {
test(`${mode}: punch and recoil share a presentation time through pause, follow toggle, and round end`, async ({page}) => {
  test.setTimeout(120000); await enginePage(page, mode);
  const result = await page.evaluate(async () => {
    const e = (window as any).punchEngine, p = e.sim.actors[0];
    const {Vector3} = await import(/* @vite-ignore */ '/node_modules/.vite/deps/three.js');
    const {direction} = await import(/* @vite-ignore */ '/src/range/shot-model.ts');
    e.sim.pause(); e.sim.phase = 'fighting'; e.paused = false;
    p.yaw = .7; p.pitch = -.15;
    p.weapon.recovery.angle = {pitch: 6, yaw: -3}; p.weapon.recovery.velocity = {pitch: 40, yaw: 10};
    p.punch.hit({group: 'chest', rawDamage: 36, armor: 100, helmet: true});
    e.sim.accumulator = .004;
    const state = JSON.stringify({punch: p.punch.angle, recoil: p.weapon.recovery.angle, velocity: p.weapon.recovery.velocity});
    e.shotEffects.impact(new Vector3(0, 1.2, -8), 1, e.ownTraceColor, e.animationClock);
    const impacts = Array.from(e.shotEffects.impacts.instanceMatrix.array);
    const samples: any[] = [];
    for (const [phase, paused] of [['fighting', false], ['fighting', true], ['result', false]] as const) {
      e.sim.phase = phase; e.paused = paused;
      p.position.z = paused ? 4 : 8;
      for (const follow of [false, true]) {
        e.setSettings({...e.settings, follow});
        e.pacer.next = 0; e.last = performance.now(); e.tick(e.last + 100);
        const remainder = paused || phase !== 'fighting' ? 0 : e.sim.accumulator;
        const recoil = p.weapon.recovery.predict(remainder), punch = p.punch.predict(remainder, p.weapon.recovery.angle);
        const ray = direction(p.yaw - (recoil.yaw + punch.yaw) * Math.PI / 180,
          p.pitch + (recoil.pitch + punch.pitch) * Math.PI / 180);
        const projected = new Vector3().copy(ray).multiplyScalar(10).add(e.camera.position).project(e.camera);
        const transform = new DOMMatrix(e.crosshair.style.transform);
        samples.push({phase, paused, follow, camera: [e.camera.rotation.x, e.camera.rotation.y, e.camera.rotation.z],
          expectedCamera: [p.pitch + (recoil.pitch * .45 + punch.pitch) * Math.PI / 180,
            p.yaw - (recoil.yaw * .45 + punch.yaw) * Math.PI / 180, punch.roll * Math.PI / 180],
          crosshair: [transform.m41, transform.m42],
          expectedCrosshair: follow ? [projected.x * e.width / 2, -projected.y * e.height / 2] : [0, 0]});
      }
    }
    return {samples, impactsUnchanged: impacts.every((value, i) => value === e.shotEffects.impacts.instanceMatrix.array[i]),
      unchanged: state === JSON.stringify({punch: p.punch.angle, recoil: p.weapon.recovery.angle, velocity: p.weapon.recovery.velocity})};
  });
  expect(result.unchanged).toBe(true);
  expect(result.impactsUnchanged).toBe(true);
  for (const sample of result.samples) {
    for (let axis = 0; axis < 3; axis++) expect(sample.camera[axis]).toBeCloseTo(sample.expectedCamera[axis], 6);
    for (let axis = 0; axis < 2; axis++) expect(Math.abs(sample.crosshair[axis] - sample.expectedCrosshair[axis])).toBeLessThan(.001);
  }
});
}

test('rendered target and held rifle face actor yaw, and hit-pose sampling preserves that transform', async ({page}, info) => {
  await enginePage(page);
  await page.addStyleTag({content: '.duel-entry {display:none}'});
  await page.waitForFunction(() => (window as any).punchEngine?.worldWeapons.has('ak47') && (window as any).punchEngine.hitboxes.has(1));
  const samples = await page.evaluate(async () => {
    const e = (window as any).punchEngine;
    const {Vector3, Matrix4} = await import(/* @vite-ignore */ '/node_modules/.vite/deps/three.js');
    e.sim.pause(); e.paused = true; e.covers.visible = false;
    e.sim.actors[0].position = {x: 0, y: 1.6256, z: 4}; e.sim.actors[0].yaw = 0; e.sim.actors[0].pitch = 0;
    const bot = e.sim.actors[1], root = e.models.get(1), held = e.heldWeapons.get(1), muzzle = e.botMuzzles.get(1);
    bot.position = {x: 0, y: 1.6256, z: -4}; bot.feet = 0; bot.pitch = 0; bot.velocity = {x: 0, z: 0};
    const samples = [];
    for (const yaw of [0, Math.PI / 2, Math.PI, -.7]) {
      bot.yaw = yaw;
      const snapshot = e.sim.snapshot()[1]; e.syncActors(e.sim.snapshot(), 0); root.updateWorldMatrix(true, true);
      const expected = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const modelForward = new Vector3(0, 0, 1).transformDirection(root.matrixWorld);
      const grip = root.getObjectByName('wpn').getWorldPosition(new Vector3());
      const barrel = muzzle.getWorldPosition(new Vector3()).sub(grip); barrel.y = 0; barrel.normalize();
      const before = e.hitboxes.get(1).capture().capsules.map((capsule: any) => ({point0: {...capsule.point0}, point1: {...capsule.point1}}));
      e.sampleActorHitPose(snapshot); root.updateWorldMatrix(true, true);
      const after = e.hitboxes.get(1).capture().capsules;
      const gap = Math.max(...after.flatMap((capsule: any, i: number) => [
        new Vector3().copy(capsule.point0).distanceTo(new Vector3().copy(before[i].point0)),
        new Vector3().copy(capsule.point1).distanceTo(new Vector3().copy(before[i].point1))]));
      samples.push({yaw, modelDot: modelForward.dot(expected), barrelDot: barrel.dot(expected), hitPoseGap: gap,
        weapon: held.name, finite: new Matrix4().copy(root.matrixWorld).elements.every(Number.isFinite)});
    }
    bot.yaw = Math.PI; e.pacer.next = 0; e.last = performance.now(); e.tick(e.last + 100);
    return samples;
  });
  for (const sample of samples) {
    expect(sample.modelDot).toBeCloseTo(1, 7);
    expect(sample.barrelDot).toBeGreaterThan(.9);
    expect(sample.hitPoseGap).toBeLessThan(1e-8);
    expect(sample.finite).toBe(true);
  }
  const screenshot = await page.locator('canvas[data-duel]').screenshot({path: info.outputPath('target-facing.png')});
  const sharp = (await import('sharp')).default;
  const {data} = await sharp(screenshot).removeAlpha().raw().toBuffer({resolveWithObject: true});
  expect(new Set(data).size).toBeGreaterThan(32);
});
