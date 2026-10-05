import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function captureEngine(page: Page, kind: 'range' | 'duel') {
  await expect(page.locator(`canvas[data-${kind}]`)).toBeVisible();
  await page.evaluate(async kind => {
    const name = kind === 'range' ? '/range/engine.ts' : '/duel/DuelEngine.ts';
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes(name))!.name;
    const module = await import(/* @vite-ignore */ url);
    const Class = kind === 'range' ? module.RangeEngine : module.DuelEngine;
    const original = Class.prototype.tick;
    Class.prototype.tick = function(time: number) {(window as any).lessonEngine = this; original.call(this, time);};
  }, kind);
  await page.waitForFunction(kind => {
    const e = (window as any).lessonEngine;
    return kind === 'range' ? e?.loadedTarget : e?.motionReady && e.viewRoot.children.length;
  }, kind);
}

test('fundamentals offer interactive practice, honest demonstrations and mobile controls', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', {name: 'Learn the fundamentals'}).click();
  const dialog = page.getByRole('dialog', {name: 'Stop before you shoot'});
  await expect(dialog).toBeVisible();
  await page.getByRole('button', {name: 'Watch example'}).click();
  await expect(page.locator('.lesson-feedback')).toContainText('That is a counter-strafe');
  await expect(page.getByRole('button', {name: 'Next lesson'})).toBeDisabled();
  await page.getByRole('button', {name: 'Try it yourself'}).click();
  // Pointer controls exercise the same input path on desktop and touch devices.
  const right = (await page.getByRole('button', {name: 'Move right', exact: true}).boundingBox())!;
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2); await page.mouse.down();
  await page.waitForTimeout(360);
  await page.mouse.up();
  const left = (await page.getByRole('button', {name: 'Move left', exact: true}).boundingBox())!;
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2); await page.mouse.down();
  await expect(page.locator('.lesson-feedback')).toContainText('That is a counter-strafe');
  await page.mouse.up();
  await page.getByRole('button', {name: 'Next lesson'}).click();
  await expect(page.getByRole('heading', {name: 'Aim with your movement'})).toBeVisible();
  await page.getByRole('button', {name: 'Fire / Space'}).click();
  await expect(page.locator('.lesson-feedback')).toContainText('right of your crosshair');
  await page.getByRole('button', {name: 'Watch example'}).click();
  await expect(page.locator('.lesson-feedback')).toContainText('shot connected');
  const image = await page.locator('.movement-tutorial').screenshot({path: `test-results/tutorial-${info.project.name}.png`});
  expect((await sharp(image).stats()).channels[0].stdev).toBeGreaterThan(20);
  expect((await page.locator('.movement-tutorial').boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Close tutorial'}).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('transfer and spread choices persist, with mode-specific recommendations', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('guided');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Practice spread', {exact: true})).not.toBeChecked();
  await expect(page.locator('.setting-explanation').filter({hasText: 'Turning it off does not remove recoil'})).toBeVisible();
  await page.getByLabel('Transfer after bullet', {exact: true}).fill('9');
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByLabel('Training mode').selectOption('transfer');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Practice spread', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Transfer after bullet', {exact: true})).toHaveValue('9');
  await page.getByLabel('Transfer trigger').selectOption('kill');
  await page.reload();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Transfer trigger')).toHaveValue('kill');
  await expect(page.getByLabel('Transfer after bullet', {exact: true})).toHaveCount(0);
});

