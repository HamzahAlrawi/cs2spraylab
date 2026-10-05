import {expect, test} from '@playwright/test';
import sharp from 'sharp';

const desktopSmoke = new Set(['chromium', 'brave', 'opera-gx']);

test('compact duel arenas persist for small rosters and safely expand for five bots', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Authored arena integration regression');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('slider', {name: 'Arena size', exact: true}).press('Home');
  await expect(page.getByRole('slider', {name: 'Arena size', exact: true})).toHaveValue('0.65');
  await page.reload();
  await expect(page.getByRole('slider', {name: 'Arena size', exact: true})).toHaveValue('0.65');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).compactArenaEngine = this; return original.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).compactArenaEngine);
  const compact = await page.evaluate(() => {
    const e = (window as any).compactArenaEngine, arena = e.sim.arena;
    return {width: arena.maxX - arena.minX, depth: arena.maxZ - arena.minZ,
      pois: arena.pois.length, shellScale: e.shell.scale.x, eyeHeight: e.sim.actors[0].eyeHeight};
  });
  expect(compact.width).toBeCloseTo(15.6, 6);
  expect(compact.depth).toBeCloseTo(20.8, 6);
  expect(compact.pois).toBe(4);
  expect(compact.shellScale).toBe(.65);
  expect(compact.eyeHeight).toBeCloseTo(64 * .0254, 6);
  await page.getByLabel('Number of bots').press('End');
  await expect(page.getByRole('slider', {name: 'Arena size', exact: true})).toHaveValue('1');
  await expect(page.getByRole('slider', {name: 'Arena size', exact: true})).toHaveAttribute('min', '1');
  await expect.poll(() => page.evaluate(() => (window as any).compactArenaEngine.sim.actors.length)).toBe(6);
  const regular = await page.evaluate(() => {
    const e = (window as any).compactArenaEngine, arena = e.sim.arena;
    return {width: arena.maxX - arena.minX, pois: arena.pois.length, eyeHeight: e.sim.actors[0].eyeHeight};
  });
  expect(regular.width).toBe(24);
  expect(regular.pois).toBe(6);
  expect(regular.eyeHeight).toBe(compact.eyeHeight);
  expect(errors).toEqual([]);
});

test('AI Duel is playable from the first visit with adjacent bot controls', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop duel smoke test');
  await page.goto('/');
  await expect(page.getByLabel('Training mode')).toHaveValue('duel');
  await expect(page.getByLabel('Bot skill level')).toHaveValue('3');
  await expect(page.getByRole('complementary', {name: 'Duel settings'})).toBeVisible();
  const canvas = page.locator('canvas[data-duel]');
  await expect(canvas).toBeVisible();
  const stats = await sharp(await canvas.screenshot()).stats();
  expect(stats.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  await page.getByLabel('Number of bots').press('ArrowRight');
  await expect(page.getByLabel('Number of bots')).toHaveValue('2');
  await page.getByLabel('Bot skill level').selectOption('2');
  await page.getByLabel('Bot armor',{exact:true}).uncheck();
  await page.getByLabel('Add bot weapon').selectOption('mp9');
  await page.getByLabel('Add weapon to bot pool').click();
  await expect(page.getByLabel('Remove MP9')).toBeVisible();
  await page.getByLabel('Number of bots').press('ArrowLeft');
  await page.getByLabel('Bot skill level').selectOption('1');
  await page.getByLabel('Bot aim accuracy').press('Home');
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await expect(page.getByRole('button', {name: 'Pause duel'})).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.matches('canvas[data-duel]'))).toBe(true);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
  await expect.poll(async () => Number((await page.locator('.duel-ammo strong').innerText()).split('/')[0].trim()),
    {timeout: 5000}).toBeLessThan(30);
  await expect(page.locator('.duel-shortcut-warning')).toHaveCount(0);
  await page.keyboard.down('Control');
  await page.keyboard.down('w');
  await page.waitForTimeout(120);
  await page.keyboard.up('w');
  await page.keyboard.up('Control');
  await expect(page.getByRole('button', {name: 'Pause duel'})).toBeVisible();
  await expect(page.locator('.settings-hint')).toHaveCount(0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyW');
  await page.screenshot({path: `test-results/${info.project.name}-duel.png`});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume duel'})).toBeVisible();
  await page.getByRole('button', {name: 'Mouse & crosshair'}).click();
  await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
  await page.getByRole('button', {name: 'Done'}).click();
  await expect(page.getByRole('button', {name: 'Resume duel'})).toBeVisible();
});

