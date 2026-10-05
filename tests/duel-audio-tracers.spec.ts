import {expect, test} from '@playwright/test';

test('spatial footsteps and gunfire turn with the listener and attenuate behind cover', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {positionListener, spatialChain} = await import(/* @vite-ignore */ '/src/range/spatial-audio.ts');
    const render = async (x: number, z: number, yaw: number, occluded = false) => {
      const context = new OfflineAudioContext(2, 24000, 48000);
      positionListener(context, {x: 0, y: 1.6, z: 0}, yaw, 0);
      const chain = spatialChain(context, {position: {x, y: 0, z}, occluded});
      const source = context.createBufferSource();
      const buffer = context.createBuffer(1, 16000, 48000), samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] =
        (Math.sin(i * .027) + Math.sin(i * .16) + Math.sin(i * .63)) / 3;
      source.buffer = buffer; source.connect(chain.input); chain.output.connect(context.destination); source.start();
      const rendered = await context.startRendering();
      const energies = [0, 1].map(channel => rendered.getChannelData(channel).reduce((sum, value) => sum + value * value, 0));
      chain.dispose(); source.disconnect();
      return energies;
    };
    return {right: await render(5, -2, 0), left: await render(-5, -2, 0),
      turned: await render(5, -2, Math.PI), near: await render(1, -2, 0),
      far: await render(10, -20, 0), muffled: await render(5, -2, 0, true)};
  });
  expect(result.right[1]).toBeGreaterThan(result.right[0] * 1.3);
  expect(result.left[0]).toBeGreaterThan(result.left[1] * 1.3);
  expect(result.turned[0]).toBeGreaterThan(result.turned[1] * 1.3);
  expect(result.near[0] + result.near[1]).toBeGreaterThan((result.far[0] + result.far[1]) * 3);
  expect(result.muffled[0] + result.muffled[1]).toBeLessThan((result.right[0] + result.right[1]) * .5);
});

test('live player and enemy tracers begin at barrels and preserve physical endpoints', async ({page}, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).tracerEngine = this; original.call(this, time);};
  });
  await page.waitForFunction(() => {
    const e = (window as any).tracerEngine;
    return e?.motionReady && e.worldWeapons.has('ak47') && e.viewRoot.children.length;
  });
  const attachments = await page.evaluate(() => {
    const e = (window as any).tracerEngine, names: string[] = [];
    e.actors.traverse((object: any) => {if (object.isMesh) names.push(object.name);});
    return {view: !!e.viewMuzzle, bots: e.botMuzzles.size, names};
  });
  expect(attachments, JSON.stringify(attachments)).toMatchObject({view: true, bots: 1});
  await page.addStyleTag({content: '.duel-entry {display:none}'});
  const result = await page.evaluate(async () => {
    const e = (window as any).tracerEngine;
    const Vector3 = e.camera.position.constructor;
    e.sim.arena.solids.length = 0; e.covers.visible = false;
    e.sim.actors[1].position = {x: 1, y: 1.6256, z: 3};
    e.syncActors(e.sim.snapshot(), 0); e.viewScene.updateMatrixWorld(true);
    const endpoint = {x: 1, y: 1.6, z: -10};
    e.processEvents([{kind: 'fire', actorId: 0, shotId: 900, equipment: 'ak47', origin: {x: 0, y: 1.6256, z: 8},
      direction: new Vector3(endpoint.x,endpoint.y-1.6256,endpoint.z-8).normalize()}, {kind: 'surface', shooter: 0, shotId: 900, point: endpoint}]);
    const line = e.shotEffects.tracers;
    const positions = Array.from(line.geometry.getAttribute('position').array).slice(0, 6) as number[];
    const start = new Vector3(...positions.slice(0, 3));
    const muzzle = e.viewMuzzle.getWorldPosition(new Vector3());
    const viewNdc = muzzle.clone().project(e.viewCamera);
    const ndc = start.clone().project(e.camera);
    const {viewmodelViewport} = await import(/* @vite-ignore */ '/src/range/viewmodel.ts');
    const vp = viewmodelViewport(e.width, e.height);
    const x = (vp.x + (viewNdc.x + 1) * vp.width / 2) / e.width * 2 - 1;
    const y = (vp.y + (viewNdc.y + 1) * vp.height / 2) / e.height * 2 - 1;
    e.processEvents([{kind: 'fire', actorId: 1, shotId: 901, equipment: 'ak47', origin: {x: 1, y: 1.6256, z: 3},
      direction: new Vector3(-1.5,1.4-1.6256,4).normalize()}, {kind: 'surface', shooter: 1, shotId: 901, point: {x: -.5, y: 1.4, z: 7}}]);
    const enemyStart = Array.from(line.geometry.getAttribute('position').array).slice(6, 9) as number[];
    const enemyMuzzle = e.botMuzzles.get(1).getWorldPosition(new Vector3());
    return {positions, delta: [ndc.x - x, ndc.y - y],
      ahead: start.sub(e.camera.position).dot(e.camera.getWorldDirection(new Vector3())),
      enemyStart, enemyMuzzle: enemyMuzzle.toArray(), muzzle: muzzle.toArray()};
  });
  expect(result.positions.slice(3)).toEqual([1, expect.closeTo(1.6), -10]);
  expect(Math.abs(result.delta[0]) + Math.abs(result.delta[1])).toBeLessThan(.00001);
  expect(result.ahead).toBeGreaterThan(.2);
  for (let i = 0; i < 3; i++) expect(result.enemyStart[i]).toBeCloseTo(result.enemyMuzzle[i], 5);
  expect(result.enemyStart[1]).toBeGreaterThan(.8);
  expect(result.enemyStart[1]).toBeLessThan(1.7);
  await page.locator('canvas[data-duel]').screenshot({path: `test-results/duel-tracers-${info.project.name}.png`});
  expect(errors).toEqual([]);
});
