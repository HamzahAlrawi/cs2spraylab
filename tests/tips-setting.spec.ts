import {expect, test} from '@playwright/test';

test('tips opt-out persists without hiding controls, measurements or manual lessons', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name), 'Desktop/mobile tips integration');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'guided', showTips: false, volume: 0, quality: 'performance',
    }));
  });
  await page.goto('/');
  await expect(page.locator('.mode-brief p')).toHaveCount(0);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Training', exact: true}).click();
  const tips = page.getByRole('switch', {name: 'Show coaching tips', exact: true});
  await expect(tips).not.toBeChecked();
  await tips.check();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.locator('.mode-brief p')).toHaveCount(1);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await tips.uncheck();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.reload();
  await expect(page.locator('.mode-brief p')).toHaveCount(0);
  await page.getByLabel('Training mode').selectOption('prefire');
  const showPanel = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await showPanel.isVisible()) await showPanel.click();
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout: 90000});
  await expect(page.locator('.prefire-goal')).toHaveCount(0);
  await page.locator('summary').filter({hasText: /^Run review/}).click();
  await expect(page.getByText('Quality score', {exact: true})).toBeVisible();
  const candidates = await page.evaluate(async () => {
    const routesPath = '/src/range/prefire/routes.ts', occupancyPath = '/src/range/prefire/occupancy.ts';
    const {prefireRoutes} = await import(/* @vite-ignore */ routesPath);
    const {prefireCandidates} = await import(/* @vite-ignore */ occupancyPath);
    return prefireCandidates(prefireRoutes.find((route: {id: string}) => route.id === 'long-doors')).length;
  });
  await page.locator('summary').filter({hasText: /^Possible holds/}).click();
  await expect(page.getByLabel('Route angles').locator('li')).toHaveCount(candidates);
  await expect(page.getByRole('button', {name: 'Enter prefire', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Learn the fundamentals', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Stop before you shoot'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Watch example', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Close tutorial', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
