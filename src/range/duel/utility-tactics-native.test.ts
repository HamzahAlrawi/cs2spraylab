import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import {NativeMapCollision} from '../prefire/native-collision';
import type {DuelActorSnapshot} from './types';
import type {Arena} from './geometry';
import {BotUtilityPlanner} from './utility-tactics';
import {UtilitySimulation} from './utilities';
import {utilityInventory, type UtilityKind} from './utility-loadout';
import setups from './utility-opportunities.json';
import rounds from './real-map-round-data.json';
import {traceSolid} from './geometry';

const chunks = ['dust2-mid-ct'];
const base = (chunk: string) => `public/revamp/maps/dust2/duel/${chunk}/`;
const actor = (entry: typeof setups.entries[number]): DuelActorSnapshot => ({id: 1, generation: 0, side: 'enemy',
  position: {...entry.eye}, feet: entry.feet.y, velocity: {x: 0, z: 0}, yaw: entry.yaw, pitch: entry.pitch,
  grounded: true, verticalVelocity: 0, crouched: false, duckAmount: 0, health: 100, armor: 100,
  helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});

describe.skipIf(chunks.some(chunk => !existsSync(base(chunk) + 'collision.bin')))('bounded native-chunk utility planning cost', () => {
  it.each(chunks)('measures positive and four-candidate rejection on %s', async chunk => {
    const bytes = readFileSync(base(chunk) + 'collision.bin');
    const collision = await NativeMapCollision.create(JSON.parse(readFileSync(base(chunk) + 'collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const launches = vi.spyOn(UtilitySimulation.prototype, 'throw');
    try {
      const arena: Arena = {...collision.bounds!, native: collision, solids: []};
      let witness: {self: DuelActorSnapshot; point: DuelActorSnapshot['position']; seed: number; milliseconds: number} | undefined;
      const candidates = setups.entries.filter(item => item.chunk === chunk && item.kind !== 'smoke');
      const covered = (from: DuelActorSnapshot['position'], to: DuelActorSnapshot['position']) => {
        const d = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
        return traceSolid(from, {x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d}, arena, d).distance < d - .01;
      };
      for (const course of rounds.chunks[chunk as keyof typeof rounds.chunks].courses) for (const hold of course.holds) {
        for (const feet of [hold.lane.anchor, hold.lane.retreat]) for (const point of course.views) {
          const eye = {...feet, y: feet.y + 1.6256}, d = Math.hypot(point.x - feet.x, point.z - feet.z);
          if (d < 7 || d > 25 || !covered(eye, point) || !covered({...eye, y: feet.y + .9}, point)) continue;
          for (const kind of ['molotov', 'he', 'flash'] as const) candidates.push({...setups.entries[0], id: 'covered-course', chunk,
            feet, eye, kind, target: {...point, y: point.y - (kind === 'flash' ? .1 : 1.2)}, yaw: 0, pitch: 0});
          break;
        }
        if (candidates.length > 100) break;
      }
      outer: for (const entry of candidates) {
        const self = actor(entry), point = {...entry.target, y: entry.target.y + (entry.kind === 'flash' ? .1 : 1.2)};
        for (let seed = 1; seed <= 8; seed++) {
          const planner = new BotUtilityPlanner(seed, 1, 10), before = performance.now();
          const command = planner.command(3, self, utilityInventory([entry.kind as UtilityKind]),
            {point, observedAt: 3, readyAt: 3, source: 'sight'}, arena,
            {visible: false, lastShotAt: -Infinity, teammates: [], readyToThrow: false});
          if (command) {witness = {self, point, seed, milliseconds: performance.now() - before}; break outer;}
        }
      }
      expect(witness, 'a positive observed-contact native geometry planning witness').toBeDefined();
      const {self, point, seed} = witness!;
      const peer: DuelActorSnapshot = {...self, id: 2, position: {...point}, feet: point.y - 1.2};
      const samples: number[] = [];
      for (let iteration = 0; iteration < 8; iteration++) {
        launches.mockClear();
        const planner = new BotUtilityPlanner(seed, 1, 10), before = performance.now();
        const command = planner.command(3, self, utilityInventory(['molotov', 'incendiary', 'he', 'flash']),
          {point, observedAt: 3, readyAt: 3, source: 'sight'}, arena,
          {visible: false, lastShotAt: -Infinity, teammates: [peer], readyToThrow: false});
        samples.push(performance.now() - before);
        expect(command).toBeUndefined();
        expect(launches).toHaveBeenCalledTimes(4);
      }
      process.stdout.write(JSON.stringify({chunk, positiveMs: witness!.milliseconds,
        rejectedMedianMs: [...samples].sort((a, b) => a - b)[4], rejectedMaxMs: Math.max(...samples)}) + '\n');
      const smokeSamples: number[] = [];
      for (let iteration = 0; iteration < 8; iteration++) {
        launches.mockClear();
        const before = performance.now();
        const command = new BotUtilityPlanner(seed, 1, 10).command(3, {...self, health: 30},
          utilityInventory(['smoke', 'molotov', 'incendiary', 'he', 'flash']),
          {point, observedAt: 3, readyAt: 3, source: 'sight'}, arena,
          {visible: false, lastShotAt: -Infinity, teammates: [peer], readyToThrow: false});
        smokeSamples.push(performance.now() - before);
        expect(command).toBeUndefined();
        expect(launches).toHaveBeenCalledTimes(4);
      }
      process.stdout.write(JSON.stringify({chunk, smokeSearchMedianMs: [...smokeSamples].sort((a, b) => a - b)[4],
        smokeSearchMaxMs: Math.max(...smokeSamples), lastCandidates: launches.mock.calls.map(([input]) => input.kind)}) + '\n');
    } finally {launches.mockRestore(); collision.dispose();}
  }, 30000);
});
