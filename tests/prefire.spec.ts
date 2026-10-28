import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function showDrillPanel(page: Page) {
  const button = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await button.isVisible()) await button.click();
}

async function openSetupSection(page: Page, title: string) {
  const summary = page.locator('.prefire-disclosure > summary').filter({hasText: title});
  if (await summary.locator('..').getAttribute('open') === null) await summary.click();
}

test('Dust 2 prefire loads native geometry, runs all courses and returns to Duel', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native-map gameplay integration');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible({timeout: 30000});
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).prefireEngine = this; return original.call(this, time);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await showDrillPanel(page);
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout: 90000});
  await expect(page.getByRole('button', {name: 'Enter prefire'})).toBeVisible();
  const canvas = page.locator('canvas[aria-label="Dust 2 prefire map"]');
  const pixels = await sharp(await canvas.screenshot()).stats();
  expect(pixels.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  await page.screenshot({path: 'research/dust2/prefire-textured.png'});
  const routes = await page.getByLabel('Prefire route').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(routes).toHaveLength(10);
  await page.getByRole('radio', {name: 'Fixed lineup', exact: true}).check();
  for (const route of routes) {
    await page.getByLabel('Prefire route').selectOption(route);
    await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.route.id)).toBe(route);
    const state = await page.evaluate(() => {
      const e = (window as any).prefireEngine, p = e.sim.actors[0];
      return {native: !!e.sim.arena.native, bots: e.sim.actors.length - 1,
        fits: e.sim.arena.native.fits(p.position, p.feet, 72 * .0254), y: p.feet,
        concealed: e.sim.actors.slice(1).every((bot: any) => [bot.position.y, bot.feet + 32 * .0254].every(y => {
          const delta = {x: bot.position.x - p.position.x, y: y - p.position.y, z: bot.position.z - p.position.z};
          const distance = Math.hypot(delta.x, delta.y, delta.z);
          return !!e.sim.arena.native.ray(p.position, {x: delta.x / distance, y: delta.y / distance, z: delta.z / distance}, distance - .02);
        }))};
    });
    expect(state.native).toBe(true); expect(state.fits).toBe(true);
    expect(state.concealed, `${route} must start behind real cover`).toBe(true);
    expect(state.bots).toBe(5);
  }
  await page.getByLabel('Prefire route').selectOption('long-doors');
  await page.getByLabel('Practice lineup').selectOption('pit-clear');
  await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.route.angles.map((angle: any) => angle.name)))
    .toEqual(['Long wide corner', 'Pit platform', 'Pit upper edge', 'Pit approach', 'Deep pit']);
  await page.getByLabel('Practice lineup').selectOption('long-doors');
  await page.getByRole('button', {name: 'Next route', exact: true}).click();
  await expect(page.getByLabel('Prefire route')).toHaveValue('long-a');
  await page.getByLabel('Practice lineup').selectOption('long-cross');
  await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.route.angles[0].source.index)).toBe(22);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.prefire.v1')!).routeId)).toBe('long-a');
  await page.getByLabel('Prefire route').selectOption('long-doors');
  await page.getByRole('radio', {name: 'Weighted', exact: true}).check();
  await openSetupSection(page, 'Encounter options');
  await openSetupSection(page, 'Possible holds');
  await expect(page.getByLabel('Prefire bots per run')).toHaveValue('4');
  await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.actors.length - 1)).toBe(4);
  await expect(page.getByLabel('Route angles').locator('li')).toHaveCount(17);
  await expect(page.getByLabel('Route angles').locator('li small').first()).toHaveText(/^\d+\/\d+$/);
  await page.getByText('Position evidence', {exact: true}).click();
  await expect(page.getByText(/Repeated pauses count once/)).toBeVisible();
  await page.getByLabel('Prefire bots per run').fill('5');
  await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.actors.length - 1)).toBe(5);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.prefire.v1')!).botsPerRun)).toBe(5);
  await page.getByLabel('Prefire bots per run').fill('2');
  await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.actors.length - 1)).toBe(2);
  await page.getByRole('radio', {name: 'Fixed lineup', exact: true}).check();
  await expect(page.getByLabel('Prefire bots per run')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.actors.length - 1)).toBe(5);
  await expect(page.getByLabel('Bot behavior', {exact: true})).toHaveValue('angle-specific');
  await page.getByRole('button', {name: 'Enter prefire'}).click();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await page.keyboard.down('w');
  const approachMotion = await page.evaluate(async () => {
    const e = (window as any).prefireEngine;
    const start = {...e.sim.actors[0].position};
    let maxSpeed = 0, maxDistance = 0;
    const until = performance.now() + 2200;
    while (performance.now() < until) {
      const a = e.sim.actors[0];
      maxSpeed = Math.max(maxSpeed, Math.hypot(a.velocity.x, a.velocity.z) / .0254);
      maxDistance = Math.max(maxDistance, Math.hypot(a.position.x - start.x, a.position.z - start.z));
      await new Promise(requestAnimationFrame);
    }
    return {maxSpeed, maxDistance};
  });
  await page.keyboard.up('w');
  expect(approachMotion.maxSpeed).toBeGreaterThan(130);
  expect(approachMotion.maxDistance).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await showDrillPanel(page);
  await openSetupSection(page, 'Encounter options');
  await page.getByLabel('Bot behavior', {exact: true}).selectOption('static');
  await openSetupSection(page, 'Combat');
  await page.getByLabel('Return fire', {exact: true}).check();
  await expect(page.getByLabel('Bot reaction time')).toBeVisible();
  await page.getByLabel('Return fire', {exact: true}).uncheck();
  await page.getByRole('button', {name: 'Enter prefire'}).click();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).prefireEngine.sim.coach.review().shots)).toBeGreaterThan(0);
  await page.keyboard.down('w'); await page.waitForTimeout(400); await page.keyboard.up('w');
  const live = await page.evaluate(() => {
    const e = (window as any).prefireEngine;
    return {seconds: e.sim.time, bots: e.sim.actors.slice(1).map((a: any) => ({feet: a.feet, alive: a.alive})),
      grounded: e.sim.actors[0].grounded, speed: Math.hypot(e.sim.actors[0].velocity.x, e.sim.actors[0].velocity.z),
      cameraEyeError: e.camera.position.distanceTo(e.sim.renderSnapshot()[0].position),
      calls: e.renderer.info.render.calls, triangles: e.renderer.info.render.triangles};
  });
  expect(live.seconds).toBeGreaterThan(0); expect(live.triangles).toBeGreaterThan(100);
  expect(live.grounded).toBe(true);
  expect(live.cameraEyeError).toBeLessThan(1e-8);
  console.log('Prefire render sample:', JSON.stringify(live));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume prefire'})).toBeVisible();
  await page.getByRole('button', {name: 'Next route', exact: true}).click();
  await expect(page.getByLabel('Prefire route')).toHaveValue('long-a');
  await page.getByRole('button', {name: 'Enter prefire'}).click();
  await page.evaluate(() => {
    const sim = (window as any).prefireEngine.sim, p = sim.actors[0];
    sim.drops.push({id: 99999, equipment: 'm4a4', ammo: 30, reserve: 90, picked: false,
      position: {...p.position, y: p.feet + .08}});
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume prefire'})).toBeVisible();
  await page.getByLabel('Training mode').selectOption('duel');
  await expect(page.getByRole('button', {name: 'Enter duel'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('prefire panel fits mobile and can change courses', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-chromium', 'Native mobile layout');
  test.setTimeout(180000);
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('prefire');
  await showDrillPanel(page);
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout: 90000});
  await page.getByLabel('Prefire route').selectOption('b-tunnels');
  await openSetupSection(page, 'Encounter options');
  await page.getByLabel('Bot behavior', {exact: true}).selectOption('angle-specific');
  await openSetupSection(page, 'Combat');
  await page.getByLabel('Return fire', {exact: true}).check();
  await expect(page.getByLabel('Bot reaction time')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Dust 2 Prefire'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: 'research/dust2/prefire-mobile.png', fullPage: true});
});
