import {expect, test} from '@playwright/test';

test('weapon drops have one rendered owner and do not accumulate after lethal feedback or round resets', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto('/');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).dropEngine = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => {
    const e = (window as any).dropEngine; return e?.motionReady && e.worldWeapons.has('ak47') && e.gestureClips.has('ak47');
  });
  const samples = await page.evaluate(() => {
    const e = (window as any).dropEngine, result = [];
    const base = e.scene.children.length;
    for (let round = 0; round < 12; round++) {
      const target = e.sim.actors[1]; target.health = 0; target.alive = false;
      const point = {...target.position, y: target.feet + .08};
      e.sim.drops.push({id: 1, equipment: 'ak47', ammo: 10, reserve: 60, position: point, picked: false});
      e.syncDrops();
      e.processEvents([{kind: 'hit', tick: e.sim.tick, shooter: 0, victim: 1, shotId: round,
        group: 'head', point, healthDamage: 100, armorDamage: 0, lethal: true}]);
      e.syncDrops();
      const active = {nodes: e.scene.children.length - base, tracked: e.dropModels.size,
        owned: e.scene.children.filter((object: any) => object.userData.spraylabDropId === 1).length};
      e.seed = 431; e.restart();
      result.push({...active, afterReset: e.scene.children.length - base, afterTracked: e.dropModels.size});
    }
    return result;
  });
  for (const sample of samples) expect(sample).toEqual({nodes: 1, tracked: 1, owned: 1, afterReset: 0, afterTracked: 0});
  expect(errors).toEqual([]);
});
