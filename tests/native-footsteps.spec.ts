import {expect, test} from '@playwright/test';

test('native footstep playback loads bounded banks and cancels cleanly on desktop/mobile', async ({page}) => {
  await page.route('**/__native-audio-test', route => route.fulfill({contentType: 'text/html',
    body: '<!doctype html><html><body><button id="start">Start</button></body></html>'}));
  await page.goto('/__native-audio-test');
  await page.evaluate(async () => {
    const {RangeAudio} = await import(/* @vite-ignore */ '/src/range/audio.ts');
    const requests: string[] = [], original = window.fetch.bind(window);
    window.fetch = (input, init) => {requests.push(String(input)); return original(input, init);};
    const audio = new RangeAudio({reverb: false, propagationDelay: false});
    (window as any).footstepHarness = {audio, requests, ready: false};
    document.getElementById('start')!.onclick = async () => {
      await audio.unlock('ak47');
      // Exercise real decode, nodes and cleanup without making the test audible.
      (audio as any).master?.disconnect();
      (window as any).footstepHarness.ready = true;
    };
  });
  await page.locator('#start').click();
  await page.waitForFunction(() => (window as any).footstepHarness.ready);
  const result = await page.evaluate(async () => {
    const {audio, requests} = (window as any).footstepHarness;
    const manifest = await (await fetch('/audio/events.json')).json();
    const initialFootsteps = requests.filter((url: string) => url.includes('/footstep-')).length;
    const allFootsteps = new Set(Object.values(manifest.events).flatMap((event: any) => event.samples)
      .filter((url: any) => url.includes('/footstep-'))).size;
    const coldSand = !audio.samples.has(manifest.events['step-sand'].samples[0]);
    const first = audio.playStep(.25, 0, false, undefined, 'sand');
    audio.stopVoices(); await audio.stepLoads.get('step-sand');
    const voicesAfterLoad = audio.voices.size;
    const loadedSand = manifest.events['step-sand'].samples.every((url: string) => audio.samples.has(url));
    const sand = audio.samples.get(manifest.events['step-sand'].samples[0]);
    const peak = sand.getChannelData(0).reduce((max: number, value: number) => Math.max(max, Math.abs(value)), 0);
    const second = audio.playStep(.25, 0, false, {position: {x: 3, y: .5, z: -2}}, 'sand');
    const silent = audio.playStep(.25, 0, false, undefined, 'silent');
    const muted = audio.playStep(0, 0, false, undefined, 'tile');
    const voicesBeforeDispose = audio.voices.size;
    audio.dispose();
    return {status: audio.status, initialFootsteps, allFootsteps, coldSand, first, voicesAfterLoad, loadedSand,
      peak, second, silent, muted, voicesBeforeDispose, voicesAfterDispose: audio.voices.size};
  });
  expect(result).toMatchObject({status: 'ready', coldSand: true, first: true, voicesAfterLoad: 0,
    loadedSand: true, second: true, silent: false, muted: false, voicesBeforeDispose: 1, voicesAfterDispose: 0});
  expect(result.initialFootsteps).toBeLessThanOrEqual(36);
  expect(result.allFootsteps).toBeGreaterThan(result.initialFootsteps * 4);
  expect(result.peak).toBeGreaterThan(.001);
});
