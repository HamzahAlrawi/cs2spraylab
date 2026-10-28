import {expect, test, type Page} from '@playwright/test';

test.beforeEach(async ({page}) => {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function' || typeof (window as any).webkitAudioContext === 'function');
  test.skip(!available, 'This browser build omits Web Audio; unavailable-audio handling is tested in learning-audit.spec.ts.');
});

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {Math.random = () => .5;});
  await page.goto('/tests/hearing-host.html');
  await expect(page.getByRole('heading', {name: 'Hearing practice'})).toBeVisible();
  return errors;
}
async function start(page: Page) {
  await page.getByRole('button', {name: 'Start listening'}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
}

test('direction-only coaching gives signed evidence and a next-trial goal without judging distance', async ({page}, info) => {
  const errors = await setup(page);
  await page.getByLabel('Sounds', {exact: true}).selectOption('steps');
  await page.getByLabel('Scoring', {exact: true}).selectOption('direction');
  await start(page);
  await page.getByLabel('Estimated bearing').fill('230');
  await page.getByLabel('Estimated distance').fill('1');
  await page.getByRole('button', {name: 'Confirm estimate'}).click();
  const review = page.getByRole('region', {name: 'Skill review'});
  await expect(review).toBeVisible();
  await expect(review.locator('.coaching-evidence')).toContainText('50.0 degrees left');
  await expect(review.locator('.coaching-evidence')).toContainText('distance is not scored');
  await expect(review.locator('.coaching-goal')).toContainText('within 45 degrees');
  await expect(review.getByText('Distance error', {exact: true})).toHaveCount(0);
  await expect(review.locator('.coaching-confidence')).toContainText('1 comparable first-listen');
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.hearing.history.v1')!));
  expect(rows[0].context).toMatchObject({config: {task: 'direction', sounds: 'steps'}, event: 'step-concrete', volume: .7, heading: 0});
  await page.locator('.hearing-practice').screenshot({path: info.outputPath('direction-coaching.png')});
  expect(errors).toEqual([]);
});

test('mono review judges range only and replays are a learning aid rather than a score penalty', async ({page}) => {
  const errors = await setup(page);
  await page.getByLabel('Output device', {exact: true}).selectOption('mono');
  await start(page);
  await page.getByRole('button', {name: 'Replay sound', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  await page.getByLabel('Estimated bearing').fill('180');
  await page.getByLabel('Estimated distance').fill('14');
  await page.getByRole('button', {name: 'Confirm estimate'}).click();
  const review = page.getByRole('region', {name: 'Skill review'});
  await expect(review.getByRole('heading', {name: 'Estimate range, not direction'})).toBeVisible();
  await expect(review.locator('.coaching-evidence')).toContainText('no directional judgment');
  await expect(review.getByText('Direction error', {exact: true})).toHaveCount(0);
  await expect(review.locator('.coaching-confidence')).toContainText('score is unchanged');
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.hearing.history.v1')!));
  expect(rows[0].replays).toBe(1); expect(rows[0].score).toBeGreaterThan(95);
  expect(errors).toEqual([]);
});

test('front/back feedback explains panner ambiguity and calibration retains the trial sound', async ({page}, info) => {
  const errors = await setup(page);
  await page.getByLabel('Spatial audio', {exact: true}).selectOption('equalpower');
  await page.evaluate(async () => {
    const {RangeAudio} = await import(/* @vite-ignore */ '/src/range/audio.ts');
    const original = RangeAudio.prototype.playEvent;
    (window as any).coachingEvents = [];
    RangeAudio.prototype.playEvent = function(event: string, ...args: any[]) {
      (window as any).coachingEvents.push(event); return original.call(this, event, ...args);
    };
  });
  await start(page);
  await page.getByRole('button', {name: 'Turn listener right 90 degrees'}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  await page.getByRole('button', {name: 'Turn listener right 90 degrees'}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  await page.getByLabel('Estimated bearing').fill('0');
  await page.getByLabel('Estimated distance').fill('14');
  await page.getByRole('button', {name: 'Confirm estimate'}).click();
  const review = page.getByRole('region', {name: 'Skill review'});
  await expect(review.getByRole('heading', {name: 'Check front versus back'})).toBeVisible();
  await expect(review).toContainText('Try HRTF with headphones');
  await expect(review.locator('.coaching-confidence')).toContainText('not proof of poor listening');
  await page.getByRole('button', {name: 'near', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).coachingEvents.at(-1))).toBe('ak47');
  await page.setViewportSize({width: 320, height: 740});
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await review.scrollIntoViewIfNeeded();
  await review.screenshot({path: info.outputPath('hearing-coaching-320.png')});
  expect(errors).toEqual([]);
});
