import {expect, test} from '@playwright/test';

async function enginePage(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance', follow: true}));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, health: 500, playerHealth: 500}));
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).punchEngine = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).punchEngine?.motionReady);
}

test('a nonlethal hit displaces the player camera fully and Follow Recoil stays aligned', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enginePage(page);
  const result = await page.evaluate(async () => {
    const e = (window as any).punchEngine, player = e.sim.actors[0], bot = e.sim.actors[1];
    e.sim.arena.solids = []; e.covers.visible = false;
    player.position = {x: 0, y: 1.6256, z: 4}; player.yaw = 0; player.pitch = 0;
    bot.position = {x: 0, y: 1.6256, z: -4}; bot.yaw = Math.PI;
    bot.pitch = Math.atan2(1.2 - 1.6256, 8); bot.weapon.random = () => 0;
    e.sim.command(1, {firePressed: true}); e.sim.start(); e.sim.step();
    const events = e.sim.drainEvents(), hit = events.find((event: any) => event.kind === 'hit');
    e.processEvents(events); e.sim.pause(); e.paused = true;
    const punch = {...player.punch.shot}, aim = player.pitch, recoil = {...player.weapon.recovery.recoil};
    await new Promise(resolve => setTimeout(resolve, 180));
    const transform = e.crosshair.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return {hit, punch, aim, recoil, cameraPitch: e.camera.rotation.x,
      crosshair: [Number(transform?.[1]), Number(transform?.[2])], finite: e.camera.matrixWorld.elements.every(Number.isFinite)};
  });
  expect(result.hit).toMatchObject({victim: 0, group: 'chest', lethal: false});
  expect(result.punch.pitch).toBeGreaterThan(.5);
  expect(result.recoil).toEqual({pitch: 0, yaw: 0});
  expect(result.cameraPitch).toBeCloseTo(result.aim + result.punch.pitch * Math.PI / 180, 5);
  expect(Math.hypot(...result.crosshair)).toBeLessThan(.01);
  expect(result.finite).toBe(true);
  expect(errors).toEqual([]);
});

test('bare-head punch rolls the camera and a new round clears actor punch', async ({page}, info) => {
  await enginePage(page);
  await page.addStyleTag({content: '.duel-entry {display:none}'});
  const result = await page.evaluate(async () => {
    const e = (window as any).punchEngine, player = e.sim.actors[0];
    player.punch.random = () => .6;
    player.punch.hit({group: 'head', rawDamage: 20, armor: 0, helmet: false});
    const punch = {...player.punch.shot};
    await new Promise(resolve => setTimeout(resolve, 150));
    const roll = e.camera.rotation.z;
    e.restart(false);
    return {punch, roll, fresh: e.sim.actors[0].punch.shot};
  });
  expect(result.roll).toBeCloseTo(result.punch.roll * Math.PI / 180, 5);
  expect(result.fresh).toEqual({pitch: 0, yaw: 0, roll: 0});
  await page.locator('canvas[data-duel]').screenshot({path: info.outputPath('fresh-round.png')});
});
