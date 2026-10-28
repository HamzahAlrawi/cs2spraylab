import {preview} from 'vite';
import {chromium, expect} from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs/promises';

const server = await preview({preview: {host: '127.0.0.1', port: 0, strictPort: false}, logLevel: 'error'});
const browser = await chromium.launch({channel: 'chromium'});
const results = [], errors = [];
try {
  await fs.mkdir('test-results', {recursive: true});
  const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
  for (const viewport of [{width: 1440, height: 1000}, {width: 412, height: 915}]) {
    const context = await browser.newContext({viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700});
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.stack ?? error.message));
      page.on('response', response => {if (response.status() >= 400 && new URL(response.url()).origin === new URL(base).origin) errors.push(`${response.status()} ${response.url()}`);});
      await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', volume: 0, quality: 'performance', frameLimit: 60})));
      await page.goto(base);
      for (const mode of ['guided', 'spray', 'transfer', 'peek', 'precision', 'burst', 'duel', 'hearing', 'prefire']) {
        await page.getByLabel('Training mode').selectOption(mode);
        const view = mode === 'hearing' ? page.getByRole('region', {name: 'Hearing practice', exact: true})
          : page.locator(mode === 'duel' || mode === 'prefire' ? 'canvas[data-duel]' : 'canvas[data-range]');
        await view.waitFor({state: 'visible', timeout: 90000});
        if (mode === 'guided') await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 30000});
        if (mode === 'prefire') {
          const setup = page.getByRole('button', {name: 'Show drill panel', exact: true});
          if (await setup.isVisible()) await setup.click();
          await expect(page.getByLabel('Prefire route')).toBeVisible();
        }
        if (mode !== 'hearing') await expect.poll(async () => {
          const pixels = await sharp(await view.screenshot()).stats();
          return pixels.channels.slice(0,3).some(channel => channel.stdev > 10);
        }, {timeout: 30000}).toBe(true);
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal overflow: ${mode} / ${viewport.width}`);
        results.push({mode, viewport, visible: true});
        if (mode === 'prefire' || mode === 'guided') await page.screenshot({path: `test-results/production-${mode}-${viewport.width}.png`, fullPage: true});
      }
      // Drains asynchronous shader warmups after the rapid mode teardown above.
      await page.waitForTimeout(1500);
    } finally {await context.close();}
  }
  await fs.writeFile('test-results/production-smoke.json', JSON.stringify({browser: await browser.version(), results, errors}, null, 2));
  console.log(JSON.stringify({checks: results.length, errors}, null, 2));
  if (errors.length) throw new Error('Production smoke produced browser or asset errors.');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
