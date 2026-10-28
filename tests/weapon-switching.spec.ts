import {expect, test, type Page} from '@playwright/test';

async function engine(page: Page, kind: 'range' | 'duel') {
  await page.evaluate(async kind => {
    const suffix = kind === 'range' ? '/range/engine.ts' : '/duel/DuelEngine.ts';
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes(suffix))!.name;
    const module = await import(/* @vite-ignore */ url), Class = kind === 'range' ? module.RangeEngine : module.DuelEngine;
    const tick = Class.prototype.tick;
    Class.prototype.tick = function(time: number) {(window as any).weaponSwitchQA = this; return tick.call(this, time);};
  }, kind);
  await page.waitForFunction(() => !!(window as any).weaponSwitchQA);
}

for (const mode of ['guided', 'duel'] as const) test(`${mode}: carried weapons are prepared once and repeated switches reuse native assemblies`, async ({page}, info) => {
  test.setTimeout(150000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const requests: string[] = []; page.on('request', request => {if (/\/models\/view-.*\.glb/.test(request.url())) requests.push(request.url());});
  await page.addInitScript(mode => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, quality: 'performance', volume: 0}));
  }, mode);
  await page.goto('/');
  await expect(page.locator(`canvas[data-${mode === 'guided' ? 'range' : 'duel'}]`)).toBeVisible();
  await engine(page, mode === 'guided' ? 'range' : 'duel');
  await page.waitForFunction(mode => {
    const e = (window as any).weaponSwitchQA, cache = mode === 'guided' ? e?.modelCache : e?.viewModels;
    return ['ak47', 'usp', 'knife'].every(weapon => cache?.has(weapon));
  }, mode, {timeout: 90000});
  const before = requests.length;
  const result = await page.evaluate(async mode => {
    const e = (window as any).weaponSwitchQA;
    const cache = mode === 'guided' ? e.modelCache : e.viewModels;
    const roots = new Map([...cache].map(([id, value]: any) => [id, mode === 'guided' ? value : value.scene]));
    const samples: number[] = [];
    let reused = true, synchronous = true;
    for (const id of ['usp', 'knife', 'ak47', 'usp', 'knife', 'ak47']) {
      const start = performance.now();
      const pending = mode === 'guided' ? e.setWeapon(id) : e.loadViewModel(id);
      const root = mode === 'guided' ? e.weaponRoot : e.viewRoot;
      synchronous &&= root.children[0] === roots.get(id);
      await pending;
      reused &&= root.children[0] === roots.get(id);
      samples.push(performance.now() - start);
    }
    return {reused, synchronous, size: cache.size, samples};
  }, mode);
  expect(result.reused).toBe(true); expect(result.synchronous).toBe(true); expect(result.size).toBe(3);
  expect(requests.length).toBe(before); expect(errors).toEqual([]);
  await info.attach('hot-weapon-switch-times', {body: JSON.stringify(result), contentType: 'application/json'});
  await page.screenshot({path: `research/weapon-switch-${mode}-${info.project.name}.png`});
});

test('Dust 2 restores legacy preset-disabled floor arrows, while an explicit opt-out survives presets and reload', async ({page}, info) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'duel',quality:'performance',volume:0}));
    if (!localStorage.getItem('spraylab.prefire.v1')) localStorage.setItem('spraylab.prefire.v1', JSON.stringify({
      population:'random',botBehavior:'angle-specific',movingBots:true,returnFire:false,routeGuide:false,
    }));
  });
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await engine(page, 'duel');
  await page.getByLabel('Training mode').selectOption('prefire');
  const show = page.getByRole('button', {name:'Show drill panel',exact:true});
  if (await show.isVisible()) await show.click();
  const arrows = page.getByLabel('Floor route arrows', {exact:true});
  await expect(arrows).toBeVisible({timeout:90000}); await expect(arrows).toBeChecked();
  await page.waitForFunction(() => (window as any).weaponSwitchQA?.scenario?.guide.children.some((child: any) => child.isInstancedMesh && child.count > 0));
  await page.getByLabel('Training preset').selectOption('pressure'); await expect(arrows).toBeChecked();
  await page.screenshot({path:`research/route-arrows-default-${info.project.name}.png`});
  await arrows.uncheck();
  await page.getByLabel('Training preset').selectOption('learn'); await expect(arrows).not.toBeChecked();
  await page.reload();
  const showAgain = page.getByRole('button', {name:'Show drill panel',exact:true});
  if (await showAgain.isVisible()) await showAgain.click();
  await expect(arrows).toBeVisible({timeout:90000}); await expect(arrows).not.toBeChecked();
});
