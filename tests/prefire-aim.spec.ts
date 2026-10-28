import {expect, test, type Page} from '@playwright/test';

async function openPrefire(page: Page) {
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(t: number) {(window as any).aimQA = this; return tick.call(this, t);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout: 90000});
  await page.waitForFunction(() => (window as any).aimQA?.hitboxes.get(1)?.pose.capsules.length === 19);
}

test('Dust 2 crosshair and recoil-follow ray remain aligned through aspect and frame-remainder changes', async ({page}) => {
  test.setTimeout(150000); await openPrefire(page);
  const errors = await page.evaluate(async () => {
    const e = (window as any).aimQA;
    const threePath = '/node_modules/.vite/deps/three.js', ballisticsPath = '/src/range/ballistics.ts';
    const equipmentPath = '/src/range/equipment.ts', shotPath = '/src/range/shot-model.ts';
    const {Vector3} = await import(/* @vite-ignore */ threePath);
    const {WeaponRecovery} = await import(/* @vite-ignore */ ballisticsPath);
    const {equipmentStats} = await import(/* @vite-ignore */ equipmentPath);
    const {direction} = await import(/* @vite-ignore */ shotPath);
    // Freeze physics while testing the active fractional presentation clock.
    // Paused/result camera sampling is tested separately in aim-punch.spec.ts.
    e.paused = false; e.sim.pause(); e.sim.phase = 'fighting';
    const p = e.sim.actors[0], results: {error: number; aspect: string; follow: boolean; shots: number; remainder: number; transform: string; punch: unknown; size: number[]; point: number[]; state: number[]}[] = [];
    for (const aspect of ['native', '4:3', '16:9']) for (const follow of [false, true]) for (const shots of [0, 1, 5]) for (const remainder of [0, .003, .007]) {
      e.setSettings({...e.settings, aspect, follow});
      const recovery = new WeaponRecovery(equipmentStats('ak47'));
      for (let i = 0; i < shots; i++) {recovery.fire(); recovery.advance(.1);}
      p.weapon.recovery.angle = {...recovery.angle}; p.weapon.recovery.velocity = {...recovery.velocity};
      p.yaw = .57; p.pitch = .15; e.sim.accumulator = remainder;
      e.pacer.next = 0; e.last = performance.now(); e.tick(e.last + 100);
      const canvas = e.renderer.domElement.getBoundingClientRect(), cross = e.crosshair.getBoundingClientRect();
      let x = canvas.left + canvas.width / 2, y = canvas.top + canvas.height / 2;
      if (follow) {
        const recoil = p.weapon.recovery.predict(remainder);
        const ray = direction(p.yaw - recoil.yaw * Math.PI / 180, p.pitch + recoil.pitch * Math.PI / 180);
        const projected = new Vector3().copy(ray).multiplyScalar(10).add(e.camera.position).project(e.camera);
        x += projected.x * canvas.width / 2; y -= projected.y * canvas.height / 2;
      }
      results.push({error: Math.hypot(cross.x - x, cross.y - y), aspect, follow, shots, remainder,
        transform: e.crosshair.style.transform, punch: p.punch.angle, size: [e.width, e.height, canvas.width, canvas.height],
        point: [cross.x, cross.y, x, y, canvas.left, canvas.top],
        state: [p.yaw, p.pitch, e.sim.accumulator, e.camera.rotation.x, e.camera.rotation.y]});
    }
    return results;
  });
  expect(errors).toHaveLength(54);
  const worst = [...errors].sort((a, b) => b.error - a.error)[0];
  expect(worst.error, JSON.stringify(worst)).toBeLessThan(.01);
});

test('Prefire reports the actual firing state and clears it on a new route', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop pointer-lock firing workflow');
  test.setTimeout(150000); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPrefire(page); await page.getByLabel('Training preset').selectOption('learn');
  await page.getByRole('button', {name: 'Enter prefire'}).click();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  const centered = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-duel]')!.getBoundingClientRect();
    const cross = document.querySelector('.follow-origin')!.getBoundingClientRect();
    return {width: canvas.width, height: canvas.height, screen: [innerWidth, innerHeight],
      error: Math.hypot(cross.x - innerWidth / 2, cross.y - innerHeight / 2)};
  });
  expect(centered.width).toBe(centered.screen[0]); expect(centered.height).toBe(centered.screen[1]);
  expect(centered.error).toBeLessThan(.01);
  await expect(page.getByRole('complementary', {name: 'Prefire settings', exact: true})).toBeHidden();
  await page.mouse.click(centered.width / 2, centered.height / 2);
  await expect(page.getByLabel('Last shot state')).toContainText('Settled / baseline accuracy');
  await page.keyboard.down('w'); await page.waitForTimeout(250);
  await page.mouse.click(centered.width / 2, centered.height / 2);
  await page.keyboard.up('w');
  await expect(page.getByLabel('Last shot state')).toContainText('Shot while moving');
  const retained = await page.evaluate(() => {
    const e = (window as any).aimQA;
    return {sample: e.lastShot.state, current: e.sim.actors[0].weapon.recovery.penalty};
  });
  expect(retained.sample.speedUnits).toBeGreaterThan(70);
  expect(retained.sample.movementInaccuracy).toBeGreaterThan(0);
  expect(retained.sample.inaccuracy).toBeGreaterThan(retained.current);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', {name: 'Prefire settings', exact: true})).toBeVisible();
  await expect(page.getByLabel('Last shot accuracy')).toContainText('Shot while moving');
  await page.getByRole('button', {name: 'Repeat route', exact: true}).click();
  await expect(page.getByLabel('Last shot accuracy')).toHaveCount(0);
  expect(errors).toEqual([]);
});
