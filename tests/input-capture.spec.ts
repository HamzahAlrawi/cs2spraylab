import {expect, test, type Page} from '@playwright/test';

type Mode = 'duel' | 'guided';
type EngineProbe = {
  disposed: boolean;
  entering: boolean;
  paused?: boolean;
  inputStatus?: string;
  inputName?: string;
  renderer: {domElement: HTMLCanvasElement};
  shortcuts: {protected: boolean};
  loadedTarget?: boolean;
  modelCache?: Map<string, unknown>;
  sim: {
    active?: boolean;
    phase?: string;
    equipped: string;
    yaw: number;
    shots: number;
    firing: boolean;
    actors: {yaw: number; command: {fireHeld: boolean}; weapon: {ammo: number}}[];
  };
};

declare global {
  interface Window {
    inputCaptureEngines: Partial<Record<Mode, EngineProbe>>;
    inputCaptureLegacy?: {requested: number; changes: number; release: (() => void) | null};
    inputCaptureEvents: {type: string; time: number; locked: string | null; fullscreen: boolean; hidden: boolean}[];
  }
}

const selector = (mode: Mode) => mode === 'duel' ? 'canvas[data-duel]' : 'canvas[data-range]';
const enterLabel = (mode: Mode) => mode === 'duel' ? 'Enter duel' : 'Enter range';
const pauseLabel = (mode: Mode) => mode === 'duel' ? 'Pause duel' : 'Pause range';

async function exposeEngine(page: Page, mode: Mode) {
  const path = mode === 'duel' ? '/src/range/duel/DuelEngine.ts' : '/src/range/engine.ts';
  await page.waitForFunction(path => performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname === path), path);
  await page.evaluate(async ({path, mode}) => {
    // Import the fetched URL, including Vite's timestamp, to patch the live class.
    const url = performance.getEntriesByType('resource').reverse().find(entry => new URL(entry.name).pathname === path)!.name;
    const module = await import(/* @vite-ignore */ url);
    const prototype = (mode === 'duel' ? module.DuelEngine : module.RangeEngine).prototype;
    const tick = prototype.tick;
    window.inputCaptureEngines ??= {};
    prototype.tick = function(this: EngineProbe, time: number) {
      window.inputCaptureEngines[mode] = this;
      return tick.call(this, time);
    };
  }, {path, mode});
  await page.waitForFunction(mode => {
    const engine = window.inputCaptureEngines[mode];
    return engine && !engine.disposed && (mode === 'duel' || engine.loadedTarget && engine.modelCache?.has(engine.sim.equipped));
  }, mode);
  await expect(page.getByRole('button', {name: enterLabel(mode), exact: true})).toBeEnabled();
  await page.bringToFront();
}

async function nativeCapabilities(page: Page) {
  const capabilities = await page.evaluate(() => ({
    pointerLock: typeof HTMLElement.prototype.requestPointerLock === 'function' && 'pointerLockElement' in document,
    keyboardLock: typeof (navigator as Navigator & {keyboard?: {lock?: unknown}}).keyboard?.lock === 'function',
  }));
  if (capabilities.pointerLock) {
    // Probe the browser's standard API independently of either engine. The
    // Windows WebKit runner exposes this API but rejects active root documents.
    await page.evaluate(() => {
      const probe = document.createElement('button'); probe.id = 'native-capture-probe'; probe.textContent = 'Capture probe';
      Object.assign(probe.style, {position:'fixed',top:'0',left:'0',zIndex:'99999'});
      const result = (window as any).nativeCaptureProbe = {done:false,error:''};
      const changed = () => {if (document.pointerLockElement === probe) result.done = true;};
      document.addEventListener('pointerlockchange', changed);
      probe.onclick = () => {
        try {const pending = probe.requestPointerLock(); if (pending) pending.catch(error => {result.error = error.name; result.done = true;});}
        catch (error) {result.error = (error as Error).name; result.done = true;}
      };
      (window as any).removeNativeCaptureProbe = () => {document.removeEventListener('pointerlockchange', changed); document.exitPointerLock(); probe.remove();};
      document.body.append(probe);
    });
    await page.locator('#native-capture-probe').click();
    await page.waitForFunction(() => (window as any).nativeCaptureProbe.done);
    const error = await page.evaluate(() => {const error = (window as any).nativeCaptureProbe.error; (window as any).removeNativeCaptureProbe(); return error;});
    await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    test.skip(error === 'WrongDocumentError', 'Browser standard API independently rejects its active root document; native capture cannot be tested in this runner.');
    expect(error, 'Standalone native pointer capture must work before testing engine capture').toBe('');
  }
  return capabilities;
}

