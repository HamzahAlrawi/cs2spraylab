import {expect, test, type Page} from '@playwright/test';

const prefireKey = 'spraylab.prefire.v1';
const duelKey = 'spraylab.duel.v1';

async function revealSetup(page: Page, mode: 'duel' | 'prefire') {
  const button = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await button.isVisible()) await button.click();
  if (mode === 'prefire') {
    await expect(page.getByLabel('Training preset')).toBeVisible({timeout: 90000});
    for (const title of ['Combat', 'Guidance & run options']) {
      const summary = page.locator('.prefire-disclosure > summary').filter({hasText: title});
      if (await summary.locator('..').getAttribute('open') === null) await summary.click();
    }
  } else {
    await expect(page.getByLabel('Bot behavior', {exact: true})).toBeVisible({timeout: 90000});
    const summary = page.locator('.duel-setup-section > summary').filter({hasText: 'Advanced combat & radar'});
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  }
}

async function openSetup(page: Page, mode: 'duel' | 'prefire', saved?: {key: string; config: Record<string, unknown>}) {
  await page.addInitScript(({mode, saved}) => {
    if (!localStorage.getItem('spraylab.range.v2')) {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, volume: 0, quality: 'performance'}));
    }
    if (saved && !localStorage.getItem(saved.key)) localStorage.setItem(saved.key, JSON.stringify(saved.config));
  }, {mode, saved});
  await page.goto('/');
  await revealSetup(page, mode);
  await expect(page.getByRole('checkbox', {name: 'Bot trading', exact: true})).toBeVisible({timeout: 90000});
}

async function savedConfig(page: Page, key: string) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), key);
}

test('new Prefire presets keep next-route progression and show inactive trading honestly', async ({page}) => {
  test.setTimeout(180000);
  await openSetup(page, 'prefire');
  const progression = page.getByRole('group', {name: 'After clearing a route', exact: true});
  const next = progression.getByRole('radio', {name: 'Next route', exact: true});
  const repeat = progression.getByRole('radio', {name: 'Repeat route', exact: true});
  const trading = page.getByRole('checkbox', {name: 'Bot trading', exact: true});
  await expect(next).toBeChecked();
  await expect(trading).toBeChecked();
  await expect(trading).toBeDisabled();
  await expect(page.getByText('Bots trade teammates (requires return fire)', {exact: true})).toBeVisible();

  for (const preset of ['learn', 'entry', 'pressure']) {
    await page.getByLabel('Training preset').selectOption(preset);
    await expect(next).toBeChecked();
    await expect(page.getByLabel('Training preset')).toHaveValue(preset);
    if (preset === 'pressure') await expect(trading).toBeEnabled();
    else await expect(trading).toBeDisabled();
  }
  await repeat.check();
  await expect(page.getByLabel('Training preset')).toHaveValue('pressure');
  await next.check();
  await expect.poll(() => savedConfig(page, prefireKey)).toMatchObject({autoAdvance: true, tradeEnabled: true});

  const layout = await progression.evaluate(node => {
    const spans = [...node.querySelectorAll('label span')];
    const boxes = spans.map(span => span.getBoundingClientRect());
    return {fits: spans.every(span => span.scrollWidth <= span.clientWidth), separated: boxes[0].right <= boxes[1].left + 1};
  });
  expect(layout).toEqual({fits: true, separated: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await next.scrollIntoViewIfNeeded();
  await page.screenshot({path: test.info().outputPath('prefire-progression-trading.png'), fullPage: true});
  await page.reload();
  await revealSetup(page, 'prefire');
  await expect(next).toBeChecked({timeout: 90000});
  await expect(page.getByLabel('Training preset')).toHaveValue('pressure');
});

test('saved repeat-route and disabled trades survive presets, return-fire changes and reload', async ({page}) => {
  test.setTimeout(180000);
  await openSetup(page, 'prefire', {key: prefireKey, config: {autoAdvance: false, tradeEnabled: false, returnFire: true}});
  const repeat = page.getByRole('radio', {name: 'Repeat route', exact: true});
  const trading = page.getByRole('checkbox', {name: 'Bot trading', exact: true});
  await expect(repeat).toBeChecked();
  await expect(trading).not.toBeChecked();
  for (const preset of ['learn', 'entry', 'pressure']) {
    await page.getByLabel('Training preset').selectOption(preset);
    await expect(repeat).toBeChecked();
    await expect(trading).not.toBeChecked();
    await expect(page.getByLabel('Training preset')).toHaveValue(preset);
  }

  await trading.check();
  await page.getByRole('checkbox', {name: 'Return fire', exact: true}).uncheck();
  await expect(trading).toBeDisabled();
  await expect(trading).toBeChecked();
  await expect.poll(() => savedConfig(page, prefireKey)).toMatchObject({autoAdvance: false, tradeEnabled: true, returnFire: false});
  await page.reload();
  await revealSetup(page, 'prefire');
  await expect(repeat).toBeChecked({timeout: 90000});
  await expect(trading).toBeDisabled();
  await expect(trading).toBeChecked();
  await page.getByRole('checkbox', {name: 'Return fire', exact: true}).check();
  await expect(trading).toBeEnabled();
  await expect(trading).toBeChecked();
  await trading.uncheck();
  await expect(page.getByLabel('Training preset')).toHaveValue('pressure');
  await expect.poll(() => savedConfig(page, prefireKey)).toMatchObject({autoAdvance: false, tradeEnabled: false, returnFire: true});
  await page.reload();
  await revealSetup(page, 'prefire');
  await expect(repeat).toBeChecked({timeout: 90000});
  await expect(trading).toBeEnabled();
  await expect(trading).not.toBeChecked();
});

test('Duel migrates trading on and persists its independent choice in both directions', async ({page}) => {
  test.setTimeout(180000);
  await openSetup(page, 'duel', {key: duelKey, config: {botCount: 3, behavior: 'holder'}});
  const trading = page.getByRole('checkbox', {name: 'Bot trading', exact: true});
  await expect(trading).toBeEnabled();
  await expect(trading).toBeChecked();
  await expect(page.getByLabel('Number of bots')).toHaveValue('3');
  await expect.poll(() => savedConfig(page, duelKey)).toMatchObject({tradeEnabled: true, botCount: 3, behavior: 'holder'});
  await trading.uncheck();
  await expect.poll(() => savedConfig(page, duelKey)).toMatchObject({tradeEnabled: false});
  await page.reload();
  await revealSetup(page, 'duel');
  await expect(trading).not.toBeChecked({timeout: 90000});
  await page.getByLabel('Training mode').selectOption('prefire');
  await revealSetup(page, 'prefire');
  await expect(page.getByLabel('Training preset')).toBeVisible({timeout: 90000});
  await expect(trading).toBeChecked();
  await expect(trading).toBeDisabled();
  await page.getByLabel('Training mode').selectOption('duel');
  await revealSetup(page, 'duel');
  await expect(trading).toBeEnabled();
  await expect(trading).not.toBeChecked();
  await trading.check();
  await expect.poll(() => savedConfig(page, duelKey)).toMatchObject({tradeEnabled: true});
  await page.reload();
  await revealSetup(page, 'duel');
  await expect(trading).toBeChecked();
});
