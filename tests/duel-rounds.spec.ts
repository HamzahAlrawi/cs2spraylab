import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function enginePage(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).roundEngine = this; original.call(this, time);};
  });
  await page.waitForFunction(() => {
    const engine = (window as any).roundEngine;
    return engine?.motionReady && engine.worldWeapons.has('ak47');
  });
}

test('rounds restart without another click or viewport changes; Escape pauses the countdown', async ({page}, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enginePage(page);
  await page.getByLabel('Player health', {exact: true}).fill('240');
  await page.getByLabel('Round restart delay').fill('1.5');
  await page.reload();
  await expect(page.getByLabel('Player health', {exact: true})).toHaveValue('240');
  // Reload replaced the instrumented prototype; attach to the fresh module.
  await enginePage(page);
  await page.getByRole('button', {name: 'Enter duel', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Pause duel', exact: true})).toBeVisible();
  const bounds = await page.locator('canvas[data-duel]').boundingBox();
  const state = () => page.evaluate(() => ({fullscreen: !!document.fullscreenElement, lock: !!document.pointerLockElement}));
  const before = await state();
  if (!info.project.name.startsWith('mobile')) expect(before).toEqual({fullscreen: true, lock: true});
  const forceDeath = () => page.evaluate(() => {
    const e = (window as any).roundEngine;
    e.sim.actors[0].alive = false; e.sim.actors[0].health = 0;
    e.processEvents([{kind: 'hit', victim: 0, shooter: 1, shotId: 9999, group: 'head', healthDamage: 240,
      armorDamage: 0, lethal: true, point: {...e.sim.actors[0].position}}]);
    e.sim.step(); e.processEvents(e.sim.drainEvents()); e.report();
  });
  await forceDeath();
  await expect(page.locator('.duel-result')).toContainText('Next round');
  await expect(page.getByRole('button', {name: 'Enter duel', exact: true})).toHaveCount(0);
  await page.waitForTimeout(550);
  const deathCamera = await page.evaluate(() => ({y: (window as any).roundEngine.camera.position.y,
    roll: (window as any).roundEngine.camera.rotation.z}));
  expect(deathCamera.y).toBeLessThan(1.3); expect(deathCamera.roll).toBeGreaterThan(.05);
  await page.locator('canvas[data-duel]').screenshot({path: `test-results/duel-player-death-${info.project.name}.png`});
  await expect(page.locator('.duel-result')).toHaveCount(0, {timeout: 4000});
  await expect(page.locator('.duel-health strong')).toHaveText('240');
  expect(await page.locator('canvas[data-duel]').boundingBox()).toEqual(bounds);
  expect(await state()).toEqual(before);
  await forceDeath();
  if (info.project.name.startsWith('mobile')) await page.getByRole('button', {name: 'Pause duel'}).click();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume duel'})).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.locator('.duel-result')).toContainText('Paused');
  await page.getByRole('button', {name: 'Resume duel'}).click();
  await expect(page.locator('.duel-result')).toHaveCount(0, {timeout: 4000});
  expect(errors).toEqual([]);
});

test('baked bot deaths lower the skeleton, settle on the floor, and keep a rendered corpse', async ({page}, info) => {
  await enginePage(page);
  await page.addStyleTag({content: '.duel-entry {display:none}'});
  const samples = await page.evaluate(() => {
    const e = (window as any).roundEngine;
    e.covers.visible = false;
    e.sim.arena.solids.length = 0;
    e.sim.actors[1].position = {x: 0, y: 1.6256, z: 4};
    e.sim.actors[1].yaw = Math.PI;
    e.syncActors(e.sim.snapshot(), 0);
    const model = e.models.get(1), animator = e.animators.get(1), actor = e.sim.snapshot()[1];
    const samples: {head: number; pelvis: number}[] = [];
    model.updateMatrixWorld(true);
    const sample = () => {model.updateMatrixWorld(true); return {
      head: model.getObjectByName('head_0').matrixWorld.elements[13],
      pelvis: model.getObjectByName('pelvis').matrixWorld.elements[13],
    };};
    samples.push(sample());
    actor.alive = false;
    for (const age of [.05, .15, .35, .65, 1.2, 1.5, 2]) {
      animator.update(actor, 1 / 60, age); samples.push(sample());
    }
    e.sim.actors[1].alive = false;
    e.deaths.set(1, e.animationClock - 2.6);
    return samples;
  });
  expect(samples[0].head).toBeGreaterThan(1.4);
  expect(samples[4].head).toBeLessThan(samples[0].head - .2);
  expect(samples[4].pelvis).toBeLessThan(samples[0].pelvis - .1);
  expect(samples[6].head).toBeLessThan(.55);
  expect(samples[6].pelvis).toBeLessThan(.5);
  expect(samples[6].head).toBeGreaterThan(0);
  expect(samples[7].head).toBeCloseTo(samples[6].head, 3);
  await page.waitForTimeout(80);
  const png = await page.locator('canvas[data-duel]').screenshot({path: `test-results/duel-bot-death-${info.project.name}.png`});
  const pixels = await sharp(png).stats();
  expect(pixels.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  expect(await page.evaluate(() => (window as any).roundEngine.models.get(1).visible)).toBe(true);
});

test('all constrained death variants preserve stance, avoid joint flips and respect raised support surfaces', async ({page}) => {
  await enginePage(page);
  const variants = await page.evaluate(() => {
    const e = (window as any).roundEngine;
    e.covers.visible = false;
    const results: {id: number; duck: number; initialHead: number; maxHead: number; finalHead: number; root: number;
      peakTime: number; clipStart: number; maxJointStep: number; clips: string[]}[] = [];
    for (const duck of [0, .5, 1]) for (const id of [0, 1, 2]) {
      e.rebuildActors();
      const base = e.sim.actors[1];
      base.feet = 1; base.duckAmount = duck; base.alive = true; base.yaw = Math.PI;
      base.position = {x: 0, y: 1 + (64 - 18 * duck) * .0254, z: 4};
      e.sim.arena.solids = [{center: {x: 0, y: .5, z: 4}, size: {x: 2, y: 1, z: 2}}];
      e.syncActors(e.sim.snapshot(), 0);
      const model = e.models.get(1), animator = e.animators.get(1);
      const actor = {...e.sim.snapshot()[1], id, alive: false};
      const head = () => {model.updateMatrixWorld(true); return model.getObjectByName('head_0').matrixWorld.elements[13] - 1;};
      const initialHead = head();
      let maxHead = initialHead, peakTime = 0, maxJointStep = 0;
      const bones = ['pelvis', 'spine_0', 'spine_1', 'spine_2', 'head_0'].map(name => model.getObjectByName(name));
      let previous = bones.map(bone => bone.quaternion.clone());
      for (let frame = 0; frame <= 180; frame++) {
        animator.update(actor, 1 / 60, frame / 60);
        if (frame > 5) maxJointStep = Math.max(maxJointStep, ...bones.map((bone, index) => bone.quaternion.angleTo(previous[index])));
        previous = bones.map(bone => bone.quaternion.clone());
        if (head() > maxHead) {maxHead = head(); peakTime = frame / 60;}
      }
      const finalHead = head();
      base.alive = false;
      e.deaths.set(1, e.animationClock - 3);
      e.syncActors(e.sim.snapshot(), 0);
      results.push({id, duck, initialHead, maxHead, finalHead, root: model.position.y, peakTime, clipStart: animator.deathStart,
        maxJointStep, clips: animator.deathActions.map((value: any) => value.action.getClip().name)});
    }
    return results;
  });
  for (const variant of variants) {
    expect(variant.root, JSON.stringify(variant)).toBe(1);
    expect.soft(variant.maxHead, JSON.stringify(variant)).toBeLessThan(variant.initialHead + .15);
    expect(variant.finalHead, JSON.stringify(variant)).toBeGreaterThan(0);
    expect(variant.finalHead, JSON.stringify(variant)).toBeLessThan(.8);
    expect(variant.maxJointStep, JSON.stringify(variant)).toBeLessThan(55 * Math.PI / 180);
    expect(variant.clips.every(name => /death_(?:crouch_)?fall_[abc]$/.test(name))).toBe(true);
  }
});
