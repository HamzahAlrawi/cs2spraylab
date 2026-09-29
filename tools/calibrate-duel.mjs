import {createServer} from 'vite';
import fs from 'node:fs/promises';

const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {DuelSimulation} = await vite.ssrLoadModule('/src/range/duel/simulation.ts');
  const {sanitizeDuelConfig} = await vite.ssrLoadModule('/src/range/duel/config.ts');
  const {testArena} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const results = [];
  const median = values => {values.sort((a, b) => a - b); return values.length ? Math.round(values[Math.floor(values.length / 2)] * 1000) / 1000 : null;};
  for (const skill of [1, 5, 10, '10+']) for (const moving of [false, true]) {
    let shots = 0, hits = 0, heads = 0, misses = 0;
    const firstShots = [], firstHits = [], lethalTimes = [];
    for (let seed = 1; seed <= 32; seed++) {
      const arena = {...testArena(), lanes: [{side: 1, role: 'entry',
        anchor: {x: 0, y: 0, z: -8}, edge: {x: 1.3, y: 0, z: -8}, retreat: {x: 0, y: 0, z: -8}}]};
      const sim = new DuelSimulation(sanitizeDuelConfig({skill, behavior: 'aggressive'}), seed, arena);
      sim.actors[0].health = 10000;
      let firstShot, firstHit, lethalTime, damage = 0;
      let side = 1;
      sim.start();
      for (let tick = 0; tick < 5 * 128; tick++) {
        if (moving) {
          if (sim.actors[0].position.x > 1.6) side = -1;
          if (sim.actors[0].position.x < -1.6) side = 1;
          sim.command(0, {side});
        }
        sim.step();
        for (const event of sim.drainEvents()) {
          if (event.kind === 'fire' && event.actorId === 1) {shots++; firstShot ??= sim.time;}
          if (event.kind === 'hit' && event.shooter === 1) {
            hits++; heads += +(event.group === 'head'); firstHit ??= sim.time;
            damage += event.healthDamage;
            if (damage >= 100) lethalTime ??= sim.time;
          }
        }
      }
      if (firstShot != null) firstShots.push(firstShot);
      if (firstHit != null) firstHits.push(firstHit); else misses++;
      if (lethalTime != null) lethalTimes.push(lethalTime);
    }
    results.push({skill, moving, encounters: 32, shots, hits, heads, hitPercent: +(hits / shots * 100).toFixed(1),
      noDamage: misses, firstShotMedian: median(firstShots), firstDamageMedian: median(firstHits),
      dealt100: lethalTimes.length, timeTo100Median: median(lethalTimes)});
  }
  await fs.mkdir('test-results', {recursive: true});
  await fs.writeFile(`test-results/duel-calibration-${process.argv[2] ?? 'current'}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {await vite.close();}
