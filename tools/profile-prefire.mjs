import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';

const browser = await chromium.launch({channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}}), errors = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('response', response => {if (response.status() >= 400 && response.url().includes('/maps/dust2/')) errors.push(`${response.status()} ${response.url()}`);});
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance', frameLimit: 60})));
  await page.goto(process.env.PREFIRE_URL ?? 'http://127.0.0.1:5176/');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async recordingEnabled => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine} = await import(url), tick = DuelEngine.prototype.tick;
    window.prefireProfile = {engine: null, collecting: false, frames: [], poses: 0, recordingMs: 0, recordingCalls: 0};
    const replayPath = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/combat-replay.ts')).name;
    const {CombatReplay} = await import(replayPath);
    for (const method of ['frame', 'input', 'shot', 'contact']) {
      const original = CombatReplay.prototype[method];
      CombatReplay.prototype[method] = function(...args) {
        if (!recordingEnabled) return;
        const start = performance.now();
        try {return original.apply(this,args);}
        finally {if (window.prefireProfile.collecting) {window.prefireProfile.recordingMs += performance.now() - start; window.prefireProfile.recordingCalls++;}}
      };
    }
    const samplePose = DuelEngine.prototype.sampleActorHitPose;
    DuelEngine.prototype.sampleActorHitPose = function(actor, time) {
      if (window.prefireProfile.collecting) window.prefireProfile.poses++;
      return samplePose.call(this, actor, time);
    };
    DuelEngine.prototype.tick = function(time) {
      const profile = window.prefireProfile; profile.engine = this;
      this.renderer.info.autoReset = false; this.renderer.info.reset();
      const start = performance.now(); tick.call(this, time);
      if (profile.collecting && this.renderer.info.render.calls) profile.frames.push({cpu: performance.now() - start,
        calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles});
    };
  }, !process.argv.includes('--no-recording'));
  await page.getByLabel('Training mode').selectOption('prefire');
  await page.getByLabel('Prefire route').waitFor({timeout: 90000});
  if (process.argv.includes('--combat')) {
    await page.getByLabel('Return fire', {exact: true}).check();
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: Number(process.env.CPU_RATE ?? 1)});
  const results = [];
  const sampleMs = Math.max(1000, Math.min(30000, Number(process.env.PREFIRE_SAMPLE_MS) || 10000));
  await fs.mkdir('research/dust2/views', {recursive: true});
  const routes = (await page.getByLabel('Prefire route').locator('option').evaluateAll(options => options.map(option => option.value)))
    .filter(id => !process.env.PREFIRE_ROUTES || process.env.PREFIRE_ROUTES.split(',').includes(id));
  for (const id of routes) {
    await page.getByLabel('Prefire route').selectOption(id);
    await page.waitForTimeout(900);
    if (process.argv.includes('--active')) {
      await page.evaluate(async combat => {
        const e = window.prefireProfile.engine;
        e.sim.actors[0].health = 10000;
        e.sim.start();
        if (combat) {
          const physicsPath = '/src/range/actor-physics.ts';
          const {UNIT, STEP} = await import(physicsPath);
          let waypoint = 0;
          const points = e.sim.route.path.map(p => ({x: p[0] * UNIT, y: p[2] * UNIT, z: -p[1] * UNIT}));
          while (e.sim.time < 8 && e.sim.phase === 'fighting') {
            const p = e.sim.actors[0], target = points[waypoint], dx = target.x - p.position.x, dz = target.z - p.position.z;
            const distance = Math.hypot(dx, dz), speed = Math.hypot(p.velocity.x, p.velocity.z), yaw = Math.atan2(-dx, -dz);
            let forward = 1;
            if (distance < .18 && speed < .12) {waypoint = Math.min(waypoint + 1, points.length - 1); forward = 0;}
            else if (distance < .1 + speed * .075) forward = speed > .12 ? -1 : 0;
            e.sim.command(0, {forward, side: 0, walk: true, yawDelta: Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw))});
            e.sim.step(); e.sim.drainEvents();
          }
          e.sim.command(0, {forward: 0, side: 0});
        }
      }, process.argv.includes('--combat'));
      if (process.argv.includes('--shoot')) await page.evaluate(() => window.prefireProfile.engine.sim.command(0, {fireHeld: true, firePressed: true}));
      await page.waitForTimeout(process.argv.includes('--shoot') ? 500 : 1500);
    }
    await page.evaluate(async () => {
      const p = window.prefireProfile, path = '/src/range/performance.ts';
      const {FrameMetrics} = await import(path);
      p.engine.metrics = new FrameMetrics();
      p.frames.length = 0; p.poses = 0; p.recordingMs = p.recordingCalls = 0; p.collecting = true;
    });
    await page.waitForTimeout(sampleMs);
    results.push(await page.evaluate(id => {
      const p = window.prefireProfile; p.collecting = false;
      const quantile = (key, q) => {const values = p.frames.map(f => f[key]).sort((a,b) => a-b); return +(values[Math.floor((values.length - 1) * q)] ?? 0).toFixed(2);};
      return {id, phase: p.engine.sim.phase, frames: p.frames.length, poseSamples: p.poses,
        botContacts: p.engine.sim.actors.slice(1).filter(a => p.engine.sim.prefireBotDecision(a.id)?.visible).length,
        cpu50: quantile('cpu', .5), cpu95: quantile('cpu', .95), cpu99: quantile('cpu', .99),
        drawCalls: quantile('calls', .5), triangles: quantile('triangles', .5), textures: p.engine.renderer.info.memory.textures,
        recording: {calls: p.recordingCalls, milliseconds: p.recordingMs,
          millisecondsPerFrame: p.recordingMs / Math.max(1,p.frames.length),
          note: 'Recorder method time only; excludes shared shot/sensor pose preparation.'},
        performance: p.engine.performanceReport()};
    }, id));
    await page.locator('canvas[aria-label="Dust 2 prefire map"]').screenshot({path: `research/dust2/views/${id}.png`});
  }
  const report = process.env.PREFIRE_REPORT ?? 'research/dust2/profile.json';
  const graphics = await page.evaluate(() => {
    const gl = window.prefireProfile.engine.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {userAgent: navigator.userAgent, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable'};
  });
  await fs.writeFile(report, JSON.stringify({schemaVersion: 2,
    environment: {browser: await browser.version(), headless: true, cpu: os.cpus()[0]?.model,
      logicalCpus: os.availableParallelism(), platform: `${os.platform()} ${os.release()}`, graphics,
      note: 'Local automated browser workload; other application load is not controlled. CPU throttling is not old-PC validation.'},
    sampleMs, cpuRate: Number(process.env.CPU_RATE ?? 1), combat: process.argv.includes('--combat'),
    playerShooting: process.argv.includes('--shoot'), recordingEnabled: !process.argv.includes('--no-recording'), results, errors}, null, 2));
  console.log(JSON.stringify({results: results.map(({performance, ...row}) => ({...row, frameTimes: performance.summary})), errors}, null, 2));
  if (errors.length) throw new Error('Native map browser errors occurred.');
} finally {await browser.close();}
