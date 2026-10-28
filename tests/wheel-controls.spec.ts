import {expect, test, type Page} from '@playwright/test';

type Mode = 'guided' | 'duel';
type Direction = 'up' | 'down';
type Motion = {
  time: number; feet: number; y: number; verticalVelocity: number; grounded: boolean;
  jump: boolean; jumpHeld: boolean; jumpPressed: boolean;
};
type WheelSample = {deltaY: number; trusted: boolean; cancelable: boolean; prevented: boolean | null; target: string; x: number; y: number};
type WheelHarness = {
  engine: any; sample: () => Motion; step: (ticks: number) => Motion[]; samples: Motion[];
};
declare global {
  interface Window {
    wheelControlsEngine?: any;
    wheelControlsQA?: WheelHarness;
    wheelControlsEvents: WheelSample[];
  }
}

const canvasSelector = (mode: Mode) => `canvas[data-${mode === 'guided' ? 'range' : 'duel'}]`;
const jumpButton = (page: Page) => page.getByRole('button', {name: 'Bind jump', exact: true});
const wheelLabel = (direction: Direction) => direction === 'up' ? 'Wheel Up' : 'Wheel Down';
const wheelDelta = (direction: Direction, magnitude = 120) => direction === 'up' ? -magnitude : magnitude;

async function hookEngine(page: Page, mode: Mode) {
  const path = mode === 'guided' ? '/src/range/engine.ts' : '/src/range/duel/DuelEngine.ts';
  await page.waitForFunction(path => performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname === path), path);
  await page.evaluate(async ({path, mode}) => {
    const url = performance.getEntriesByType('resource').reverse().find(entry => new URL(entry.name).pathname === path)!.name;
    const module = await import(/* @vite-ignore */ url);
    const prototype = (mode === 'guided' ? module.RangeEngine : module.DuelEngine).prototype;
    const tick = prototype.tick;
    prototype.tick = function(time: number) {window.wheelControlsEngine = this; return tick.call(this, time);};
  }, {path, mode});
  await page.waitForFunction(mode => {
    const e = window.wheelControlsEngine;
    return e && !e.disposed && (mode === 'duel' || e.loadedTarget && e.modelCache.has(e.sim.equipped));
  }, mode);
}

async function boot(page: Page, mode: Mode) {
  await page.addInitScript(mode => {
    performance.setResourceTimingBufferSize(10000);
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode, quality: 'performance', volume: 0, frameLimit: 60, protectShortcuts: false, showTips: false,
    }));
    if (!localStorage.getItem('spraylab.duel.v1')) localStorage.setItem('spraylab.duel.v1', JSON.stringify({
      botCount: 1, skill: 1, behavior: 'patient', playerHealth: 500, shortcutProtection: false, mapDesign: 'Courtyard', generatedMaps:true,
    }));
    window.wheelControlsEvents = [];
    window.addEventListener('wheel', event => {
      const sample: WheelSample = {deltaY: event.deltaY, trusted: event.isTrusted, cancelable: event.cancelable, prevented: null,
        target: (event.target as Element).id || (event.target as Element).tagName, x:event.clientX,y:event.clientY};
      window.wheelControlsEvents.push(sample);
      // Observe consumption after capture and gameplay listeners have both run.
      setTimeout(() => {sample.prevented = event.defaultPrevented;}, 0);
    }, {capture: true, passive: true});
  }, mode);
  await page.goto('/');
  await expect(page.locator(canvasSelector(mode))).toBeVisible();
  await hookEngine(page, mode);
  await page.bringToFront();
}

async function wheel(page: Page, deltaY: number, prevented: boolean) {
  const before = await page.evaluate(() => window.wheelControlsEvents.length);
  await page.mouse.wheel(0, deltaY);
  await expect.poll(() => page.evaluate(() => window.wheelControlsEvents.length)).toBe(before + 1);
  const event = await page.evaluate(index => window.wheelControlsEvents[index], before);
  // Opera's CDP wheel events can be trusted but non-cancelable. DOM cannot mark
  // those prevented; real panel scrolling, saved bindings and jumps are checked below.
  await expect.poll(() => page.evaluate(index => window.wheelControlsEvents[index].prevented, before))
    .toBe(prevented && event.cancelable);
  expect(event.trusted, 'Use native wheel input, not dispatchEvent or direct jump commands').toBe(true);
  expect(Math.sign(event.deltaY)).toBe(Math.sign(deltaY));
}

async function openControls(page: Page) {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Controls', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Settings', exact: true})).toBeVisible();
}

async function captureJump(page: Page, direction: Direction) {
  const button = jumpButton(page), panel = page.locator('#settings-content');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const top = await panel.evaluate(element => element.scrollTop);
  await wheel(page, wheelDelta(direction), true);
  await expect(button).toHaveText(wheelLabel(direction));
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await panel.evaluate(element => element.scrollTop), 'Active capture must suppress dialog scrolling').toBe(top);
}

