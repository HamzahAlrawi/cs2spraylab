import {expect, test} from '@playwright/test';
import sharp from 'sharp';

test('native articulated deaths retain anatomy, pose, momentum and raised-floor contact', async ({page}, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.duel.v1', JSON.stringify({generatedMaps: true})));
  await page.goto('/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).deathEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).deathEngine?.criticalReady && (window as any).deathEngine.motionReady);
  await page.addStyleTag({content: '.duel-entry,.duel-hud,.duel-reticle,.duel-setup,.duel-result{display:none!important}'});
  const shots: {input: Buffer; left: number; top: number}[] = [];
  const scenarios = [
    {name: 'chest-front', duck: 0, head: false, direction: {x: 0, y: 0, z: 1}},
    {name: 'head-side', duck: 0, head: true, direction: {x: 1, y: 0, z: 0}},
    {name: 'crouched', duck: 1, head: false, direction: {x: 0, y: 0, z: -1}},
    {name: 'moving', duck: 0, head: false, direction: {x: 0, y: 0, z: 1}, speed: 3},
    {name: 'airborne', duck: .5, head: true, direction: {x: -1, y: 0, z: 0}, feet: .7, vertical: 2},
    {name: 'platform', duck: .5, head: false, direction: {x: 0, y: 0, z: 1}, floor: 1},
  ];
  for (let row = 0; row < scenarios.length; row++) {
    const scenario = scenarios[row];
    const initial = await page.evaluate(scenario => {
      const e = (window as any).deathEngine;
      cancelAnimationFrame(e.frame); e.paused = true; e.covers.visible = false;
      e.sim.arena.solids = []; e.rebuildActors();
      const actor = e.sim.actors[1], floor = scenario.floor ?? 0;
      actor.alive = true; actor.feet = floor + (scenario.feet ?? 0); actor.duckAmount = scenario.duck;
      actor.position = {x: 0, y: actor.feet + (64 - 18 * scenario.duck) * .0254, z: 4};
      actor.velocity = {x: scenario.speed ?? 0, z: 0}; actor.verticalVelocity = scenario.vertical ?? 0;
      actor.yaw = Math.PI; actor.pitch = 0; actor.grounded = !scenario.feet;
      const model = e.models.get(1), animator = e.animators.get(1);
      model.position.set(0, actor.feet, 4); model.rotation.y = 0;
      animator.update(e.sim.snapshot()[1], 1 / 60); model.updateMatrixWorld(true);
      e.camera.position.set(0, floor + 1.4, .5); e.camera.lookAt(0, floor + .7, 4); e.camera.updateMatrixWorld(true);
      e.scene.traverse((node: any) => {if (node.userData.actorId && node.userData.actorId !== 1) node.visible = false;});
      for (const [id, root] of e.models) root.visible = id === 1;
      animator.setDeathWorld({floor});
      const before = model.getObjectByName('head_0').getWorldPosition(e.camera.position.clone());
      const lengths: Record<string, number> = {};
      model.traverse((bone: any) => {if (bone.isBone) lengths[bone.name] = bone.position.length();});
      const dead = {...e.sim.snapshot()[1], alive: false, deathDirection: scenario.direction, deathGroup: scenario.head ? 'head' : 'chest'};
      const held = e.heldWeapons.get(1); if (held) held.visible = false;
      animator.update(dead, 0, 0, {deathVelocity: {x: scenario.speed ?? 0, y: scenario.vertical ?? 0, z: 0}});
      const captured = model.getObjectByName('head_0').getWorldPosition(before.clone());
      (window as any).deathCase = {model, animator, dead, lengths, before, maxHead: before.y, maxStretch: 0, maxStep: 0, lastHead: before.clone()};
      return {poseError: captured.distanceTo(before), rigid: !!animator.rigidDeath};
    }, scenario);
    expect(initial.rigid).toBe(true); expect(initial.poseError).toBeLessThan(1e-5);
    for (const [column, age] of [0, .12, .25, .45, .8, 1.2, 3].entries()) {
      const state = await page.evaluate(age => {
        const e = (window as any).deathEngine, c = (window as any).deathCase;
        c.animator.update(c.dead, 1 / 60, age); c.model.updateMatrixWorld(true);
        const head = c.model.getObjectByName('head_0').getWorldPosition(c.before.clone());
        c.maxHead = Math.max(c.maxHead, head.y);
        c.model.traverse((bone: any) => {if (bone.isBone && /^(spine_|neck_|head_|clavicle_|arm_|hand_|leg_|ankle_|ball_)/.test(bone.name)) {
          const error = Math.abs(bone.position.length() - c.lengths[bone.name]);
          if (error > c.maxStretch) {c.maxStretch = error; c.stretched = bone.name;}
        }});
        const physicsGap = Math.max(...c.animator.rigidDeath.bindings.map((binding: any) =>
          binding.bone.getWorldPosition(c.before.clone()).distanceTo(binding.body.translation())));
        e.renderer.render(e.scene, e.camera);
        return {head: head.toArray(), maxHead: c.maxHead, maxStretch: c.maxStretch, stretched: c.stretched, physicsGap};
      }, age);
      expect(state.head.every(Number.isFinite)).toBe(true);
      expect(state.maxStretch, JSON.stringify(state)).toBeLessThan(.10);
      expect(state.physicsGap, JSON.stringify({scenario: scenario.name, age, ...state})).toBeLessThan(.00001);
      if (age === 3) {
        expect(state.head[1], scenario.name).toBeGreaterThan((scenario.floor ?? 0) - .05);
        expect(state.head[1], scenario.name).toBeLessThan((scenario.floor ?? 0) + .8);
      }
      const input = await sharp(await page.locator('canvas[data-duel]').screenshot()).resize(300, 210).png().toBuffer();
      shots.push({input, left: column * 300, top: row * 210});
    }
  }
  await sharp({create: {width: 2100, height: scenarios.length * 210, channels: 3, background: '#202020'}})
    .composite(shots).png().toFile(info.outputPath('death-contact-sheet.png'));
  expect(errors).toEqual([]);
});

test('live native-map eliminations use local source geometry and release corpse worlds on reset', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).deathEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).deathEngine?.criticalReady && (window as any).deathEngine.sim.arena.native,
    {}, {timeout: 90000});
  const result = await page.evaluate(() => {
    const e = (window as any).deathEngine; cancelAnimationFrame(e.frame);
    const actor = e.sim.actors[1]; actor.alive = false; actor.health = 0;
    actor.deathDirection = {x: 1, y: 0, z: 0}; actor.deathGroup = 'head';
    const model = e.models.get(1), animator = e.animators.get(1);
    const head = model.getObjectByName('head_0').getWorldPosition(e.camera.position.clone());
    e.processEvents([{kind: 'hit', victim: 1, shooter: 0, shotId: 9999, group: 'head', healthDamage: 100,
      armorDamage: 0, lethal: true, point: {x: head.x, y: head.y, z: head.z}}]);
    e.syncActors(e.sim.snapshot(), 0);
    animator.update(e.sim.snapshot()[1], 0, 2);
    const physics = animator.rigidDeath, point = model.getObjectByName('head_0').getWorldPosition(head.clone());
    const result = {native: !!physics, triangles: physics?.geometry.indices.length / 3,
      finite: point.toArray().every(Number.isFinite), held: e.heldWeapons.get(1)?.visible ?? false};
    e.rebuildActors(); return {...result, freed: physics?.disposed};
  });
  expect(result).toMatchObject({native: true, finite: true, held: false, freed: true});
  expect(result.triangles).toBeGreaterThan(100); expect(errors).toEqual([]);
});
