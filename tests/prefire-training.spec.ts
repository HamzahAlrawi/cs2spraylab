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

async function openPractice(page: Page) {
  await page.addInitScript(() => {if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'}));});
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).prefireTrainingEngine = this; return tick.call(this, time);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await showDrillPanel(page);
  await expect(page.getByLabel('Training preset')).toBeVisible({timeout: 90000});
}

// Local native-simulator QA: no health edits, teleporting, game hooks or changes
// to spread/recoil. The existing workflow tests separately use actual key input.
async function clearNativeAngles(page: Page, killCount: number) {
  return page.evaluate(async wanted => {
    const geometryPath = '/src/range/duel/geometry.ts', physicsPath = '/src/range/actor-physics.ts';
    const {actorHeadPoint, traceActor} = await import(/* @vite-ignore */ geometryPath);
    const {groundVelocity, UNIT, STEP, DEG} = await import(/* @vite-ignore */ physicsPath);
    const e = (window as any).prefireTrainingEngine, sim = e.sim;
    const heading = (a: any, b: any) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
    const delta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
    const points = sim.route.path.map((p: number[]) => ({x: p[0] * UNIT, y: p[2] * UNIT, z: -p[1] * UNIT}));
    let waypoint = e.prefireQASimulation === sim ? e.prefireQAWaypoint ?? 0 : 0, nextTapAt = sim.time;
    for (let tick = 0; tick < 12000 && sim.phase === 'fighting'; tick++) {
      const p = sim.actors[0], speed = Math.hypot(p.velocity.x, p.velocity.z);
      const command = {forward: 0, side: 0, walk: false, crouch: false, jump: false, fireHeld: false, firePressed: false, yawDelta: 0, pitchDelta: 0, reloadPressed: false};
      let exposed: any;
      for (const bot of sim.actors.slice(1)) {
        if (!bot.alive) continue;
        const head = actorHeadPoint({...bot.position, y: bot.feet}, bot.duckAmount, bot.yaw);
        const d = Math.hypot(head.x - p.position.x, head.y - p.position.y, head.z - p.position.z);
        const direction = {x: (head.x - p.position.x) / d, y: (head.y - p.position.y) / d, z: (head.z - p.position.z) / d};
        const hit = traceActor(p.position, direction, {...bot.position, y: bot.feet}, bot.duckAmount, d + .5, bot.yaw);
        if (hit.group === 'head' && !sim.arena.native.ray(p.position, direction, hit.distance - .0001) && (!exposed || d < exposed.distance)) exposed = {point: head, distance: d};
      }
      if (exposed) {
        const recoil = p.weapon.recovery.predict(STEP), yaw = heading(p.position, exposed.point) + recoil.yaw * DEG;
        command.yawDelta = delta(p.yaw, yaw);
        command.pitchDelta = Math.atan2(exposed.point.y - p.position.y, Math.hypot(exposed.point.x - p.position.x, exposed.point.z - p.position.z)) - recoil.pitch * DEG - p.pitch;
        if (speed > .12) {
          const cap = p.weapon.actions.stats.speed * UNIT;
          const predicted = groundVelocity(p.velocity.x, p.velocity.z, -p.velocity.x / speed, -p.velocity.z / speed, cap, STEP, {weaponSpeed: cap, walking: false, ducking: false});
          if (predicted.x * p.velocity.x + predicted.z * p.velocity.z > 0) {
            command.side = (-p.velocity.x * Math.cos(yaw) + p.velocity.z * Math.sin(yaw)) / speed;
            command.forward = (p.velocity.x * Math.sin(yaw) + p.velocity.z * Math.cos(yaw)) / speed;
          }
        } else if (sim.time >= nextTapAt) {command.firePressed = true; nextTapAt = sim.time + .4;}
      } else {
        const point = points[waypoint], remaining = Math.hypot(point.x - p.position.x, point.z - p.position.z);
        command.yawDelta = delta(p.yaw, heading(p.position, point)); command.pitchDelta = -p.pitch;
        if (remaining < .18 && speed < .12) waypoint = Math.min(waypoint + 1, points.length - 1);
        else if (remaining < .1 + speed * .065) command.forward = speed > .12 ? -1 : 0;
        else command.forward = 1;
      }
      if (!p.weapon.ammo) {command.firePressed = false; command.reloadPressed = !p.weapon.reloadUntil;}
      sim.command(0, command); sim.step();
      if (sim.actors.slice(1).filter((a: any) => !a.alive).length >= wanted) break;
    }
    sim.command(0, {forward: 0, side: 0, firePressed: false, fireHeld: false});
    e.prefireQASimulation = sim; e.prefireQAWaypoint = waypoint;
    return {outcome: sim.outcome, kills: sim.actors.slice(1).filter((a: any) => !a.alive).length, review: sim.coach.review()};
  }, killCount);
}

test('practice presets, review timing and beginner cues survive reload without overflowing', async ({page}) => {
  test.setTimeout(180000);
  await openPractice(page);
  await page.getByLabel('Training preset').selectOption('learn');
  await openSetupSection(page, 'Encounter options');
  await openSetupSection(page, 'Combat');
  await openSetupSection(page, 'Guidance & run options');
  await expect(page.getByLabel('Bot behavior', {exact: true})).toHaveValue('static');
  await expect(page.getByLabel('Return fire', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Floor route arrows', {exact: true})).toBeChecked();
  await expect(page.getByRole('radio', {name: 'Next route', exact: true})).toBeChecked();
  await page.getByLabel('Training preset').selectOption('entry');
  await expect(page.getByLabel('Bot behavior', {exact: true})).toHaveValue('angle-specific');
  await expect(page.getByLabel('Floor route arrows', {exact: true})).toBeChecked();
  await page.getByLabel('Training preset').selectOption('pressure');
  await expect(page.getByLabel('Return fire', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Bot reaction time')).toHaveValue('750');
  await expect(page.getByLabel('Floor route arrows', {exact: true})).toBeChecked();
  await page.getByLabel('Floor route arrows', {exact: true}).uncheck();
  await page.getByLabel('Training preset').selectOption('entry');
  await expect(page.getByLabel('Floor route arrows', {exact: true})).not.toBeChecked();
  await page.getByLabel('Training preset').selectOption('pressure');
  await page.getByLabel('Prefire review time').press('End');
  await page.getByLabel('Prefire review time').press('ArrowLeft');
  await page.getByLabel('Prefire review time').press('ArrowLeft');
  await openSetupSection(page, 'Run review');
  await page.getByText('Training cues & scoring', {exact: true}).click();
  await expect(page.getByText('Speed does not raise your score.', {exact: false})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(async () => {
    const pixels = await sharp(await page.locator('canvas[aria-label="Dust 2 prefire map"]').screenshot()).stats();
    return pixels.channels.slice(0, 3).every(channel => channel.stdev > 12);
  }, {timeout: 30000}).toBe(true);
  await page.screenshot({path: `research/dust2/training-presets-${test.info().project.name}.png`, fullPage: true});
  await page.reload(); await showDrillPanel(page);
  await expect(page.getByLabel('Training preset')).toBeVisible({timeout: 90000});
  await expect(page.getByLabel('Training preset')).toHaveValue('pressure');
  await expect(page.getByLabel('Floor route arrows', {exact: true})).not.toBeChecked();
  await openSetupSection(page, 'Guidance & run options');
  await expect(page.getByLabel('Prefire review time')).toHaveValue('8');
});

test('expanded course groups and observed occupancy are visible, bounded and persistent', async ({page}) => {
  test.setTimeout(180000); await openPractice(page);
  await expect(page.getByRole('radio', {name: 'Weighted', exact: true})).toBeChecked();
  const routes = page.getByLabel('Prefire route');
  await expect(routes.locator('option')).toHaveCount(10);
  await expect(routes.locator('optgroup')).toHaveCount(7);
  await openSetupSection(page, 'Possible holds');
  await page.getByText('Position evidence', {exact: true}).click();
  await expect(page.getByText('32 matches / 256 sampled rounds.', {exact: false})).toBeVisible();
  await expect(page.getByText('These are relative training weights, not match spawn probabilities.', {exact: false})).toBeVisible();
  await openSetupSection(page, 'Encounter options');
  await expect(page.getByLabel('Prefire bots per run')).toHaveValue('4');
  await expect.poll(() => page.evaluate(() => (window as any).prefireTrainingEngine.sim.actors.length - 1)).toBe(4);
  await routes.selectOption('ct-mid-push');
  await expect.poll(() => page.evaluate(() => (window as any).prefireTrainingEngine.sim.route.id)).toBe('ct-mid-push');
  await page.getByRole('radio', {name: 'Fixed lineup', exact: true}).check();
  await expect.poll(() => page.evaluate(() => (window as any).prefireTrainingEngine.sim.actors.length - 1)).toBe(5);
  await page.reload();
  await showDrillPanel(page);
  await expect(page.getByLabel('Prefire route')).toHaveValue('ct-mid-push', {timeout: 90000});
  await expect(page.getByRole('radio', {name: 'Fixed lineup', exact: true})).toBeChecked();
});

test('physical native hits produce readable angle feedback and exactly one saved route result', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native shot/pointer-lock integration');
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPractice(page); await page.getByLabel('Training preset').selectOption('learn');
  await page.getByRole('button', {name: 'Enter prefire'}).click();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  const first = await clearNativeAngles(page, 1);
  expect(first.kills).toBe(1); expect(first.review.shots).toBeGreaterThan(0);
  await expect(page.locator('.prefire-live-feedback')).toBeVisible();
  const bounds = await page.evaluate(() => {
    const box = document.querySelector('.prefire-live-feedback')!.getBoundingClientRect();
    const view = document.querySelector('.duel-view')!.getBoundingClientRect();
    return {below: box.top - (view.top + view.height / 2), inside: box.bottom <= view.bottom};
  });
  expect(bounds.below).toBeGreaterThan(44); expect(bounds.inside).toBe(true);
  await page.screenshot({path: 'research/dust2/training-angle-feedback.png'});
  const complete = await clearNativeAngles(page, 5);
  expect(complete.outcome).toBe('won'); expect(complete.kills).toBe(5);
  await expect(page.getByText('Route cleared', {exact: true})).toBeVisible();
  await expect(page.locator('.duel-result span')).toHaveText(/Next round in [45]\.\ds/);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.prefire.history.v1') || '[]'));
  expect(history).toHaveLength(1); expect(history[0].outcome).toBe('won'); expect(history[0].score).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await showDrillPanel(page);
  const runReview = page.locator('details.prefire-disclosure').filter({has: page.locator('summary').filter({hasText: /^Run review/})});
  await expect(runReview).toHaveAttribute('open', '');
  await runReview.locator(':scope > summary').click();
  await page.evaluate(() => (window as any).prefireTrainingEngine.report());
  await expect(runReview).not.toHaveAttribute('open');
  await openSetupSection(page, 'Run review');
  const currentReview = page.locator('.prefire-angle-review').filter({has: page.getByText('Angle review', {exact: true})});
  await currentReview.locator('summary').click();
  await expect(currentReview.locator('li')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('physical route clears advance by default after review and repeat when selected', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop Chromium native walking/shooting and pointer lock; mobile intentionally skipped.');
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPractice(page);
  await openSetupSection(page, 'Guidance & run options');
  const routes = page.getByLabel('Prefire route');
  const next = page.getByRole('radio', {name: 'Next route', exact: true});
  const repeat = page.getByRole('radio', {name: 'Repeat route', exact: true});
  await expect(next).toBeChecked();
  await page.getByLabel('Training preset').selectOption('learn');
  await expect(next).toBeChecked();
  await routes.selectOption('long-doors');
  await page.getByLabel('Prefire review time').press('Home');
  await expect(page.getByLabel('Prefire review time')).toHaveValue('2');
  const expectedNext = await page.evaluate(async () => {
    const routesPath = '/src/range/prefire/routes.ts';
    const {prefireRoutes} = await import(/* @vite-ignore */ routesPath);
    return prefireRoutes[(prefireRoutes.findIndex((route: any) => route.id === 'long-doors') + 1) % prefireRoutes.length].id as string;
  });
  expect(expectedNext).not.toBe('long-doors');

  // Observe the real automatic restart; do not advance its clock or force a result.
  await page.evaluate(() => {
    const engine = (window as any).prefireTrainingEngine, restart = engine.restart;
    engine.prefireQACompletedRuns = [];
    engine.restart = function(continuous = false) {
      const completed = continuous ? {routeId: this.sim.route.id, outcome: this.sim.outcome,
        reviewSeconds: this.scenario.feedbackSeconds(), reviewedSeconds: this.roundFlow.elapsed} : null;
      const result = restart.call(this, continuous);
      if (completed) this.prefireQACompletedRuns.push({...completed, nextRouteId: this.sim.route.id, nextPhase: this.sim.phase});
      return result;
    };
  });

  for (const [index, expectedRoute] of [expectedNext, 'long-doors'].entries()) {
    if (index === 1) {
      await page.keyboard.press('Escape');
      await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
      await showDrillPanel(page);
      await openSetupSection(page, 'Guidance & run options');
      await routes.selectOption('long-doors');
      await expect.poll(() => page.evaluate(() => (window as any).prefireTrainingEngine.sim.route.id)).toBe('long-doors');
      await repeat.check();
      await expect(repeat).toBeChecked();
    }
    await expect(routes).toHaveValue('long-doors');
    await expect.poll(() => page.evaluate(() => (window as any).prefireTrainingEngine.sim.phase)).toBe('ready');
    await expect.poll(() => page.evaluate(() => (window as any).prefireTrainingEngine.sim.actors.length - 1)).toBe(5);
    await page.getByRole('button', {name: 'Enter prefire', exact: true}).click();
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    const complete = await clearNativeAngles(page, 5);
    expect(complete.outcome).toBe('won'); expect(complete.kills).toBe(5);
    expect(complete.review.shots).toBeGreaterThanOrEqual(5);
    await expect(page.getByText('Route cleared', {exact: true})).toBeVisible();
    await expect(page.locator('.duel-result span')).toHaveText(/Next round in [12]\.\ds/);
    await expect(routes).toHaveValue('long-doors');

    await expect.poll(() => page.evaluate(() => (window as any).prefireTrainingEngine.prefireQACompletedRuns.length)).toBe(index + 1);
    const restart = await page.evaluate(index => (window as any).prefireTrainingEngine.prefireQACompletedRuns[index], index);
    expect(restart).toMatchObject({routeId: 'long-doors', outcome: 'won', reviewSeconds: 2, nextRouteId: expectedRoute, nextPhase: 'fighting'});
    expect(restart.reviewedSeconds).toBeGreaterThanOrEqual(2);
    expect(restart.reviewedSeconds).toBeLessThanOrEqual(2.25);
    await expect(page.locator('.duel-result')).toBeHidden();
    await expect(routes).toHaveValue(expectedRoute);
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.prefire.history.v1') || '[]'));
    expect(history).toHaveLength(index + 1);
    expect(history.every((attempt: any) => attempt.outcome === 'won')).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  await showDrillPanel(page);
  await openSetupSection(page, 'Guidance & run options');
  await expect(repeat).toBeChecked();
  expect(errors).toEqual([]);
});
