import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

const chunk = 'dust2-mid-ct';
const isMap = (url: string) => new URL(url).pathname.startsWith('/maps/');

async function observeEngine(page: Page) {
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {
      if ((window as any).diskCacheEngine !== this) {
        (window as any).diskCacheEngine = this;
        (window as any).diskCacheWorld = {frames: 0, calls: 0, triangles: 0};
        const render = this.renderer.render.bind(this.renderer);
        this.renderer.render = (scene: any, camera: any) => {
          const result = render(scene, camera);
          if (scene === this.scene && camera === this.camera && this.sim.phase === 'fighting' && !this.paused) {
            const audit = (window as any).diskCacheWorld;
            audit.frames++; audit.calls = this.renderer.info.render.calls; audit.triangles = this.renderer.info.render.triangles;
          }
          return result;
        };
      }
      return tick.call(this, time);
    };
  });
  await page.waitForFunction(() => {
    const e = (window as any).diskCacheEngine;
    return e?.criticalReady && !e.loadingMap && e.scenario?.chunk.id === 'dust2-mid-ct';
  });
  await expect(page.getByRole('button', {name: 'Enter duel', exact: true})).toBeVisible();
}

async function settleCaches(page: Page) {
  await page.evaluate(async () => {
    const engineUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const assets = await import(/* @vite-ignore */ new URL('../prefire/asset-delivery.ts', engineUrl).href);
    const queries = await import(/* @vite-ignore */ new URL('../prefire/query-cache.ts', engineUrl).href);
    await assets.settleAssetCache();
    await queries.settleQueryCache();
  });
}

