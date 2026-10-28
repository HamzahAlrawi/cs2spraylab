import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
import sharp from 'sharp';

const browser = await chromium.launch({channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}}), errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('http://127.0.0.1:5176/');
  await page.locator('canvas[data-duel]').waitFor();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine} = await import(url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time) {window.layoutEngine = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => !!window.layoutEngine);
  const designs = await page.getByLabel('Map layout', {exact: true}).locator('option').evaluateAll(options => options.map(option => option.value).filter(value => value !== 'random'));
  await fs.mkdir('research/duel-layouts', {recursive: true});
  for (const design of designs) {
    await page.getByLabel('Map layout', {exact: true}).selectOption(design);
    await page.waitForFunction(design => window.layoutEngine.sim.arena.design === design, design);
    await page.waitForTimeout(350);
    const metadata = await page.evaluate(async () => {
      const {Plane, Vector3} = await import('/node_modules/.vite/deps/three.js');
      const e = window.layoutEngine, a = e.sim.arena;
      // Render a QA-only overview through a separate camera; gameplay state is untouched.
      const camera = e.camera.clone(), canvas = e.renderer.domElement;
      camera.aspect = canvas.width / canvas.height; camera.fov = 65;
      camera.position.set(0, 27, 10); camera.lookAt(0, 0, -4); camera.updateProjectionMatrix();
      const autoClear = e.renderer.autoClear;
      const clippingPlanes = e.renderer.clippingPlanes;
      e.renderer.autoClear = true;
      // The warehouse roof otherwise hides the entire arena from above.
      e.renderer.clippingPlanes = [new Plane(new Vector3(0, -1, 0), 5.3)];
      e.renderer.setViewport(0, 0, e.width, e.height);
      e.renderer.render(e.scene, camera);
      const imageData = canvas.toDataURL('image/png').split(',')[1];
      e.renderer.autoClear = autoClear;
      e.renderer.clippingPlanes = clippingPlanes;
      return {seed: a.seed, design: a.design, solids: a.solids.length, lanes: a.lanes.length,
        roles: a.pois.map(poi => poi.placement?.role), templates: a.pois.map(poi => poi.templateId),
        imageData};
    });
    const screenshot = Buffer.from(metadata.imageData, 'base64');
    delete metadata.imageData;
    const stats = await sharp(screenshot).stats();
    const nonblank = stats.channels.slice(0, 3).every(channel => channel.stdev > 10);
    if (!nonblank) throw new Error(`Blank layout: ${design}`);
    await fs.writeFile(`research/duel-layouts/${design.toLowerCase().replaceAll(' ', '-')}.png`, screenshot);
    results.push({...metadata, nonblank});
  }
  await fs.writeFile('research/duel-layouts/overview.json', JSON.stringify({results, errors}, null, 2));
  console.log(JSON.stringify({results, errors}, null, 2));
  if (errors.length) throw new Error('Arena preview browser errors');
} finally {await browser.close();}
