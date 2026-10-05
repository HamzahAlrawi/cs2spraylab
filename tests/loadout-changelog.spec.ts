import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';

const catalog = JSON.parse(readFileSync('src/range/cosmetics-data.json', 'utf8')).cosmetics as {id: string; equipment: string; label: string}[];
const ak = catalog.find(item => item.equipment === 'ak47')!;
const deagle = catalog.filter(item => item.equipment === 'deagle').slice(0, 2);

test.beforeEach(async ({page}) => {
  await page.addInitScript(({ak, deagle}) => {
    if (sessionStorage.getItem('loadout-changelog-seeded')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({weapon: 'awp', sidearm: 'deagle', primaryEnabled: true, volume: 0}));
    localStorage.setItem('spraylab.progression.v1', JSON.stringify({version: 2, xp: 357885, balance: 10000,
      owned: [ak.id, ...deagle.map(item => item.id)], equipped: {ak47: ak.id, deagle: deagle[1].id}}));
    sessionStorage.setItem('loadout-changelog-seeded', '1');
  }, {ak, deagle});
  await page.goto('/');
});

test('owned primary selection keeps Loadout open and focuses its equipped finish', async ({page}, info) => {
  await page.setViewportSize({width: 320, height: 740});
  await page.locator('.weapon-select').click();
  const loadout = page.getByRole('dialog', {name: 'Loadout'});
  await loadout.getByLabel('Skin weapon', {exact: true}).selectOption('2');
  await loadout.locator('.weapon-item').filter({hasText: 'AK-47'}).click();
  await expect(loadout).toBeVisible();
  await expect(loadout.getByLabel('Skin weapon', {exact: true})).toHaveValue('1');
  const finishes = loadout.getByRole('region', {name: 'AK-47 skins'});
  await expect(finishes.getByRole('button', {name: /^Equip AK-47 skin/})).toHaveCount(2);
  const owned = finishes.getByRole('button', {name: `Equip AK-47 skin ${ak.label}`, exact: true});
  await expect(owned).toBeFocused();
  await expect(owned).toBeInViewport();
  await expect(owned).toHaveAttribute('aria-pressed', 'true');
  const stock = finishes.getByRole('button', {name: 'Equip AK-47 skin Stock', exact: true});
  await stock.click();
  await expect(loadout).toBeVisible();
  await expect(stock).toHaveAttribute('aria-pressed', 'true');
  await loadout.locator('.weapon-item').filter({hasText: 'AK-47'}).click();
  await expect(stock).toBeFocused();
  const slot = loadout.getByLabel('Skin weapon', {exact: true});
  await slot.focus();
  await slot.selectOption('2');
  await expect(slot).toBeFocused();
  await slot.selectOption('1');
  await expect(slot).toBeFocused();
  await loadout.locator('.weapon-item').filter({hasText: 'AK-47'}).click();
  await expect(stock).toBeFocused();
  expect(await loadout.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await loadout.locator('.weapon-item').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
  await page.screenshot({path: `test-results/${info.project.name}-owned-primary-320.png`});
  await finishes.getByRole('button', {name: 'Browse AK-47 unlocks'}).click();
  await expect(loadout).toHaveCount(0);
  const armory = page.getByRole('dialog', {name: 'Armory'});
  await expect(armory).toBeVisible();
  await expect(armory.getByLabel('Equipment', {exact: true})).toHaveValue('ak47');
  await expect(armory.getByRole('button', {name: 'Unlocks', exact: true})).toHaveAttribute('aria-pressed', 'true');
});

test('owned sidearm selection focuses its finishes and preserves equipped ownership on reload', async ({page}) => {
  await page.locator('.weapon-select').focus();
  await page.keyboard.press('Enter');
  const loadout = page.getByRole('dialog', {name: 'Loadout'});
  await loadout.locator('.weapon-item').filter({hasText: 'Desert Eagle'}).click();
  await expect(loadout).toBeVisible();
  await expect(loadout.getByRole('switch', {name: 'Carry a primary weapon'})).not.toBeChecked();
  await expect(loadout.getByLabel('Skin weapon', {exact: true})).toHaveCount(0);
  const finishes = loadout.getByRole('region', {name: 'Desert Eagle skins'});
  await expect(finishes.getByRole('button', {name: /^Equip Desert Eagle skin/})).toHaveCount(3);
  await expect(finishes.getByRole('button', {name: `Equip Desert Eagle skin ${deagle[1].label}`, exact: true})).toBeFocused();
  await finishes.getByRole('button', {name: `Equip Desert Eagle skin ${deagle[0].label}`, exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(loadout).toHaveCount(0);
  await expect(page.locator('.weapon-select')).toBeFocused();
  await expect(page.locator('.weapon-select')).toContainText('Desert Eagle');
  await page.reload();
  await page.locator('.weapon-select').click();
  await expect(finishes.getByRole('button', {name: /^Equip Desert Eagle skin/})).toHaveCount(3);
  await expect(finishes.getByRole('button', {name: `Equip Desert Eagle skin ${deagle[0].label}`, exact: true})).toHaveAttribute('aria-pressed', 'true');
});

test('stock-only weapon selection still closes Loadout even at maximum level', async ({page}) => {
  await page.locator('.weapon-select').click();
  const loadout = page.getByRole('dialog', {name: 'Loadout'});
  await loadout.locator('.weapon-item').filter({hasText: 'AK-47'}).click();
  await expect(loadout).toBeVisible();
  await loadout.locator('.weapon-item').filter({hasText: /^AWP/}).click();
  await expect(loadout).toHaveCount(0);
  await expect(page.locator('.weapon-select')).toContainText('AWP');
  await page.locator('.weapon-select').click();
  await expect(loadout.getByRole('switch', {name: 'Carry a primary weapon'})).toBeInViewport();
  await expect(loadout.getByRole('region', {name: 'AWP skins'}).getByRole('button', {name: /^Equip AWP skin/})).toHaveCount(1);
});

test('header changelog preserves history, is keyboard-accessible and does not alter the loadout', async ({page}) => {
  const trigger = page.getByRole('button', {name: 'Changelog', exact: true});
  await expect.poll(() => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('spraylab.range.v2') || '{}').crosshair))).toBe(true);
  const before = await page.evaluate(() => localStorage.getItem('spraylab.range.v2'));
  await trigger.click();
  const dialog = page.getByRole('dialog', {name: 'Changelog', exact: true});
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('heading', {name: 'Latest update', exact: true})).toBeVisible();
  await expect(dialog.locator('code')).toHaveText(['49d8ea6', '06774a9']);
  await expect(dialog.locator('.changelog-section')).toHaveCount(14);
  await expect(dialog.getByRole('heading', {name: 'Responsive combat, radar & armor', exact: true})).toHaveCount(1);
  await expect(dialog.getByRole('heading', {name: 'Previous update (49d8ea6)', exact: true})).toHaveCount(1);
  await expect(dialog.getByRole('heading', {name: 'XP, credits & achievements', exact: true})).toHaveCount(1);
  await expect(dialog.getByRole('heading', {name: 'Hearing practice', exact: true})).toHaveCount(1);
  expect(await dialog.locator('[id]').evaluateAll(nodes => new Set(nodes.map(node => node.id)).size === nodes.length)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', {name: 'Close panel'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', {name: 'Close panel'})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', {name: 'Close panel'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => localStorage.getItem('spraylab.range.v2'))).toBe(before);
  await trigger.click();
  await dialog.getByRole('button', {name: 'Close panel'}).click();
  await expect(trigger).toBeFocused();
});