async function confirmCapture(page: Page, mode: Mode, fullscreen: boolean) {
  await expect.poll(() => page.evaluate(mode => {
    const engine = window.inputCaptureEngines[mode]!;
    const active = mode === 'duel' ? !engine.paused && engine.sim.phase === 'fighting' : engine.sim.active;
    const input = mode === 'duel' ? engine.inputName : engine.inputStatus;
    return !!active && !engine.entering && /^(Raw|Standard) mouse$/.test(input ?? '') && document.pointerLockElement === engine.renderer.domElement;
  }, mode), {message: `${mode} must own native pointer lock after entry`}).toBe(true);
  await expect(page.getByRole('button', {name: pauseLabel(mode), exact: true})).toBeVisible();
  if (fullscreen) {
    await expect.poll(() => page.evaluate(mode => {
      const engine = window.inputCaptureEngines[mode]!;
      return engine.shortcuts.protected && !!document.fullscreenElement?.contains(engine.renderer.domElement);
    }, mode), {message: 'Keyboard Lock entry must retain fullscreen'}).toBe(true);
  }
}

async function stableCapture(page: Page, mode: Mode, fullscreen: boolean) {
  const observation = await page.evaluate(async ({mode, fullscreen}) => {
    const engine = window.inputCaptureEngines[mode]!;
    const failures: string[] = [];
    let samples = 0;
    const started = performance.now();
    const sample = () => {
      samples++;
      if (document.pointerLockElement !== engine.renderer.domElement) failures.push('Pointer lock lost');
      if (mode === 'duel' ? engine.paused : !engine.sim.active) failures.push('Engine paused');
      if (fullscreen && (!engine.shortcuts.protected || !document.fullscreenElement?.contains(engine.renderer.domElement))) failures.push('Fullscreen/protection lost');
    };
    document.addEventListener('pointerlockchange', sample);
    document.addEventListener('fullscreenchange', sample);
    const timer = setInterval(sample, 20);
    try {
      sample();
      await new Promise(resolve => setTimeout(resolve, 1050));
      sample();
      return {elapsed: performance.now() - started, samples, failures};
    } finally {
      clearInterval(timer);
      document.removeEventListener('pointerlockchange', sample);
      document.removeEventListener('fullscreenchange', sample);
    }
  }, {mode, fullscreen});
  expect(observation.elapsed).toBeGreaterThanOrEqual(1000);
  expect(observation.samples).toBeGreaterThan(2);
  expect(observation.failures).toEqual([]);
}

async function mouseOnlyAim(page: Page, mode: Mode) {
  const snapshot = () => page.evaluate(mode => {
    const engine = window.inputCaptureEngines[mode]!;
    return mode === 'duel'
      ? {yaw: engine.sim.actors[0].yaw, shots: engine.sim.actors[0].weapon.ammo, firing: engine.sim.actors[0].command.fireHeld}
      : {yaw: engine.sim.yaw, shots: engine.sim.shots, firing: engine.sim.firing};
  }, mode);
  const before = await snapshot();
  expect(before.firing).toBe(false);
  // Real mouse movement, with no pointerdown or synthetic movement event.
  await page.mouse.move(420, 320);
  await page.mouse.move(660, 360, {steps: 8});
  await expect.poll(async () => Math.abs((await snapshot()).yaw - before.yaw)).toBeGreaterThan(.0001);
  const after = await snapshot();
  expect(after.shots).toBe(before.shots);
  expect(after.firing).toBe(false);
}

