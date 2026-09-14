import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('pausing clears live hit feedback before the entry button returns', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  const result = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-range]')!;
    const caption = document.querySelector<HTMLElement>('.hit-caption')!;
    const marker = document.querySelector<HTMLElement>('.hit-marker')!;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch', bubbles: true}));
    canvas.dispatchEvent(new PointerEvent('pointerup', {button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch', bubbles: true}));
    const start = performance.now();
    while (performance.now() - start < 5000) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const pause = document.querySelector<HTMLButtonElement>('button[aria-label="Pause range"]');
      if (pause && caption.style.opacity === '1') {
        pause.click();
        return {caption: caption.style.opacity, marker: marker.style.opacity};
      }
    }
    throw new Error('No live hit feedback appeared while the range was active');
  });
  expect(result).toEqual({caption: '0', marker: '0'});
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled();
});

test('wall patterns animate, respect reduced motion and can be switched off independently', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Wall detail is inspected from the desktop firing line');
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  const box = (await page.locator('canvas[data-range]').boundingBox())!;
  const focal = box.height * 2 / 3;
  const clip = {x: box.x + box.width / 2 - 7 / 13.47 * focal + 3, y: box.y + box.height / 2 - (4 - 1.6256) / 13.47 * focal + 3,
    width: 3.5 / 13.47 * focal - 6, height: 3.5 / 13.47 * focal - 6};
  const shot = async () => sharp(await page.screenshot({clip, scale: 'css'})).raw().toBuffer();
  const right = async () => sharp(await page.screenshot({clip: {...clip, x: box.x + box.width / 2 + 3.5 / 13.47 * focal + 3}, scale: 'css'})).raw().toBuffer();
  const a = await shot();
  // The animation holds a completed spray before looping; do not sample only that hold.
  await expect.poll(async () => (await shot()).equals(a), {timeout: 6000}).toBe(false);
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.waitForTimeout(200);
  const still = await shot(); await page.waitForTimeout(350); expect((await shot()).equals(still)).toBe(true);
  await page.locator('.weapon-select').click();
  await page.locator('.weapon-item').filter({has: page.locator('img[src="/models/mp9.png"]')}).click();
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  const mp9 = await shot(); expect(mp9.equals(still)).toBe(false);
  const rightBefore = await right();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByLabel('Impact pattern (left)', {exact: true}).uncheck();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  const hidden = await shot();
  const mean = (data: Buffer) => data.reduce((sum, v) => sum + v, 0) / data.length;
  expect(mean(hidden)).toBeGreaterThan(mean(mp9) + 30);
  expect((await right()).equals(rightBefore)).toBe(true);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByLabel('Impact pattern (left)', {exact: true}).check();
  await page.getByLabel('Mouse movement (right)', {exact: true}).uncheck();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  expect((await shot()).equals(mp9)).toBe(true);
  expect(mean(await right())).toBeGreaterThan(mean(rightBefore) + 30);
  await page.reload();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Impact pattern (left)', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Mouse movement (right)', {exact: true})).not.toBeChecked();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.screenshot({path: `test-results/${info.project.name}-wall-pattern.png`});
});

test('Compact is thicker and both guides are distinct from the yellow crosshair', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  await expect(page.locator('.follow-origin .crosshair .top')).toHaveCSS('width', '2px');
  await expect(page.locator('.aim-cue.now')).toHaveCSS('color', 'rgb(85, 255, 164)');
  await expect(page.locator('.aim-cue.next')).toHaveCSS('color', 'rgb(255, 117, 215)');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Crosshair', exact: true}).click();
  await page.getByRole('button', {name: 'Classic', exact: true}).click();
  await page.getByRole('button', {name: 'Compact', exact: true}).click();
  await expect(page.getByLabel('Thickness', {exact: true})).toHaveValue('2');
  await expect(page.getByLabel('Crosshair color', {exact: true})).toHaveValue('#ffeb55');
  await expect(page.locator('.crosshair-preview .crosshair .top')).toHaveCSS('width', '2px');
});

