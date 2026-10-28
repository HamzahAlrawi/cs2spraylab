import {expect, test} from '@playwright/test';

test('contextual settings shortcuts open audio or mouse instead of an unrelated previous tab', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'hearing', volume: .2, quality: 'performance'})));
  await page.goto('/');
  await page.getByRole('button', {name: 'Range audio settings', exact: true}).click();
  await expect(page.getByRole('tab', {name: 'Audio & video', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Weapon volume', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByLabel('Training mode', {exact: true}).selectOption('duel');
  const show = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await show.isVisible()) await show.click();
  await page.getByRole('button', {name: 'Mouse & crosshair', exact: true}).click();
  await expect(page.getByRole('tab', {name: 'Mouse', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Sensitivity', {exact: true})).toBeVisible();
});

test('rapid Deagle taps in guided practice keep the page alive with finite shot data', async ({page}) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({
    mode: 'guided', sidearm: 'deagle', primaryEnabled: false, volume: 0, quality: 'performance',
  })));
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  const canvas = page.locator('canvas[data-range]');
  for (let i = 0; i < 6; i++) {
    await canvas.dispatchEvent('pointerdown', {button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch'});
    await canvas.dispatchEvent('pointerup', {button: 0, pointerId: 1, isPrimary: true, pointerType: 'touch'});
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('ammo')).toContainText('1');
  await expect(canvas).toBeVisible(); await expect(page.locator('.range-error')).toHaveCount(0);
  expect(await page.locator('.range-app').innerText()).not.toMatch(/NaN|undefined|Infinity/);
  expect(errors).toEqual([]);
});

test('switching from combat waits for the range engine and its assets before accepting entry', async ({page}) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible();
  let release!: () => void;
  const delay = new Promise<void>(resolve => release = resolve);
  await page.route('**/src/range/engine.ts*', async route => {await delay; await route.continue();});
  await page.getByLabel('Training mode', {exact: true}).selectOption('guided');
  const loading = page.getByRole('button', {name: 'Loading range', exact: true});
  await expect(loading).toBeDisabled();
  // A double tap while changing modes must not dereference a missing engine.
  await loading.dispatchEvent('click'); await loading.dispatchEvent('click');
  await expect(page.locator('canvas[data-range]')).toHaveCount(0);
  release();
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  await page.getByLabel('Training mode', {exact: true}).selectOption('hearing');
  await expect(page.getByRole('region', {name: 'Hearing practice', exact: true})).toBeVisible();
  await page.getByLabel('Training mode', {exact: true}).selectOption('guided');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  await expect(page.locator('canvas[data-range]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a completed duel keeps its measured scorecard after automatic round reset', async ({page}) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ path), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).scoreHealthQA = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).scoreHealthQA?.motionReady);
  const review = await page.evaluate(() => {
    const e = (window as any).scoreHealthQA, sim = e.sim;
    e.pause(); sim.arena.solids.length = 0;
    const [player, bot] = sim.actors;
    player.position = {x: 0, y: 1.6256, z: 3}; player.yaw = player.pitch = 0; player.health = 10000;
    bot.position = {x: 0, y: 1.6256, z: 0}; bot.health = 1;
    sim.command(1, {}); sim.start(); sim.paused = false;
    sim.command(0, {firePressed: true, fireHeld: true});
    for (let tick = 0; tick < 384 && sim.phase === 'fighting'; tick++) sim.step();
    e.processEvents(sim.drainEvents());
    const review = e.completedRound?.review;
    e.restart(); e.report(); return review;
  });
  expect(review?.shots).toBeGreaterThan(0);
  const show = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await show.isVisible()) await show.click();
  await page.getByRole('tab', {name: 'Scorecard', exact: true}).click();
  const card = page.getByRole('region', {name: 'Duel scorecard', exact: true});
  await expect(card).toContainText('Last completed round');
  await expect(card).toContainText(`${review.hits} / ${review.shots}`);
  await expect(card).not.toContainText(/NaN|undefined|Infinity|\[object Object\]/);
  await expect(card.getByText('Next rep', {exact: true})).toBeVisible();
  await card.getByText('Skill breakdown', {exact: true}).click();
  await card.getByRole('button', {name: 'Practice this', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Practice block', exact: true})).toContainText('0 of 3 reps');
  expect(errors).toEqual([]);
});

test('the fullscreen toolbar works for combat and range views', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop fullscreen API. Mobile has no toolbar fullscreen.');
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'}));
    (window as any).fullscreenRequests = [];
    // Verify the requested surface without depending on headless OS fullscreen support.
    HTMLElement.prototype.requestFullscreen = async function() {(window as any).fullscreenRequests.push(this.getAttribute('aria-label'));};
  });
  await page.goto('/');
  for (const mode of ['duel', 'guided', 'prefire']) {
    await page.getByLabel('Training mode', {exact: true}).selectOption(mode);
    await page.getByRole('button', {name: 'Fullscreen', exact: true}).click();
  }
  expect(await page.evaluate(() => (window as any).fullscreenRequests)).toEqual(['Practice range', 'Practice range', 'Practice range']);
});
