import {expect,test,type Page} from '@playwright/test';
import sharp from 'sharp';
import {canvasColors} from './render-frame';

async function rangeEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url);
    const tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).performanceEngine = this; tick.call(this,time);};
  });
  await page.waitForFunction(() => {
    const e = (window as any).performanceEngine; return e?.loadedTarget && e.modelCache.has(e.sim.equipped);
  });
}

test('guided Deagle survives repeated taps, reloads and weapon switching', async ({page},info) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const mobile = info.project.name.startsWith('mobile');
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'guided',sidearm:'deagle',primaryEnabled:false,volume:0,protectShortcuts:false})));
  await page.goto('/'); await rangeEngine(page);
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  const canvas = page.locator('canvas[data-range]');
  await expect(page.getByRole('button',{name:'Pause range',exact:true})).toBeVisible();
  if (!mobile) await expect(page.locator('.range-shortcut-warning')).toContainText('C to crouch');
  for (let i = 0; i < 5; i++) {
    if (mobile) await canvas.tap(); else {await page.mouse.down(); await page.mouse.up();}
    await page.waitForTimeout(260);
  }
  await expect(page.getByTestId('ammo')).toHaveText('2/ 7');
  const recoil = await page.evaluate(() => (window as any).performanceEngine.sim.recoil.pitch);
  expect(recoil).toBeGreaterThan(0);
  if (mobile) await page.getByRole('button',{name:'Reload',exact:true}).click(); else await page.keyboard.press('r');
  await expect(page.locator('.hud-ammo')).toContainText('Reloading');
  await expect(page.getByTestId('ammo')).toHaveText('7/ 7',{timeout:10000});
  for (let i = 0; i < 10; i++) {
    if (mobile) await canvas.tap(); else {await page.mouse.down(); await page.mouse.up();}
    await page.waitForTimeout(40);
  }
  expect(await page.evaluate(() => (window as any).performanceEngine.sim.pistolAmmo)).toBeLessThan(7);
  const colors = await sharp(await canvas.screenshot()).stats();
  expect(colors.channels.slice(0,3).every(channel => channel.stdev > 10)).toBe(true);
  if (mobile) await page.getByRole('button',{name:'Equip Default knife',exact:true}).click(); else await page.keyboard.press('Digit3');
  await expect(page.getByRole('button',{name:'Equip Default knife',exact:true})).toHaveAttribute('aria-pressed','true');
  if (mobile) await page.getByRole('button',{name:'Equip Desert Eagle',exact:true}).click(); else await page.keyboard.press('Digit2');
  await expect(page.getByRole('button',{name:'Equip Desert Eagle',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:`test-results/${info.project.name}-guided-deagle.png`});
  expect(errors).toEqual([]);
});

test('performance preset and opt-in FPS work in both engines and persist', async ({page},info) => {
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));
  await page.goto('/');
  await expect(page.getByLabel('Performance monitor')).toBeHidden();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Render quality').selectOption('performance');
  await expect(page.getByLabel('Frame limit')).toHaveValue('60');
  await page.getByLabel('Show FPS counter').check();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByLabel('Performance monitor')).toBeVisible();
  await page.getByRole('button',{name:'Enter duel',exact:true}).click();
  await expect.poll(async () => parseInt(await page.getByLabel('Performance monitor').innerText())).toBeGreaterThan(30);
  await expect.poll(async () => parseInt(await page.getByLabel('Performance monitor').innerText())).toBeLessThanOrEqual(65);
  if (info.project.name.startsWith('mobile')) await page.getByRole('button',{name:'Pause duel',exact:true}).click(); else await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.getByLabel('Training mode').selectOption('guided');
  await rangeEngine(page);
  await expect(page.getByLabel('Performance monitor')).toBeVisible();
  const buffer = await page.locator('canvas[data-range]').evaluate(node => ({width:(node as HTMLCanvasElement).width,height:(node as HTMLCanvasElement).height}));
  expect(Math.max(buffer.width,buffer.height)).toBeLessThanOrEqual(960);
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause range',exact:true})).toBeVisible();
  await expect.poll(async () => parseInt(await page.getByLabel('Performance monitor').innerText())).toBeGreaterThan(30);
  expect(await canvasColors(page,'canvas[data-range]')).toBeGreaterThan(8);
  const meter = (await page.getByLabel('Performance monitor').boundingBox())!, ammo = (await page.locator('.hud-ammo').boundingBox())!;
  expect(meter.y).toBeGreaterThanOrEqual(ammo.y+ammo.height);
  await page.screenshot({path:`test-results/${info.project.name}-performance-monitor.png`});
  if (info.project.name.startsWith('mobile')) await page.getByRole('button',{name:'Pause range',exact:true}).click(); else await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('Render quality')).toHaveValue('performance');
  await expect(page.getByLabel('Show FPS counter')).toBeChecked();
  await page.getByLabel('Show FPS counter').uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByLabel('Performance monitor')).toBeHidden();
});

test('range reserves Ctrl+W when supported and releases protection on pause', async ({page},info) => {
  test.skip(info.project.name !== 'chromium');
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'guided',sidearm:'deagle',primaryEnabled:false,volume:0})));
  await page.goto('/'); await rangeEngine(page);
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).performanceEngine.shortcuts.protected)).toBe(true);
  await expect(page.locator('.range-shortcut-warning')).toHaveCount(0);
  await page.keyboard.down('Control'); await page.keyboard.down('w'); await page.waitForTimeout(180);
  await page.keyboard.up('w'); await page.keyboard.up('Control');
  expect(page.isClosed()).toBe(false);
  await expect(page.getByRole('button',{name:'Pause range',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(await page.evaluate(() => (window as any).performanceEngine.shortcuts.protected)).toBe(false);
});
