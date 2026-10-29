import {expect, test} from '@playwright/test';
import sharp from 'sharp';

for (const mode of ['guided', 'duel'] as const) test(`${mode}: owned Bleeding Edge loads its native mask, not the magenta placeholder`, async ({page}, info) => {
  test.setTimeout(150000);
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name));
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(mode => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, sidearm: 'usp', primaryEnabled: false, quality: 'performance', volume: 0}));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({generatedMaps: true, botCount: 1, skill: 1, botUtilities: false, shortcutProtection: false}));
    localStorage.setItem('spraylab.progression.v1', JSON.stringify({version: 2, xp: 357885, balance: 2877,
      owned: ['usp-ht_red_edges'], equipped: {usp: 'usp-ht_red_edges'}}));
  }, mode);
  await page.goto('/');
  const selector = `canvas[data-${mode === 'guided' ? 'range' : 'duel'}]`;
  await expect(page.locator(selector)).toBeVisible();
  await page.evaluate(async mode => {
    const suffix = mode === 'guided' ? '/range/engine.ts' : '/duel/DuelEngine.ts';
    const url = performance.getEntriesByType('resource').find(e => e.name.includes(suffix))!.name;
    const module = await import(/* @vite-ignore */ url), Class = mode === 'guided' ? module.RangeEngine : module.DuelEngine;
    const tick = Class.prototype.tick;
    Class.prototype.tick = function(t: number) {(window as any).skinQA = this; return tick.call(this, t);};
  }, mode);
  await page.waitForFunction(mode => {
    const e = (window as any).skinQA;
    const root = mode === 'guided' ? e?.modelCache.get('usp')?.children[0] : e?.viewModels.get('usp')?.scene;
    return root?.userData.cosmeticFinish === 'usp-ht_red_edges';
  }, mode, {timeout: 90000});
  const result = await page.evaluate(mode => {
    const e = (window as any).skinQA, root = mode === 'guided' ? e.modelCache.get('usp') : e.viewModels.get('usp').scene;
    let masks = 0, hands = 0;
    root.traverse((o: any) => {if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.cosmeticPaintByNumberMask) masks++;
      if (/firstperson|glove|sleeve/i.test(o.name) && !m.cosmeticPaintByNumberMask) hands++;
    }});
    return {masks, hands};
  }, mode);
  expect(result.masks).toBeGreaterThan(0); expect(result.hands).toBeGreaterThan(0);
  expect(requests.some(url => url.includes('/finish-repairs/usp-bleeding-edge-mask-'))).toBe(true);
  expect(requests.some(url => url.includes('kit-1323-albedo'))).toBe(false);
  await page.getByRole('button', {name: mode === 'guided' ? 'Enter range' : 'Enter duel', exact: true}).click();
  await page.waitForFunction(mode => mode === 'guided' ? (window as any).skinQA.sim.active : (window as any).skinQA.sim.phase === 'fighting', mode);
  await page.evaluate(() => (window as any).skinQA.inspect());
  await page.waitForTimeout(800);
  const shot=await page.locator(selector).screenshot({path: `research/usp-bleeding-edge-${mode}-${info.project.name}.png`});
  const {data,info: image}=await sharp(shot).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let red=0,pink=0;
  for(let y=Math.floor(image.height*.45);y<image.height;y++)for(let x=Math.floor(image.width*.4);x<image.width;x++){
    const i=(y*image.width+x)*4,[r,g,b]=data.subarray(i,i+3);
    if(r>45&&r>g*1.5&&r>b*1.4)red++;
    if(r>75&&b>75&&g<Math.min(r,b)*.25)pink++;
  }
  expect(red).toBeGreaterThan(500);expect(pink).toBeLessThan(100);
  expect(errors).toEqual([]);
});
