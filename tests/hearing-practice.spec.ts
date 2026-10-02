import {expect, test, type Page} from '@playwright/test';

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const audit = {starts: 0, stops: 0, live: 0, decoded: 0, models: [] as string[]};
    (window as any).hearingAudioAudit = audit;
    const Context = window.AudioContext || (window as any).webkitAudioContext;
    if (!Context) return;
    const bufferSource = Context.prototype.createBufferSource;
    Context.prototype.createBufferSource = function() {
      const source = bufferSource.call(this), start = source.start.bind(source), stop = source.stop.bind(source);
      let live = false;
      const end = () => {if (live) {audit.live--; live = false;}};
      source.addEventListener('ended', end);
      source.start = (...args: any[]) => {audit.starts++; audit.live++; live = true; start(...args);};
      source.stop = (...args: any[]) => {audit.stops++; end(); stop(...args);};
      return source;
    };
    const decode = Context.prototype.decodeAudioData;
    Context.prototype.decodeAudioData = function(...args: any[]) {
      audit.decoded++; return decode.apply(this, args);
    };
    const panner = Context.prototype.createPanner;
    Context.prototype.createPanner = function() {
      const node = panner.call(this), connect = node.connect.bind(node);
      node.connect = (...args: any[]) => {audit.models.push(node.panningModel); return connect(...args);};
      return node;
    };
  });
  // Vite processes bare imports for a single React instance, including cold starts.
  await page.goto('/tests/hearing-host.html');
  await expect(page.getByRole('heading', {name: 'Hearing practice'})).toBeVisible();
  return errors;
}
test.beforeEach(async ({page}, info) => {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function' || typeof (window as any).webkitAudioContext === 'function');
  test.skip(!available && !info.title.startsWith('missing native audio'), 'This browser build omits Web Audio; unavailable-audio handling is tested separately.');
});
async function start(page: Page) {
  await page.getByRole('button', {name: /Start listening|New sound|Next sound/}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
}
const audit = (page: Page) => page.evaluate(() => (window as any).hearingAudioAudit);

test('native HRTF playback keeps target hidden until a click, stops on answer, saves bounded history', async ({page}, info) => {
  const errors = await setup(page);
  await page.getByLabel('Sounds', {exact: true}).selectOption('steps');
  await start(page);
  await expect(page.getByLabel('Actual sound position', {exact: true})).toHaveCount(0);
  const before = await audit(page);
  expect(before.decoded).toBeGreaterThan(0); expect(before.models).toContain('HRTF');
  const board = page.getByRole('group', {name: 'Overhead range board'}), box = (await board.boundingBox())!;
  await board.click({position: {x: box.width * .7, y: box.height * .35}});
  await expect(page.getByLabel('Actual sound position', {exact: true})).toBeVisible();
  await expect(page.getByText('Direction error', {exact: true})).toBeVisible();
  await expect(page.getByText('Distance error', {exact: true})).toBeVisible();
  const answered = await audit(page); expect(answered.live).toBe(0);
  await page.waitForTimeout(1500); expect((await audit(page)).starts).toBe(answered.starts);
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.hearing.history.v1')!));
  expect(rows).toHaveLength(1); expect(rows[0].score).toBeGreaterThanOrEqual(0); expect(rows[0].score).toBeLessThanOrEqual(100);
  await page.getByRole('button', {name: 'Replay sound', exact: true}).click();
  await expect.poll(async () => (await audit(page)).starts).toBeGreaterThan(answered.starts);
  await page.getByRole('button', {name: 'Next sound', exact: true}).click();
  await expect(page.getByLabel('Actual sound position', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  await page.getByLabel('Estimated bearing').fill('359');
  await page.getByLabel('Estimated distance').fill('9');
  await page.getByRole('button', {name: 'Confirm estimate'}).click();
  await page.locator('.hearing-practice').screenshot({path: info.outputPath('hearing.png')});
  expect(errors).toEqual([]);
});

test('configuration persists, listener rotates and mono switches to distance-only scoring', async ({page}) => {
  const errors = await setup(page);
  await page.getByLabel('Sounds', {exact: true}).selectOption('shots');
  await page.getByLabel('Surface', {exact: true}).selectOption('wood');
  await page.getByLabel('Gun', {exact: true}).selectOption('m4a1s');
  await page.getByLabel('Spatial audio', {exact: true}).selectOption('equalpower');
  await page.getByLabel('Distance falloff', {exact: true}).selectOption('calibrated');
  await page.getByLabel('Output device', {exact: true}).selectOption('mono');
  await page.getByLabel('Scoring', {exact: true}).selectOption('direction');
  await page.getByLabel('Mix muffled sounds').check();
  await page.getByLabel('Audio level', {exact: true}).evaluate((input: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '35');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await expect(page.getByText(/Left\/right cannot be learned/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Gun', {exact: true})).toHaveValue('m4a1s');
  await expect(page.getByLabel('Distance falloff', {exact: true})).toHaveValue('calibrated');
  await expect(page.getByLabel('Audio level', {exact: true})).toHaveValue('35');
  await expect(page.getByLabel('Output device', {exact: true})).toHaveValue('mono');
  await page.getByRole('button', {name: 'far', exact: true}).click();
  await expect.poll(async () => (await audit(page)).starts).toBeGreaterThan(0);
  await start(page);
  await page.getByRole('button', {name: 'Turn listener right 90 degrees'}).click();
  await expect(page.getByText('Facing 90°', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  const board = page.getByRole('group', {name: 'Overhead range board'});
  await board.focus(); await board.press('ArrowRight'); await board.press('ArrowUp'); await board.press('Enter');
  await expect(page.getByLabel('Actual sound position', {exact: true})).toBeVisible();
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.hearing.history.v1')!));
  expect(rows[0].scoring).toBe('distance'); expect(rows[0].replays).toBe(1);
  expect((await audit(page)).models).toContain('equalpower'); expect(errors).toEqual([]);
});

test('suspension, visibility, replay races, muting and unmount stop native voices', async ({page}) => {
  const errors = await setup(page);
  await page.getByLabel('Sounds', {exact: true}).selectOption('steps');
  await start(page);
  await page.getByRole('button', {name: 'Replay sound', exact: true}).click();
  await page.getByRole('button', {name: 'Range audio settings'}).click();
  const paused = await audit(page); expect(paused.live).toBe(0);
  await page.waitForTimeout(1500); expect((await audit(page)).starts).toBe(paused.starts);
  await page.evaluate(() => (window as any).hearingProps({suspended: false}));
  await page.getByRole('button', {name: 'Replay sound', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await audit(page); expect(hidden.live).toBe(0);
  await page.waitForTimeout(1500); expect((await audit(page)).starts).toBe(hidden.starts);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange'));
    (window as any).hearingProps({volume: 0});
  });
  await expect(page.getByText(/Audio muted/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Replay sound', exact: true})).toBeDisabled();
  await page.evaluate(() => (window as any).hearingProps({volume: .5}));
  await page.getByRole('button', {name: 'Replay sound', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  await page.evaluate(() => (window as any).unmountHearing());
  const unmounted = await audit(page); expect(unmounted.live).toBe(0);
  await page.waitForTimeout(1500); expect((await audit(page)).starts).toBe(unmounted.starts); expect(errors).toEqual([]);
});

test('native spatial render has directional energy, distance falloff and identical mono channels', async ({page}) => {
  const errors = await setup(page);
  const rendered = await page.evaluate(async () => {
    const {spatialChain, positionListener} = await import(/* @vite-ignore */ '/src/range/spatial-audio.ts');
    const bytes = await (await fetch('/audio/native/step-concrete-0.wav')).arrayBuffer();
    async function render(distance: number, mono = false, yaw = 0, panningModel: PanningModelType = 'HRTF', occluded = false) {
      const context = new OfflineAudioContext(2, 48000, 48000);
      positionListener(context, {x: 0, y: 0, z: 0}, yaw, 0);
      const chain = spatialChain(context, {position: {x: distance, y: 0, z: -1}, occluded}, {monoOutput: mono, panningModel});
      const voice = context.createBufferSource(); voice.buffer = await context.decodeAudioData(bytes.slice(0));
      voice.connect(chain.input); chain.output.connect(context.destination); voice.start();
      const output = await context.startRendering(), left = output.getChannelData(0), right = output.getChannelData(1);
      let l = 0, r = 0, difference = 0;
      for (let i = 0; i < left.length; i++) {l += left[i] ** 2; r += right[i] ** 2; difference = Math.max(difference, Math.abs(left[i] - right[i]));}
      chain.dispose(); voice.disconnect(); return {l, r, difference};
    }
    return {right: await render(8), turned: await render(8, false, Math.PI), near: await render(4), far: await render(24),
      mono: await render(8, true), equalpower: await render(8, false, 0, 'equalpower'), muffled: await render(8, false, 0, 'HRTF', true)};
  });
  expect(rendered.right.r).toBeGreaterThan(rendered.right.l * 1.2);
  expect(rendered.turned.l).toBeGreaterThan(rendered.turned.r * 1.2);
  expect(rendered.near.l + rendered.near.r).toBeGreaterThan((rendered.far.l + rendered.far.r) * 3);
  expect(rendered.mono.difference).toBeLessThan(.000001); expect(rendered.mono.l).toBeGreaterThan(0);
  expect(rendered.equalpower.r).toBeGreaterThan(rendered.equalpower.l);
  expect(rendered.muffled.l + rendered.muffled.r).toBeLessThan(rendered.right.l + rendered.right.r);
  expect(errors).toEqual([]);
});

test('missing native audio reports failure and never accepts a silent answer', async ({page}) => {
  const errors = await setup(page);
  await page.route('**/audio/events.json', route => route.fulfill({status: 404, body: 'missing'}));
  await page.getByRole('button', {name: 'Start listening'}).click();
  await expect(page.getByText(/Audio unavailable/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeDisabled();
  await expect(page.getByLabel('Actual sound position', {exact: true})).toHaveCount(0);
  expect((await audit(page)).starts).toBe(0); expect(errors).toEqual([]);
});

test('320px touch board and controls fit without horizontal overflow', async ({page}, info) => {
  const errors = await setup(page);
  await page.setViewportSize({width: 320, height: 740});
  await start(page);
  const board = page.getByRole('group', {name: 'Overhead range board'}), box = (await board.boundingBox())!;
  if (info.project.use.hasTouch) await page.touchscreen.tap(box.x + box.width * .8, box.y + box.height * .4);
  else await board.click({position: {x: box.width * .8, y: box.height * .4}});
  await expect(page.getByLabel('Actual sound position', {exact: true})).toBeVisible();
  const overflow = await page.evaluate(() => {
    const root = document.querySelector('.hearing-practice')!;
    return {root: root.scrollWidth > root.clientWidth, page: document.documentElement.scrollWidth > innerWidth};
  });
  expect(overflow).toEqual({root: false, page: false});
  await page.screenshot({path: info.outputPath('hearing-320.png')}); expect(errors).toEqual([]);
});

test('integrated drill releases 3D resources and stops playback across settings and mode switches', async ({page}, info) => {
  const errors = await setup(page);
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'duel', volume:.7, quality:'performance'})));
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.getByLabel('Training mode').selectOption('hearing');
  await expect(page.locator('canvas[data-duel],canvas[data-range]')).toHaveCount(0);
  await expect(page.getByLabel('Distance falloff')).toHaveValue('native');
  await expect(page.getByRole('button', {name:'Reset range', exact:true})).toHaveCount(0);
  await page.getByLabel('Sounds', {exact:true}).selectOption('steps');
  await start(page);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  expect((await audit(page)).live).toBe(0);
  await page.getByRole('button', {name:'Done', exact:true}).click();
  await page.getByRole('button', {name:'Replay sound', exact:true}).click();
  await expect(page.getByRole('button', {name:'Confirm estimate'})).toBeEnabled();
  await page.getByLabel('Training mode').selectOption('guided');
  const stopped = await audit(page); expect(stopped.live).toBe(0);
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.waitForTimeout(1500); expect((await audit(page)).starts).toBe(stopped.starts);
  await page.getByLabel('Training mode').selectOption('hearing');
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({path:info.outputPath('integrated-hearing-320.png')});
  expect(errors).toEqual([]);
});
