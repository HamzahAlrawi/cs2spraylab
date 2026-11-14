import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

const server = await createServer({server: {host: '127.0.0.1', port: 5198, strictPort: false}});
await server.listen();
const browser = await chromium.launch({headless: true});
const directory = 'research/native-breakables-audit'; fs.mkdirSync(directory, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 800}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  const result = await page.evaluate(async () => {
    const {THREE} = await import('/tools/utility-presentation-preview.mjs');
    const {loadNativeMap} = await import('/src/range/prefire/map.ts');
    const metadata = await (await fetch('/maps/mirage/visual.json')).json();
    const map = await loadNativeMap(undefined, {base: '/maps/mirage/', visibility: false});
    const checks = [];
    for (const entity of metadata.nativeEntities.entities.filter(e => e.health > 0)) {
      map.collision.resetEntities();
      const nodes = []; map.scene.traverse(node => {if (node.userData.nativeEntityId === entity.id) nodes.push(node);});
      if (!nodes.length) throw Error(`Missing native visual identity: ${entity.id}`);
      const vertices = entity.vertices, indices = entity.indices;
      let shot;
      for (let t = 0; t < indices.length && !shot; t += 3) {
        const a = new THREE.Vector3().fromArray(vertices, indices[t] * 3), b = new THREE.Vector3().fromArray(vertices, indices[t + 1] * 3),
          c = new THREE.Vector3().fromArray(vertices, indices[t + 2] * 3);
        const center = a.clone().add(b).add(c).divideScalar(3), normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        for (const sign of [1, -1]) {
          const direction = normal.clone().multiplyScalar(-sign), origin = center.clone().addScaledVector(normal, sign * .15);
          const hit = map.collision.ray(origin, direction, .3);
          if (hit?.entityId === entity.id) {shot = {origin, direction}; break;}
        }
      }
      if (!shot) throw Error(`Native entity cannot be shot: ${entity.id}`);
      const before = map.collision.ray(shot.origin, shot.direction, .3);
      const to = shot.origin.clone().addScaledVector(shot.direction, .3);
      const grenadeBefore = map.collision.sweepGrenade(shot.origin, to, .01).fraction;
      const broken = map.collision.damageEntity(entity.id, 100);
      const after = map.collision.ray(shot.origin, shot.direction, .3);
      if (!broken || nodes.some(node => node.visible) || after?.entityId === entity.id) throw Error(`Native entity did not break: ${entity.id}`);
      const grenadeAfter = map.collision.sweepGrenade(shot.origin, to, .01).fraction;
      checks.push({id: entity.id, nodes: nodes.length, before: before.distance, after: after?.distance ?? null, grenadeBefore, grenadeAfter});
    }
    map.collision.resetEntities();
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#283333'); scene.add(map.scene, new THREE.HemisphereLight(0xffffff, 0x666666, 2));
    const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .01, 300);
    const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true}); renderer.setSize(innerWidth, innerHeight);
    document.body.replaceChildren(renderer.domElement); Object.assign(document.body.style, {margin: '0', overflow: 'hidden'});
    const entity = metadata.nativeEntities.entities.find(e => e.model.endsWith('/wall_hole_cover_sheetmetal.vmdl'));
    const box = new THREE.Box3(); for (let i = 0; i < entity.vertices.length; i += 3) box.expandByPoint(new THREE.Vector3().fromArray(entity.vertices, i));
    const center = box.getCenter(new THREE.Vector3()); camera.position.copy(center).add(new THREE.Vector3(1.8, .2, 0)); camera.lookAt(center);
    renderer.render(scene, camera);
    window.nativeBreakableAudit = {map, scene, camera, renderer, entity};
    return {checks, entityCount: metadata.nativeEntities.entities.length};
  });
  assert(result.checks.length >= 9);
  const covers = result.checks.filter(check => /:3758$|:4063$/.test(check.id));
  assert.equal(covers.length, 2);
  for (const check of covers) assert(check.grenadeAfter > check.grenadeBefore + .1, `Cover must open for grenades: ${check.id}`);
  await page.screenshot({path: `${directory}/window-vent-before.png`});
  await page.evaluate(() => {
    const {map, scene, camera, renderer, entity} = window.nativeBreakableAudit;
    map.collision.damageEntity(entity.id, 100); renderer.render(scene, camera);
  });
  await page.screenshot({path: `${directory}/window-vent-after.png`});
  await page.evaluate(() => {window.nativeBreakableAudit.map.dispose(); window.nativeBreakableAudit.renderer.dispose();});
  const chunks = await page.evaluate(async () => {
    const {loadRealMapChunk, createRealMapArena} = await import('/src/range/duel/real-map.ts');
    const {nativeMaps} = await import('/src/range/prefire/maps/index.ts');
    const {DuelSimulation} = await import('/src/range/duel/simulation.ts');
    const {sanitizeDuelConfig} = await import('/src/range/duel/config.ts');
    const {stanceCurve} = await import('/src/range/actor-physics.ts');
    const results = [];
    for (const id of ['mirage-mid', 'mirage-b']) {
      const chunk = nativeMaps.get('de_mirage').chunks.find(chunk => chunk.id === id);
      const map = await loadRealMapChunk(chunk, new AbortController().signal);
      try {
        const nodes = []; map.scene.traverse(node => {if (node.userData.nativeEntityId) nodes.push(node);});
        if (!nodes.length) throw Error(`Chunk lost native mutable identities: ${id}`);
        const idSet = new Set(nodes.map(node => node.userData.nativeEntityId));
        let broken = 0;
        for (const entityId of idSet) {
          const event = map.collision.damageEntity(entityId, 100);
          if (!event) continue;
          broken++;
          map.updateVisibility?.(event.point);
          if (nodes.some(node => node.userData.nativeEntityId === entityId && node.visible)) throw Error('PVS resurrected a destroyed prop');
        }
        map.collision.resetEntities();
        if (!broken) throw Error(`Chunk has no hittable native breakables: ${id}`);
        for (const seed of [1, 7, 42, 256]) {
          const config = sanitizeDuelConfig({botCount: 5, mapId: 'de_mirage', mapPool: ['de_mirage']});
          const sim = new DuelSimulation(config, seed, createRealMapArena(map, chunk, config, seed));
          for (const actor of sim.actors.slice(1)) sim.command(actor.id, {});
          sim.start(); sim.advance(.05);
          for (const actor of sim.actors) {
            const height = (72 - 18 * stanceCurve(actor.duckAmount ?? 0)) * .0254;
            if (!map.collision.fits(actor.position, actor.feet, height)) throw Error(`Native prop blocks ${id}/${seed}/actor ${actor.id}`);
          }
        }
        results.push({id, entities: idSet.size, broken, fiveBotSpawnSeeds: 4});
      } finally {map.dispose();}
    }
    return results;
  });
  assert.deepEqual(errors, []);
  result.chunks = chunks;
  fs.writeFileSync(`${directory}/results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {await browser.close(); await server.close();}
