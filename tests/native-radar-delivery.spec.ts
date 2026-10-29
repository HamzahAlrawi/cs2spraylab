import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
const manifest = JSON.parse(readFileSync('src/range/duel/native-radar.json', 'utf8'));

test('native radar survives module reload with no repeat asset request', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name));
  await page.route('**/__radar-cache', route => route.fulfill({contentType: 'text/html', body: '<body style="margin:0;background:#20272b"></body>'}));
  const downloads: string[] = []; page.on('request', request => {if (new URL(request.url()).pathname === manifest.delivery.url) downloads.push(request.url());});
  const acquire = async () => page.evaluate(async () => {
    const cachePath = '/src/range/duel/native-radar-cache.ts', deliveryPath = '/src/range/prefire/asset-delivery.ts';
    const {loadNativeRadar} = await import(/* @vite-ignore */ cachePath);
    const {settleAssetCache} = await import(/* @vite-ignore */ deliveryPath);
    const [first, second] = await Promise.all([loadNativeRadar(), loadNativeRadar()]);
    const {DuelRadar} = await import(/* @vite-ignore */ '/src/range/duel/radar.ts');
    const radar = new DuelRadar(document.body);
    const arena = {...first.overview.bounds, solids: []};
    radar.update({id: 0, position: {x: 5.334, y: 1.67492, z: 7.5438}, feet: .04932, yaw: -.3} as any, [], 0,
      arena, {radarEnabled: true, radarRotate: true, radarScale: .7}, first.overview);
    const image = first.overview.image as ImageBitmap, ctx = radar.canvas.getContext('2d')!, colors = new Set<string>();
    const pixels = ctx.getImageData(0, 0, radar.canvas.width, radar.canvas.height).data;
    for (let i = 0; i < pixels.length; i += 16) if (pixels[i + 3] > 200) colors.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    const result = {same: first.overview === second.overview, width: image.width, height: image.height, colors: colors.size};
    first.dispose(); second.dispose(); await settleAssetCache(); return result;
  });
  await page.goto('/__radar-cache');
  expect(await acquire()).toMatchObject({same: true, width: 1024, height: 1024});
  expect(downloads).toHaveLength(1);
  await page.route(`**${manifest.delivery.url}`, route => route.abort());
  downloads.length = 0; await page.reload();
  const revisited = await acquire();
  expect(revisited).toMatchObject({same: true, width: 1024, height: 1024}); expect(revisited.colors).toBeGreaterThan(25);
  expect(downloads).toEqual([]);
  await page.screenshot({path: `research/native-radar-cached-${info.project.name}.png`});
});
