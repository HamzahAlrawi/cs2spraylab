import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function ready(page: Page, mode = 'duel') {
  await page.addInitScript(mode => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, quality: 'performance', volume: 0, showTips: false}));
  }, mode);
  await page.goto('/');
  await expect(page.getByRole('combobox', {name: 'Training mode', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Learn the fundamentals', exact: true})).toBeVisible();
}
async function showSetup(page: Page) {
  const show = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await show.isVisible()) await show.click();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const button = page.getByRole('button', {name: 'Settings', exact: true});
  const bounds = (await button.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test('drill discovery searches by skill and changes mode without changing the loadout', async ({page}, info) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!));
  const launch = page.getByRole('button', {name: 'Choose a drill', exact: true});
  await launch.click();
  const dialog = page.getByRole('dialog', {name: 'Choose a drill', exact: true});
  await expect(dialog.getByLabel('Find a drill')).toBeFocused();
  await expect(dialog.locator('.drill-choice')).toHaveCount(9);
  await expect(dialog.getByRole('button', {name: 'Choose AI Duel', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({path: `test-results/ux-drill-library-${info.project.name}.png`});
  await dialog.getByLabel('Find a drill').fill('zzzz');
  await expect(dialog.getByText('No matching drills')).toBeVisible();
  await dialog.getByRole('button', {name: 'Clear search', exact: true}).click();
  await dialog.getByLabel('Find a drill').fill('recoil fundamentals');
  await expect(dialog.locator('.drill-choice')).toHaveCount(1);
  await page.screenshot({path: `test-results/ux-drills-${info.project.name}.png`});
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(launch).toBeFocused();
  await launch.click();
  await page.getByRole('button', {name: 'Choose Guided spray', exact: true}).click();
  await expect(page.getByLabel('Training mode')).toHaveValue('guided');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 45000});
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!));
  for (const key of ['sensitivity', 'dpi', 'weapon', 'sidearm', 'primaryEnabled', 'crosshair']) expect(after[key]).toEqual(before[key]);
  expect(after.spread).toBe(false);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Training', exact: true}).click();
  await page.getByLabel('Practice spread', {exact: true}).check();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await launch.click();
  await page.getByRole('button', {name: 'Choose Guided spray', exact: true}).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).spread)).toBe(true);
  const canvas = page.locator('canvas[data-range]');
  const entry = (await page.getByRole('button', {name: 'Enter range', exact: true}).boundingBox())!;
  const cue = await page.locator('.aim-cue.now').boundingBox();
  if (cue) expect(entry.y >= cue.y + cue.height || entry.y + entry.height <= cue.y).toBe(true);
  expect((await sharp(await canvas.screenshot()).stats()).channels[0].stdev).toBeGreaterThan(10);
  await page.screenshot({path: `test-results/ux-workspace-${info.project.name}.png`});
  expect(errors).toEqual([]);
});