test('real Duel chunk survives a fresh JS realm and code identity with only CacheStorage map bytes', async ({page, context}, info) => {
  test.skip(info.project.name !== 'chromium');
  test.setTimeout(120000);
  const errors: string[] = [], downloaded = new Set<string>(), blocked: string[] = [], network: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (isMap(response.url()) && response.ok()) downloaded.add(new URL(response.url()).pathname);
  });
  // Seed only this isolated test context's first document, never overwrite saves on reload.
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, realMapChunk: 'dust2-mid-ct'}));
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', quality: 'performance', volume: 0}));
    localStorage.setItem('duel-disk-cache.save-sentinel', 'keep-player-data');
    (window as any).warmDocumentOnly = true;
  });
  await page.goto('/');
  await observeEngine(page);
  await page.getByRole('button', {name: 'Enter duel', exact: true}).click();
  await page.waitForFunction(() => (window as any).diskCacheWorld?.frames > 1);
  // Loading the real scene warms collision, navigation, geometry, textures, context and radar.
  await settleCaches(page);
  const warm = await page.evaluate(async () => {
    const keys = (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(key => key.url)))).flat();
    const e = (window as any).diskCacheEngine;
    return {mapKeys: keys.filter(url => new URL(url).pathname.startsWith('/maps/')).map(url => new URL(url).pathname).sort(),
      queryKeys: keys.filter(url => new URL(url).pathname.startsWith('/__spraylab_queries__/')).sort(),
      collision: e.sim.arena.native.collisionSha256, chunk: e.scenario.chunk.id};
  });
  expect(warm.chunk).toBe(chunk);
  expect(downloaded.size, 'first visit must download real chunk resources').toBeGreaterThan(5);
  expect(warm.mapKeys.length).toBeGreaterThan(5);
  for (const path of downloaded) expect(warm.mapKeys, `download persisted: ${path}`).toContain(path);
  for (const path of warm.mapKeys) expect(path).toMatch(/^\/maps\/dust2\/duel\/objects\/[a-f0-9]{64}\.(bin|gz)$/);
  expect(warm.queryKeys.some(url => url.endsWith(`/${warm.collision}`)), 'prepared query snapshot must finish persisting').toBe(true);
  // Closing the owner destroys JS maps, decoded scenes and in-flight workers.
  await page.close();

  await context.route(url => url.pathname.startsWith('/maps/'), async route => {
    blocked.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  const reloaded = await context.newPage();
  reloaded.on('pageerror', error => errors.push(error.message));
  context.on('request', request => {if (isMap(request.url())) network.push(request.url());});
  const cdp = await context.newCDPSession(reloaded);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  await cdp.send('Network.setBypassServiceWorker', {bypass: true});
  await reloaded.addInitScript(() => {
    (window as any).diskCacheHits = [];
    const match = Cache.prototype.match;
    Cache.prototype.match = async function(request, options) {
      const response = await match.call(this, request, options);
      const url = new URL(typeof request === 'string' ? request : request.url, location.href);
      if (response?.ok) (window as any).diskCacheHits.push(url.pathname);
      return response;
    };
  });
  await reloaded.goto('/?disk-cache-release=next');
  expect(await reloaded.evaluate(() => (window as any).warmDocumentOnly)).toBeUndefined();
  await observeEngine(reloaded);
  await expect(reloaded.locator('canvas[data-duel]')).toBeVisible();
  await reloaded.getByRole('button', {name: 'Enter duel', exact: true}).click();
  await reloaded.waitForFunction(() => {
    const e = (window as any).diskCacheEngine, rendered = (window as any).diskCacheWorld;
    return e?.sim.phase === 'fighting' && e.sim.time > 0 && rendered?.frames > 1 && rendered.calls > 0 && rendered.triangles > 0;
  });
  const restored = await reloaded.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {collisionPreparationReport} = await import(/* @vite-ignore */ new URL('../prefire/collision-preparation.ts', url).href);
    const e = (window as any).diskCacheEngine;
    return {chunk: e.scenario.chunk.id, selection: e.config.realMapChunk, collision: e.sim.arena.native.collisionSha256,
      bots: e.sim.actors.length - 1, hits: [...new Set<string>((window as any).diskCacheHits)],
      queries: collisionPreparationReport(), sentinel: localStorage.getItem('duel-disk-cache.save-sentinel')};
  });
  expect(restored).toMatchObject({chunk, selection: chunk, collision: warm.collision, bots: 1, sentinel: 'keep-player-data'});
  expect(restored.queries).toEqual([expect.objectContaining({sha256: warm.collision, source: 'disk'})]);
  for (const path of warm.mapKeys) expect(restored.hits, `fresh realm read from CacheStorage: ${path}`).toContain(path);
  const pixels = await sharp(await reloaded.locator('canvas[data-duel]').screenshot({path: info.outputPath('cached-duel-gameplay.png')})).stats();
  expect(pixels.channels.slice(0, 3).every(channel => channel.stdev > 10), 'rendered gameplay must not be blank').toBe(true);

  // A distinct module URL models a new code identity, not an actual deployed release.
  // Unchanged content hashes must still reuse disk bytes; incompatibility rules have unit coverage.
  const releaseReuse = await reloaded.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const assetUrl = new URL('../prefire/asset-delivery.ts', url);
    const original = await import(/* @vite-ignore */ assetUrl.href);
    assetUrl.searchParams.set('disk-cache-release', 'next');
    const released = await import(/* @vite-ignore */ assetUrl.href);
    const {localChunkManifest} = await import(/* @vite-ignore */ new URL('./map-manifests.ts', url).href);
    const asset = localChunkManifest('dust2-mid-ct').delivery;
    const before = (window as any).diskCacheHits.filter((path: string) => path === asset.url).length;
    const bytes = await released.fetchDeliveredAsset(asset);
    await released.settleAssetCache();
    return {distinctModule: original.fetchDeliveredAsset !== released.fetchDeliveredAsset, bytes: bytes.byteLength,
      expectedBytes: asset.decodedBytes, additionalDiskHits: (window as any).diskCacheHits.filter((path: string) => path === asset.url).length - before};
  });
  expect(releaseReuse).toEqual({distinctModule: true, bytes: releaseReuse.expectedBytes, expectedBytes: releaseReuse.expectedBytes, additionalDiskHits: 1});
  await settleCaches(reloaded);
  expect(blocked, 'every /maps/ network attempt is blocked, including optional resources').toEqual([]);
  expect(network, 'no /maps/ request may escape through HTTP cache or workers').toEqual([]);
  expect(errors).toEqual([]);
});