test('live guide projection sends scheduled shots into the head at long range and while crouched', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Detailed physical projection sweep runs once');
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', spread: false})));
  await page.goto('/'); await captureEngine(page, 'range');
  const results = await page.evaluate(async () => {
    const e = (window as any).lessonEngine, s = e.sim, V = e.camera.position.constructor;
    const {TARGET_Z} = await import(/* @vite-ignore */ '/src/range/simulation.ts');
    cancelAnimationFrame(e.frame);
    const render = () => {
      const time = performance.now(); e.previous = time; e.pacer.ready(time, 0);
      e.tick(time); cancelAnimationFrame(e.frame);
    };
    const results = [];
    for (const follow of [false, true]) for (const distance of [4, 15, 90]) for (const eye of [46, 55, 64]) {
      s.settings.follow = follow; s.settings.spread = false; s.active = false;
      s.previousPosition = undefined; s.position = {x: 0, y: eye * .0254, z: TARGET_Z + distance};
      s.accumulator = 0; s.resetRecovery(); s.shots = 10; s.firing = true;
      for (let n = 0; n < 10; n++) {s.recovery.fire(); s.recovery.advance(.1);}
      s.recoil = s.recovery.recoil; s.nextShot = s.time + .05; s.yaw = 0; s.pitch = 0;
      render();
      const cue = e.cues[0];
      const ndc = new V(parseFloat(cue.style.left) / 50 - 1, 1 - parseFloat(cue.style.top) / 50, .5);
      const dir = ndc.unproject(e.camera).sub(e.camera.position).normalize();
      const fraction = follow ? 1 : .45;
      s.yaw = Math.atan2(-dir.x, -dir.z) + s.recoil.yaw * Math.PI / 180 * fraction;
      s.pitch = Math.asin(dir.y) - s.recoil.pitch * Math.PI / 180 * fraction;
      const delay = Math.ceil((s.nextShot - s.time) * 128 - 1e-8) / 128;
      s.recovery.advance(delay); s.time += delay;
      s.fire();
      results.push({follow, distance, eye, caption: e.hitCaption.textContent, sample: s.samples.at(-1)});
    }
    return results;
  });
  for (const result of results) expect(result.caption, JSON.stringify(result)).toBe('HEADSHOT');
});

test('Duel size, equipment, damage arcs and scorecard work without blocking the crosshair', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await captureEngine(page, 'duel');
  await page.getByLabel('Arena size', {exact: true}).fill('1.5');
  await expect.poll(() => page.evaluate(() => (window as any).lessonEngine.sim.arena.maxX)).toBe(18);
  const geometry = await page.evaluate(() => {
    const e = (window as any).lessonEngine; return {scale: e.shell.scale.toArray(), z: e.sim.actors[0].position.z};
  });
  expect(geometry.scale).toEqual([1.5, 1, 1.5]);
  expect(geometry.z).toBeGreaterThan(10);
  await page.getByRole('button', {name: 'Equip USP-S', exact: true}).click();
  await expect(page.locator('.duel-ammo small')).toHaveText('USP-S');
  await page.waitForFunction(() => (window as any).lessonEngine.renderedEquipment === 'usp' && (window as any).lessonEngine.viewRoot.children.length);
  await page.getByRole('button', {name: 'Equip Default knife', exact: true}).click();
  await expect(page.locator('.duel-ammo strong')).toHaveText('--');
  await page.getByRole('button', {name: 'Equip AK-47', exact: true}).click();
  await page.evaluate(() => {
    const e = (window as any).lessonEngine;
    e.sim.command(1, {}); e.sim.start(); e.sessionStarted = true;
    e.sim.actors[1].position.x = 5;
    e.processEvents([{kind: 'hit', shooter: 1, victim: 0, group: 'chest', shotId: 3, healthDamage: 35, armorDamage: 12, lethal: false, point: e.sim.actors[0].position}]);
    e.report();
  });
  await expect(page.locator('.damage-arc')).toHaveCount(1);
  const arc = await page.locator('.damage-arc').boundingBox();
  expect(arc!.width).toBeGreaterThan(120);
  await page.locator('.duel-view').screenshot({path: `test-results/damage-feedback-${info.project.name}.png`});
  await expect(page.locator('.damage-arc')).toHaveCount(0);
  await page.evaluate(() => {
    const e = (window as any).lessonEngine, self = e.sim.snapshot()[0];
    e.pause();
    e.sim.coach.shot(self); e.sim.coach.shot({...self, velocity: {x: 5, z: 0}});
    e.sim.coach.hit({kind: 'hit', shooter: 0, victim: 1, group: 'head', healthDamage: 40, armorDamage: 0, lethal: true}, 1);
    e.processEvents([{kind: 'round', outcome: 'won', seconds: 1}]); e.report();
  });
  await page.getByRole('tab', {name: 'Scorecard', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Duel scorecard'})).toContainText('50%');
  await expect(page.getByRole('region', {name: 'Duel scorecard'})).toContainText('1/2 shots fired while moving');
  await page.getByRole('region', {name: 'Duel scorecard'}).screenshot({path: `test-results/scorecard-${info.project.name}.png`});
  const png = await page.locator('canvas[data-duel]').screenshot();
  expect((await sharp(png).stats()).channels[0].stdev).toBeGreaterThan(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await page.getByRole('tab', {name: 'Scorecard'}).click();
  await expect(page.getByRole('region', {name: 'Duel scorecard'})).toContainText('Hits / shots');
  expect(errors).toEqual([]);
});

test('all exported native audio events decode in the browser', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Decode the full sound bank once');
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {events} = await (await fetch('/audio/events.json')).json();
    const context = new OfflineAudioContext(2, 48000, 48000);
    const urls = [...new Set(Object.values(events).flatMap((e: any) => e.samples))] as string[];
    let silent = 0;
    for (const url of urls) {
      const response = await fetch(url); if (!response.ok) throw new Error(url);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (!buffer.getChannelData(0).some(value => Math.abs(value) > .001)) silent++;
    }
    return {count: urls.length, events: Object.keys(events).length, silent};
  });
  expect(result.events).toBeGreaterThan(50); expect(result.count).toBeGreaterThan(90); expect(result.silent).toBe(0);
});

