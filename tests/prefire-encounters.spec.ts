import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function showDrillPanel(page: Page) {
  const button = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await button.isVisible()) await button.click();
}

test('native Prefire renders readable cover and responsive silent defenders during a physical approach', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native map rendering and physical actor integration');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'auto', showFps: true}));
    localStorage.setItem('spraylab.prefire.v1', JSON.stringify({routeId: 'b-tunnels', population: 'all', returnFire: false, botBehavior: 'angle-specific'}));
  });
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible({timeout: 30000});
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).encounterEngine = this; return original.call(this, time);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await showDrillPanel(page);
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout: 90000});
  await page.getByLabel('Prefire route').selectOption('b-tunnels');
  await page.waitForFunction(() => (window as any).encounterEngine?.models?.size === 5);
  const lighting = await page.evaluate(() => {
    const e = (window as any).encounterEngine, light = e.mapLighting;
    return {enabled: e.renderer.shadowMap.enabled, cached: !!light.sun.shadow.map,
      autoUpdate: e.renderer.shadowMap.autoUpdate, casters: light.meshes.filter((mesh: any) => mesh.castShadow).length,
      receivers: light.meshes.filter((mesh: any) => mesh.receiveShadow).length,
      pendingRestore: light.restore.length};
  });
  expect(lighting).toMatchObject({enabled: true, cached: true, autoUpdate: false, pendingRestore: 0});
  expect(lighting.casters).toBeGreaterThan(50); expect(lighting.receivers).toBeGreaterThanOrEqual(lighting.casters);
  await page.screenshot({path: 'research/dust2/prefire-lighting-b-start.png'});
  await page.getByRole('button', {name: 'Enter prefire'}).click();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await page.evaluate(async () => {
    const e = (window as any).encounterEngine, sim = e.sim;
    const {placePrefireTarget} = await import('/src/range/prefire/placement.ts');
    const {idleCommand} = await import('/src/range/duel/types.ts');
    const targets = sim.route.path.map((point: any) => placePrefireTarget(sim.map.collision, point));
    const nativeStep = sim.step.bind(sim), start = {...sim.actors[0].position};
    const state = {start, distance: 0, speed: 0, seen: 0, shots: 0, ticks: 0, waypoint: 0};
    (window as any).encounterProbe = state;
    // Drive only ordinary player inputs. Bot decisions, map LOS, actor contacts,
    // pose evaluation and rendering remain on the actual gameplay path.
    sim.step = () => {
      const p = sim.actors[0], target = targets[state.waypoint];
      if (Math.hypot(target.x - p.position.x, target.z - p.position.z) < .5 && state.waypoint < targets.length - 1) state.waypoint++;
      const goal = targets[state.waypoint];
      const yaw = Math.atan2(-(goal.x - p.position.x), -(goal.z - p.position.z));
      sim.command(0, {...idleCommand(), forward: Math.hypot(goal.x - p.position.x, goal.z - p.position.z) > .5 ? 1 : 0,
        yawDelta: Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw))});
      nativeStep(); state.ticks++;
      state.distance = Math.max(state.distance, Math.hypot(p.position.x - start.x, p.position.z - start.z));
      state.speed = Math.max(state.speed, Math.hypot(p.velocity.x, p.velocity.z) / .0254);
      state.seen += sim.actors.slice(1).filter((bot: any) => sim.prefireBotDecision(bot.id)?.visible).length;
      state.shots = sim.actors.slice(1).reduce((sum: number, bot: any) => sum + bot.weapon.ordinal, 0);
    };
  });
  await expect.poll(() => page.evaluate(() => (window as any).encounterProbe.seen), {timeout: 25000}).toBeGreaterThan(20);
  const motion = await page.evaluate(() => (window as any).encounterProbe);
  expect(motion.distance).toBeGreaterThan(2); expect(motion.speed).toBeGreaterThan(130); expect(motion.shots).toBe(0);
  const canvas = page.locator('canvas[aria-label="Dust 2 prefire map"]');
  const pixels = await sharp(await canvas.screenshot()).stats();
  expect(pixels.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  await page.screenshot({path: 'research/dust2/prefire-lighting-b-approach.png'});
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const e = (window as any).encounterEngine;
    e.setSettings({...e.settings, quality: 'performance'});
  });
  await expect.poll(() => page.evaluate(() => (window as any).encounterEngine.renderer.shadowMap.enabled)).toBe(false);
  expect(errors).toEqual([]);
});
