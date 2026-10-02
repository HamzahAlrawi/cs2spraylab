import {expect, test} from '@playwright/test';
import sharp from 'sharp';
import {canvasColors} from './render-frame';

test('duel keeps render resources bounded across rounds and presents continuous native stance', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native presentation and GPU lifecycle regression');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ moduleUrl);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {
      (window as any).presentationEngine = this;
      this.renderer.info.autoReset = false; this.renderer.info.reset();
      original.call(this, time);
    };
  });
  await page.waitForFunction(() => {
    const engine = (window as any).presentationEngine;
    return engine?.motionReady && engine.worldWeapons.has('ak47') && engine.viewRoot.children.length;
  });
  await page.evaluate(() => {
    const engine = (window as any).presentationEngine;
    engine.setConfig({...engine.config, botCount: 5});
    engine.covers.visible = false;
  });
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => ({...(window as any).presentationEngine.renderer.info.memory}));
  for (let round = 0; round < 8; round++) {
    await page.evaluate(() => (window as any).presentationEngine.restart());
    await canvasColors(page,'canvas[data-duel]');
  }
  const after = await page.evaluate(() => {
    const engine = (window as any).presentationEngine;
    return {...engine.renderer.info.memory, calls: engine.renderer.info.render.calls};
  });
  expect(after.textures).toBeLessThanOrEqual(before.textures);
  expect(after.geometries).toBeLessThanOrEqual(before.geometries);
  expect(after.calls).toBeLessThan(75);
  const gaitMotion = await page.evaluate(() => {
    const engine = (window as any).presentationEngine;
    const actor = engine.sim.snapshot()[1];
    actor.yaw = 0; actor.velocity = {x: 4, z: 0};
    const animator = engine.animators.get(1), model = engine.models.get(1);
    const positions: number[][] = [];
    for (let frame = 0; frame < 30; frame++) {
      animator.update(actor, 1 / 60); model.updateMatrixWorld(true);
      const foot = model.getObjectByName('ankle_L');
      if (foot) positions.push(foot.matrixWorld.elements.slice(12, 15));
    }
    return positions.length ? Math.max(...positions.map(position => Math.hypot(...position.map((value, i) => value - positions[0][i])))) : 0;
  });
  expect(gaitMotion).toBeGreaterThan(.05);

  await page.evaluate(() => {
    const engine = (window as any).presentationEngine;
    engine.setConfig({...engine.config, botCount: 1});
    engine.covers.visible = false;
    engine.sim.actors[1].position = {x: 0, y: 1.6256, z: 3};
    engine.sim.actors[1].yaw = Math.PI;
    engine.sim.phase = 'fighting';
    engine.paused = true;
    engine.sim.pause();
    engine.report();
  });
  const heads: number[] = [];
  await page.addStyleTag({content: '.duel-entry {display:none}'});
  for (const duck of [0, .25, .5, .75, 1]) {
    await page.evaluate(amount => {
      const engine = (window as any).presentationEngine;
      engine.sim.actors[1].duckAmount = amount;
    }, duck);
    await canvasColors(page,'canvas[data-duel]');
    heads.push(await page.evaluate(() => {
      const model = (window as any).presentationEngine.models.get(1);
      model.updateMatrixWorld(true);
      const head = model.getObjectByName('head_0');
      return head ? head.matrixWorld.elements[13] : NaN;
    }));
    if ([0, .5, 1].includes(duck)) await page.locator('canvas[data-duel]').screenshot({path: `test-results/duel-stance-${duck}.png`});
  }
  expect(heads.every(Number.isFinite)).toBe(true);
  expect(heads[0] - heads[4]).toBeGreaterThan(.25);
  expect(heads[0] - heads[4]).toBeLessThan(.7);
  for (let i = 1; i < heads.length; i++) expect(heads[i]).toBeLessThan(heads[i - 1]);
  const stats = await sharp(await page.locator('canvas[data-duel]').screenshot()).stats();
  expect(stats.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  expect(errors).toEqual([]);
});

test('native airborne crouch tucks the body and keeps the world-space head near the eye trajectory', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native rig stance regression');
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).airEngine = this; original.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).airEngine?.motionReady);
  const heads = await page.evaluate(() => {
    const e = (window as any).airEngine;
    e.covers.visible = false;
    const actor = e.sim.actors[1];
    actor.position = {x: 0, y: 2.2256, z: 4}; actor.feet = .6;
    actor.grounded = false; actor.velocity = {x: 0, z: 0};
    const result: number[] = [];
    for (const duck of [0, .25, .5, .75, 1]) {
      actor.duckAmount = duck; actor.feet = .6 + duck * duck * (3 - 2 * duck) * .4572;
      e.syncActors(e.sim.snapshot(), .03);
      const model = e.models.get(1); model.updateMatrixWorld(true);
      result.push(model.getObjectByName('head_0').matrixWorld.elements[13]);
    }
    return result;
  });
  expect(Math.max(...heads) - Math.min(...heads)).toBeLessThan(.25);
  expect(heads.every(height => height > 1.9 && height < 2.5)).toBe(true);
  await page.addStyleTag({content: '.duel-entry {display:none}'});
  await page.locator('canvas[data-duel]').screenshot({path: 'test-results/duel-crouch-jump.png'});
});