test('header controls and changelog fit desktop, mobile and landscape without overlap', async ({page}, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1440, 1000], [1200, 900], [1024, 768], [1000, 768], [800, 900], [581, 800], [580, 800], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({width, height});
    const header = page.locator('.appbar');
    expect(await header.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const boxes = await header.locator('.brand, .main-nav, .app-actions > button, .app-actions > a').evaluateAll(nodes => nodes.map(node => {
      const {left, top, right, bottom, width, height} = node.getBoundingClientRect();
      return {left, top, right, bottom, width, height};
    }).filter(box => box.width > 0 && box.height > 0));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].left).toBeGreaterThanOrEqual(0);
      expect(boxes[i].right).toBeLessThanOrEqual(width);
      for (const other of boxes.slice(i + 1)) {
        expect(boxes[i].right <= other.left || other.right <= boxes[i].left || boxes[i].bottom <= other.top || other.bottom <= boxes[i].top).toBe(true);
      }
    }
    await expect(page.getByRole('button', {name: 'Changelog', exact: true})).toBeVisible();
    if (height > 540) await expect(page.locator('.changelog-button span')).toBeVisible();
    if ([1440, 390, 320, 844].includes(width)) await page.screenshot({path: `test-results/${info.project.name}-header-${width}.png`});
    await page.getByRole('button', {name: 'Changelog', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Changelog', exact: true});
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await dialog.locator('.changelog-content').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await dialog.locator('.changelog-note').scrollIntoViewIfNeeded();
    await expect(dialog.locator('.changelog-note')).toBeInViewport();
    await dialog.locator('.changelog-release').first().scrollIntoViewIfNeeded();
    if ([1440, 390, 320, 844].includes(width)) await page.screenshot({path: `test-results/${info.project.name}-changelog-${width}.png`});
    await dialog.getByRole('button', {name: 'Close panel'}).click();
  }
  expect(errors).toEqual([]);
});
