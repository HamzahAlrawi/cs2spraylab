import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';

const finishes = JSON.parse(readFileSync('src/range/cosmetics-data.json', 'utf8')).cosmetics as {id: string; equipment: string; label: string}[];
const ak = finishes.find(item => item.equipment === 'ak47')!;
const deagle = finishes.filter(item => item.equipment === 'deagle').slice(0, 2);

test.beforeEach(async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium', 'mobile-webkit', 'brave', 'opera-gx'].includes(info.project.name));
  await page.addInitScript(({ak, deagle}) => {
    if (sessionStorage.getItem('collection-seeded')) return;
    localStorage.setItem('spraylab.progression.v1', JSON.stringify({version: 2, xp: 357885, balance: 10000,
      owned: [ak.id, ...deagle.map(item => item.id)], equipped: {ak47: ak.id}}));
    sessionStorage.setItem('collection-seeded', '1');
  }, {ak, deagle});
  await page.goto('/');
});

test('collection is owned-only and scoped to the active gun, with a separate purchase view', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', {name: /Open armory/}).click();
  const armory = page.getByRole('dialog', {name: 'Armory'}), items = armory.locator('.progression-choice');
  await expect(armory.getByRole('button', {name: 'Collection', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(armory.getByLabel('Equipment', {exact: true})).toHaveValue('ak47');
  await expect(items).toHaveCount(2);
  await expect(armory.locator('option[value="all"]')).toHaveCount(0);
  await expect(armory.locator('.progression-price, .is-locked')).toHaveCount(0);
  await expect(armory.getByLabel('Ownership', {exact: true})).toHaveCount(0);
  await armory.getByLabel('Equipment', {exact: true}).selectOption('deagle');
  await expect(items).toHaveCount(3);
  await expect(items.locator('.progression-choice-name small')).toHaveText(['Desert Eagle', 'Desert Eagle', 'Desert Eagle']);
  await armory.getByRole('button', {name: 'Unlocks', exact: true}).click();
  await expect(items).toHaveCount(8);
  await expect(items.filter({hasText: deagle[0].label})).toHaveCount(0);
  const boughtName = await items.first().locator('.progression-choice-name').evaluate(node => node.firstChild!.textContent!);
  await items.first().getByRole('button').click();
  await expect(armory.getByRole('button', {name: 'Collection', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(items).toHaveCount(4);
  await expect(armory.locator('.progression-action-notice')).toContainText(`${boughtName} purchased`);
  await items.filter({hasText: boughtName}).getByRole('button').click();
  await expect(items.filter({hasText: boughtName})).toHaveClass(/is-equipped/);
  await armory.getByRole('button', {name: 'Close armory'}).click();
  await page.reload();
  await page.locator('.weapon-select').click();
  const loadout = page.getByRole('dialog', {name: 'Loadout'});
  await expect(loadout.locator('.loadout-finishes')).toHaveCount(1);
  await expect(loadout.locator('.loadout-finishes > div > button')).toHaveCount(2);
  await loadout.getByLabel('Sidearm', {exact: true}).selectOption('deagle');
  await loadout.getByLabel('Skin weapon', {exact: true}).selectOption('2');
  await expect(loadout.locator('.loadout-finishes > div > button')).toHaveCount(4);
  await expect(loadout.locator('.loadout-finishes button.selected')).toContainText(boughtName);
  await page.screenshot({path: `test-results/${info.project.name}-owned-loadout.png`});
  expect(errors).toEqual([]);
});

test('native glove previews and the focused collection fit small screens', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', {name: /Open armory/}).click();
  const armory = page.getByRole('dialog', {name: 'Armory'});
  await armory.getByRole('tab', {name: 'Gloves', exact: true}).click();
  await expect(armory.locator('.progression-choice')).toHaveCount(1);
  await expect(armory.locator('.progression-preview img')).toHaveAttribute('src', '/textures/cosmetics/gloves-standard-preview.webp');
  await armory.getByRole('button', {name: 'Unlocks', exact: true}).click();
  await expect(armory.locator('.progression-choice')).toHaveCount(8);
  await expect.poll(() => armory.locator('.progression-preview img').evaluateAll(nodes => nodes.every(node => {
    const image = node as HTMLImageElement; return image.complete && image.naturalWidth >= 128;
  }))).toBe(true);
  await expect(armory.getByRole('tab', {name: 'Gloves', exact: true}).locator('img')).toHaveAttribute('src', '/textures/cosmetics/gloves-standard-preview.webp');
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({width, height});
    const cards = armory.locator('.progression-choice');
    await cards.first().scrollIntoViewIfNeeded();
    expect(await armory.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await cards.evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
    expect(await armory.locator('.progression-views button, .progression-tabs button').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
    await page.screenshot({path: `test-results/${info.project.name}-glove-inventory-${width}.png`});
  }
  await armory.getByRole('button', {name: 'Collection', exact: true}).click();
  await expect(armory.locator('.progression-choice')).toHaveCount(1);
  expect(errors).toEqual([]);
});