test('settings have keyboard tabs, persistent edits and a safe reset confirmation', async ({page}, info) => {
  test.setTimeout(90000);
  await ready(page, 'guided');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  await expect(page.getByRole('tab', {name: 'Mouse', exact: true})).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Sensitivity', {exact: true}).fill('1.23');
  await page.getByLabel('Sensitivity', {exact: true}).press('Tab');
  await expect(page.getByLabel('Sensitivity', {exact: true})).toHaveValue('1.23');
  await page.getByRole('tab', {name: 'Mouse', exact: true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', {name: 'Crosshair', exact: true})).toBeFocused();
  await expect(page.getByLabel('Crosshair preview')).toBeVisible();
  await page.getByRole('button', {name: 'Classic', exact: true}).click();
  await page.getByRole('tab', {name: 'Training', exact: true}).click();
  await expect(page.getByLabel('Practice spread', {exact: true})).toBeVisible();
  await page.getByRole('tab', {name: 'Audio & video', exact: true}).click();
  await expect(page.getByLabel('Render quality')).toBeVisible();
  await expect(page.getByLabel('Import angular capture')).not.toBeVisible();
  await dialog.locator('summary').filter({hasText: 'Data, imports & exports'}).click();
  await expect(page.getByLabel('Import angular capture')).toBeAttached();
  await page.getByRole('tab', {name: 'Mouse', exact: true}).click();
  await page.getByRole('button', {name: 'Restore defaults', exact: true}).click();
  await expect(page.getByLabel('Sensitivity', {exact: true})).toHaveValue('1.23');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.screenshot({path: `test-results/ux-settings-${info.project.name}.png`});
  await noOverflow(page);
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.reload();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Sensitivity', {exact: true})).toHaveValue('1.23');
  await page.getByRole('button', {name: 'Restore defaults', exact: true}).click();
  await page.getByRole('button', {name: 'Reset settings', exact: true}).click();
  await expect(page.getByLabel('Sensitivity', {exact: true})).toHaveValue('0.5');
  await expect(page.getByText('Settings restored.', {exact: true})).toBeVisible();
  // The closed calibration disclosure must not trap focus offscreen.
  await page.getByRole('button', {name: 'Done', exact: true}).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Close panel', exact: true})).toBeFocused();
});

test('loadout categories and search narrow weapons without changing owned finishes', async ({page}, info) => {
  test.setTimeout(90000);
  await ready(page);
  await page.locator('.weapon-select').click();
  const dialog = page.getByRole('dialog', {name: 'Loadout', exact: true});
  const inventoryCount = await dialog.locator('.weapon-item').count();
  await dialog.getByRole('button', {name: 'Pistols', exact: true}).click();
  await expect(dialog.locator('.weapon-item')).toHaveCount(10);
  await dialog.getByLabel('Find a weapon').fill('Desert');
  await expect(dialog.locator('.weapon-item')).toHaveCount(1);
  await expect(dialog.locator('.weapon-item')).toContainText('Desert Eagle');
  await page.screenshot({path: `test-results/ux-loadout-${info.project.name}.png`});
  await noOverflow(page);
  await dialog.getByLabel('Find a weapon').fill('zzzz');
  await expect(dialog.getByText('No matching weapons')).toBeVisible();
  await dialog.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(dialog.locator('.weapon-item')).toHaveCount(inventoryCount);
  await dialog.getByLabel('Find a weapon').fill('Desert');
  await dialog.locator('.weapon-item').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.weapon-select')).toContainText('Desert Eagle');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!));
  expect(settings.primaryEnabled).toBe(false); expect(settings.sidearm).toBe('deagle');
});

test('essential duel setup stays clear while advanced controls and focus view remain available', async ({page}, info) => {
  test.setTimeout(90000);
  await ready(page);
  await showSetup(page);
  await expect(page.getByLabel('Bot skill level', {exact: true})).toBeVisible();
  await page.getByLabel('Bot skill level', {exact: true}).selectOption('5');
  await expect(page.getByLabel('Bot health', {exact: true})).not.toBeVisible();
  await page.locator('summary').filter({hasText: /^Health & armor$/}).click();
  await page.getByLabel('Player health', {exact: true}).fill('150');
  await page.locator('summary').filter({hasText: /^Health & armor$/}).click();
  await page.screenshot({path: `test-results/ux-setup-${info.project.name}.png`});
  await noOverflow(page);
  await page.getByRole('button', {name: 'Hide drill panel', exact: true}).click();
  await expect(page.getByLabel('Duel settings', {exact: true})).toBeHidden();
  await expect(page.getByRole('button', {name: 'Enter duel', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Show drill panel', exact: true}).click();
  await expect(page.getByLabel('Bot skill level', {exact: true})).toHaveValue('5');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.duel.v1')!).playerHealth)).toBe(150);
});

test('workspace controls stay within compact, tablet, landscape and desktop viewports', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'One explicit responsive sweep; mobile workflows run separately.');
  test.setTimeout(90000);
  await ready(page, 'guided');
  for (const size of [{width: 320, height: 740}, {width: 393, height: 800}, {width: 768, height: 1024}, {width: 740, height: 390}, {width: 1280, height: 720}, {width: 1440, height: 1000}]) {
    await page.setViewportSize(size);
    await noOverflow(page);
    for (const name of ['Choose a drill', 'Settings', 'Unmute']) {
      const node = page.getByRole('button', {name, exact: true});
      const box = (await node.boundingBox())!;
      expect(box.x, `${name} at ${size.width}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name} at ${size.width}`).toBeLessThanOrEqual(size.width);
    }
    await page.screenshot({path: `test-results/ux-responsive-${size.width}x${size.height}.png`});
  }
});
