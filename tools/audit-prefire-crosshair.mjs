import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto(process.env.PREFIRE_URL ?? 'http://127.0.0.1:5176/');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine} = await import(url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(t) {window.crosshairEngine = this; return tick.call(this, t);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await page.getByLabel('Prefire route').waitFor({timeout: 90000});
  await page.waitForFunction(() => window.crosshairEngine?.models?.get(1));
  const rows = [];
  for (const size of [{width: 1440, height: 1000}, {width: 1920, height: 1080}, {width: 1024, height: 768}, {width: 390, height: 844}]) {
    await page.setViewportSize(size);
    rows.push(...await page.evaluate(async viewport => {
      const e = window.crosshairEngine;
      const {Vector3} = await import('/node_modules/.vite/deps/three.js');
      const {direction} = await import('/src/range/shot-model.ts');
      const {WeaponRecovery} = await import('/src/range/ballistics.ts');
      const {equipmentStats} = await import('/src/range/equipment.ts');
      const p = e.sim.actors[0], samples = [];
      // A paused local-browser fixture keeps recoil and pose fixed while the
      // actual engine renders; it never changes shot math or creates a result.
      e.paused = true; e.sim.pause(); e.sim.phase = 'fighting';
      p.weapon.actions.scopeLevel = 0;
      for (const aspect of ['native', '4:3', '16:9']) for (const follow of [false, true]) for (const shots of [0, 5]) for (const remainder of [0, .003, .007]) {
        e.setSettings({...e.settings, aspect, follow});
        const recovery = new WeaponRecovery(equipmentStats('ak47'));
        for (let i = 0; i < shots; i++) {recovery.fire(); recovery.advance(.1);}
        p.weapon.recovery.angle = {...recovery.angle}; p.weapon.recovery.velocity = {...recovery.velocity};
        p.yaw = .57; p.pitch = .15;
        e.sim.accumulator = remainder; e.pacer.next = 0; e.last = performance.now(); e.tick(e.last + 100);
        const canvas = e.renderer.domElement.getBoundingClientRect(), cross = e.crosshair.getBoundingClientRect();
        const viewRay = new Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion);
        const recoil = p.weapon.recovery.predict(remainder), ray = direction(p.yaw - recoil.yaw * Math.PI / 180, p.pitch + recoil.pitch * Math.PI / 180);
        const projection = new Vector3().copy(ray).multiplyScalar(10).add(e.camera.position).project(e.camera);
        const projected = {x: canvas.left + (projection.x + 1) * canvas.width / 2, y: canvas.top + (1 - projection.y) * canvas.height / 2};
        samples.push({viewport, aspect, follow, shots, remainder, canvas: {x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height},
          engine: {width: e.width, height: e.height, aspect: e.camera.aspect},
          centerErrorPx: Math.hypot(cross.x - canvas.left - canvas.width / 2, cross.y - canvas.top - canvas.height / 2),
          followErrorPx: Math.hypot(cross.x - projected.x, cross.y - projected.y),
          rayErrorDegrees: Math.acos(Math.min(1, Math.max(-1, viewRay.dot(new Vector3().copy(ray))))) * 180 / Math.PI,
          cameraOriginError: e.camera.position.distanceTo(new Vector3().copy(p.position)),
          cross: {x: cross.x, y: cross.y}, projected});
      }
      return samples;
    }, size));
  }
  console.log(JSON.stringify({cases: rows.length, errors, maxRestRayErrorDegrees: Math.max(...rows.filter(row => !row.shots).map(row => row.rayErrorDegrees)), failures: rows.filter(row => row.follow ? row.followErrorPx > .01 : row.centerErrorPx > .01),
    ...(process.argv.includes('--verbose') ? {rows} : {})}, null, 2));
  assert.deepEqual(errors, []);
  if (process.argv.includes('--assert')) for (const row of rows) assert.ok(row.follow ? row.followErrorPx < .01 : row.centerErrorPx < .01, JSON.stringify(row));
} finally {await browser.close();}
