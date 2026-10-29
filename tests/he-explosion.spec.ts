import {test, expect} from '@playwright/test';

test('HE has a visible animated smoke after-effect that fades and respects cover', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {heExplosionHarness} = await import(/* @vite-ignore */ '/tests/he-explosion-harness.ts'); return heExplosionHarness();
  });
  expect(result.flash).toBeGreaterThan(2000); expect(result.smoke).toBeGreaterThan(1500);
  expect(result.moving).toBeGreaterThan(1000); expect(result.tail).toBeGreaterThan(50);
  expect(result.removed).toBe(0); expect(result.blocked).toBe(0);
  expect(result.glError).toBe(0); expect(errors).toEqual([]);
  await page.screenshot({path: `research/he-explosion-${info.project.name}.png`});
});
