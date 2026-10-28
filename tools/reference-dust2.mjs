import {chromium} from '@playwright/test';
import path from 'node:path';
const browser = await chromium.launch({channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await page.goto('http://127.0.0.1:5176');
  await page.evaluate(async () => {
    const u = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine: E} = await import(u), tick = E.prototype.tick;
    E.prototype.tick = function(t) {window.referenceEngine = this; return tick.call(this, t);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await page.getByLabel('Prefire route').waitFor({timeout: 90000});
  await page.getByLabel('Prefire route').selectOption('b-tunnels');
  await page.evaluate(async rawUrl => {
    const {GLTFLoader} = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const asset = await new GLTFLoader().loadAsync(rawUrl);
    asset.scene.rotation.y = Math.PI / 2;
    asset.scene.traverse(n => {
      if (!n.isMesh || Array.isArray(n.material)) return;
      const v = n.material.userData.vmat;
      if (/materials\/tools\//.test(v?.Name ?? '') || /csgo_effects/.test(v?.ShaderName ?? '') || v?.IntParams?.F_DEPTH_FEATHER === 1) n.visible = false;
      if (v?.IntParams?.F_PAINT_VERTEX_COLORS !== 1) n.material.vertexColors = false;
    });
    const e = window.referenceEngine;
    e.scenario.map.scene.visible = false;
    e.scene.add(asset.scene);
  }, `/@fs/${path.resolve('research/dust2/native-current.glb').replaceAll('\\', '/')}`);
  await page.waitForTimeout(2000);
  await page.locator('canvas[aria-label="Dust 2 prefire map"]').screenshot({path: 'research/dust2/raw-reference.png'});
} finally {await browser.close();}