test.beforeEach(async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile') && !info.title.startsWith('mobile entry'), 'Desktop mouse capture regression');
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance', frameLimit: 60, protectShortcuts: true}));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({skill: 1, behavior: 'patient', playerHealth: 500, shortcutProtection: true}));
    window.inputCaptureEvents = [];
    for (const type of ['pointerlockchange', 'pointerlockerror', 'fullscreenchange', 'visibilitychange', 'blur', 'focus']) {
      window.addEventListener(type, () => window.inputCaptureEvents.push({type, time: performance.now(),
        locked: document.pointerLockElement?.outerHTML.slice(0, 150) ?? null,
        fullscreen: !!document.fullscreenElement, hidden: document.hidden}), true);
    }
  });
});

test('mobile entry never requests desktop capture or fullscreen, including after a drill switch', async ({page}, info) => {
  test.skip(!info.project.name.startsWith('mobile'), 'Touch entry regression');
  await page.addInitScript(() => {
    (window as any).captureRequests=0;
    Object.defineProperty(HTMLElement.prototype,'requestPointerLock',{configurable:true,value:()=> {
      (window as any).captureRequests++; return Promise.reject(new DOMException('Not supported on this phone','NotSupportedError'));
    }});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Enter duel',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause duel',exact:true})).toBeVisible();
  await expect(page.locator('.duel-ammo')).toContainText('Touch');
  await page.getByRole('button',{name:'Pause duel',exact:true}).click();
  await page.getByLabel('Training mode').selectOption('guided');
  await exposeEngine(page,'guided');
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause range',exact:true})).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('Touch');
  expect(await page.evaluate(()=>({calls:(window as any).captureRequests,lock:!!document.pointerLockElement,full:!!document.fullscreenElement})))
    .toEqual({calls:0,lock:false,full:false});
  await page.locator('canvas[data-range]').tap();
  await expect.poll(()=>page.evaluate(()=>window.inputCaptureEngines.guided!.sim.shots)).toBeGreaterThan(0);
});

