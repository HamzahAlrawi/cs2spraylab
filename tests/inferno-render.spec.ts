import {test, expect} from '@playwright/test';

for (const kind of ['molotov', 'incendiary'] as const) test(`${kind} renders animated native flames without a white sheet`, async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  await page.goto('/');
  const result = await page.evaluate(async kind => {
    const {infernoRenderHarness} = await import(/* @vite-ignore */ '/tests/inferno-render-harness.ts');
    return infernoRenderHarness(kind);
  }, kind);
  expect(result.warm).toBeGreaterThan(1500); expect(result.changed).toBeGreaterThan(1000);
  expect(result.white / result.pixels).toBeLessThan(.03); expect(result.glError).toBe(0); expect(errors).toEqual([]);
  await page.screenshot({path: `research/inferno-${kind}-${info.project.name}.png`});
});
