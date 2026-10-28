import {expect, test, type Page} from '@playwright/test';

async function openArmory(page: Page, xp = 357885, balance = 1000000) {
  await page.addInitScript(({xp, balance}) => localStorage.setItem('spraylab.progression.v1', JSON.stringify({version: 2, xp, balance, owned: [], equipped: {}})), {xp, balance});
  await page.goto('/tests/armory-host.html');
  await page.getByRole('button', {name: /Open armory/}).click();
  return page.getByRole('dialog', {name: 'Armory', exact: true});
}

test('browse, cancel, confirm and equip are separate keyboard-safe actions', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const dialog = await openArmory(page);
  await expect(dialog.getByRole('button', {name: 'Close armory'})).toBeFocused();
  await expect(dialog.locator('.progression-choice')).toHaveCount(1);
  await dialog.getByRole('button', {name: 'Unlocks', exact: true}).click();
  await expect(dialog.locator('.progression-choice')).toHaveCount(8);
  const firstPage = await dialog.locator('.progression-choice').first().getAttribute('aria-label');
  await dialog.getByRole('button', {name: 'Next page'}).click();
  expect(await dialog.locator('.progression-choice').first().getAttribute('aria-label')).not.toBe(firstPage);
  await dialog.getByRole('button', {name: 'Previous page'}).click();
  await dialog.locator('.progression-choice').first().click();
  const detail = dialog.locator('.armory-detail'), label = await detail.locator('h3').innerText();
  const balanceBefore = await dialog.locator('.progression-wallet strong').innerText();
  await detail.getByRole('button', {name: /^Buy /}).click();
  await expect(detail.getByRole('group', {name: 'Purchase confirmation'})).toBeVisible();
  await expect(detail.getByRole('button', {name: 'Cancel', exact: true})).toBeFocused();
  await expect(dialog.locator('.progression-wallet strong')).toHaveText(balanceBefore);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(detail.getByRole('button', {name: /^Buy /})).toBeFocused();
  await detail.getByRole('button', {name: /^Buy /}).click();
  await detail.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(dialog.locator('.progression-wallet strong')).toHaveText(balanceBefore);
  await detail.getByRole('button', {name: /^Buy /}).click();
  await detail.getByRole('button', {name: 'Confirm purchase', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'Collection', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.locator('h3')).toHaveText(label);
  await expect(detail.getByRole('button', {name: `Equip ${label}`, exact: true})).toBeFocused();
  await expect(dialog.locator('.progression-action-notice')).toContainText('Ready to equip');
  expect(await dialog.locator('.progression-wallet strong').innerText()).not.toBe(balanceBefore);
  await detail.getByRole('button', {name: `Equip ${label}`, exact: true}).click();
  await expect(detail.getByRole('button', {name: `${label}, equipped`, exact: true})).toBeDisabled();
  await page.screenshot({path: test.info().outputPath('armory-owned.png'), fullPage: true});
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Open armory/})).toBeFocused();
  expect(errors).toEqual([]);
});

test('locked and insufficient-credit items remain inspectable but cannot be bought', async ({page}) => {
  const dialog = await openArmory(page, 0, 0);
  await dialog.getByRole('button', {name: 'Unlocks', exact: true}).click();
  await dialog.locator('.progression-choice').first().click();
  await expect(dialog.locator('.armory-detail .progression-item-action')).toBeDisabled();
  await dialog.getByRole('tab', {name: 'Knives', exact: true}).click();
  await dialog.locator('.progression-choice').first().click();
  await expect(dialog.locator('.armory-detail .armory-status')).toHaveText('Level locked');
  await expect(dialog.locator('.armory-detail .progression-item-action')).toBeDisabled();
  await dialog.getByLabel('Availability', {exact: true}).selectOption('affordable');
  await expect(dialog.getByText('No finishes match your filters.')).toBeVisible();
  await dialog.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(dialog.locator('.progression-choice')).toHaveCount(8);
  await dialog.getByRole('tab', {name: 'Knives', exact: true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', {name: 'Gloves', exact: true})).toBeFocused();
  await expect(dialog.getByRole('tab', {name: 'Gloves', exact: true})).toHaveAttribute('aria-selected', 'true');
});

test('native glove previews and detail controls fit desktop and mobile', async ({page}) => {
  await openArmory(page);
  await page.getByRole('button', {name: 'Close armory'}).click();
  await page.getByRole('button', {name: 'Open glove unlocks', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Armory', exact: true});
  await expect(dialog.getByRole('tab', {name: 'Gloves', exact: true})).toHaveAttribute('aria-selected', 'true');
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 700], [844, 390]]) {
    await page.setViewportSize({width, height});
    await expect.poll(() => dialog.locator('.progression-preview img').evaluateAll(nodes => nodes.every(node => {
      const image = node as HTMLImageElement; return image.complete && image.naturalWidth > 0;
    }))).toBe(true);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await dialog.locator('button, select, input').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1))).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({path: test.info().outputPath(`armory-gloves-${width}.png`), fullPage: true});
    if (width === 390) {
      const choice = dialog.locator('.progression-choice').first();
      await choice.click();
      await expect(dialog.getByRole('button', {name: 'Back to finishes', exact: true})).toBeFocused();
      await expect(dialog.locator('.armory-detail')).toBeVisible();
      await page.screenshot({path: test.info().outputPath('armory-mobile-detail.png'), fullPage: true});
      await dialog.getByRole('button', {name: 'Back to finishes', exact: true}).click();
      await expect(choice).toBeFocused();
    }
  }
  await page.getByRole('button', {name: 'Close armory'}).click();
  await expect(page.getByRole('button', {name: 'Open glove unlocks', exact: true})).toBeFocused();
});

test('the existing app opens the redesigned armory without integration changes', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', quality: 'performance', volume: 0, showTips: false})));
  await page.goto('/');
  const trigger = page.getByRole('button', {name: /Open armory/});
  await trigger.click();
  const dialog = page.getByRole('dialog', {name: 'Armory', exact: true});
  await expect(dialog.getByRole('region', {name: 'Progression account'})).toBeVisible();
  await expect(dialog.getByLabel('Equipment', {exact: true})).toHaveValue('ak47');
  await dialog.getByText('Account totals', {exact: false}).click();
  await expect(dialog.getByText('Credits earned', {exact: true})).toBeVisible();
  await dialog.getByRole('button', {name: 'Achievements', exact: false}).click();
  await expect(dialog.getByRole('combobox', {name: 'Achievement category'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
