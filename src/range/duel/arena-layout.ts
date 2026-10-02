import type {Arena, CoverLane, Solid} from './geometry';
import {clearSegment, routeTo} from './navigation';
import {randomStream} from './rng';
import {coveredSpawns} from './spawns';
import {arenaPOIs, footprintsOverlap, footprintOf, placePOI, poiThemes, reserveFootprint, type Footprint, type POITheme} from './arena-pois';

const point = (x: number, z: number) => ({x, y: 0, z});
export const arenaDesigns = ['Freight yard', 'Service lanes', 'Courtyard', 'Switchback', 'Loading bays', 'Workshop'] as const;
export function seedForDesign(seed: number, design: string) {
  const index = arenaDesigns.findIndex(name => name === design);
  return index < 0 ? seed : seed * arenaDesigns.length + index;
}
export type ArenaOptions = {scale?: number; theme?: POITheme};

function candidate(seed: number, design: number, scale: number, theme: POITheme, attempt: number, safe = false): Arena {
  const random = randomStream(seed, `authored-pois-${attempt}`);
  const between = (a: number, b: number) => a + random() * (b - a);
  const centerX = safe ? 0 : between(-.25, .25), width = safe ? 5.25 : between(5.25, 6.5);
  const solids: Solid[] = [{center: {x: centerX, y: 1.6, z: 0}, size: {x: width, y: 3.2, z: .75}, kind: 'concrete'}];
  const lanes: CoverLane[] = [];
  const arena: Arena = {minX: -12 * scale, maxX: 12 * scale, minZ: -20 * scale, maxZ: 12 * scale,
    solids, lanes, pois: [], design: arenaDesigns[design], seed, poiTheme: theme};
  const reservations: Footprint[] = [reserveFootprint(footprintOf(solids), .6)];
  const templates = arenaPOIs.filter(p => p.theme === theme);
  const camps = templates.filter(p => p.spawnCover);
  const camp = camps[safe ? 0 : Math.floor(random() * camps.length)];
  const sign = safe ? 1 : random() < .5 ? -1 : 1;
  const slots = [{template: camp, x: sign * (scale < 1 ? 3 : safe ? 4 : between(3.75, 4.25)),
    z: scale < 1 ? Math.max(5.01, arena.maxZ - 2.75) : arena.maxZ - 2.1, camp: true}];
  const shuffled = templates.filter(p => !p.spawnCover).map((template, index) => ({template, order: safe ? index : random()})).sort((a, b) => a.order - b.order);
  // Compact rounds use two pairs. Full-size rounds get an additional flank;
  // the assemblies and native hull are never shrunk to make them fit.
  for (const [index, side] of (scale < 1 ? [-sign] : [-sign, sign]).entries()) {
    const template = shuffled[index].template;
    slots.push({template, x: side * (arena.maxX - 1.25 - template.footprint.maxX),
      // The .7m navigation grid needs more than a hull-width-only slit.
      z: .375 + 1.9 - template.footprint.minZ + (safe ? 0 : between(0, .1)), camp: false});
  }
  for (const [slot, placement] of slots.entries()) {
    const mirrorX = (placement.x < 0 ? -1 : 1) as -1 | 1;
    for (const side of [-1, 1] as const) {
      const placed = placePOI(placement.template, point(placement.x, side * placement.z), mirrorX, side, `poi-${slot}-${side}`, solids.length);
      const r = placed.instance.reservation;
      if (r.minX < arena.minX + .6 || r.maxX > arena.maxX - .6 || r.minZ < arena.minZ + .6 || r.maxZ > arena.maxZ - .6 ||
        reservations.some(other => footprintsOverlap(r, other))) return arena;
      reservations.push(r); arena.pois!.push(placed.instance); solids.push(...placed.solids);
      if (side !== -1) continue;
      const f = placed.instance.footprint;
      if (placement.camp) {
        const z = -placement.z - .95;
        // Both ends of the authored back cover are useful camp peek directions.
        for (const direction of [-1, 1] as const) {
          const x = placement.x + direction * .85;
          lanes.push({side: direction, role: 'camp', anchor: point(x, z),
            edge: point(direction < 0 ? f.minX - .75 : f.maxX + .75, z), retreat: point(x, z - .75), axis: {x: direction, z: 0}});
        }
        if (scale < 1) {
          const x = mirrorX > 0 ? f.maxX + .75 : f.minX - .75;
          lanes.push({side: mirrorX, role: 'flank', anchor: point(x, -placement.z),
            edge: point(x, -1.3), retreat: point(x, -placement.z - .75), axis: {x: 0, z: 1}});
        }
      } else {
        const x = mirrorX > 0 ? f.minX - .75 : f.maxX + .75;
        lanes.push({side: mirrorX, role: 'flank', anchor: point(x, -placement.z),
          edge: point(x, -1.3), retreat: point(x, -placement.z - .75), axis: {x: 0, z: 1}});
        lanes.push({side: mirrorX, role: 'offAngle', anchor: point(x, -1.6),
          edge: point(x - mirrorX * .6, -1.6), retreat: point(x, -2.4), axis: {x: -mirrorX, z: 0}});
      }
    }
  }
  for (const side of [-1, 1] as const) {
    const corner = centerX + side * width / 2;
    lanes.push({side, role: 'entry', anchor: point(corner - side * .8, -1.3),
      edge: point(corner + side * .8, -1.3), retreat: point(corner - side * 1.4, -1.3), axis: {x: side, z: 0}});
  }
  return arena;
}

export function createArena(seed: number, options: ArenaOptions = {}): Arena {
  const scale = Number.isFinite(options.scale) ? Math.max(.65, Math.min(1.5, options.scale!)) : 1;
  const design = ((Math.floor(seed) % arenaDesigns.length) + arenaDesigns.length) % arenaDesigns.length;
  const theme = poiThemes.includes(options.theme!) ? options.theme! : poiThemes[design];
  // Bounded, round-construction-only validation. No new per-frame navigation.
  for (let attempt = 0; attempt < 24; attempt++) {
    const arena = candidate(seed, design, scale, theme, attempt);
    if (arena.pois?.length === (scale < 1 ? 4 : 6) && validLayout(arena, scale)) return arena;
  }
  const fallback = candidate(seed, design, scale, theme, 0, true);
  if (!validLayout(fallback, scale) || fallback.pois?.length !== (scale < 1 ? 4 : 6)) throw new Error(`Invalid authored fallback arena: ${theme}, ${scale}`);
  return fallback;
}

function validLayout(arena: Arena, scale: number) {
  if (arena.solids.some((a, i) => arena.solids.slice(i + 1).some(b => footprintsOverlap(footprintOf([a]), footprintOf([b]))))) return false;
  const north = point(0, -8 * scale), south = point(0, 8 * scale);
  if (!routeTo(north, south, arena).length) return false;
  return arena.lanes!.every(lane => clearSegment(lane.anchor, lane.edge, arena) &&
    clearSegment(lane.anchor, lane.retreat, arena) &&
    [lane.anchor, lane.edge, lane.retreat].every(p => arena.solids.every(s =>
      Math.abs(p.x - s.center.x) >= s.size.x / 2 + .6 - 1e-8 || Math.abs(p.z - s.center.z) >= s.size.z / 2 + .6 - 1e-8)) &&
    routeTo(north, lane.anchor, arena).length > 0 && routeTo(south, lane.anchor, arena).length > 0) &&
    !!coveredSpawns(arena, arena.seed ?? 0, 5);
}
