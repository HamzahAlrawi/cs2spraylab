import {readFileSync, existsSync} from 'node:fs';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {NativeMapCollision} from '../prefire/native-collision';
import {placePrefireTarget} from '../prefire/placement';
import {prefireRoutes} from '../prefire/routes';
import {utilityKinds} from './utility-loadout';
import {UtilitySimulation, UTILITY_RULES} from './utilities';
import type {Arena} from './geometry';

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('utility contact in installed Dust 2 geometry', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    collision = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => collision?.dispose());
  it.each(utilityKinds)('%s uses the actual native floor, not a synthetic y=0 plane', kind => {
    const feet = placePrefireTarget(collision, prefireRoutes[0].spawn), sim = new UtilitySimulation(4);
    const arena: Arena = {...collision.bounds!, solids: [], native: collision};
    sim.throw({actorId: 0, side: 'player', kind, origin: {...feet, y: feet.y + .08},
      direction: {x: 0, y: -1, z: 0}, strength: 0, time: 0,
      velocity: {x: 0, y: UTILITY_RULES.throwSpeed * .3 / 1.25, z: 0}});
    let detonated = false;
    for (let tick = 1; tick <= 300; tick++) {
      const events = sim.advance(1 / 128, tick / 128, arena, []);
      for (const projectile of sim.projectiles) expect(projectile.position.y).toBeGreaterThan(feet.y - .08);
      detonated ||= events.some(event => event.type === 'detonate');
    }
    expect(detonated).toBe(true); expect(sim.projectiles).toHaveLength(0);
    for (const effect of sim.effects) expect(effect.position.y).toBeGreaterThan(feet.y - .08);
  });
});
