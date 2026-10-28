import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

const server = await createServer({server: {host: '127.0.0.1', port: 5197, strictPort: false}});
await server.listen();
const browser = await chromium.launch({headless: true});
const root = 'research/utility-presentation/screenshots'; fs.mkdirSync(root, {recursive: true});
const results = [];
try {
  for (const viewport of [{width: 1280, height: 800}, {width: 390, height: 844}]) {
    const page = await browser.newPage({viewport}); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.evaluate(async () => {
      const {THREE, UtilityRenderer} = await import('/tools/utility-presentation-preview.mjs');
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#273638');
      const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .05, 100);
      camera.position.set(0, 3, innerWidth < 600 ? 21 : 11); camera.lookAt(0, 1.2, 0);
      const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
      renderer.setSize(innerWidth, innerHeight); document.body.replaceChildren(renderer.domElement);
      Object.assign(document.body.style, {margin: '0', overflow: 'hidden'});
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({color: '#69787a'}));
      floor.rotation.x = -Math.PI / 2; scene.add(floor);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(.25, 3, 3), new THREE.MeshBasicMaterial({color: '#a3aaab'}));
      wall.position.set(-.5, 1.5, -.2); scene.add(wall);
      const effects = new UtilityRenderer(scene, new THREE.Group()); await effects.prepareParticles();
      const cells = [];
      for (let x = -3; x <= -1; x += .8) for (let y = .4; y < 3; y += .8) for (let z = -1.6; z < 1; z += .8)
        cells.push({x, y, z});
      const base = {id: 1, actorId: 0, side: 'player', radius: 4.2, startedAt: 0, expiresAt: 20, holes: []};
      const smoke = {...base, kind: 'smoke', type: 'smoke', position: {x: -2, y: 1, z: 0}, cells};
      const fire = {...base, id: 2, kind: 'molotov', type: 'fire', position: {x: 2, y: 0, z: 0},
        cells: Array.from({length: 18}, (_, i) => ({x: 1 + i % 6 * .4, y: 0, z: Math.floor(i / 6) * .4}))};
      window.utilityAudit = {renderer, effects, scene, camera, smoke, fire};
      window.renderUtilityAudit = (time, flash = false) => {
        effects.update([], [smoke, fire, ...(flash ? [{...base, id: 3, kind: 'flash', type: 'burst',
          startedAt: time - .03, expiresAt: time + .22, position: {x: 0, y: 2, z: 0}, cells: []}] : [])], time, camera);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(innerWidth * innerHeight * 4);
        renderer.getContext().readPixels(0, 0, innerWidth, innerHeight, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
        let energy = 0, warm = 0, hash = 0;
        for (let i = 0; i < pixels.length; i += 4) {energy += pixels[i] + pixels[i + 1] + pixels[i + 2];
          if (pixels[i] > pixels[i + 2] * 1.3 && pixels[i] > 90) warm++;
          hash = (Math.imul(hash, 31) + pixels[i] + pixels[i + 1]) | 0;}
        return {energy, warm, hash, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries};
      };
    });
    const first = await page.evaluate(() => window.renderUtilityAudit(2));
    await page.screenshot({path: `${root}/${viewport.width}-effects.png`});
    const second = await page.evaluate(() => window.renderUtilityAudit(2.2));
    assert(first.energy > 1e6 && first.warm > 30, 'Nonblank scene and visible native flames required');
    assert.notEqual(first.hash, second.hash, 'Native frame animation must move');
    assert.equal(first.geometries, second.geometries, 'No frame allocations');
    await page.evaluate(() => window.renderUtilityAudit(2.2, true));
    await page.screenshot({path: `${root}/${viewport.width}-flash.png`});
    assert.deepEqual(errors, []); results.push({viewport, first, second}); await page.close();
  }
  fs.writeFileSync(`${root}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
} finally {await browser.close(); await server.close();}
