import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const weaponIds = Object.keys(JSON.parse(readFileSync('src/range/game-data.json', 'utf8')).weapons);

test('target readiness never enables shooting before the weapon has loaded', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/models/view-ak47.glb', async route => { await gate; await route.continue(); });
  const targetLoaded = page.waitForResponse('**/models/target.glb');
  await page.goto('/');
  await targetLoaded;
  await page.waitForTimeout(800);
  await expect(page.getByRole('button', { name: 'Loading range', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  let releaseNext!: () => void;
  const nextGate = new Promise<void>(resolve => { releaseNext = resolve; });
  await page.route('**/models/view-m4a4.glb', async route => { await nextGate; await route.continue(); });
  await page.locator('.weapon-select').click();
  await page.locator('.weapon-item').filter({ has: page.locator('img[src="/models/m4a4.png"]') }).click();
  await expect(page.getByRole('button', { name: 'Loading range', exact: true })).toBeDisabled();
  releaseNext();
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
});

test('range renders real models, settings persist, and viewport has no overflow', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  const canvas = page.locator('canvas[data-range]');
  const png = await canvas.screenshot();
  const stats = await sharp(png).stats();
  expect(stats.channels.slice(0, 3).every(c => c.stdev > 15)).toBe(true);
  await page.screenshot({ path: `test-results/${info.project.name}-range.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Invert mouse Y').check();
  await page.getByLabel('Follow recoil', { exact: true }).check();
  await page.getByRole('tab', { name: 'Crosshair', exact: true }).click();
  await page.getByRole('button', { name: 'Dot', exact: true }).click();
  await expect(page.getByLabel('Center dot', { exact: true })).toBeChecked();
  await page.screenshot({ path: `test-results/${info.project.name}-settings.png` });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Invert mouse Y')).toBeChecked();
  await expect(page.getByLabel('Follow recoil', { exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});

test('tap emits exactly a timed five-shot burst, without audio or Pointer Lock', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { value: undefined });
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { value: undefined });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Burst length').selectOption('5');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const canvas = page.locator('canvas[data-range]');
  if (info.project.name.startsWith('mobile')) {
    const bounds = (await canvas.boundingBox())!;
    await page.touchscreen.tap(bounds.x + bounds.width * .25, bounds.y + bounds.height * .4);
  } else {
    await canvas.dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 200, clientY: 400 });
    await canvas.dispatchEvent('pointerup', { button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch' });
  }
  await canvas.dispatchEvent('pointerup', { button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' });
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]')[0]?.shots)).toBe(5);
  await page.getByRole('button', { name: 'Session', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Recent attempts' })).toBeVisible();
});

test('moving targets animate in shooting modes without starting a burst', async ({ page }) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  await page.getByLabel('Training mode').selectOption('spray');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByLabel('Moving target', {exact: true}).check();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  const canvas = page.locator('canvas[data-range]');
  const before = await canvas.screenshot();
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForTimeout(700);
  const after = await canvas.screenshot();
  expect(before.equals(after)).toBe(false);
  if (await page.evaluate(() => Boolean(document.pointerLockElement))) await page.keyboard.press('Escape');
  else await page.getByRole('button', { name: 'Pause range', exact: true }).click();
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  await expect(page.getByTestId('ammo')).toContainText('30');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]').length)).toBe(0);
});

test('blocked storage still allows rendering and settings changes', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('Blocked', 'SecurityError'); } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Invert mouse Y').check();
  await expect(page.getByLabel('Invert mouse Y')).toBeChecked();
});

test('all weapon viewmodels render distinctly and native shot samples decode', async ({ page }, info) => {
  test.setTimeout(300000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  const names = weaponIds;
  const fingerprints = new Set<string>();
  for (const name of names) {
    await page.locator('.weapon-select').click();
    await page.locator('.weapon-item').filter({ has: page.locator(`img[src="/models/${name}.png"]`) }).click();
    await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
    await page.waitForTimeout(300);
    const png = await page.locator('canvas[data-range]').screenshot();
    // Exclude the animated wall plot: this fingerprint must come from the gun.
    const meta = await sharp(png).metadata();
    const left = Math.floor(meta.width! * .55), top = Math.floor(meta.height! * .6);
    const { data } = await sharp(png).extract({left, top, width: meta.width! - left, height: meta.height! - top}).resize(64, 64).raw().toBuffer({ resolveWithObject: true });
    fingerprints.add(data.toString('base64'));
    await page.screenshot({ path: `test-results/${info.project.name}-${name.replace(/[^a-z0-9]/gi, '')}.png` });
  }
  expect(fingerprints.size).toBe(17);
  await page.locator('.weapon-select').click();
  await page.locator('.weapon-item').filter({has: page.locator('img[src="/models/ak47.png"]')}).click();
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  const decoded = await page.evaluate(async ids => {
    const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    const ctx = new Constructor(); const results: { id: string; duration: number; peak: number }[] = [];
    try {
      for (const id of ids) {
        const response = await fetch(`/audio/${id}.wav`);
        const audio = await ctx.decodeAudioData(await response.arrayBuffer());
        let peak = 0; for (const s of audio.getChannelData(0)) peak = Math.max(peak, Math.abs(s));
        results.push({ id, duration: audio.duration, peak });
      }
    } finally { await ctx.close(); }
    return results;
  }, weaponIds);
  if (!decoded) {
    info.annotations.push({ type: 'capability', description: 'Windows WebKit has no Web Audio implementation; unavailable-audio behavior is checked here.' });
    await page.getByRole('button', { name: 'Enter range', exact: true }).click();
    await expect(page.locator('.statusbar')).toContainText('Audio unavailable');
    return;
  }
  expect(decoded).toHaveLength(17);
  for (const d of decoded) { expect(d.duration).toBeGreaterThan(.05); expect(d.peak).toBeGreaterThan(.01); }
});

test('guided cues, immediate repeat ammo, visible feedback and project links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  await expect(page.locator('.aim-cue.now')).toBeVisible();
  await expect(page.locator('.aim-cue.next')).toBeVisible();
  expect(await page.locator('.aim-cue.now').evaluate(e => getComputedStyle(e).color)).not.toBe(await page.locator('.aim-cue.next').evaluate(e => getComputedStyle(e).color));
  await expect(page.getByRole('link', { name: 'Donate' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://github.com/HamzahAlrawi/cs2spraylab');
  await expect(page.getByLabel('Target distance', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Sensitivity', { exact: true })).toHaveValue('1');
  await page.getByLabel('Burst length').selectOption('5');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const canvas = page.locator('canvas[data-range]');
  await canvas.dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch' });
  await expect(page.locator('.hit-caption')).toContainText(/HEADSHOT|BODY HIT|MISS/);
  await expect(page.locator('.exit-hint')).toContainText('Press ESC to exit');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]').length)).toBe(1);
  await expect(page.getByTestId('ammo')).toContainText('5');
  await canvas.dispatchEvent('pointerdown', { button: 0, pointerId: 2, isPrimary: true, pointerType: 'touch' });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]').length)).toBe(2);
  await expect(page.locator('.hud-ammo')).not.toContainText('Resetting');
});

test('walking controls distance, jump changes view and stationary backstop stays still', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop movement workflow');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { value: undefined }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter range', exact: true }).click();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => parseFloat(await page.locator('.distance-input output').innerText())).toBeLessThan(8);
  await page.keyboard.up('KeyW');
  const canvas = page.locator('canvas[data-range]');
  await page.waitForTimeout(400);
  const before = await canvas.screenshot();
  // Capture a real keyboard jump after fixed steps, before screenshot IPC.
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-range]')!;
    canvas.dataset.jumpFrameReady = 'false';
    const onJump = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      window.removeEventListener('keydown', onJump);
      const start = performance.now();
      const freeze = (now: number) => {
        if (now - start < 60) { requestAnimationFrame(freeze); return; }
        window.dispatchEvent(new Event('blur'));
        canvas.dataset.jumpFrameReady = 'true';
      };
      requestAnimationFrame(freeze);
    };
    window.addEventListener('keydown', onJump);
  });
  await page.keyboard.down('Space');
  await expect(canvas).toHaveAttribute('data-jump-frame-ready', 'true');
  await page.keyboard.up('Space');
  const jumped = await canvas.screenshot(); expect(jumped.equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Enter range', exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `test-results/${info.project.name}-close-target.png` });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Moving target', { exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Enter range', exact: true }).click();
  const a = await canvas.screenshot(); await page.waitForTimeout(230); const b = await canvas.screenshot();
  const meta = await sharp(a).metadata();
  const area = { left: Math.round(meta.width! * .3), top: Math.round(meta.height! * .3), width: 60, height: 35 };
  const wallA = await sharp(a).extract(area).raw().toBuffer(), wallB = await sharp(b).extract(area).raw().toBuffer();
  const delta = wallA.reduce((sum, v, i) => sum + Math.abs(v - wallB[i]), 0) / wallA.length;
  expect(delta).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('mouse Pointer Lock rejection leaves drag aim and keyboard movement usable', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop mouse workflow');
  await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { value: () => Promise.reject(new DOMException('Denied', 'SecurityError')) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter range', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('Drag aim');
  await page.keyboard.down('KeyD');
  await expect.poll(async () => Number(await page.locator('.hud-stat b').first().innerText())).toBeGreaterThan(50);
  await page.keyboard.up('KeyD');
  const canvas = page.locator('canvas[data-range]'); const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .4);
  await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]')[0]?.shots)).toBeGreaterThan(0);
});

test('transfer hands the guide from A to B and restores A for the next attempt', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  await page.getByLabel('Training mode').selectOption('transfer');
  await expect(page.locator('.aim-cue.now')).toContainText('NOW 1 / A');
  const canvas = page.locator('canvas[data-range]');
  await canvas.dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch' });
  await expect(page.locator('.aim-cue.now')).toContainText('/ B');
  await expect(page.locator('.aim-cue.next')).toContainText('/ B');
  await page.screenshot({ path: `test-results/${info.project.name}-transfer.png` });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]')[0]?.shots)).toBe(30);
  await expect(page.locator('.aim-cue.now')).toContainText('NOW 1 / A');
});

test('long-range compensation cues remain fixed-size and player distance persists', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Long desktop traversal is covered once');
  await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { value: undefined }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  const nearSize = await page.locator('.aim-cue.now').boundingBox();
  await page.getByRole('button', { name: 'Enter range', exact: true }).click();
  await page.keyboard.down('KeyS');
  await expect.poll(async () => parseFloat(await page.locator('.distance-input output').innerText()), { timeout: 25000 }).toBeGreaterThan(90);
  await page.keyboard.up('KeyS');
  await page.getByRole('button', { name: 'Pause range', exact: true }).click();
  await expect(page.locator('.aim-cue.now')).toBeVisible();
  await expect(page.locator('.aim-cue.next')).toBeVisible();
  const farSize = await page.locator('.aim-cue.now').boundingBox();
  expect(farSize!.width).toBe(nearSize!.width); expect(farSize!.height).toBe(nearSize!.height);
  await page.getByLabel('Training mode').selectOption('spray');
  await expect(page.locator('.aim-cue.now')).toBeHidden();
  expect(parseFloat(await page.locator('.distance-input output').innerText())).toBeGreaterThan(90);
  await page.getByLabel('Training mode').selectOption('guided');
  await page.screenshot({ path: `test-results/${info.project.name}-long-range.png` });
});

test('mobile landscape keeps shooting, settings and project links within the viewport', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('mobile'), 'Touch landscape workflow');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter range', exact: true })).toBeEnabled({timeout: 45000});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await expect(page.getByRole('link', { name: 'Donate' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  const canvas = page.locator('canvas[data-range]'), b = (await canvas.boundingBox())!;
  expect(b.height).toBeGreaterThan(240);
  const stats = await sharp(await canvas.screenshot()).stats();
  expect(stats.channels.slice(0, 3).every(c => c.stdev > 15)).toBe(true);
  await page.touchscreen.tap(b.x + b.width * .25, b.y + b.height * .4);
  const caption = (await page.locator('.hit-caption').boundingBox())!;
  const score = (await page.locator('.hud-result').boundingBox())!;
  expect(caption.y + caption.height).toBeLessThan(score.y);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]')[0]?.shots)).toBe(30);
  await page.screenshot({ path: `test-results/${info.project.name}-landscape.png` });
});
