import {expect, test} from '@playwright/test';

test('live result view advances airborne grenades instead of freezing their rendered position', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name)); test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'}));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({generatedMaps: true, botCount: 1, botUtilities: false, shortcutProtection: false}));
    localStorage.setItem('spraylab.duel.hint.v1', 'seen');
  });
  await page.goto('/');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function (time: number) {(window as any).postRoundEngine = this; return tick.call(this, time);};
  });
  await page.getByRole('button', {name: 'Enter duel', exact: true}).click();
  await page.waitForFunction(() => (window as any).postRoundEngine?.criticalReady);
  const before = await page.evaluate(() => {
    const engine = (window as any).postRoundEngine, sim = engine.sim;
    for (const actor of sim.actors) actor.command.fireHeld = actor.command.firePressed = false;
    sim.actors[0].alive = false; sim.actors[0].health = 0; sim.phase = 'result'; sim.outcome = 'lost'; sim.completedAt = sim.time;
    // Isolate the post-result loop without starting the next-round countdown.
    engine.roundFlow.reset(); sim.resume(); engine.paused = false;
    const p = sim.actors[0].position;
    sim.utilities.throw({actorId: 0, side: 'player', kind: 'he', origin: {x: p.x, y: p.y + 1, z: p.z},
      direction: {x: 1, y: .2, z: 0}, velocity: {x: 0, y: 0, z: 0}, strength: .2, time: sim.time});
    return {time: sim.time, at: sim.completedAt, position: {...sim.utilities.projectiles[0].position}};
  });
  await expect.poll(() => page.evaluate(() => (window as any).postRoundEngine.sim.time)).toBeGreaterThan(before.time + .2);
  const moving = await page.evaluate(() => {
    const engine = (window as any).postRoundEngine, sim = engine.sim;
    const mesh = engine.utilityRenderer.group.getObjectByName('utility-projectiles-he');
    return {position: sim.utilities.projectiles[0]?.position, rendered: mesh?.count, at: sim.completedAt, outcome: sim.outcome};
  });
  expect(moving.position).toBeDefined(); expect(moving.position).not.toEqual(before.position);
  expect(moving.rendered).toBe(1); expect(moving.at).toBe(before.at); expect(moving.outcome).toBe('lost');
  await expect.poll(() => page.evaluate(() => (window as any).postRoundEngine.sim.utilities.projectiles.length), {timeout: 5000}).toBe(0);
  expect(errors).toEqual([]);
});
