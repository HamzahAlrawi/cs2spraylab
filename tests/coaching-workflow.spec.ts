import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function openRange(page: Page) {
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', weapon: 'm4a4', spread: false, burst: 10, volume: 0, quality: 'performance'})));
  await page.goto('/');
  const showPanel = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await showPanel.isVisible()) await showPanel.click();
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ path);
    const tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).workflowEngine = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).workflowEngine?.assetStatus === 'Models ready');
}
async function fireAttempt(page: Page) {
  return page.evaluate(() => {
    const e = (window as any).workflowEngine; cancelAnimationFrame(e.frame); e.reset();
    const s = e.sim; s.start(true);
    for (let i = 0; i < 200; i++) s.advance(1 / 128);
    s.active = false; e.statusTime = -1; e.previous = performance.now() - 120; e.tick(performance.now());
    return s.latest;
  });
}

test('diagnosis launches measured reps, deep-links lessons, renders comparable trends and restores the task', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openRange(page);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(resources.some(url => url.includes('/DuelStage.tsx') || url.includes('/HearingPractice.tsx') || url.includes('/MovementTutorial.tsx'))).toBe(false);
  const first = await fireAttempt(page); expect(first.shots).toBe(10);
  const coach = page.getByRole('complementary', {name: 'Range skill coach'});
  await coach.getByRole('button', {name: /Practice this/}).click();
  const block = page.getByRole('region', {name: 'Practice block'});
  await expect(block).toContainText('0 of 3 reps');
  await coach.getByRole('button', {name: 'Review lesson', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Aim with your movement'})).toBeVisible();
  await page.getByRole('button', {name: 'Close tutorial'}).click();
  await expect(page.getByLabel('Training mode')).toHaveValue('guided');
  await expect(page.locator('.weapon-select')).toContainText('M4A4');
  for (let i = 1; i <= 3; i++) {
    await fireAttempt(page); await expect(block).toContainText(`${i} of 3 reps`);
  }
  await expect(block).toContainText('3 measured');
  await coach.getByText('Same-setup skill trends', {exact: true}).click();
  await expect(coach.locator('.skill-trends')).toContainText('n=4');
  await expect(block.getByRole('button', {name: 'Save retention check'})).toBeVisible();
  await block.getByRole('button', {name: 'Save retention check'}).click();
  await block.getByRole('button', {name: 'End practice block'}).click();
  await expect(block).toHaveCount(0); await expect(page.getByRole('button', {name: /Retention check/})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const intro = await page.locator('.mode-brief').evaluate(node => ({padding: getComputedStyle(node).paddingLeft, font: getComputedStyle(node).fontSize}));
  expect(parseFloat(intro.padding)).toBeGreaterThanOrEqual(12); expect(parseFloat(intro.font)).toBeLessThanOrEqual(12);
  await page.screenshot({path: `test-results/coaching-workflow-${info.project.name}.png`, fullPage: true});
  const pixels = await sharp(await page.locator('canvas[data-range]').screenshot()).stats();
  expect(pixels.channels[0].stdev).toBeGreaterThan(10); expect(errors).toEqual([]);
});

test('changing task settings excludes incompatible reps from the block and skill trend', async ({page}) => {
  await openRange(page); await fireAttempt(page);
  await page.getByRole('button', {name: /Practice this/}).click();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Training', exact: true}).click();
  await page.getByLabel('Practice spread', {exact: true}).check();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await fireAttempt(page);
  await expect(page.getByRole('region', {name: 'Practice block'})).toContainText('0 of 3 reps');
  await page.getByText('Same-setup skill trends', {exact: true}).click();
  await expect(page.locator('.skill-trends')).toContainText('n=1');
});

test('a lesson opened from Session replaces that dialog and returns focus to practice', async ({page}) => {
  await openRange(page); await fireAttempt(page);
  await page.getByRole('button', {name: /^Session/}).click();
  const session = page.getByRole('dialog');
  await session.getByRole('button', {name: 'Review lesson', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Aim with your movement', exact: true})).toBeVisible();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Learn the fundamentals', exact: true})).toBeFocused();
});