test('lessons two and three are completable with manual movement and preserve their results', async ({page}) => {
  await page.goto('/'); await page.getByRole('button', {name: 'Learn the fundamentals'}).click();
  for (const name of ['2. Aim with your movement', '3. Peek one angle at a time']) {
    await page.getByRole('button', {name, exact: true}).click();
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => {
      const a = document.querySelector('.lesson-target')!.getBoundingClientRect();
      const b = document.querySelector('.lesson-scene')!.getBoundingClientRect();
      return a.x + a.width / 2 - (b.x + b.width / 2) < 16;
    });
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyA');
    await expect(page.locator('.lesson-speed .ready')).toBeVisible();
    await page.keyboard.up('KeyA');
    await page.getByRole('button', {name: 'Fire / Space'}).click();
    await expect(page.locator('.lesson-feedback')).toContainText('shot connected');
    await page.waitForTimeout(1400);
    await expect(page.locator('.lesson-feedback')).toContainText('shot connected');
  }
});

test('native reload moves the hands and magazine, returns to idle, and keeps HUD controls apart', async ({page}, info) => {
  await page.goto('/'); await captureEngine(page, 'duel');
  const sample = (remaining: number) => page.evaluate(remaining => {
    const e = (window as any).lessonEngine;
    cancelAnimationFrame(e.frame);
    const weapon = e.sim.actors[0].weapon;
    weapon.reload.cancel(false); e.viewAnimation.cancel();
    if (remaining > 0) {
      weapon.ammo = weapon.actions.base.magazine - 1;
      weapon.reload.start(0); weapon.reload.advance(weapon.actions.base.reload - remaining);
    }
    e.viewAnimationElapsed = 1 / 30;
    e.sim.time = remaining > 0 ? weapon.actions.base.reload - remaining : 0;
    e.last = performance.now(); e.pacer.ready(e.last, 0); e.tick(e.last); cancelAnimationFrame(e.frame);
    const scene = e.viewRoot.children[0]; scene.updateMatrixWorld(true);
    const hand = scene.getObjectByName('hand_L');
    const position = hand.getWorldPosition(hand.position.clone()).toArray();
    return {position, loaded: !!e.viewAnimation};
  }, remaining);
  const idle = await sample(0), midway = await sample(1.2);
  expect(idle.loaded).toBe(true);
  expect(Math.hypot(...idle.position.map((v: number, i: number) => v - midway.position[i]))).toBeGreaterThan(.05);
  await page.locator('.duel-view').screenshot({path: `test-results/native-reload-${info.project.name}.png`});
  const restored = await sample(0);
  expect(restored.position).toEqual(idle.position);
  await page.evaluate(() => {
    const e = (window as any).lessonEngine; e.sim.start(); e.sessionStarted = true; e.report();
  });
  for (const size of [{width: 1440, height: 1000}, {width: 390, height: 844}, {width: 844, height: 390}]) {
    await page.setViewportSize(size);
    const boxes = await page.locator('.duel-tools > *').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height};
    }));
    expect(boxes).toHaveLength(4);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
  }
});