async function installStepper(page: Page, mode: Mode) {
  await page.evaluate(mode => {
    const engine = window.wheelControlsEngine, sim = engine.sim;
    const advance = sim.advance.bind(sim);
    // Keep rendering/input live; only the real simulation clock is test-driven.
    sim.advance = () => {};
    if (mode === 'duel') for (const actor of sim.actors.slice(1)) sim.command(actor.id, {});
    const sample = (): Motion => {
      const player = mode === 'guided' ? sim : sim.actors[0];
      const input = mode === 'guided' ? sim.input : player.command;
      return {time: sim.time, feet: player.feet, y: player.position.y, verticalVelocity: player.verticalVelocity,
        grounded: !!player.grounded, jump: !!input.jump, jumpHeld: !!player.jumpHeld, jumpPressed: !!input.jumpPressed};
    };
    const samples: Motion[] = [];
    window.wheelControlsQA = {engine, sample, samples, step: ticks => {
      const rows: Motion[] = [];
      for (let i = 0; i < ticks; i++) {advance(1 / 128); const row = sample(); rows.push(row); samples.push(row);}
      return rows;
    }};
  }, mode);
}

async function enter(page: Page, mode: Mode, resume = false) {
  const name = mode === 'guided' ? 'Enter range' : resume ? 'Resume duel' : 'Enter duel';
  await page.getByRole('button', {name, exact: true}).click();
  await expect.poll(() => page.evaluate(mode => {
    const e = window.wheelControlsEngine;
    const active = mode === 'guided' ? e.sim.active : e.sim.phase === 'fighting' && !e.paused;
    const ownsCapture = !e.renderer.domElement.requestPointerLock || document.pointerLockElement === e.renderer.domElement;
    return !!active && !e.entering && ownsCapture;
  }, mode), {message: `${mode} must enter through the real engine and retain native mouse capture`}).toBe(true);
  const box = await page.locator(canvasSelector(mode)).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function checkNativeCapture(page: Page, browserName: string) {
  if (browserName !== 'webkit') return;
  // Windows WebKit can advertise Pointer Lock but reject its active root document.
  await page.evaluate(() => {
    const button = document.createElement('button'); button.id = 'wheel-native-probe'; button.textContent = 'Capture probe';
    Object.assign(button.style, {position: 'fixed', top: '0', left: '0', zIndex: '99999'});
    button.onclick = async () => {
      try {await button.requestPointerLock(); button.dataset.result = 'accepted';}
      catch (error) {button.dataset.result = (error as Error).name;}
    };
    document.body.append(button);
  });
  const probe = page.locator('#wheel-native-probe'); await probe.click();
  await expect(probe).toHaveAttribute('data-result', /.+/);
  const result = await probe.getAttribute('data-result');
  await page.evaluate(() => {document.exitPointerLock?.(); document.getElementById('wheel-native-probe')!.remove();});
  await expect.poll(() => page.evaluate(() => document.pointerLockElement == null)).toBe(true);
  test.skip(result === 'WrongDocumentError', 'Standalone native Pointer Lock rejects the active root document in this WebKit runner.');
  expect(result, 'Native API failure must not be mistaken for an engine wheel failure').toBe('accepted');
}

const sample = (page: Page) => page.evaluate(() => window.wheelControlsQA!.sample());
const step = (page: Page, ticks: number) => page.evaluate(ticks => window.wheelControlsQA!.step(ticks), ticks);

function expectGrounded(rows: Motion[], ground: Motion) {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.feet).toBeCloseTo(ground.feet, 6);
    expect(row.y).toBeCloseTo(ground.y, 6);
    expect(row.verticalVelocity).toBe(0);
    expect(row.grounded).toBe(true);
    expect(row.jump).toBe(false); expect(row.jumpHeld).toBe(false); expect(row.jumpPressed).toBe(false);
  }
}

function expectSingleFlight(rows: Motion[], ground: Motion) {
  const sequence = [ground, ...rows];
  const takeoffs = rows.filter((row, i) => row.verticalVelocity > 0 && sequence[i].verticalVelocity <= 0 && row.feet > ground.feet + .0001);
  const landings = rows.filter((row, i) => sequence[i].feet > ground.feet + .0001 && Math.abs(row.feet - ground.feet) < .0001);
  expect(takeoffs, 'A wheel pulse must produce exactly one physical takeoff').toHaveLength(1);
  expect(landings, 'The player must physically return to the same floor once').toHaveLength(1);
  expect(takeoffs[0].y).toBeGreaterThan(ground.y);
  expect(Math.max(...rows.map(row => row.feet)) - ground.feet).toBeGreaterThan(.5);
  expect(Math.max(...rows.map(row => row.y)) - ground.y).toBeGreaterThan(.5);
  expect(rows.some(row => row.verticalVelocity < -1)).toBe(true);
  expect(rows.every(row => !row.jump && !row.jumpHeld && !row.jumpPressed)).toBe(true);
  expectGrounded(rows.slice(-64), ground);
}

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop mouse-wheel regression');
  test.setTimeout(120000);
});

