import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';

const url = process.env.DUEL_URL ?? 'http://127.0.0.1:5178';
const label = process.argv[2] ?? 'current';
const browser = await chromium.launch({channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required']});
try {
  await fs.mkdir('test-results', {recursive: true});
  const page = await browser.newPage({viewport: {width: Number(process.argv[3] ?? 1920), height: Number(process.argv[4] ?? 1080)}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('canvas[data-duel]').waitFor();
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))?.name;
    const {DuelEngine} = await import(moduleUrl ?? '/src/range/duel/DuelEngine.ts');
    const original = DuelEngine.prototype.tick;
    const records = [], gpu = [];
    let last = 0;
    window.duelProfile = {records, gpu, engine: null, collect: false};
    DuelEngine.prototype.tick = function(timestamp) {
      const profile = window.duelProfile;
      profile.engine = this;
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      profile.renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      this.renderer.info.autoReset = false;
      this.renderer.info.reset();
      let render = 0, actors = 0, sim = 0;
      const measure = (owner, name, add) => {
        const fn = owner[name];
        owner[name] = function(...args) {const start = performance.now(); const result = fn.apply(this, args); add(performance.now() - start); return result;};
        return () => {owner[name] = fn;};
      };
      const restores = [measure(this.renderer, 'render', ms => {render += ms;}),
        measure(this, 'syncActors', ms => {actors += ms;}), measure(this.sim, 'advance', ms => {sim += ms;})];
      const query = ext && profile.collect ? gl.createQuery() : null;
      if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      const start = performance.now();
      original.call(this, timestamp);
      const total = performance.now() - start;
      if (query) {gl.endQuery(ext.TIME_ELAPSED_EXT); gpu.push({query, ext});}
      restores.forEach(restore => restore());
      if (profile.collect) {
        records.push({frame: timestamp - last, total, render, actors, sim,
          calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
          geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
          visibleBots: [...this.models.values()].filter(model => model.visible).length});
      }
      last = timestamp;
    };
  });
  await page.waitForFunction(() => window.duelProfile?.engine?.motionReady && window.duelProfile.engine.viewRoot.children.length);
  await page.evaluate(async () => {
    const {engine} = window.duelProfile;
    await engine.audio.unlock(engine.settings.weapon);
  });
  const results = [];
  for (const botCount of [1, 5]) {
    await page.evaluate(count => {
      const {engine} = window.duelProfile;
      engine.seed = 104;
      engine.setConfig({...engine.config, botCount: count, skill: 5});
      engine.sim.actors[0].health = 100000;
      engine.sim.start();
    }, botCount);
    // Covered spawns need time to develop into fights before measuring steady-state play.
    await page.waitForTimeout(12000);
    await page.evaluate(() => {window.duelProfile.records.length = 0; window.duelProfile.collect = true;});
    await page.waitForTimeout(6500);
    results.push(await page.evaluate(count => {
      const p = window.duelProfile;
      p.collect = false;
      const gl = p.engine.renderer.getContext();
      const gpuMs = [];
      for (const {query, ext} of p.gpu) {
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        }
        gl.deleteQuery(query);
      }
      p.gpu.length = 0;
      const stats = values => {
        values.sort((a, b) => a - b);
        return Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99]].map(([key, q]) => [key,
          Math.round((values[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0) * 100) / 100]));
      };
      return {botCount: count, renderer: p.renderer, frames: p.records.length, audioState: p.engine.audio.context?.state,
        elapsed: p.engine.sim.time, phase: p.engine.sim.phase, damageTaken: p.engine.sim.coach.taken,
        canvas: {width: gl.drawingBufferWidth, height: gl.drawingBufferHeight},
        metrics: Object.fromEntries(['frame', 'total', 'render', 'actors', 'sim', 'calls', 'triangles', 'geometries', 'textures', 'visibleBots']
          .map(key => [key, stats(p.records.map(record => record[key]))])), gpuMs: stats(gpuMs)};
    }, botCount));
    await page.screenshot({path: `test-results/duel-profile-${label}-${botCount}.png`});
  }
  await fs.mkdir('test-results', {recursive: true});
  await fs.writeFile(`test-results/duel-profile-${label}.json`, JSON.stringify({results, errors}, null, 2));
  console.log(JSON.stringify({results, errors}, null, 2));
} finally {await browser.close();}
