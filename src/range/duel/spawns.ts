import {UNIT, type Vec} from '../actor-physics';
import {canFitInArena, traceSolid, type Arena} from './geometry';
import {routeTo} from './navigation';
import {randomStream} from './rng';

export function coveredSpawns(arena: Arena, seed: number, count: number) {
  const random = randomStream(seed, 'covered-spawns');
  const candidates = (side: number) => arena.solids.filter(s => s.size.x >= 3 && s.size.y >= 2 && side * s.center.z > 5)
    .flatMap(s => [0, -.85, .85].flatMap(x => [1, 2].map(back => ({x: s.center.x + x,
      y: 64 * UNIT, z: s.center.z + side * (s.size.z / 2 + back)}))))
    .filter(p => canFitInArena(p, 0, 72 * UNIT, arena)).map(p => ({p, key: random()})).sort((a, b) => a.key - b.key).map(v => v.p);
  const hidden = (a: Vec, b: Vec) => [-.22, 0, .22].every(offset => {
    const dx = b.x + offset - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
    return traceSolid(a, {x: dx / d, y: dy / d, z: dz / d}, arena, d).distance < d;
  });
  for (const player of candidates(1)) {
    const bots: Vec[] = [];
    for (const p of candidates(-1)) {
      if (bots.some(b => Math.hypot(b.x - p.x, b.z - p.z) < 32 * UNIT + .02) ||
        !hidden(player, p) || !hidden(p, player) || !routeTo(p, player, arena).length) continue;
      bots.push(p);
      if (bots.length === count) return {player, bots};
    }
  }
  return undefined;
}
