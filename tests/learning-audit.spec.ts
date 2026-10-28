import {expect, test, type Page} from '@playwright/test';

async function tutorial(page: Page) {
  await page.goto('/tests/tutorial-host.html');
  await page.getByRole('button', {name: 'Open tutorial'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function hearing(page: Page) {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function' || typeof (window as any).webkitAudioContext === 'function');
  test.skip(!available, 'This browser build omits Web Audio; the missing-API fallback is tested separately.');
  await page.goto('/tests/hearing-host.html');
}

test('tutorial buttons retain native Space activation and focus through watch/retry', async ({page}) => {
  await tutorial(page);
  const watch = page.getByRole('button', {name: 'Watch example'});
  await watch.focus();
  await page.keyboard.press('Space');
  const tryIt = page.getByRole('button', {name: 'Try it yourself'});
  await expect(tryIt).toBeVisible();
  await expect(tryIt).toBeFocused();
  await page.keyboard.press('Space');
  await expect(watch).toBeFocused();
  await page.getByRole('button', {name: '2. Aim with your movement', exact: true}).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', {name: 'Aim with your movement'})).toBeVisible();
  await page.getByRole('button', {name: 'Fire / Space'}).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.lesson-feedback')).toContainText('right of your crosshair');
  await page.getByRole('button', {name: 'Restart lesson'}).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.lesson-feedback')).toContainText('Hold D');
  await page.getByRole('dialog').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', {name: 'Restart lesson'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Close tutorial'})).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Open tutorial'})).toBeFocused();
});

test('tutorial movement buttons support held keyboard activation', async ({page}) => {
  await page.clock.install();
  await tutorial(page);
  await page.getByRole('button', {name: 'Move right', exact: true}).focus();
  await page.keyboard.down('Space');
  await page.clock.runFor(360);
  await expect(page.locator('.lesson-speed')).toContainText('Moving: rifle inaccuracy');
  await page.keyboard.up('Space');
  await page.getByRole('button', {name: 'Move left', exact: true}).focus();
  await page.keyboard.down('Enter');
  await page.clock.runFor(130);
  await expect(page.locator('.lesson-feedback')).toContainText('Counter-strafe complete');
  await page.keyboard.up('Enter');
  await page.getByRole('button', {name: 'Next lesson'}).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', {name: 'Aim with your movement'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Open tutorial'})).toBeFocused();
});