test('Duel warns about browser shortcuts when fullscreen protection is disabled', async ({page}, info) => {
  test.skip(!desktopSmoke.has(info.project.name), 'Desktop shortcut fallback');
  await page.goto('/');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await expect(page.locator('.duel-shortcut-warning')).toContainText('C to crouch');
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.keyboard.down('c');
  await page.keyboard.up('c');
  await expect(page.getByRole('button', {name: 'Pause duel'})).toBeVisible();
});

test('side-angle traversal remains renderable during an active duel', async ({page}, info) => {
  test.skip(!desktopSmoke.has(info.project.name), 'Desktop angle smoke test');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await page.keyboard.down('d');
  await page.waitForTimeout(1250);
  await page.keyboard.up('d');
  await page.keyboard.down('w');
  await page.waitForTimeout(1450);
  await page.keyboard.up('w');
  await page.waitForTimeout(1100);
  await page.screenshot({path: `test-results/${info.project.name}-duel-angle.png`});
  expect(errors).toEqual([]);
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await expect(page.getByRole('button', {name: /Pause duel|Next round/})).toBeVisible();
});

test('switching from Duel to Guided spray restores the original range', async ({page}, info) => {
  test.skip(!desktopSmoke.has(info.project.name), 'Desktop mode-switch smoke test');
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('guided');
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.getByLabel('Training mode').selectOption('duel');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
});

test('five bots render after duel settings are saved and restored', async ({page}, info) => {
  test.skip(!desktopSmoke.has(info.project.name), 'Desktop five-bot smoke test');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Number of bots').press('End');
  await expect(page.getByLabel('Number of bots')).toHaveValue('5');
  await page.reload();
  await expect(page.getByLabel('Number of bots')).toHaveValue('5');
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await expect(page.locator('.duel-topline')).toContainText('5 ENEMIES LEFT');
  await page.waitForTimeout(1000);
  const stats = await sharp(await page.locator('canvas[data-duel]').screenshot()).stats();
  expect(stats.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  expect(errors).toEqual([]);
});

test('Duel remains playable on a mobile landscape viewport', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-chromium', 'Touch viewport smoke test');
  await page.setViewportSize({width: 844, height: 390});
  await page.goto('/');
  await expect(page.getByLabel('Training mode')).toHaveValue('duel');
  const canvas = page.locator('canvas[data-duel]');
  const bounds = (await canvas.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(500);
  expect(bounds.height).toBeGreaterThan(240);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await expect(page.getByRole('button', {name: 'Pause duel'})).toBeVisible();
  await expect(page.locator('.settings-hint')).toHaveCount(0);
  await canvas.tap();
  await expect.poll(async () => Number((await page.locator('.duel-ammo strong').innerText()).split('/')[0].trim()),
    {timeout: 5000}).toBeLessThan(30);
  await page.screenshot({path: `test-results/${info.project.name}-duel-landscape.png`});
  await page.getByRole('button', {name: 'Equip USP-S', exact: true}).tap();
  await expect(page.getByRole('button', {name: 'Equip USP-S', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Pause duel', exact: true}).tap();
  await expect(page.getByRole('button', {name: 'Resume duel', exact: true})).toBeVisible();
});

test('Duel follow recoil uses the same live crosshair setting as the range', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop crosshair projection test');
  await page.goto('/');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByLabel('Follow recoil').check();
  await page.getByRole('button', {name: 'Done'}).click();
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await page.mouse.down();
  await expect.poll(async () => Number((await page.locator('.duel-ammo strong').innerText()).split('/')[0].trim()))
    .toBeLessThan(27);
  const offset = await page.locator('.duel-view .follow-origin').evaluate(element => {
    const values = element.style.transform.match(/-?[\d.]+/g)?.map(Number) ?? [];
    return Math.abs(values[0] ?? 0) + Math.abs(values[1] ?? 0);
  });
  expect(offset).toBeGreaterThan(1);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const settled = await page.locator('.duel-view .follow-origin').evaluate(element => {
    const values = element.style.transform.match(/-?[\d.]+/g)?.map(Number) ?? [];
    return Math.abs(values[0] ?? 0) + Math.abs(values[1] ?? 0);
  });
  expect(settled).toBeLessThan(offset);
});
