import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {DuelSimulation} = await vite.ssrLoadModule('/src/range/duel/simulation.ts');
  const {sanitizeDuelConfig} = await vite.ssrLoadModule('/src/range/duel/config.ts');
  const {duelArena} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const runs = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 19, 42, 101, 208, 431, 9001]) {
    const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1, roundSeconds: 25}), seed, duelArena(seed));
    sim.actors[0].health = 10000;
    sim.start();
    const roles = new Set(), peeks = new Set(), phases = new Set();
    let laneSwitches = 0, botShots = 0, botHits = 0, lastLane = '';
    let attacks = 0, emptyAttacks = 0, attackShots = 0, previousPhase = '';
    let travel = 0, last = sim.snapshot()[1].position;
    for (let tick = 0; tick < 25 * 128 && sim.phase === 'fighting'; tick++) {
      sim.step();
      const bot = sim.snapshot()[1];
      travel += Math.hypot(bot.position.x - last.x, bot.position.z - last.z);
      last = bot.position;
      const decision = sim.botDecision(1);
      if (decision) {
        if (decision.phase === 'attack' && previousPhase !== 'attack') {attacks++; attackShots = botShots;}
        if (decision.phase !== 'attack' && previousPhase === 'attack' && botShots === attackShots) emptyAttacks++;
        previousPhase = decision.phase;
        const lane = `${decision.role}:${decision.side}`;
        if (lastLane && lane !== lastLane) laneSwitches++;
        lastLane = lane;
        roles.add(decision.role); phases.add(decision.phase);
        if (decision.phase === 'expose') peeks.add(decision.peek);
      }
      for (const event of sim.drainEvents()) {
        if (event.kind === 'fire' && event.actorId === 1) botShots++;
        if (event.kind === 'hit' && event.shooter === 1) botHits++;
      }
    }
    runs.push({seed, roles: [...roles], peeks: [...peeks], phases: [...phases], laneSwitches,
      botShots, botHits, attacks, emptyAttacks, travel: +travel.toFixed(1)});
  }
  for (const run of runs) console.log(JSON.stringify(run));
  console.log(JSON.stringify({summary: {zeroShotRounds: runs.filter(run => !run.botShots).length,
    multiRouteRounds: runs.filter(run => run.roles.length > 1).length,
    multiPeekRounds: runs.filter(run => run.peeks.length > 1).length,
    totalHits: runs.reduce((total, run) => total + run.botHits, 0)}}));
} finally {
  await vite.close();
}
