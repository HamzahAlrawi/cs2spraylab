import fs from 'node:fs';
import {chromium} from '@playwright/test';

const region = process.argv.find(arg => arg.startsWith('--region='))?.slice(9) ?? 'site';
const regions = {
  site: {eye: [980, 2600, 1550], look: [980, 2600, 95], span: 1050, labels: [[720,2764,170], [1117,2597,95], [1299,2874,125], [1100,2750,95], [1250,2650,95], [1190,2750,95], [1400,2750,120], [1000,2900,120]]},
  pit: {eye: [1400, 470, 1300], look: [1400, 470, -80], span: 1100, labels: [[1572,201,-182], [1292,429,-127], [1379,703,-37], [1450,300,-175], [1660,420,-140], [1400,550,-110]]},
  car: {eye: [1650,1850,1250], look: [1650,1850,0], span: 1000, labels: [[1788,1812,1], [1739,1882,1], [1710,2185,1], [1625,1710,-1], [1744,2073,2]]},
  ninja: {eye: [400,2780,750], look: [400,2780,95], span: 400, labels: [[278,2764,137],[240,2800,95],[350,2750,95],[450,2750,95],[550,2750,95]]},
};
if (!regions[region]) throw new Error('Unknown region');
const browser = await chromium.launch({channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', quality: 'high', volume: 0}));
  });
  await page.goto('http://127.0.0.1:5176');
  await page.locator('canvas[data-duel]').waitFor();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine} = await import(url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(t) {window.coverageQA = this; return tick.call(this, t);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await page.locator('canvas[aria-label="Dust 2 prefire map"]').waitFor({timeout: 90000});
  await page.waitForFunction(() => window.coverageQA?.scenario?.map);
  await page.evaluate(async region => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const e = window.coverageQA; cancelAnimationFrame(e.frame); e.pause();
    const point = p => new THREE.Vector3(p[0] * .0254, p[2] * .0254, -p[1] * .0254);
    e.actors.visible = false; e.effects.visible = false; e.actorShadows.group.visible = false;
    e.scenario.guide.visible = false;
    const map = e.scenario.map.scene;
    map.traverse(node => {node.visible = true;});
    e.scene.fog = null;
    const camera = new THREE.OrthographicCamera(-region.span * .0254, region.span * .0254, region.span * .0254 / e.camera.aspect, -region.span * .0254 / e.camera.aspect, .1, 150);
    camera.position.copy(point(region.eye)); camera.up.set(0, 0, -1); camera.lookAt(point(region.look));
    camera.updateMatrixWorld(true);
    for (const [index, p] of region.labels.entries()) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(.35), new THREE.MeshBasicMaterial({color: '#ed3b90', depthTest: false}));
      mesh.position.copy(point(p)); mesh.position.y += 1; mesh.renderOrder = 999; e.scene.add(mesh);
      const position = mesh.position.clone().project(camera);
      const rect = e.renderer.domElement.getBoundingClientRect();
      const label = document.createElement('span'); label.textContent = `${index + 1}: ${p.join(', ')}`;
      Object.assign(label.style, {position: 'fixed', left: `${rect.left + (position.x + 1) * rect.width / 2}px`, top: `${rect.top + (1 - position.y) * rect.height / 2}px`, zIndex: 999, color: '#fff', background: '#171a1a', font: '14px monospace', padding: '2px'});
      document.body.append(label);
    }
    e.renderer.clear(); e.renderer.render(e.scene, camera);
    document.querySelector('.duel-entry')?.remove();
  }, regions[region]);
  fs.mkdirSync('research/dust2/requested-coverage', {recursive: true});
  await page.screenshot({path: `research/dust2/requested-coverage/${region}-overview.png`});
} finally {await browser.close();}
