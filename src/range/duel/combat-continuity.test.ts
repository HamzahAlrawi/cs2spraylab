import {expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';
import {testArena, type Arena} from './geometry';

it.each(['ak47', 'mp9', 'hkp2000', 'deagle'] as const)('%s max-skill contact does not turn into a silent movement loop', weapon => {
  for (const seed of [5, 19, 31, 78]) {
    const arena: Arena = {...testArena(), minX: -25, maxX: 25,
      spawns: {player: {feet: {x: 0, y: 0, z: 0}, yaw: 0}, bots: [{feet: {x: 0, y: 0, z: -12}, yaw: Math.PI, lane: 0}]},
      lanes: [{side: 1, role: 'entry', anchor: {x: 0, y: 0, z: -12}, edge: {x: 1, y: 0, z: -12},
        retreat: {x: 0, y: 0, z: -13}, watch: {x: 0, y: 64 * UNIT, z: 0}}]};
    const simulation = new DuelSimulation(sanitizeDuelConfig({skill: '10+', weapons: [weapon],
      utilitiesEnabled: false, tradeEnabled: false, behavior: 'aggressive'}), seed, arena);
    simulation.actors[0].health = 100_000;
    simulation.start();
    let shots = 0, lastShot = 0, stalled = 0, longest = 0;
    for (let tick = 0; tick < 8 / STEP; tick++) {
      simulation.step();
      const events = simulation.drainEvents(), bot = simulation.actors[1];
      if (events.some(event => event.kind === 'fire' && event.actorId === 1)) {shots++; lastShot = simulation.time;}
      const decision = simulation.botDecision(1);
      const contact = decision?.sensorAge !== null && decision?.sensorAge !== undefined && decision.sensorAge < .075 &&
        !['no-sight', 'reaction', 'information-peek', 'reload', 'empty'].includes(decision.fireBlockedReason ?? '');
      stalled = shots >= 2 && contact && simulation.time - lastShot > .5 && bot.weapon.ammo > 0 ? stalled + STEP : 0;
      longest = Math.max(longest, stalled);
    }
    expect(shots, `seed ${seed}`).toBeGreaterThan(4);
    expect(longest, `seed ${seed}: ${JSON.stringify(simulation.botDecision(1))}`).toBeLessThan(1.2);
  }
});
