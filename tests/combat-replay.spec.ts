import {expect, test} from '@playwright/test';
import sharp from 'sharp';

test('shot review preserves the simulation, renders geometry, exports results and resumes', async ({page}, info) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ path), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).replayQA = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).replayQA?.motionReady && (window as any).replayQA?.hitboxes.size > 0);
  await page.evaluate(() => {
    const engine = (window as any).replayQA;
    engine.pause(); engine.sim.actors.forEach((actor: any) => actor.health = 10000);
    engine.sim.start(); engine.sim.paused = false; engine.sim.command(1, {});
    engine.sim.command(0, {side: 1, fireHeld: true, firePressed: true});
    for (let tick = 0; tick < 128; tick++) engine.sim.step();
    engine.pause(); engine.report();
  });
  const setup = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await setup.isVisible()) await setup.click();
  const button = page.getByRole('button', {name: 'Review fight', exact: true});
  await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByLabel('Combat replay', {exact: true})).toBeVisible();
  await page.waitForFunction(() => !!(window as any).replayQA.replayView);
  const before = await page.evaluate(() => {
    const e = (window as any).replayQA;
    return {tick: e.sim.tick, shots: JSON.stringify(e.sim.replay.export().shots), geometry: e.replayScene.group.children.length};
  });
  expect(before.geometry).toBeGreaterThan(0);
  await page.getByRole('button', {name: 'Player view', exact: true}).click();
  await page.getByLabel('Replay time').press('Home');
  const start = await page.evaluate(() => {
    const e = (window as any).replayQA;
    e.replayScene.camera(e.camera, undefined, false);
    return {position: e.camera.position.toArray(), time: e.replayView.time};
  });
  await page.getByRole('button', {name: 'Play replay', exact: true}).click();
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => ({tick: (window as any).replayQA.sim.tick,
    shots: JSON.stringify((window as any).replayQA.sim.replay.export().shots)}));
  expect(after.tick).toBe(before.tick); expect(after.shots).toBe(before.shots);
  await page.getByLabel('Replay time').press('End');
  await expect.poll(() => page.evaluate(() => (window as any).replayQA.replayView.time)).toBeGreaterThan(start.time);
  const end = await page.evaluate(() => {
    const e = (window as any).replayQA; e.replayScene.camera(e.camera, undefined, false);
    return e.camera.position.toArray();
  });
  expect(Math.hypot(...end.map((v: number, i: number) => v - start.position[i]))).toBeGreaterThan(.1);
  await page.getByText('Shot analysis', {exact: true}).click();
  await expect(page.getByLabel('Review shot', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  const bounds = await page.getByLabel('Combat replay', {exact: true}).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const stats = await sharp(await page.locator('canvas[data-duel]').screenshot()).stats();
  expect(stats.channels.slice(0, 3).some(channel => channel.stdev > 8)).toBe(true);
  await page.screenshot({path: info.outputPath('combat-review.png')});
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export combat recording'}).click();
  expect((await download).suggestedFilename()).toMatch(/^spraylab-combat-.*\.json$/);
  await page.getByRole('button', {name: 'Close combat replay'}).click();
  await expect(page.getByLabel('Combat replay', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Resume duel'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('movement-only fight replay survives auto-advance with its original map and closes cleanly', async ({page}) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ path), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).emptyReplayQA = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).emptyReplayQA?.motionReady);
  const originalWorld = await page.evaluate(() => {
    const e = (window as any).emptyReplayQA;
    e.pause(); e.sim.start(); e.sim.paused = false; e.sim.command(1, {}); e.sim.command(0, {side: 1});
    for (let tick = 0; tick < 96; tick++) e.sim.step();
    const solids = JSON.stringify(e.sim.replay.export().worlds[0].solids);
    e.restart(); return solids;
  });
  const setup = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await setup.isVisible()) await setup.click();
  await page.getByRole('button', {name: 'Review fight', exact: true}).click();
  const panel = page.getByLabel('Combat replay', {exact: true}); await expect(panel).toBeVisible();
  await expect(page.getByRole('button', {name: 'Play replay', exact: true})).toBeEnabled();
  await expect(page.getByText('Shot analysis', {exact: true})).toHaveCount(0);
  expect(await page.evaluate(() => {
    const e = (window as any).emptyReplayQA;
    return JSON.stringify(e.replayView.recording.worlds[0].solids);
  })).toBe(originalWorld);
  await page.getByRole('button', {name: 'Play replay', exact: true}).click();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Play replay', exact: true})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle((window as any).emptyReplayQA.crosshair).visibility)).toBe('visible');
  await page.getByRole('button', {name: 'Review fight', exact: true}).click();
  await page.getByRole('button', {name: 'New duel round', exact: true}).click();
  await expect(panel).toHaveCount(0); expect(errors).toEqual([]);
});

test('real native shot poses are unchanged by future and older presentation queries', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native rig clock regression');
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ path), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).clockQA = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).clockQA?.hitboxes.get(1)?.pose.capsules.length === 19);
  const result = await page.evaluate(() => {
    const e = (window as any).clockQA; cancelAnimationFrame(e.frame);
    e.sim.actors[0].health = 10000; e.sim.command(1, {side: 1, walk: false}); e.sim.start();
    for (let tick = 0; tick < 128; tick++) e.sim.step();
    const actor = e.sim.snapshot()[1], time = e.sim.time;
    const capture = () => e.sampleActorHitPose(actor, time).capsules.flatMap((c: any) => [c.point0.x, c.point0.y, c.point0.z, c.point1.x, c.point1.y, c.point1.z]);
    const before = capture(), animator = e.animators.get(1);
    animator.update(actor, .007, undefined, {bodyYaw: e.sim.actorBodyYaw(actor, time + .007), poseTime: time + .007});
    e.sampleActorHitPose(actor, time - .03125); const after = capture();
    const snapshots = e.sim.renderSnapshot();
    e.covers.visible = false; e.camera.position.copy(snapshots[0].position); e.camera.lookAt(snapshots[1].position); e.camera.updateMatrixWorld();
    e.animationTimes.set(1,e.animationClock);
    e.syncActors(snapshots,1 / 240);
    return {maximumDelta: Math.max(...before.map((value: number, i: number) => Math.abs(value - after[i]))), capsules: before.length / 6,
      restoredTime: e.poseTimes.get(1), expectedTime: time - 1 / 128 + e.sim.accumulator, dirty: e.sampledPoses.has(1)};
  });
  expect(result.capsules).toBe(19); expect(result.maximumDelta).toBeLessThan(1e-8);
  expect(result.restoredTime).toBeCloseTo(result.expectedTime,10); expect(result.dirty).toBe(false);
});
