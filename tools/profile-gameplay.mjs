import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';

const label = process.argv[2] ?? 'current';
const rate = Number(process.env.CPU_RATE ?? 4);
const browser = await chromium.launch({channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const errors = [];
  page.on('pageerror', error => {errors.push(error.stack ?? error.message); console.error(error.stack ?? error.message);});
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', sidearm: 'deagle', primaryEnabled: false, volume: 0})));
  await page.goto(process.env.GAMEPLAY_URL ?? 'http://127.0.0.1:5179');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/range/engine.ts'))?.name;
    const {RangeEngine} = await import(url ?? '/src/range/engine.ts');
    const original = RangeEngine.prototype.tick;
    window.gameplayProfile = {records: [], engine: null, collect: false, parts: {}};
    const measure = (owner, name) => {
      const fn = owner[name];
      owner[name] = function(...args) {
        const start = performance.now();
        try {return fn.apply(this, args);} finally {
          const p = window.gameplayProfile.parts;
          p[name] = (p[name] ?? 0) + performance.now() - start;
        }
      };
    };
    let previous = 0;
    RangeEngine.prototype.tick = function(time) {
      const profile = window.gameplayProfile;
      if (profile.engine !== this) {
        profile.engine = this;
        measure(this.sim, 'advance'); measure(this.sim, 'predictedRecoil'); measure(this, 'castTargets'); measure(this.renderer, 'render');
      }
      this.renderer.info.autoReset = false; this.renderer.info.reset();
      profile.parts = {};
      const start = performance.now();
      original.call(this, time);
      if (profile.collect && this.renderer.info.render.calls) profile.records.push({frame: time - previous, total: performance.now() - start,
        ...profile.parts, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles});
      if (this.renderer.info.render.calls) previous = time;
    };
  });
  try {await page.waitForFunction(() => {
    const e = window.gameplayProfile?.engine; return e?.loadedTarget && e.modelCache.has(e.sim.equipped);
  });} catch (error) {
    await fs.mkdir('test-results', {recursive: true});
    await page.screenshot({path: `test-results/gameplay-profile-${label}-crash.png`});
    console.log(JSON.stringify({errors, text: await page.locator('body').innerText(), state: await page.evaluate(() => {
      const e = window.gameplayProfile?.engine; return e ? {loaded: e.loadedTarget, assets: e.assetStatus, equipment: e.sim.equipped} : null;
    })}, null, 2));
    throw error;
  }
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', {rate});
  const results = [];
  for (const [weapon, quality] of [['deagle', 'auto'], ['ak47', 'auto'], ['ak47', 'low'], ['ak47', 'performance']]) {
    await page.evaluate(({weapon, quality}) => {
      const {engine: e} = window.gameplayProfile;
      e.configure({...e.sim.settings, weapon, sidearm: weapon === 'deagle' ? 'deagle' : 'usp', primaryEnabled: weapon !== 'deagle', quality, frameLimit:quality === 'performance' ? 60 : 0});
    }, {weapon, quality});
    await page.waitForFunction(() => {
      const e = window.gameplayProfile.engine; return e.loadedTarget && e.modelCache.has(e.sim.equipped);
    });
    await page.evaluate(() => {
      const p = window.gameplayProfile, e = p.engine;
      e.sim.reset(); e.sim.active = true;
      window.profileFire = setInterval(() => {
        if (!e.sim.firing && !e.sim.pistolReloadAt && !e.sim.primaryReloadAt) e.sim.start();
      }, 40);
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {window.gameplayProfile.records.length = 0; window.gameplayProfile.collect = true;});
    await page.waitForTimeout(4500);
    results.push(await page.evaluate(({weapon, quality, rate}) => {
      const p = window.gameplayProfile, e = p.engine; p.collect = false; clearInterval(window.profileFire); e.pause();
      const percentile = (values, q) => {
        values.sort((a, b) => a - b); return Math.round((values[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0) * 100) / 100;
      };
      const gl = e.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {weapon, quality, rate, frames: p.records.length, renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        metrics: Object.fromEntries(['frame', 'total', 'advance', 'predictedRecoil', 'castTargets', 'render', 'calls', 'triangles'].map(key => [key,
          {p50: percentile(p.records.map(r => r[key] ?? 0), .5), p95: percentile(p.records.map(r => r[key] ?? 0), .95), p99: percentile(p.records.map(r => r[key] ?? 0), .99)}]))};
    }, {weapon, quality, rate}));
  }
  await fs.mkdir('test-results', {recursive: true});
  const report = {results, errors};
  await fs.writeFile(`test-results/gameplay-profile-${label}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {await browser.close();}
