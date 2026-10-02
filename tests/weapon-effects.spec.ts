import {expect, test} from '@playwright/test';
import {canvasColors} from './render-frame';

test('range resolves hits immediately, flashes at the barrel, and suppressed weapons never trace', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'guided',volume:0,spread:false})));
  await page.goto('/');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).fxEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).fxEngine?.loadedTarget && (window as any).fxEngine.modelCache.has('ak47'));
  const result = await page.evaluate(async () => {
    const e = (window as any).fxEngine, Vector = e.camera.position.constructor;
    e.sim.active = true; e.sim.start();
    const marks = [...e.impactClouds.values()].reduce((sum: number, cloud: any) => sum + cloud.mesh.count, 0);
    const immediate = {shots: e.sim.shots, marks, action:e.viewAnimations.get('ak47').activeAction};
    e.sim.release('mouse'); e.sim.active = false;
    const muzzle = e.viewMuzzles.get('ak47').main, flash = e.viewFlashes.sprites.find((s: any) => s.visible);
    const projected = muzzle.getWorldPosition(new Vector()).project(e.viewCamera);
    const original = Array.from(e.shotEffects.tracers.geometry.getAttribute('position').array).slice(0,6);
    e.camera.position.x += 1; e.shotEffects.update(e.elapsed);
    const moved = Array.from(e.shotEffects.tracers.geometry.getAttribute('position').array).slice(0,6);
    const textureReady = !!flash?.material.map?.image;
    const count = e.shotEffects.nextTrace;
    for (const weapon of ['usp','m4a1s','mp5sd']) e.shotEffects.trace(weapon,0,new Vector(0,1,0),new Vector(1,1,-20),e.elapsed,e.traceColor);
    return {immediate, projected:projected.toArray(), flash:!!flash, textureReady, original, moved,
      tracesBefore:count, tracesAfter:e.shotEffects.nextTrace, visibleObjects:e.scene.children.length};
  });
  expect(result.immediate.shots).toBe(1); expect(result.immediate.marks).toBeGreaterThan(0);
  expect(result.immediate.action).toBe('fire'); expect(result.flash).toBe(true); expect(result.textureReady).toBe(true);
  expect(Math.abs(result.projected[0])).toBeLessThan(1); expect(Math.abs(result.projected[1])).toBeLessThan(1);
  expect(result.original).toEqual(result.moved); expect(result.tracesAfter).toBe(result.tracesBefore);
  expect(await canvasColors(page, 'canvas[data-range]')).toBeGreaterThan(8);
  await page.screenshot({path:`research/firing-${info.project.name}.png`});
  expect(errors).toEqual([]);
});

test('knife shop filters by native model and owns every native preview before equipping', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.progression.v1',JSON.stringify({version:2,xp:357885,balance:1000000}));
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'guided',volume:0}));
  });
  await page.goto('/'); await page.getByRole('button',{name:/Open armory/}).click();
  const shop = page.getByRole('dialog',{name:'Armory'});
  await shop.getByRole('button',{name:'Unlocks',exact:true}).click();
  await shop.getByRole('tab',{name:'Knives',exact:true}).click();
  const filter = shop.getByLabel('Knife type');
  await expect(filter.locator('option')).toHaveCount(22);
  await filter.selectOption('knife-karambit');
  expect(await shop.locator('.progression-choice').count()).toBeGreaterThan(10);
  expect(await shop.locator('.progression-choice').count()).toBeLessThan(40);
  const emerald = shop.locator('.progression-choice').filter({hasText:'Karambit | Gamma Doppler Emerald'});
  await expect(emerald).toHaveCount(1);
  const image = emerald.locator('img'); await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
  await emerald.getByRole('button').click();
  await expect(shop.getByRole('button',{name:'Collection',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(shop.locator('.progression-choice')).toHaveCount(1);
  await shop.locator('.progression-choice').getByRole('button').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.progression.v1')!).equipped.knife)).toContain('knife-karambit');
});
