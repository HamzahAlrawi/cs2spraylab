import {expect, test, type Page} from '@playwright/test';
import type {} from './prefire-map-switch-harness';

test.beforeEach(async ({}, info) => {
  test.skip(info.config.metadata.prefireMapSwitchFixture !== true, 'Requires the dedicated Prefire map-switch fixture server.');
});

async function open(page: Page) {
  const pending = new Set<string>(), errors: string[] = [];
  page.on('request', request => pending.add(request.url()));
  page.on('requestfinished', request => pending.delete(request.url()));
  page.on('requestfailed', request => {pending.delete(request.url()); errors.push(`${request.url()}: ${request.failure()?.errorText}`);});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/prefire-map-switch-host.html', {waitUntil: 'commit'});
  try {await expect(page.getByText('Loading Alpha Range', {exact: true})).toBeVisible({timeout: 15000});}
  catch (error) {console.error('Fixture startup diagnostics', {pending: [...pending], errors}); throw error;}
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().requests.length)).toBe(1);
}

test('late first-map runtime is aborted and disposed without mounting over the second map', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.getByLabel('Prefire map').selectOption('fixture_beta');
  await expect(page.getByText('Loading Beta Range', {exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().requests.map(row => [row.mapId, row.aborted])))
    .toEqual([['fixture_alpha', true], ['fixture_beta', false]]);
  await page.evaluate(() => window.prefireMapSwitch.resolve('fixture_beta'));
  await expect(page.getByRole('heading', {name: 'Beta Range Prefire'})).toBeVisible();
  const identity = {mapId: 'fixture_beta', configMapId: 'fixture_beta', catalogRevision: 'beta-revision', gameBuild: 'beta-build',
    geometrySha256: 'b'.repeat(64), runtimeMapId: 'fixture_beta', routeId: 'shared-entry'};
  await expect.poll(() => page.getByTestId('identity').textContent().then(value => JSON.parse(value!))).toEqual(identity);
  await page.evaluate(() => window.prefireMapSwitch.resolve('fixture_alpha'));
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().disposals)).toEqual(['fixture_alpha']);
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().mounts)).toEqual([identity]);
  await expect(page.getByTestId('mock-stage')).toBeVisible();
  await expect.poll(() => page.getByTestId('identity').textContent().then(value => JSON.parse(value!))).toEqual(identity);
  await expect(page.getByLabel('Prefire map')).toHaveValue('fixture_beta');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.prefire.v1')!)))
    .toMatchObject({mapId: 'fixture_beta', routeId: 'shared-entry'});
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.prefire.v1')!).lineupId)).toBeUndefined();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByLabel('Prefire map').selectOption('fixture_alpha');
  await expect(page.getByText('Loading Alpha Range', {exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().disposals)).toEqual(['fixture_alpha', 'fixture_beta']);
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().requests.length)).toBe(3);
  await page.evaluate(() => window.prefireMapSwitch.resolve('fixture_alpha'));
  await expect(page.getByRole('heading', {name: 'Alpha Range Prefire'})).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().mounts.map(row => row.mapId)))
    .toEqual(['fixture_beta', 'fixture_alpha']);
  expect(errors).toEqual([]);
});

test('selected-map error labels survive an obsolete rejection and clear when switching back', async ({page}) => {
  await open(page);
  await page.getByLabel('Prefire map').selectOption('fixture_beta');
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().requests.length)).toBe(2);
  await page.evaluate(() => window.prefireMapSwitch.reject('fixture_beta'));
  await expect(page.getByRole('alert')).toContainText('Beta Range unavailable');
  await expect(page.getByRole('alert')).toContainText('Beta Range could not load.');
  await page.evaluate(() => window.prefireMapSwitch.reject('fixture_alpha', true));
  await expect(page.getByRole('alert')).toContainText('Beta Range unavailable');
  await expect(page.getByRole('alert')).not.toContainText('fixture_alpha fixture failure');
  await page.getByLabel('Prefire map').selectOption('fixture_alpha');
  await expect(page.getByText('Loading Alpha Range', {exact: true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.prefireMapSwitch.snapshot().requests.length)).toBe(3);
  await page.evaluate(() => window.prefireMapSwitch.resolve('fixture_alpha'));
  await expect(page.getByRole('heading', {name: 'Alpha Range Prefire'})).toBeVisible();
});
