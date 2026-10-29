import {test, expect} from '@playwright/test';
test('volume smoke blocks sight, carves bullet/HE openings, refills and respects foreground depth', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {smokeRenderHarness} = await import(/* @vite-ignore */ '/tests/smoke-render-harness.ts');
    return smokeRenderHarness();
  });
  const red = (pixel: number[]) => pixel[0] - Math.max(pixel[1], pixel[2]);
  expect(red(result.empty)).toBeGreaterThan(200);
  expect(red(result.dense)).toBeLessThan(15);
  expect(red(result.bullet)).toBeGreaterThan(180);
  expect(red(result.he)).toBeGreaterThan(180);
  expect(red(result.healed)).toBeLessThan(15);
  expect(red(result.interior)).toBeLessThan(15);
  expect(result.wall[1]).toBeGreaterThan(240); expect(result.wall[0]).toBeLessThan(10);
  for (let channel = 0; channel < 3; channel++) expect(Math.abs(result.toneReference[channel] - result.toneVolume[channel])).toBeLessThanOrEqual(2);
  expect(result.glError).toBe(0); expect(errors).toEqual([]);
  await page.screenshot({path: `research/smoke-volume-${info.project.name}.png`});
});