test.afterEach(async ({page}, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const diagnostics = await page.evaluate(() => ({events: window.inputCaptureEvents, documentFocused: document.hasFocus(),
    engines: Object.fromEntries(Object.entries(window.inputCaptureEngines ?? {}).map(([mode, engine]) => [mode, {
      disposed: engine?.disposed, entering: engine?.entering, paused: engine?.paused, active: engine?.sim.active,
      input: engine?.inputName ?? engine?.inputStatus, protected: engine?.shortcuts.protected,
      ownsPointerLock: document.pointerLockElement === engine?.renderer.domElement,
    }])),
  }));
  await info.attach('input-capture-diagnostics', {body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json'});
});

test('duel -> Escape -> guided retains native capture and mouse-only aim', async ({page}) => {
  await page.goto('/');
  const capabilities = await nativeCapabilities(page);
  test.skip(!capabilities.pointerLock, 'Browser does not expose native Pointer Lock');
  await exposeEngine(page, 'duel');
  await page.getByRole('button', {name: 'Enter duel', exact: true}).click();
  await confirmCapture(page, 'duel', capabilities.keyboardLock);
  await mouseOnlyAim(page, 'duel');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume duel', exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null && document.fullscreenElement === null)).toBe(true);
  expect(await page.evaluate(() => window.inputCaptureEngines.duel!.paused)).toBe(true);
  await page.getByLabel('Training mode').selectOption('guided');
  await exposeEngine(page, 'guided');
  expect(await page.evaluate(() => window.inputCaptureEngines.duel!.disposed)).toBe(true);
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await confirmCapture(page, 'guided', capabilities.keyboardLock);
  await stableCapture(page, 'guided', capabilities.keyboardLock);
  await mouseOnlyAim(page, 'guided');
  expect(await page.locator(selector('guided')).evaluate(canvas => document.pointerLockElement === canvas)).toBe(true);
});

for (const mode of ['duel', 'guided'] as const) {
  test(`${mode}: denied desktop capture stays paused with an explicit retry message`, async ({page}) => {
    await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Capture denied by regression fixture', 'NotAllowedError')),
    }));
    await page.goto('/');
    if (mode === 'guided') await page.getByLabel('Training mode').selectOption(mode);
    await exposeEngine(page, mode);
    await page.getByRole('button', {name: enterLabel(mode), exact: true}).click();
    const message = mode === 'duel' ? page.locator('.duel-ammo') : page.locator('.statusbar');
    await expect(message).toContainText(`Mouse capture blocked. Click ${mode === 'duel' ? 'Resume duel' : 'Enter range'} again.`);
    await expect(message).not.toContainText('Drag aim');
    await expect(page.getByRole('button', {name: mode === 'duel' ? 'Resume duel' : 'Enter range', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: pauseLabel(mode), exact: true})).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.pointerLockElement === null && document.fullscreenElement === null)).toBe(true);
    expect(await page.evaluate(mode => {
      const engine = window.inputCaptureEngines[mode]!;
      return (mode === 'duel' ? engine.paused : !engine.sim.active) && !engine.entering && !engine.shortcuts.protected;
    }, mode)).toBe(true);
    const before = await page.evaluate(mode => mode === 'duel' ? window.inputCaptureEngines[mode]!.sim.actors[0].yaw : window.inputCaptureEngines[mode]!.sim.yaw, mode);
    await page.mouse.move(660, 360, {steps: 5});
    await page.waitForTimeout(100);
    expect(await page.evaluate(mode => mode === 'duel' ? window.inputCaptureEngines[mode]!.sim.actors[0].yaw : window.inputCaptureEngines[mode]!.sim.yaw, mode)).toBe(before);
  });

  test(`${mode}: legacy void-return capture waits for the native change event`, async ({page}) => {
    await page.goto('/');
    const capabilities = await nativeCapabilities(page);
    test.skip(!capabilities.pointerLock, 'Browser does not expose native Pointer Lock');
    // Isolate legacy event completion from the separate fullscreen activation path.
    if (mode === 'duel') await page.getByLabel('Protect Ctrl+W', {exact: true}).uncheck();
    else {
      await page.getByLabel('Training mode').selectOption(mode);
      await page.getByRole('button', {name: 'Settings', exact: true}).click();
      await page.getByLabel('Protect range Ctrl+W', {exact: true}).uncheck();
      await page.getByRole('button', {name: 'Done', exact: true}).click();
    }
    await exposeEngine(page, mode);
    await page.evaluate(mode => {
      const canvas = window.inputCaptureEngines[mode]!.renderer.domElement;
      const nativeRequest = canvas.requestPointerLock;
      const legacy = window.inputCaptureLegacy = {requested: 0, changes: 0, release: null as (() => void) | null};
      document.addEventListener('pointerlockchange', () => {legacy.changes++;});
      Object.defineProperty(canvas, 'requestPointerLock', {configurable: true, value: function() {
        legacy.requested++;
        legacy.release = () => {
          // Keep the real browser owner/event; only adapt its return type to void.
          const pending = nativeRequest.call(canvas);
          if (pending && typeof pending.catch === 'function') void pending.catch(() => {});
        };
      }});
    }, mode);
    await page.getByRole('button', {name: enterLabel(mode), exact: true}).click();
    await page.waitForTimeout(150);
    const pending = await page.evaluate(mode => {
      const engine = window.inputCaptureEngines[mode]!;
      return {entering: engine.entering, input: mode === 'duel' ? engine.inputName : engine.inputStatus,
        locked: document.pointerLockElement !== null, requested: window.inputCaptureLegacy!.requested,
        changes: window.inputCaptureLegacy!.changes};
    }, mode);
    expect(pending).toMatchObject({entering: true, locked: false, requested: 1, changes: 0});
    expect(pending.input).not.toMatch(/Raw mouse|Standard mouse|Drag aim|blocked/);
    await page.evaluate(() => window.inputCaptureLegacy!.release!());
    await confirmCapture(page, mode, false);
    expect(await page.evaluate(() => window.inputCaptureLegacy!.changes)).toBeGreaterThan(0);
    const input = mode === 'duel' ? page.locator('.duel-ammo') : page.locator('.statusbar');
    await expect(input).toContainText('Standard mouse');
    await stableCapture(page, mode, false);
    await mouseOnlyAim(page, mode);
  });
}
