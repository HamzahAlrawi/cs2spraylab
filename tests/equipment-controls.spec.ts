import {expect, test, type Page} from '@playwright/test';

type Mode = 'guided' | 'duel';
async function hook(page: Page, mode: Mode) {
  await expect(page.locator(`canvas[data-${mode === 'guided' ? 'range' : 'duel'}]`)).toBeVisible({timeout: 90000});
  await page.evaluate(async mode => {
    const suffix = mode === 'guided' ? '/range/engine.ts' : '/duel/DuelEngine.ts';
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes(suffix))!.name;
    const module = await import(/* @vite-ignore */ url);
    const prototype = (mode === 'guided' ? module.RangeEngine : module.DuelEngine).prototype;
    const tick = prototype.tick;
    prototype.tick = function(time: number) {(window as any).equipmentInputQA = this; return tick.call(this, time);};
  }, mode);
  await page.waitForFunction(mode => {
    const e = (window as any).equipmentInputQA;
    return e && (mode === 'duel' ? e.criticalReady : e.modelCache.has(e.sim.equipped));
  }, mode, {timeout: 90000});
}
async function activate(page: Page, mode: Mode) {
  await page.evaluate(mode => {
    const e = (window as any).equipmentInputQA;
    if (mode === 'duel') {
      e.sim.start(); e.paused = false; e.sessionStarted = true; e.inputName = 'Drag aim (browser test)';
      e.sim.command(1, {});
    } else e.sim.active = true;
    e.renderer.domElement.focus();
  }, mode);
}
const equipped = (page: Page, mode: Mode) => page.evaluate(mode => {
  const sim = (window as any).equipmentInputQA.sim;
  return mode === 'guided' ? sim.equipped : sim.actors[0].weapon.id;
}, mode);
const selected = (page: Page) => page.evaluate(() => (window as any).equipmentInputQA.sim.selectedUtility);

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'duel', quality: 'performance', volume: 0, protectShortcuts: false,
    }));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({generatedMaps: true, botCount: 1, skill: 1,
      playerHealth: 500, botUtilities: false, shortcutProtection: false}));
    localStorage.setItem('spraylab.settingsHint.v1', 'seen');
  });
});

test('deferred native map module and dependencies load without stale optimizer requests', async ({page}) => {
  const failures: string[] = [];
  page.on('response', response => {if (response.status() >= 400 && /\/src\/|\/node_modules\//.test(response.url())) failures.push(`${response.status()} ${response.url()}`);});
  await page.goto('/');
  const keys = await page.evaluate(async () => {
    const path = '/src/range/duel/real-map.ts';
    return Object.keys(await import(/* @vite-ignore */ path));
  });
  expect(keys).toContain('RealMapSession'); expect(failures).toEqual([]);
});

for (const mode of ['guided', 'duel'] as const) test(`${mode}: 3 cycles knife and Zeus, including two rapid presses`, async ({page}) => {
  test.setTimeout(120000);
  await page.addInitScript(mode => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, quality: 'performance', volume: 0, protectShortcuts: false}));
  }, mode);
  await page.goto('/'); await hook(page, mode); await activate(page, mode);
  await page.keyboard.press('Digit3'); await expect.poll(() => equipped(page, mode)).toBe('knife');
  await page.keyboard.press('Digit3'); await expect.poll(() => equipped(page, mode)).toBe('zeus');
  await page.keyboard.press('Digit3'); await expect.poll(() => equipped(page, mode)).toBe('knife');
  await page.keyboard.press('Digit1'); await expect.poll(() => equipped(page, mode)).toBe('ak47');
  await page.keyboard.press('Digit3'); await page.keyboard.press('Digit3');
  await expect.poll(() => equipped(page, mode)).toBe('zeus');
});

test('4 cycles carried grenades and direct grenade bindings persist and work with keyboard or wheel', async ({page}) => {
  test.setTimeout(120000);
  await page.goto('/'); await hook(page, 'duel'); await activate(page, 'duel');
  for (const kind of ['he', 'flash', 'smoke', 'molotov', 'he']) {
    await page.keyboard.press('Digit4'); await expect.poll(() => selected(page)).toBe(kind);
  }
  await page.keyboard.press('Digit5'); expect(await selected(page)).toBe('he');
  await page.keyboard.press('Digit3'); await expect.poll(() => equipped(page, 'duel')).toBe('knife');
  expect(await selected(page)).toBeUndefined();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Controls', exact: true}).click();
  const smoke = page.getByRole('button', {name: 'Bind equip smoke grenade', exact: true});
  await expect(smoke).toContainText('Unbound'); await smoke.click(); await page.keyboard.press('KeyX');
  await page.getByRole('button', {name: 'Bind equip flashbang', exact: true}).click();
  await page.mouse.wheel(0, 120);
  await expect(page.getByRole('button', {name: 'Bind equip flashbang', exact: true})).toContainText('Wheel Down');
  await page.reload(); await hook(page, 'duel'); await activate(page, 'duel');
  await page.keyboard.press('KeyX'); await expect.poll(() => selected(page)).toBe('smoke');
  await page.locator('canvas[data-duel]').hover(); await page.mouse.wheel(0, 120);
  await expect.poll(() => selected(page)).toBe('flash');
  await page.keyboard.press('Digit4'); await expect.poll(() => selected(page)).toBe('smoke');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).controls.grenadeSmoke)).toBe('KeyX');
});