test('viewmodels stay framed across portrait, landscape, ultrawide and stretched world views', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Aspect sweep is covered once, with other browsers covering their native viewport');
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  const reference = await page.context().newPage();
  await reference.emulateMedia({reducedMotion: 'reduce'});
  await reference.route('**/models/view-ak47.glb', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({asset: {version: '2.0'}, scene: 0, scenes: [{nodes: []}], nodes: []})}));
  await reference.goto('/');
  await expect(reference.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  for (const viewport of [{width: 1920, height: 1080}, {width: 1440, height: 1080}, {width: 3440, height: 1440}, {width: 390, height: 844}, {width: 844, height: 390}]) {
    await page.setViewportSize(viewport);
    for (const aspect of ['native', '4:3']) {
      await page.bringToFront();
      await page.getByRole('button', {name: 'Settings', exact: true}).click();
      await page.getByLabel('Display aspect').selectOption(aspect);
      await page.getByRole('button', {name: 'Done', exact: true}).click();
      await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
      await page.getByLabel('Training mode').selectOption('spray');
      const canvas = page.locator('canvas[data-range]');
      const gun = await canvas.screenshot({scale: 'css'});
      await reference.setViewportSize(viewport);
      await reference.bringToFront();
      await reference.getByRole('button', {name: 'Settings', exact: true}).click();
      await reference.getByLabel('Display aspect').selectOption(aspect);
      await reference.getByRole('button', {name: 'Done', exact: true}).click();
      const empty = await reference.locator('canvas[data-range]').screenshot({scale: 'css'});
      const meta = await sharp(gun).metadata();
      const left = Math.floor(meta.width! * .55), top = Math.floor(meta.height! * .5);
      const area = {left, top, width: meta.width! - left, height: meta.height! - top};
      const a = await sharp(gun).extract(area).removeAlpha().raw().toBuffer();
      const b = await sharp(empty).extract(area).removeAlpha().raw().toBuffer();
      let changed = 0;
      for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 35) changed++;
      expect(changed / (area.width * area.height)).toBeGreaterThan(.045);
      await page.bringToFront();
      await page.getByLabel('Training mode').selectOption('spray');
      await page.screenshot({path: `test-results/framing-${viewport.width}x${viewport.height}-${aspect.replace(':', '-')}.png`});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await reference.close();
  expect(errors).toEqual([]);
});

test('first-visit Settings hint is noticeable, dismissible and not repeated', async ({page}, info) => {
  await page.goto('/');
  await expect(page.locator('.settings-hint')).toBeVisible();
  await expect(page.locator('.hint-arrow')).toHaveCSS('animation-name', 'settings-arrow');
  await expect(page.locator('.hint-arrow')).toHaveCSS('animation-iteration-count', '4');
  const donate = (await page.getByRole('link', {name: 'Donate', exact: true}).boundingBox())!;
  const header = (await page.locator('.appbar').boundingBox())!;
  expect(donate.y).toBeGreaterThanOrEqual(header.y);
  expect(donate.y + donate.height).toBeLessThanOrEqual(header.y + header.height);
  expect(donate.height).toBeGreaterThanOrEqual(32);
  const hint = (await page.locator('.settings-hint').boundingBox())!;
  expect(hint.x).toBeGreaterThanOrEqual(0);
  expect(hint.x + hint.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  await page.screenshot({path: `test-results/${info.project.name}-first-visit.png`});
  await page.getByRole('button', {name: 'Dismiss settings hint', exact: true}).click();
  await expect(page.locator('.settings-hint')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Settings', exact: true})).toBeFocused();
  await page.reload();
  await expect(page.locator('.settings-hint')).toHaveCount(0);
});

test('first-visit hint opens Settings and respects reduced motion', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await expect(page.locator('.hint-arrow')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', {name: 'Customize your CS2 settings', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Settings', exact: true})).toBeVisible();
  await expect(page.locator('.settings-hint')).toHaveCount(0);
  await expect(page.getByLabel('Sensitivity', {exact: true})).toBeVisible();
});

test('tracking is retired from the range without relabeling or deleting old results', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'tracking'}));
    localStorage.setItem('spraylab.results.v2', JSON.stringify([{id: 'old-tracking', weapon: 'ak47', mode: 'tracking', shots: 0, hits: 0, heads: 0, seconds: 30, tracking: 72, date: '2026-09-01T12:00:00Z', samples: []}]));
  });
  await page.goto('/');
  await expect(page.getByLabel('Training mode')).toHaveValue('guided');
  await expect(page.getByLabel('Training mode').locator('option')).toHaveCount(6);
  await expect(page.getByLabel('Training mode').locator('option[value="tracking"]')).toHaveCount(0);
  await expect(page.locator('.settings-hint')).toHaveCount(0);
  await page.getByRole('button', {name: 'Session', exact: false}).click();
  await page.getByRole('button', {name: /Target tracking \(retired\)/}).click();
  await expect(page.getByRole('heading', {name: 'AK-47 / Target tracking (retired)', exact: true})).toBeVisible();
  await expect(page.locator('.section-title span')).toHaveText('72.0%');
});
