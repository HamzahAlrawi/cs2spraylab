import {expect, test} from '@playwright/test';
import {canvasColors} from './render-frame';

test('native grenade models have textured hands, correct framing and retained throw assets', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name)); test.setTimeout(180000);
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, showTips: false}));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({generatedMaps: true, botCount: 1, skill: 1,
      botUtilities: false, shortcutProtection: false}));
    localStorage.setItem('spraylab.duel.hint.v1', 'seen'); localStorage.setItem('spraylab.settingsHint.v1', 'seen');
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  await page.goto('/'); await page.locator('canvas[data-duel]').waitFor({timeout: 90000});
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/range/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function (time: number) {(window as any).grenadeEngine = this; return original.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).grenadeEngine?.criticalReady, undefined, {timeout: 90000});
  for (const kind of ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy']) {
    await page.evaluate(kind => {
      const engine = (window as any).grenadeEngine;
      engine.sim.configureUtilities({utilitiesEnabled: true, botUtilities: false, utilityLoadout: [kind]});
      engine.sim.selectUtility(kind); engine.paused = false;
    }, kind);
    await page.waitForFunction(kind => {
      const engine = (window as any).grenadeEngine, view = engine?.utilityRenderer.views.get(kind);
      return view?.scene.visible && engine.utilityRenderer.held.visible;
    }, kind);
    const result = await page.evaluate(kind => {
      const engine = (window as any).grenadeEngine, view = engine.utilityRenderer.views.get(kind);
      const meshes: any[] = []; view.scene.traverse((object: any) => {if (object.isMesh) meshes.push(object);});
      const bodies: any[] = [];
      view.scene.traverse((object: any) => {
        if (object.userData.native_view_weapon === `utility-${kind}`) object.traverse((node: any) => {if (node.isMesh) bodies.push(node);});
      });
      const body = bodies.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
      engine.viewScene.updateMatrixWorld(true);
      const position = engine.camera.position.clone(), projected = engine.camera.position.clone();
      let count = 0, visible = 0, sx = 0, sy = 0;
      for (let i = 0; i < body.geometry.attributes.position.count; i += 17) {
        body.getVertexPosition(i, position).applyMatrix4(body.matrixWorld); projected.copy(position).project(engine.viewCamera);
        count++; sx += projected.x; sy += projected.y;
        if (projected.x > -1 && projected.x < 1 && projected.y > -1 && projected.y < 1 && projected.z > -1 && projected.z < 1) visible++;
      }
      const material = Array.isArray(body.material) ? body.material[0] : body.material;
      const hand = meshes.find(mesh => mesh.name.includes('firstperson_default_gloves'));
      return {meshes: meshes.length, bodyVertices: body.geometry.attributes.position.count,
        handVertices: hand?.geometry.attributes.position.count ?? 0, texture: !!material.map, normal: !!material.normalMap,
        visibleFraction: visible / count, center: [sx / count, sy / count], scale: view.scene.scale.toArray(),
        action: view.activeAction};
    }, kind);
    expect(result.meshes).toBeGreaterThanOrEqual(3); expect(result.bodyVertices).toBeGreaterThan(500);
    expect(result.handVertices).toBeGreaterThan(500); expect(result.texture).toBe(true); expect(result.normal).toBe(true);
    expect(result.visibleFraction, `${kind} ${JSON.stringify(result)}`).toBeGreaterThan(.8);
    expect(result.scale).toEqual([1, 1, 1]); expect(result.action).toBe('idle');
    expect(await canvasColors(page, 'canvas[data-duel]')).toBeGreaterThan(5);
    await page.locator('canvas[data-duel]').screenshot({path: `research/native-grenade-${kind}-${info.project.name}.png`});
    await page.evaluate(() => (window as any).grenadeEngine.inspect());
    await page.waitForFunction(kind => (window as any).grenadeEngine.utilityRenderer.views.get(kind).activeAction === 'inspect', kind);
  }
  const downloads: string[] = []; page.on('request', request => {if (/\/models\/.*(?:\.glb|\.bin)/.test(request.url())) downloads.push(request.url());});
  await page.evaluate(() => {
    const engine = (window as any).grenadeEngine;
    for (let i = 0; i < 10; i++) {
      engine.utilityRenderer.update([{id: i, kind: 'he', position: {x: 1, y: 2, z: -3}, resting: false}], [], i / 60, engine.camera);
    }
  });
  expect(downloads).toEqual([]); expect(errors).toEqual([]);
  if (info.project.name === 'chromium') {
    await page.getByRole('button', {name: 'Enter duel', exact: true}).evaluate(element => {element.style.visibility = 'hidden';});
    const world = await page.evaluate(() => {
      const engine = (window as any).grenadeEngine;
      cancelAnimationFrame(engine.frame);
      engine.viewRoot.visible = false; engine.utilityRenderer.cancelHeld();
      const actor = {...engine.sim.snapshot()[1], position: {x: 0, y: 1.63, z: 0}, feet: 0, velocity: {x: 0, z: 0},
        yaw: Math.PI, pitch: 0, utility: 'he', reloading: false, action: undefined};
      const root = engine.models.get(actor.id); root.visible = true; root.position.set(0, 0, 0); root.rotation.y = 0;
      engine.heldWeapons.get(actor.id).visible = false;
      engine.utilityRenderer.updateWorldHeld(engine.heldGrenades.get(actor.id), 'he', true);
      engine.animators.get(actor.id).update(actor, .2, undefined, {bodyYaw: Math.PI, poseTime: 10});
      engine.camera.position.set(0, 1.5, 2.4); engine.camera.lookAt(0, 1.2, 0); engine.camera.updateMatrixWorld(true);
      engine.covers.visible = engine.dynamicCovers.visible = false;
      engine.renderer.setViewport(0, 0, engine.width, engine.height); engine.renderer.render(engine.scene, engine.camera);
      let fingers = 0;
      root.traverse((node: any) => {if (/finger_.*_R|thumb_.*_R/.test(node.name)) fingers++;});
      const hand = root.getObjectByName('hand_R'), point = hand.getWorldPosition(engine.camera.position.clone());
      const vertex = point.clone(); let gripError = Infinity;
      root.getObjectByName('held-native-he').traverse((node: any) => {
        if (!node.isMesh) return;
        for (let i = 0; i < node.geometry.attributes.position.count; i++) {
          vertex.fromBufferAttribute(node.geometry.attributes.position, i).applyMatrix4(node.matrixWorld);
          gripError = Math.min(gripError, vertex.distanceTo(point));
        }
      });
      return {fingers, gripError, hand: point.toArray(), wpn: root.getObjectByName('wpn').getWorldPosition(vertex).toArray(),
        native: !!root.getObjectByName('held-native-he'), clips: engine.utilityGestures.length};
    });
    expect(world.native).toBe(true); expect(world.clips).toBe(20);
    expect(world.gripError, JSON.stringify(world)).toBeLessThan(.075);
    await page.locator('canvas[data-duel]').screenshot({path: 'research/native-grenade-bot-chromium.png'});
  }
});
