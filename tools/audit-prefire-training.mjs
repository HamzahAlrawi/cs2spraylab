// Offline trainer QA only. Walk native courses and resolve real simulated shots;
// never attach to CS2 or include this automated test driver in the browser build.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import * as THREE from 'three';
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {PrefireSession} = await vite.ssrLoadModule('/src/range/prefire/session.ts');
  const {prefireRoutes, sourcePoint} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {sanitizePrefireConfig} = await vite.ssrLoadModule('/src/range/prefire/config.ts');
  const {defaults} = await vite.ssrLoadModule('/src/range/config.ts');
  const {actorHeadPoint, traceActor} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const {idleCommand} = await vite.ssrLoadModule('/src/range/duel/types.ts');
  const {STEP, DEG, UNIT, groundVelocity} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const map = {collision, scene: new THREE.Group(), dispose() {}};
  const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const heading = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const runs = [], failures = [];
  for (const route of prefireRoutes) for (const seed of [7, 42]) {
    const session = new PrefireSession(map, sanitizePrefireConfig({routeId: route.id, botBehavior: 'static', returnFire: false}));
    const sim = session.create(defaults, seed), targets = route.path.map(sourcePoint);
    let waypoint = 0, shots = 0, hits = 0, movingShots = 0, farthestShot = 0, firstShotAt, nextTapAt = 0;
    const successfulShots = new Set();
    sim.start();
    while (sim.phase === 'fighting') {
      const player = sim.actors[0], command = idleCommand(), speed = Math.hypot(player.velocity.x, player.velocity.z);
      let exposed;
      // This QA driver checks physically hittable points in every direction. It
      // is a clearance/weapon test, not a benchmark of human awareness or score.
      for (const bot of sim.actors.slice(1)) {
        if (!bot.alive) continue;
        const head = actorHeadPoint({...bot.position, y: bot.feet}, bot.duckAmount, bot.yaw);
        for (const offset of [0, -.085, .085]) {
          const point = {...head, x: head.x + offset}, d = Math.hypot(point.x - player.position.x, point.y - player.position.y, point.z - player.position.z);
          const direction = {x: (point.x - player.position.x) / d, y: (point.y - player.position.y) / d, z: (point.z - player.position.z) / d};
          const hit = traceActor(player.position, direction, {...bot.position, y: bot.feet}, bot.duckAmount, d + .5, bot.yaw);
          if (hit.group !== 'head' || collision.ray(player.position, direction, hit.distance - .0001)) continue;
          if (!exposed || d < exposed.distance) exposed = {point, distance: d};
        }
      }
      if (exposed) {
        const recoil = player.weapon.recovery.predict(STEP);
        const yaw = heading(player.position, exposed.point) + recoil.yaw * DEG;
        command.yawDelta = angleDelta(player.yaw, yaw);
        command.pitchDelta = Math.atan2(exposed.point.y - player.position.y,
          Math.hypot(exposed.point.x - player.position.x, exposed.point.z - player.position.z)) - recoil.pitch * DEG - player.pitch;
        // Braking is real shared-motor input, not a direct velocity assignment.
        if (speed > .12) {
          const cap = player.weapon.actions.stats.speed * UNIT;
          const prediction = groundVelocity(player.velocity.x, player.velocity.z, -player.velocity.x / speed,
            -player.velocity.z / speed, cap, STEP, {weaponSpeed: cap, ducking: false, walking: false});
          if (prediction.x * player.velocity.x + prediction.z * player.velocity.z > 0) {
            command.side = (-player.velocity.x * Math.cos(yaw) + player.velocity.z * Math.sin(yaw)) / speed;
            command.forward = (player.velocity.x * Math.sin(yaw) + player.velocity.z * Math.cos(yaw)) / speed;
          }
        } else if (sim.time >= nextTapAt) command.firePressed = true;
        farthestShot = Math.max(farthestShot, exposed.distance);
      } else {
        const target = targets[waypoint], remaining = Math.hypot(target.x - player.position.x, target.z - player.position.z);
        const yaw = heading(player.position, target);
        command.yawDelta = angleDelta(player.yaw, yaw); command.pitchDelta = -player.pitch;
        if (remaining < .18 && speed < .12) waypoint = Math.min(waypoint + 1, targets.length - 1);
        else if (remaining < .10 + speed * .065) command.forward = speed > .12 ? -1 : 0;
        else command.forward = 1;
      }
      if (player.weapon.ammo === 0) {command.reloadPressed = !player.weapon.reloadUntil; command.fireHeld = false;}
      sim.command(0, command); sim.step();
      for (const event of sim.drainEvents()) {
        if (event.kind === 'fire' && event.actorId === 0) {
          shots++; firstShotAt ??= sim.time;
          nextTapAt = sim.time + (exposed?.distance > 15 ? .4 : .12);
          movingShots += Number(Math.hypot(player.velocity.x, player.velocity.z) > .12 || !player.grounded);
        }
        if (event.kind === 'hit' && event.shooter === 0) {hits++; successfulShots.add(event.shotId);}
      }
    }
    const stats = session.report(sim), progress = session.report(sim).progress;
    const run = {route: route.id, seed, outcome: sim.outcome, seconds: sim.time, kills: stats.kills, total: stats.total,
      waypoint, shots, hits, movingShots, farthestShot, firstShotAt, quality: stats.score, openingStopped: stats.openingStopped,
      readyAim: stats.readyAim, cleanEntries: stats.cleanEntries, isolated: stats.isolation, historyRecords: progress.attempts};
    runs.push(run); console.log(JSON.stringify(run));
    if (sim.outcome !== 'won') failures.push({route: route.id, seed, code: 'course-not-cleared-by-driver', remaining: sim.actors.slice(1).filter(a => a.alive).map(a => a.id),
      player: {position: sim.actors[0].position, velocity: sim.actors[0].velocity, grounded: sim.actors[0].grounded}});
    if (shots !== stats.shots || Math.abs(stats.accuracy - (shots ? successfulShots.size / shots * 100 : 0)) > 1e-8 ||
      stats.kills !== stats.total || progress.attempts !== 1 || movingShots || stats.score === null || !Number.isFinite(stats.score) || stats.score < 0 || stats.score > 100) {
      failures.push({route: route.id, seed, code: 'training-stats-mismatch', run});
    }
  }
  const file = 'research/dust2/training-clearance.json'; fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({date: '2026-10-10', limits: 'Offline clearance driver, not human skill or FACEIT calibration. Native cover, movement, ammunition, spread and hit resolution remain enabled.', runs, failures}, null, 2));
  console.log(JSON.stringify({file, runs: runs.length, failures}, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {collision?.dispose(); await vite.close();}
