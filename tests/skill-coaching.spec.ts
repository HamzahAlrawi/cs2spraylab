import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function range(page: Page) {
  await page.addInitScript(() => {if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', spread: false, burst: 10, volume: 0, quality: 'performance'}));});
  await page.goto('/');
  const showPanel = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await showPanel.isVisible()) await showPanel.click();
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).skillEngine = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).skillEngine?.loadedTarget && (window as any).skillEngine.assetStatus === 'Models ready');
}

test('physical spray attempts produce specific measurable coaching, persist and keep the canvas stable', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await range(page);
  const before = await page.locator('canvas[data-range]').boundingBox();
  // Exercise actual range shots and mesh hit resolution; do not insert fake
  // impact samples, hits, coaching results or quality scores.
  const result = await page.evaluate(async () => {
    const e = (window as any).skillEngine, s = e.sim;
    cancelAnimationFrame(e.frame); s.start(true);
    for (let i = 0; i < 150; i++) s.advance(1 / 128);
    s.active = false; e.statusTime = -1; e.previous = performance.now() - 120; e.tick(performance.now());
    return s.latest;
  });
  expect(result.shots).toBe(10);
  expect(result.samples.every((s: any) => Number.isFinite(s.aimX) && Number.isFinite(s.aimY))).toBe(true);
  expect(result.coaching.focus).toBe('Control the later climb');
  const review = page.getByRole('region', {name: 'Skill review'});
  await expect(review).toContainText('Rounds 1-6');
  await expect(review).toContainText('Next rep'); await expect(review).toContainText('Goal');
  await expect(review).toContainText('Spray control');
  await expect(review.getByText('spray is climbing', {exact: false})).toBeVisible();
  const terms = review.locator('.coaching-terms');
  await expect(terms).not.toHaveAttribute('open');
  await terms.getByText('CS2 terms', {exact: true}).click();
  await expect(terms).toContainText('Spray control / reset');
  await expect(terms).toContainText('does not instantly reset recoil');
  await terms.getByText('CS2 terms', {exact: true}).click();
  await expect(review).toContainText('10 measured shots');
  const after = await page.locator('canvas[data-range]').boundingBox();
  expect(after!.height).toBeCloseTo(before!.height, 0); expect(after!.width).toBeCloseTo(before!.width, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('complementary', {name: 'Range skill coach'}).screenshot({path: `test-results/skill-coach-${info.project.name}.png`});
  const canvas = await page.locator('canvas[data-range]').screenshot();
  expect((await sharp(canvas).stats()).channels[0].stdev).toBeGreaterThan(12);
  await page.reload();
  const showReview = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await showReview.isVisible()) await showReview.click();
  await expect(review).toContainText('Control the later climb');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Training', exact: true}).click();
  await page.getByRole('switch', {name: 'Show coaching tips', exact: true}).uncheck();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(review.locator('.coaching-terms')).toBeHidden();
  await expect(review.locator('.coaching-evidence')).toBeVisible();
  await expect(review.getByRole('meter', {name: 'Spray control practice score'})).toBeVisible();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('switch', {name: 'Show coaching tips', exact: true}).check();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(review.getByText('CS2 terms', {exact: true})).toBeVisible();
  await page.getByLabel('Training mode').selectOption('spray');
  await expect(page.getByRole('complementary', {name: 'Range skill coach'})).toContainText('Prepare, then control');
  await page.getByLabel('Training mode').selectOption('transfer');
  await expect(page.getByRole('complementary', {name: 'Range skill coach'})).toContainText('Control A, acquire B');
  expect(errors).toEqual([]);
});

test('all movement drills expose measured goals and distinguish settled shots from actual counterstrafes', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await range(page);
  for (const mode of ['precision', 'burst', 'peek']) {
    await page.getByLabel('Training mode').selectOption(mode);
    await page.waitForFunction(mode => (window as any).skillEngine?.sim.settings.mode === mode, mode);
    await page.evaluate(() => {
      const e = (window as any).skillEngine, s = e.sim;
      cancelAnimationFrame(e.frame); s.start(true);
      for (let i = 0; i < 140; i++) s.advance(1 / 128);
      if (!s.drill.finished) s.completeDrill();
      s.active = false; e.statusTime = -1; e.previous = performance.now() - 120; e.tick(performance.now());
    });
    const coach = page.getByRole('complementary', {name: 'Drill coach'});
    await expect(coach).toContainText('Next rep'); await expect(coach).toContainText('Goal');
    await expect(coach.getByRole('region', {name: 'Skill review'})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('real semi-automatic presses build a measured tap review without resetting recovery', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', primaryEnabled: false, sidearm: 'deagle', spread: false, volume: 0, quality: 'performance'})));
  await range(page);
  const data = await page.evaluate(() => {
    const e = (window as any).skillEngine, s = e.sim; cancelAnimationFrame(e.frame);
    const punches = [];
    for (let i = 0; i < 3; i++) {
      s.start(true); punches.push(s.recovery.recoil.pitch);
      s.advance(.25); s.advance(.1);
    }
    s.active = false; e.statusTime = -1; e.previous = performance.now() - 120; e.tick(performance.now());
    return {punches, result: s.latest};
  });
  expect(data.result.shots).toBe(1); expect(data.result.coaching.score).not.toBeNull();
  expect(data.punches[1]).toBeGreaterThan(0);
  const review = page.getByRole('region', {name: 'Skill review'});
  await expect(review).toContainText('Recent 3 taps');
  await expect(review).toContainText('across 3 comparable attempts');
  await page.reload(); await expect(review).toContainText('Recent 3 taps');
  expect(errors).toEqual([]);
});