test('tutorial examples, manual completion, retry and return work on narrow screens', async ({page}, info) => {
  await page.setViewportSize({width: 320, height: 740});
  await page.clock.install();
  await tutorial(page);
  for (let lesson = 0; lesson < 3; lesson++) {
    await page.getByRole('button', {name: 'Watch example'}).click();
    await page.clock.runFor(5000);
    await expect(page.locator('.lesson-feedback')).toHaveClass(/success/);
    await expect(page.getByRole('button', {name: /Next lesson|Return to practice/})).toBeDisabled();
    await page.getByRole('button', {name: 'Try it yourself'}).click();
    await expect(page.locator('.lesson-feedback')).not.toHaveClass(/success/);
    await page.keyboard.down('KeyD');
    await page.clock.runFor(320);
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyA');
    await page.clock.runFor(lesson === 0 ? 130 : 80);
    await page.keyboard.up('KeyA');
    if (lesson > 0) await page.keyboard.press('Space');
    await expect(page.locator('.lesson-feedback')).toHaveClass(/success/);
    const target = await page.locator('.lesson-target').getAttribute('style');
    const feedback = await page.locator('.lesson-feedback').textContent();
    await page.clock.runFor(1500);
    await expect(page.locator('.lesson-target')).toHaveAttribute('style', target!);
    await expect(page.locator('.lesson-feedback')).toHaveText(feedback!);
    if (lesson < 2) {
      await page.getByRole('button', {name: 'Next lesson'}).click();
      await expect(page.getByRole('button', {name: /Next lesson|Return to practice/})).toBeDisabled();
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('dialog').screenshot({path: info.outputPath('tutorial-320.png')});
  await page.getByRole('button', {name: 'Return to practice'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('hearing exposes an explicit resume after calibration, mute and modal suspension', async ({page}) => {
  await hearing(page);
  await page.getByRole('button', {name: 'Start listening'}).click();
  const confirm = page.getByRole('button', {name: 'Confirm estimate'});
  await expect(confirm).toBeEnabled();
  await page.getByRole('button', {name: 'near', exact: true}).click();
  await expect(confirm).toBeDisabled();
  await expect(page.locator('.hearing-practice')).toHaveAttribute('data-hearing-phase', 'paused');
  await page.getByRole('button', {name: 'Resume listening', exact: true}).click();
  await expect(confirm).toBeEnabled();
  await page.getByRole('button', {name: 'Range audio settings'}).click();
  await expect(confirm).toBeDisabled();
  await page.evaluate(() => (window as any).hearingProps({suspended: false}));
  await page.getByRole('button', {name: 'Resume listening', exact: true}).click();
  await expect(confirm).toBeEnabled();
  await page.evaluate(() => (window as any).hearingProps({volume: 0}));
  await expect(confirm).toBeDisabled();
  await page.evaluate(() => (window as any).hearingProps({volume: .7}));
  await page.getByRole('button', {name: 'Resume listening', exact: true}).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByLabel('Actual sound position', {exact: true})).toBeVisible();
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.hearing.history.v1')!));
  expect(history).toHaveLength(1);
  expect(history[0].replays).toBe(3);
});

test('failed hearing playback retries the same hidden trial rather than replacing it', async ({page}) => {
  await hearing(page);
  await page.evaluate(async () => {
    const {RangeAudio} = await import(/* @vite-ignore */ '/src/range/audio.ts');
    const original = RangeAudio.prototype.playEvent;
    (window as any).attemptedSounds = [];
    RangeAudio.prototype.playEvent = function(event: string, volume: number, spatial: any) {
      const attempts = (window as any).attemptedSounds;
      attempts.push({event, position: spatial.position});
      return attempts.length === 1 ? false : original.call(this, event, volume, spatial);
    };
  });
  await page.getByRole('button', {name: 'Start listening'}).click();
  await expect(page.locator('.hearing-practice')).toHaveAttribute('data-hearing-phase', 'error');
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeDisabled();
  await expect(page.getByLabel('Actual sound position', {exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Retry sound', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  const attempts = await page.evaluate(() => (window as any).attemptedSounds);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.getByRole('button', {name: 'Confirm estimate'}).click();
  await page.getByRole('button', {name: 'Replay sound', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.hearing.history.v1')!).length)).toBe(1);
  await page.getByRole('button', {name: 'Next sound', exact: true}).click();
  await expect(page.getByLabel('Actual sound position', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
});

for (const interruption of ['configuration', 'modal', 'mute'] as const) {
  test(`pending hearing loads cannot start playback after ${interruption} changes`, async ({page}) => {
    await hearing(page);
    await page.evaluate(async () => {
      const {RangeAudio} = await import(/* @vite-ignore */ '/src/range/audio.ts');
      const original = RangeAudio.prototype.unlockEvents, play = RangeAudio.prototype.playEvent;
      (window as any).pendingHearingLoads = [];
      (window as any).startedHearingSounds = 0;
      RangeAudio.prototype.unlockEvents = async function(events: string[]) {
        const ready = await original.call(this, events);
        await new Promise<void>(resolve => (window as any).pendingHearingLoads.push(resolve));
        return ready;
      };
      RangeAudio.prototype.playEvent = function(...args: Parameters<typeof play>) {
        (window as any).startedHearingSounds++;
        return play.apply(this, args);
      };
    });
    await page.getByRole('button', {name: 'Start listening'}).click();
    await expect.poll(() => page.evaluate(() => (window as any).pendingHearingLoads.length)).toBe(1);
    if (interruption === 'configuration') await page.getByLabel('Sounds', {exact: true}).selectOption('shots');
    else await page.evaluate(kind => (window as any).hearingProps(kind === 'modal' ? {suspended: true} : {volume: 0}), interruption);
    await page.evaluate(() => (window as any).pendingHearingLoads.shift()());
    await expect(page.locator('.hearing-practice')).toHaveAttribute('data-hearing-phase', interruption === 'configuration' ? 'idle' : 'paused');
    expect(await page.evaluate(() => (window as any).startedHearingSounds)).toBe(0);
    await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeDisabled();
    await expect(page.getByLabel('Actual sound position', {exact: true})).toHaveCount(0);
    if (interruption !== 'configuration') await page.evaluate(() => (window as any).hearingProps({suspended: false, volume: .7}));
    await page.getByRole('button', {name: interruption === 'configuration' ? 'Start listening' : 'Resume listening', exact: true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).pendingHearingLoads.length)).toBe(1);
    await page.evaluate(() => (window as any).pendingHearingLoads.shift()());
    await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeEnabled();
  });
}

test('missing Web Audio reports an error and never enables a silent answer', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', {configurable: true, value: undefined});
    Object.defineProperty(window, 'webkitAudioContext', {configurable: true, value: undefined});
  });
  await page.goto('/tests/hearing-host.html');
  await page.getByRole('button', {name: 'Start listening'}).click();
  await expect(page.getByText(/Audio unavailable/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry sound', exact: true})).toBeEnabled();
  await expect(page.getByRole('button', {name: 'Confirm estimate'})).toBeDisabled();
  await expect(page.getByLabel('Actual sound position', {exact: true})).toHaveCount(0);
});
