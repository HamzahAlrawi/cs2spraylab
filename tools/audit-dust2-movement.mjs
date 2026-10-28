import fs from 'node:fs';
import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {settleNativePosition} = await vite.ssrLoadModule('/src/range/prefire/map.ts');
  const {prefireRoutes} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {advanceActor, idleInput, STEP, UNIT} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const {DuelWeaponState} = await vite.ssrLoadModule('/src/range/duel/weapon-state.ts');
  const {moveOnTerrain} = await vite.ssrLoadModule('/src/range/actor-collision.ts');
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  const manifest = JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
  const loadStarted = performance.now();
  collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const loadMs = performance.now() - loadStarted;
  const native = {solids: [], floor: null, native: collision};
  const actorAt = p => ({position: {...p, y: p.y + 64 * UNIT}, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0,
    feet: p.y, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true});
  const samples = new Map();
  for (const route of prefireRoutes) for (const point of [route.spawn, ...route.path, ...route.angles.map(a => a.position)]) {
    for (const [dx, dy] of [[0, 0], [-32, 0], [32, 0], [0, -32], [0, 32]]) {
      const source = [point[0] + dx, point[1] + dy, point[2]];
      let p; try {p = settleNativePosition(collision, source);} catch {continue;}
      samples.set([p.x, p.y, p.z].map(v => v.toFixed(3)).join(','), {p, source, route: route.id});
    }
  }
  const auditStarted = performance.now();
  const failures = [], summary = {build: manifest.build, collisionSha256: manifest.collisionSha256, loadMs: +loadMs.toFixed(2),
    samples: samples.size, stationaryTicks: 0, airborneTicks: 0,
    maxFeetDriftUnits: 0, maxGroundPenaltyError: 0, brakeComparisons: 0, groundBrakeComparisons: 0,
    maxGroundVelocityErrorUnits: 0, terrainTransitions: 0};
  const terrainTransitions = [];
  if (process.argv.includes('--motor-routes')) {
    for (const route of prefireRoutes) {
      let a = actorAt(settleNativePosition(collision, route.spawn));
      const segments = [];
      for (const point of route.path) {
        const target = settleNativePosition(collision, point);
        let tick = 0, air = 0, stopped = 0, maxRise = 0, maxVertical = 0, lostDistance = 0;
        for (; tick < 1600 && Math.hypot(target.x - a.position.x, target.z - a.position.z) > .16; tick++) {
          a.yaw = Math.atan2(-(target.x - a.position.x), -(target.z - a.position.z));
          const before = a;
          a = advanceActor(a, {...idleInput(), forward: 1}, 215 * UNIT, STEP, undefined, undefined, undefined, native);
          const distance = Math.hypot(a.position.x - before.position.x, a.position.z - before.position.z);
          const expected = Math.hypot(a.velocity.x, a.velocity.z) * STEP;
          air += Number(!a.grounded); stopped += Number(distance < .0001);
          maxRise = Math.max(maxRise, Math.abs(a.feet - before.feet) / UNIT);
          maxVertical = Math.max(maxVertical, Math.abs(a.verticalVelocity) / UNIT);
          lostDistance += Math.max(0, expected - distance) / UNIT;
          if (stopped > 128 && distance < .0001) break;
        }
        segments.push({point, ticks: tick, air, stopped, maxRise: +maxRise.toFixed(3), maxVertical: +maxVertical.toFixed(3),
          lostDistance: +lostDistance.toFixed(3), gap: +Math.hypot(target.x - a.position.x, target.z - a.position.z).toFixed(3),
          final: [a.position.x / UNIT, -a.position.z / UNIT, a.feet / UNIT]});
      }
      console.log(JSON.stringify({motorRoute: route.id, segments}));
    }
  }
  for (const {p, source, route} of samples.values()) {
    let a = actorAt(p);
    const gun = new DuelWeaponState('ak47', () => .5);
    const referenceGun = new DuelWeaponState('ak47', () => .5);
    const flat = {solids: [], floor: p.y};
    let reference = actorAt(p), airborne = 0, drift = 0, accuracyError = 0;
    for (let tick = 0; tick < 256; tick++) {
      const input = {...idleInput(), crouch: tick >= 64 && tick < 160};
      a = advanceActor(a, input, 215 * UNIT, STEP, undefined, undefined, undefined, native);
      reference = advanceActor(reference, input, 215 * UNIT, STEP, undefined, undefined, undefined, flat);
      gun.advancePassive((tick + 1) * STEP, STEP, (a.duckAmount ?? 0) >= .95, !a.grounded);
      referenceGun.advancePassive((tick + 1) * STEP, STEP, (reference.duckAmount ?? 0) >= .95, !reference.grounded);
      airborne += Number(!a.grounded);
      drift = Math.max(drift, Math.abs(a.feet - p.y) / UNIT);
      accuracyError = Math.max(accuracyError, Math.abs(gun.recovery.penalty - referenceGun.recovery.penalty));
    }
    summary.stationaryTicks += 256; summary.airborneTicks += airborne;
    summary.maxFeetDriftUnits = Math.max(summary.maxFeetDriftUnits, drift);
    summary.maxGroundPenaltyError = Math.max(summary.maxGroundPenaltyError, accuracyError);
    if (airborne || drift > .1 || accuracyError > 1e-6) failures.push({kind: 'stationary', route, source, airborne, drift, accuracyError});
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const to = {...p, x: p.x - Math.sin(yaw) * 4, z: p.z - Math.cos(yaw) * 4};
      const reverse = {...p, x: p.x + Math.sin(yaw), z: p.z + Math.cos(yaw)};
      if (collision.sweep(p, to, 72 * UNIT).fraction < .999 || collision.sweep(p, reverse, 72 * UNIT).fraction < .999) continue;
      a = {...actorAt(p), yaw, velocity: {x: -Math.sin(yaw) * 215 * UNIT, z: -Math.cos(yaw) * 215 * UNIT}};
      reference = {...a, position: {...a.position}, velocity: {...a.velocity}};
      let error = 0, airborne = 0, feetDrift = 0;
      for (let tick = 0; tick < 24; tick++) {
        const input = {...idleInput(), forward: tick >= 4 ? -1 : 0};
        a = advanceActor(a, input, 215 * UNIT, STEP, undefined, undefined, undefined, native);
        reference = advanceActor(reference, input, 215 * UNIT, STEP, undefined, undefined, undefined, flat);
        error = Math.max(error, Math.hypot(a.velocity.x - reference.velocity.x, a.velocity.z - reference.velocity.z) / UNIT);
        airborne += Number(!a.grounded);
        feetDrift = Math.max(feetDrift, Math.abs(a.feet - p.y) / UNIT);
      }
      summary.brakeComparisons++;
      // Walking off real crates/ledges must differ from an infinite flat floor.
      // Report those transitions separately rather than calling them friction errors.
      if (airborne) {
        summary.terrainTransitions++;
        terrainTransitions.push({route, source, yaw, airborne, feetDrift});
      } else {
        summary.groundBrakeComparisons++;
        if (process.argv.includes('--brake-samples') && summary.groundBrakeComparisons <= 12) {
          console.log(JSON.stringify({source, yaw, error}));
        }
        summary.maxGroundVelocityErrorUnits = Math.max(summary.maxGroundVelocityErrorUnits, error);
        if (error > .1) failures.push({kind: 'braking', route, source, yaw, error, feetDrift});
      }
    }
  }
  summary.auditMs = +(performance.now() - auditStarted).toFixed(2);
  summary.verticalIndexBytes = [...collision.columns.values()].reduce((sum, values) => sum + values.byteLength, 0);
  if (process.argv.includes('--routes')) {
    for (const route of prefireRoutes) {
      let p = settleNativePosition(collision, route.spawn);
      const segments = [];
      for (const point of route.path) {
        const target = settleNativePosition(collision, point);
        for (let tick = 0; tick < 2400 && Math.hypot(target.x - p.x, target.z - p.z) > .08; tick++) {
          const d = Math.hypot(target.x - p.x, target.z - p.z);
          const moved = moveOnTerrain(p, {...p, x: p.x + (target.x - p.x) / d * .05,
            z: p.z + (target.z - p.z) / d * .05}, 72 * UNIT, native, true);
          if (Math.hypot(moved.position.x - p.x, moved.position.z - p.z) < 1e-6) break;
          p = moved.position;
        }
        const gap = Math.hypot(target.x - p.x, target.z - p.z);
        if (gap > .15) segments.push({point, gap, stopped: [p.x / UNIT, -p.z / UNIT, p.y / UNIT]});
      }
      console.log(JSON.stringify({route: route.id, blockedSegments: segments}));
    }
  }
  console.log(JSON.stringify({summary, failures: failures.slice(0, 60), failureCount: failures.length,
    terrainTransitions: terrainTransitions.slice(0, 12)}, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {collision?.dispose(); await vite.close();}