test.afterEach(async ({page}, info) => {
  if (page.isClosed()) return;
  const diagnostics = await page.evaluate(() => ({
    wheelEvents: window.wheelControlsEvents, samples: window.wheelControlsQA?.samples,
    current: window.wheelControlsQA?.sample(), controls: JSON.parse(localStorage.getItem('spraylab.range.v2') || '{}').controls,
  })).catch(error => ({error: String(error)}));
  await info.attach('wheel-gameplay', {body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json'});
  await page.screenshot({path: info.outputPath('wheel-gameplay.png')});
  await page.evaluate(() => window.wheelControlsEngine?.pause()).catch(() => {});
});

test('Settings captures trusted wheel up/down, reports conflicts, and persists both jump directions after reload', async ({page}) => {
  await boot(page, 'guided'); await openControls(page);
  const before = await page.evaluate(() => ({...window.wheelControlsEngine.sim.position}));
  await captureJump(page, 'up');
  const reload = page.getByRole('button', {name: 'Bind reload', exact: true});
  await reload.click(); await wheel(page, -120, true);
  await expect(page.locator('.controls-message')).toHaveText('Already assigned to jump.');
  await expect(reload).toHaveAttribute('aria-pressed', 'true');
  await reload.press('Escape'); await expect(reload).toHaveText('R');
  await reload.click(); await wheel(page, 120, true); await expect(reload).toHaveText('Wheel Down');
  await jumpButton(page).click(); await wheel(page, 120, true);
  await expect(page.locator('.controls-message')).toHaveText('Already assigned to reload.');
  await jumpButton(page).press('Escape'); await expect(jumpButton(page)).toHaveText('Wheel Up');
  expect(await page.evaluate(() => ({...window.wheelControlsEngine.sim.position}))).toEqual(before);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).controls))
    .toMatchObject({jump: 'WheelUp', reload: 'WheelDown'});
  await page.reload(); await hookEngine(page, 'guided'); await openControls(page);
  await expect(jumpButton(page)).toHaveText('Wheel Up'); await expect(reload).toHaveText('Wheel Down');
  await page.getByRole('button', {name: 'Reset reload', exact: true}).click();
  await captureJump(page, 'down');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).controls.jump)).toBe('WheelDown');
  await page.reload(); await hookEngine(page, 'guided'); await openControls(page);
  await expect(jumpButton(page)).toHaveText('Wheel Down'); await expect(reload).toHaveText('R');
});

for (const mode of ['guided', 'duel'] as const) {
  test(`${mode}: wheel-jump works while Ctrl-crouching and Shift-walking without browser zoom`, async ({page,browserName}) => {
    await boot(page,mode); await checkNativeCapture(page,browserName);
    await openControls(page); await captureJump(page,'up');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await installStepper(page,mode); await enter(page,mode);
    for (const key of ['Control','Shift']) {
      await page.keyboard.down(key); await step(page,128);
      const ground = await sample(page), scale = await page.evaluate(()=>visualViewport?.scale);
      await wheel(page,-120,true); expectSingleFlight(await step(page,256),ground);
      expect(await page.evaluate(()=>visualViewport?.scale)).toBe(scale);
      await page.keyboard.up(key); await step(page,128);
    }
  });
  test(`${mode}: paused wheel neither jumps nor hijacks Settings scrolling or queues a jump on resume`, async ({page, browserName}) => {
    await boot(page, mode); await checkNativeCapture(page, browserName);
    await openControls(page); await captureJump(page, 'up');
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await installStepper(page, mode); await enter(page, mode);
    const ground = await sample(page); expectGrounded(await step(page, 8), ground);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(mode => {
      const e = window.wheelControlsEngine; return mode === 'guided' ? !e.sim.active : e.paused;
    }, mode)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.pointerLockElement == null)).toBe(true);
    const canvas = await page.locator(canvasSelector(mode)).boundingBox();
    await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
    await wheel(page, -120, false); expectGrounded(await step(page, 8), ground);
    await openControls(page);
    const panel = page.locator('#settings-content'), box = await panel.boundingBox();
    expect(await panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await panel.hover({position:{x:box!.width/2,y:box!.height/2}});
    const top = await panel.evaluate(element => element.scrollTop);
    await wheel(page, 400, false);
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(top);
    const lower = await panel.evaluate(element => element.scrollTop);
    await wheel(page, -120, false);
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeLessThan(lower);
    expectGrounded(await step(page, 8), ground);
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await enter(page, mode, true); expectGrounded(await step(page, 128), ground);
  });

  for (const direction of ['up', 'down'] as const) test(`${mode}: ${wheelLabel(direction)} causes physical takeoff, landing, and fresh jumps without held auto-bhop`, async ({page, browserName}) => {
    await boot(page, mode); await checkNativeCapture(page, browserName);
    await openControls(page); await captureJump(page, direction);
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await installStepper(page, mode); await enter(page, mode);
    const ground = await sample(page); expectGrounded(await step(page, 8), ground);
    await wheel(page, -wheelDelta(direction), false); expectGrounded(await step(page, 16), ground);
    await page.keyboard.press('Space'); expectGrounded(await step(page, 16), ground);
    for (const magnitude of [120, 600, 1]) {
      await wheel(page, wheelDelta(direction, magnitude), true);
      expectSingleFlight(await step(page, 256), ground);
      expectGrounded(await step(page, 128), ground);
    }
  });
}
