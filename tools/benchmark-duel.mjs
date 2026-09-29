import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {DuelSimulation} = await vite.ssrLoadModule('/src/range/duel/simulation.ts');
  const {sanitizeDuelConfig} = await vite.ssrLoadModule('/src/range/duel/config.ts');
  const {duelArena} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  for (const botCount of [1, 5]) {
    const arena = duelArena(431);
    const sim = new DuelSimulation(sanitizeDuelConfig({botCount, roundSeconds: 20}), 431, arena);
    sim.actors[0].health = 10000;
    sim.start();
    const durations = [];
    let botShots = 0, playerHits = 0;
    const start = performance.now();
    for (let tick = 0; tick < 3840 && sim.phase === 'fighting'; tick++) {
      const before = performance.now();
      sim.step();
      durations.push(performance.now() - before);
      for (const event of sim.drainEvents()) {
        if (event.kind === 'fire' && event.actorId > 0) botShots++;
        if (event.kind === 'hit' && event.victim === 0) playerHits++;
      }
    }
    durations.sort((a, b) => a - b);
    const percentile = p => Number(durations[Math.floor((durations.length - 1) * p)].toFixed(4));
    console.log(JSON.stringify({botCount, ticks: durations.length, elapsedMs: Number((performance.now() - start).toFixed(1)),
      tickMs: {p50: percentile(.5), p95: percentile(.95), p99: percentile(.99)},
      outcome: sim.outcome ?? 'fighting', simulatedSeconds: +sim.time.toFixed(2), botShots, playerHits,
      positions: sim.snapshot().slice(1).map(actor => ({x: +actor.position.x.toFixed(2), z: +actor.position.z.toFixed(2)}))}));
  }
} finally {
  await vite.close();
}
