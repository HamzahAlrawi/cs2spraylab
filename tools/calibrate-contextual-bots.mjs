import {createServer} from 'vite';
import fs from 'node:fs/promises';

const count = Math.max(4, Math.min(128, Number(process.env.BOT_SEEDS) || 12));
const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {DuelSimulation} = await vite.ssrLoadModule('/src/range/duel/simulation.ts');
  const {sanitizeDuelConfig} = await vite.ssrLoadModule('/src/range/duel/config.ts');
  const {testArena, traceSolid} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const {observeBot} = await vite.ssrLoadModule('/src/range/duel/perception.ts');
  const {UNIT} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const scenarios = ['open-hold', 'lateral-stop', 'cover-repeek', 'long-angle', 'low-ammo', 'death-trade'];
  const quantiles = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return {samples: sorted.length, p10: sorted.length ? sorted[Math.floor((sorted.length - 1) * .1)] : null,
      p50: sorted.length ? sorted[Math.floor((sorted.length - 1) * .5)] : null,
      p90: sorted.length ? sorted[Math.floor((sorted.length - 1) * .9)] : null};
  };
  const encounters = [];
  for (const level of [1, 3, 5, 8, 10, '10+']) for (const name of scenarios) for (let seed = 1; seed <= count; seed++) {
    const arena = {...testArena(), lanes: [{side: 1, role: 'entry', anchor: {x: 0, y: 0, z: -8},
      edge: {x: 1.6, y: 0, z: -8}, retreat: {x: 0, y: 0, z: -9}}]};
    if (name === 'cover-repeek') arena.solids.push({center: {x: 0, y: 1.4, z: 1}, size: {x: 1.5, y: 2.8, z: .5}, kind: 'concrete'});
    const sim = new DuelSimulation(sanitizeDuelConfig({skill: level, behavior: 'mixed',
      botCount: name === 'death-trade' ? 2 : 1, tradeEnabled: true, weapons: ['ak47']}), seed, arena);
    const player = sim.actors[0];
    Object.assign(player, {position: {x: 0, y: 64 * UNIT, z: name === 'long-angle' ? 11 : 7}, health: 10000});
    for (const [index, actor] of sim.actors.slice(1).entries()) {
      Object.assign(actor, {position: {x: index * 1.3, y: 64 * UNIT, z: name === 'long-angle' ? -18 : -7}, yaw: Math.PI});
      if (name === 'low-ammo') actor.weapon.ammo = 2;
    }
    let firstSeen, firstShot, firstDamage, damage = 0, shots = 0, hits = 0, heads = 0;
    let exposedNoFire = 0, exposed = 0, corpseAt;
    sim.start();
    for (let tick = 0; tick < 8 * 128 && sim.phase === 'fighting'; tick++) {
      const time = tick / 128;
      if (name === 'lateral-stop') sim.command(0, {side: time < 1.2 ? 1 : time < 1.35 ? -1 : 0});
      if (name === 'cover-repeek') sim.command(0, {side: time < .6 ? 0 : time < .95 ? 1 : time < 1.7 ? 0 : time < 2.05 ? -1 : time < 2.5 ? 0 : time < 2.85 ? 1 : 0});
      if (name === 'death-trade' && tick === 160) {
        player.yaw = 0; player.pitch = 0;
        sim.command(0, {firePressed: true, fireHeld: true});
      }
      const view = sim.snapshot(), sensed = observeBot(sim.time, view[1], [view[0]], sim.arena).visible;
      if (sensed) {firstSeen ??= sim.time; exposed++;}
      sim.step();
      let fired = false;
      for (const event of sim.drainEvents()) {
        if (event.kind === 'fire' && event.actorId > 0) {shots++; firstShot ??= sim.time; fired = true;}
        if (event.kind === 'hit' && event.shooter > 0) {
          hits++; heads += Number(event.group === 'head'); damage += event.healthDamage; firstDamage ??= sim.time;
        }
        if (event.kind === 'hit' && event.lethal && event.victim > 0) corpseAt ??= sim.time;
      }
      if (sensed && !fired && sim.time - (firstSeen ?? sim.time) > 1.5) exposedNoFire++;
    }
    const body = sim.actors[1], ray = {x: player.position.x - body.position.x, y: player.position.y - body.position.y, z: player.position.z - body.position.z};
    const range = Math.hypot(ray.x, ray.y, ray.z);
    encounters.push({level, scenario: name, seed, weapon: 'ak47', shots, hits, heads, damage, exposedTicks: exposed,
      exposedQuietTicks: exposedNoFire, firstSeen: firstSeen ?? null,
      firstVisibilityToShot: firstShot !== undefined && firstSeen !== undefined ? firstShot - firstSeen : null,
      timeToDamage: firstDamage !== undefined && firstSeen !== undefined ? firstDamage - firstSeen : null,
      noDamage: firstDamage === undefined, casualtyAt: corpseAt ?? null,
      finalBlocked: traceSolid(body.position, {x: ray.x / range, y: ray.y / range, z: ray.z / range}, sim.arena, range - .01).distance < range - .01});
  }
  const summary = [];
  for (const level of [1, 3, 5, 8, 10, '10+']) for (const scenario of scenarios) {
    const rows = encounters.filter(row => row.level === level && row.scenario === scenario);
    summary.push({level, scenario, encounters: rows.length, noDamage: rows.filter(row => row.noDamage).length,
      shots: rows.reduce((n, row) => n + row.shots, 0), hits: rows.reduce((n, row) => n + row.hits, 0),
      firstVisibilityToShot: quantiles(rows.map(row => row.firstVisibilityToShot)), timeToDamage: quantiles(rows.map(row => row.timeToDamage))});
  }
  const report = {schemaVersion: 1, provenance: {source: 'SprayLab browser simulation scenarios',
    measuredHumanData: false, warning: 'Training heuristics. First visibility to shot includes aim/motor time, not raw human reaction. Successful-encounter quantiles exclude censored misses; noDamage reports those explicitly.'},
    seeds: count, summary, encounters};
  await fs.mkdir('test-results', {recursive: true});
  await fs.writeFile('test-results/contextual-bot-calibration.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({seeds: count, encounters: encounters.length, summary}, null, 2));
} finally {await vite.close();}
