import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {STEP, UNIT, type Vec} from '../actor-physics';
import {gameData} from '../config';
import {NativeMapCollision} from '../prefire/native-collision';
import {sanitizeDuelConfig} from './config';
import type {Arena} from './geometry';
import {nativeClearSegment} from './native-navigation';
import type {RoundCatalog} from './real-map-rounds';
import data from './real-map-round-data.json';
import {DuelSimulation} from './simulation';

const chunks = ['dust2-mid-ct', 'dust2-long-doors'];
const base = (chunk: string) => `public/revamp/maps/dust2/duel/${chunk}/`;
const facing = (from: Vec, to: Vec) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

// Source-only checkouts deliberately omit the extracted native geometry.
describe.skipIf(chunks.some(chunk => !existsSync(base(chunk) + 'collision.bin')))('combat steps on pinned native map collision', () => {
  it.each(chunks)('executes rifle stops and mobile SMG shots on %s without moving through the map', async chunk => {
    const bytes = readFileSync(base(chunk) + 'collision.bin');
    const collision = await NativeMapCollision.create(JSON.parse(readFileSync(base(chunk) + 'collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      const catalog = (data as unknown as RoundCatalog).chunks[chunk];
      expect(collision.collisionSha256).toBe(catalog.collisionSha256);
      const arena: Arena = {...collision.bounds!, native: collision, solids: []};
      let placement: {player: Vec; bot: Vec; lane: NonNullable<Arena['lanes']>[number]} | undefined;
      outer: for (const course of catalog.courses) for (const hold of course.holds) for (const view of course.views) {
        const bot = hold.lane.edge, eye = {...bot, y: bot.y + 64 * UNIT};
        const d = Math.hypot(view.x - eye.x, view.y - eye.y, view.z - eye.z);
        if (d < 6 || d > 11 || !collision.fits(view, view.y - 64 * UNIT, 72 * UNIT) || !collision.fits(bot, bot.y, 72 * UNIT)) continue;
        if (collision.ray(eye, {x: (view.x - eye.x) / d, y: (view.y - eye.y) / d, z: (view.z - eye.z) / d}, d - .02)) continue;
        const dx = view.x - eye.x, dz = view.z - eye.z, horizontal = Math.hypot(dx, dz);
        if (![-1, 1].some(sign => nativeClearSegment(bot,
          {x: bot.x - dz / horizontal * sign * 1.5, y: bot.y, z: bot.z + dx / horizontal * sign * 1.5}, arena))) continue;
        placement = {player: {...view, y: view.y - 64 * UNIT}, bot, lane: hold.lane}; break outer;
      }
      expect(placement, 'Needs a sourced visible engagement with a physically reachable combat step').toBeDefined();
      const setup = placement!;
      let mobileShots = 0;
      for (const weapon of ['ak47', 'mp9'] as const) {
        const world = {...arena, lanes: [setup.lane], spawns: {player: {feet: setup.player, yaw: facing(setup.player, setup.bot)},
          bots: [{feet: setup.bot, yaw: facing(setup.bot, setup.player), lane: 0}]}};
        const sim = new DuelSimulation(sanitizeDuelConfig({weapons: [weapon], skill: 10, behavior: 'holder',
          utilitiesEnabled: false, radarEnabled: false, roundSeconds: 20}), 19, world);
        sim.actors[0].health = 10000; sim.start();
        let movement = 0, shots = 0;
        for (let tick = 0; tick < 7 / STEP && sim.phase === 'fighting'; tick++) {
          sim.step();
          const bot = sim.actors[1];
          movement = Math.max(movement, Math.hypot(bot.position.x - setup.bot.x, bot.position.z - setup.bot.z));
          if (tick % 16 === 0) expect(collision.fits(bot.position, bot.feet, (72 - 18 * (bot.duckAmount ?? 0)) * UNIT)).toBe(true);
          for (const event of sim.drainEvents()) if (event.kind === 'fire' && event.actorId === 1 && event.equipment === weapon) {
            shots++;
            if (weapon === 'ak47') expect(event.accuracy!.speedUnits).toBeLessThanOrEqual(gameData.weapons.ak47.speed * .21);
            else if (event.accuracy!.speedUnits > gameData.weapons.mp9.speed * .5) {
              mobileShots++; expect(event.accuracy!.movementInaccuracy).toBeGreaterThan(0);
            }
          }
        }
        expect(shots, weapon).toBeGreaterThan(2);
        expect(movement, weapon).toBeGreaterThan(.45);
      }
      expect(mobileShots).toBeGreaterThan(0);
    } finally {collision.dispose();}
  }, 30000);
});
