import {expect, test} from '@playwright/test';

test('achievement progress, filters and earned badges persist on desktop and mobile', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium', 'mobile-webkit', 'brave', 'opera-gx'].includes(info.project.name));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('achievements-test-seeded')) return;
    localStorage.setItem('spraylab.progression.v1', JSON.stringify({version: 2, xp: 0, balance: 123,
      achievements: {stats: {duelWins: 9, duelKills: 99, duelHeadshots: 99, currentWinStreak: 2, bestWinStreak: 3}}}));
    sessionStorage.setItem('achievements-test-seeded', '1');
  });
  await page.goto('/');
  await expect(page.locator('.progression-notification')).toHaveCount(0);
  await page.getByRole('button', {name: /Open armory/}).click();
  const dialog = page.getByRole('dialog', {name: 'Armory'});
  await dialog.getByRole('button', {name: /^Achievements/}).click();
  await expect(dialog.locator('.achievement-overview')).toContainText('3 / 42 earned');
  await expect(dialog.locator('[data-achievement="kills-100"]')).toContainText('99 / 100');
  await expect(dialog.locator('[data-achievement="heads-100"]')).toContainText('99 / 100');
  await dialog.getByLabel('Achievement status', {exact: true}).selectOption('earned');
  await expect(dialog.locator('.achievement-row')).toHaveCount(3);
  await expect(dialog.locator('[data-achievement="first-blood"]')).toContainText('Earned previously');
  await dialog.getByLabel('Achievement category', {exact: true}).selectOption('training');
  await expect(dialog.getByText('No achievements match these filters.', {exact: true})).toBeVisible();
  await dialog.getByLabel('Achievement status', {exact: true}).selectOption('remaining');
  await expect(dialog.locator('.achievement-row')).toHaveCount(14);
  await dialog.getByLabel('Achievement category', {exact: true}).selectOption('combat');
  await dialog.getByLabel('Sort achievements', {exact: true}).selectOption('progress');
  await expect(dialog.locator('.achievement-row').first()).toHaveAttribute('data-achievement', 'kills-100');
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({width, height});
    await dialog.evaluate(node => node.scrollTop = 0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await dialog.locator('.achievement-row').evaluateAll(nodes => nodes.every(node => {
      const detail = node.querySelector('.achievement-detail')!;
      return detail.scrollWidth <= detail.clientWidth;
    }))).toBe(true);
    expect(await dialog.locator('.progression-achievements select').evaluateAll(nodes => nodes.every(node => {
      const select = node as HTMLSelectElement, style = getComputedStyle(select), context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      return context.measureText(select.selectedOptions[0].text).width <= select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24;
    }))).toBe(true);
    await page.screenshot({path: `test-results/${info.project.name}-achievements-${width}.png`});
  }
  await dialog.getByRole('button', {name: 'Close armory'}).click();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.progression.v1')!).achievements.unlocked['first-blood'])).toBe(0);
  await page.getByRole('button', {name: /Open armory/}).click();
  await dialog.getByRole('button', {name: /^Achievements/}).click();
  await expect(dialog.locator('.achievement-overview')).toContainText('3 / 42 earned');
  expect(errors).toEqual([]);
});
