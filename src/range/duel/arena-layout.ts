import {canFitInArena, type Arena, type CoverLane, type Solid} from './geometry';
import {UNIT} from '../actor-physics';
import {clearSegment, routeTo} from './navigation';
import {randomStream} from './rng';
import {coveredSpawns} from './spawns';
import {arenaPOIs, environmentPOIs, footprintsOverlap, footprintOf, placePOI, poiThemes, reserveFootprint, type Footprint, type POIPlacement, type POITheme, type POITemplate} from './arena-pois';

const point = (x: number, z: number) => ({x, y: 0, z});
export const arenaDesigns = ['Freight yard', 'Service lanes', 'Courtyard', 'Switchback', 'Loading bays', 'Workshop'] as const;
export function seedForDesign(seed: number, design: string) {
  const index = arenaDesigns.findIndex(name => name === design);
  return index < 0 ? seed : seed * arenaDesigns.length + index;
}
export type ArenaOptions = {scale?: number; theme?: POITheme};

export const ARENA_SOLID_BUDGET = 56;
export const ARENA_ATTEMPTS = 24;

function midfieldRoutes(arena: Arena) {
  const landmark = footprintOf(arena.solids.filter(s => !s.poiId));
  const north = landmark.minZ - .95, south = landmark.maxZ + .95;
  const scale = (arena.maxX - arena.minX) / 24;
  return ([-1, 1] as const).map(side => {
    const x = side < 0 ? landmark.minX - .8 : landmark.maxX + .8;
    return [point(0, -8 * scale), point(0, north), point(x, north),
      point(x, south), point(0, south), point(0, 8 * scale)];
  });
}

function segmentFootprint(a: ReturnType<typeof point>, b: ReturnType<typeof point>, margin = .6) {
  return reserveFootprint({minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z)}, margin);
}

function candidate(seed: number, design: number, scale: number, theme: POITheme, attempt: number): Arena {
  const random = randomStream(seed, `diverse-pois-${attempt}`);
  const between = (a: number, b: number) => a + random() * (b - a);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const sign = () => pick([-1, 1] as const);
  const centerX = between(-.65, .65), centerZ = between(-.25, .25), width = between(5.25, 6);
  const landmarkStyle = {freight: 'plain', service: 'vent', courtyard: 'kiosk',
    switchback: 'concrete-stack', loading: 'rack', workshop: 'generator'} as const;
  const screen = (id: string, x: number, z: number, w: number, d: number): Solid => ({id: `arena/${id}`,
    material: theme === 'freight' || theme === 'service' || theme === 'workshop' ? 'metal' : 'concrete',
    kind: 'concrete', style: landmarkStyle[theme], center: {x, y: 1.6, z}, size: {x: w, y: 3.2, z: d}});
  const shape = Math.floor(random() * 4), turn = sign();
  const solids = shape === 2 ? [
    screen('split-west', centerX - width / 4, centerZ - 1.15, width / 2 + .3, .75),
    screen('split-east', centerX + width / 4, centerZ + 1.15, width / 2 + .3, .75),
  ] : [screen('central-screen', centerX, centerZ, width, .75)];
  if (shape === 1 || shape === 3) solids.push(screen(shape === 1 ? 'screen-return' : 'screen-spine',
    centerX + (shape === 1 ? turn * (width / 2 - .375) : 0), centerZ + turn * .975,
    shape === 1 ? .75 : .85, 1.2));
  const lanes: CoverLane[] = [];
  const arena: Arena = {minX: -12 * scale, maxX: 12 * scale, minZ: -20 * scale, maxZ: 12 * scale,
    solids, lanes, pois: [], traversalVolumes: [], traversalLinks: [], design: arenaDesigns[design], seed, poiTheme: theme};
  const central = footprintOf(solids);
  const reservations = solids.map(s => reserveFootprint(footprintOf([s]), .6));
  const protectedLanes = midfieldRoutes(arena).flatMap(route => route.slice(1).map((p, i) => segmentFootprint(route[i], p)));
  const addLane = (lane: CoverLane) => {
    lanes.push(lane);
    for (const end of [lane.edge, lane.retreat]) protectedLanes.push(segmentFootprint(lane.anchor, end));
  };
  for (const side of [-1, 1] as const) {
    const corner = side < 0 ? central.minX : central.maxX, z = central.minZ - .95;
    addLane({side, role: 'entry', anchor: point(corner - side * .8, z), edge: point(corner + side * .8, z),
      retreat: point(corner - side * 1.4, z), axis: {x: side, z: 0}});
  }
  const templates = arenaPOIs.filter(p => p.theme === theme), environments = environmentPOIs.filter(p => p.theme === theme);
  const camps = templates.filter(p => p.spawnCover), covers = templates.filter(p => !p.spawnCover);
  const commit = (template: POITemplate, x: number, z: number, mx: -1 | 1, mz: -1 | 1,
    role: POIPlacement['role'], side: -1 | 1, parentId?: string) => {
    const placed = placePOI(template, point(x, z), mx, mz, `poi-${arena.pois!.length}`, solids.length), r = placed.instance.reservation;
    if (solids.length + placed.solids.length > ARENA_SOLID_BUDGET ||
      r.minX < arena.minX + .6 || r.maxX > arena.maxX - .6 || r.minZ < arena.minZ + .6 || r.maxZ > arena.maxZ - .6 ||
      reservations.some(other => footprintsOverlap(r, other)) ||
      placed.solids.some(s => protectedLanes.some(l => footprintsOverlap(footprintOf([s]), l)))) return undefined;
    const f = placed.instance.footprint;
    const cover = placed.solids.reduce((best, s) => s.size.y > best.size.y ? s : best);
    const approach = point(side < 0 ? f.maxX + .75 : f.minX - .75, role === 'compound-support' ? cover.center.z : z);
    placed.instance.placement = {role, side, hemisphere: mz, landmarkId: solids[0].id!, approach, parentId};
    reservations.push(r); arena.pois!.push(placed.instance); solids.push(...placed.solids);
    arena.traversalVolumes!.push(...placed.volumes); arena.traversalLinks!.push(...placed.links);
    // Later supports cannot wall off a sibling's approach or ground traversal exit.
    const entries = [approach, ...placed.links.flatMap(l => [l.from, l.to, ...(l.boost ? [l.boost.dismount] : [])]).filter(p => p.y === 0)];
    protectedLanes.push(...entries.map(p => segmentFootprint(p, p)));
    return placed.instance;
  };
  const northSide = sign();
  const campSides = {north: northSide, south: random() < .6 ? -northSide as -1 | 1 : northSide};
  const compounds = new Map<number, ReturnType<typeof commit>>();
  for (const hemisphere of [-1, 1] as const) {
    const template = pick(camps), side = hemisphere < 0 ? campSides.north : campSides.south;
    const maxX = arena.maxX - 1.2 - Math.max(-template.footprint.minX, template.footprint.maxX);
    const x = side * between(3.15, Math.min(maxX, 5.6));
    const z = hemisphere * (hemisphere > 0 ? Math.max(5.05, arena.maxZ - between(2.75, 3.05))
      : between(Math.max(5.15, 8 * scale), Math.max(5.4, 10.5 * scale)));
    const placed = commit(template, x, z, side, hemisphere, 'spawn-compound', side);
    if (!placed) return arena;
    compounds.set(hemisphere, placed);
    const wall = solids[placed.solidIndices[0]], back = wall.center.z + hemisphere * wall.size.z / 2;
    protectedLanes.push({minX: wall.center.x - 1.45, maxX: wall.center.x + 1.45,
      minZ: Math.min(back + hemisphere * .55, back + hemisphere * 2.6),
      maxZ: Math.max(back + hemisphere * .55, back + hemisphere * 2.6)});
    if (hemisphere > 0) continue;
    for (const direction of [-1, 1] as const) addLane({side: direction, role: 'camp', anchor: point(x + direction * .85, z - .95),
      edge: point(direction < 0 ? placed.footprint.minX - .75 : placed.footprint.maxX + .75, z - .95),
      retreat: point(x + direction * .85, z - 1.7), axis: {x: direction, z: 0}});
    if (scale < 1) {
      const flankX = side < 0 ? placed.footprint.minX - .75 : placed.footprint.maxX + .75;
      addLane({side, role: 'flank', anchor: point(flankX, z), edge: point(flankX, central.minZ - .95),
        retreat: point(flankX, z - .75), axis: {x: 0, z: 1}});
    }
  }
  // Sockets flank the transfer apron; access faces midfield, never the back wall.
  const edgePlacement = (pool: readonly POITemplate[], hemisphere: -1 | 1, side: -1 | 1,
    role: POIPlacement['role'], front?: number, parentId?: string) => {
    for (let trial = 0; trial < 8; trial++) {
      const template = pick(pool), mx = side;
      const local = mx > 0 ? template.footprint : {minX: -template.footprint.maxX, maxX: -template.footprint.minX,
        minZ: template.footprint.minZ, maxZ: template.footprint.maxZ};
      const x = side > 0 ? arena.maxX - between(1.25, 1.8) - local.maxX : arena.minX + between(1.25, 1.8) - local.minX;
      const depth = between(1.9, 2.5);
      const near = front ?? (hemisphere > 0 ? central.maxZ + depth : central.minZ - depth);
      const z = near - hemisphere * template.footprint.minZ;
      const placed = commit(template, x, z, mx, hemisphere, role, side, parentId);
      if (!placed) continue;
      if (hemisphere < 0 && role !== 'compound-support') {
        const flankX = side > 0 ? placed.footprint.minX - .75 : placed.footprint.maxX + .75;
        addLane({side, role: 'flank', anchor: point(flankX, z), edge: point(flankX, central.minZ - .95),
          retreat: point(flankX, z - .75), axis: {x: 0, z: 1}});
        addLane({side, role: 'offAngle', anchor: point(flankX, central.minZ - 1.3),
          edge: point(flankX - side * .6, central.minZ - 1.3), retreat: point(flankX, central.minZ - 2.1), axis: {x: -side, z: 0}});
      }
      if (role === 'compound-support') {
        const anchor = placed.placement!.approach;
        addLane({side, role: 'offAngle', anchor, edge: point(anchor.x, placed.footprint.maxZ + .75),
          retreat: point(anchor.x, anchor.z - .75), axis: {x: 0, z: 1}});
      }
      return placed;
    }
    return undefined;
  };
  for (const hemisphere of [-1, 1] as const) {
    const campSide = hemisphere < 0 ? campSides.north : campSides.south;
    if (!edgePlacement(environments, hemisphere, -campSide as -1 | 1, 'lane-traversal')) return arena;
    if (scale >= 1 && !edgePlacement(covers, hemisphere, campSide, 'lane-cover')) return arena;
  }
  const pockets = covers.filter(t => t.footprint.maxX - t.footprint.minX <= 3);
  const extras = scale < 1 ? 1 + Math.floor(random() * 2) : 1 + Math.floor(random() * 4);
  const compound = compounds.get(-1)!;
  const rearFront = Math.min(compound.center.z - 2.9,
    ...arena.pois!.filter(p => p.center.z < 0).map(p => p.footprint.minZ)) - 1.3;
  const nextFront = new Map<number, number>([[-1, rearFront], [1, rearFront]]);
  for (let slot = 0; slot < extras; slot++) {
    const side = (slot % 2 ? -campSides.north : campSides.north) as -1 | 1;
    const placed = edgePlacement(random() < .4 && scale >= 1 ? environments : pockets,
      -1, side, 'compound-support', nextFront.get(side), compound.id);
    if (placed) nextFront.set(side, placed.footprint.minZ - 1.3);
  }
  return arena;
}

// Retain the known full-hull packing as a seed-independent emergency plan.
function fallbackCandidate(seed: number, design: number, scale: number, theme: POITheme): Arena {
  const centerX = 0, width = 5.25;
  const solids: Solid[] = [{id: 'arena/central-screen', material: 'concrete', center: {x: centerX, y: 1.6, z: 0}, size: {x: width, y: 3.2, z: .75}, kind: 'concrete'}];
  const lanes: CoverLane[] = [];
  const arena: Arena = {minX: -12 * scale, maxX: 12 * scale, minZ: -20 * scale, maxZ: 12 * scale,
    solids, lanes, pois: [], traversalVolumes: [], traversalLinks: [], design: arenaDesigns[design], seed, poiTheme: theme};
  const reservations: Footprint[] = [reserveFootprint(footprintOf(solids), .6)];
  const templates = arenaPOIs.filter(p => p.theme === theme);
  const camps = templates.filter(p => p.spawnCover);
  const camp = camps[0];
  const slots = [{template: camp, x: scale < 1 ? 3 : 4,
    z: scale < 1 ? Math.max(5.01, arena.maxZ - 2.75) : arena.maxZ - 2.75, camp: true}];
  const covers = templates.filter(p => !p.spawnCover);
  const environmentTemplates = environmentPOIs.filter(p => p.theme === theme);
  const environment = environmentTemplates[0];
  // Compact rounds use two pairs. Full-size rounds get an additional flank;
  // the assemblies and native hull are never shrunk to make them fit.
  for (const [index, side] of (scale < 1 ? [-1] : [-1, 1]).entries()) {
    const template = index === 0 ? environment : covers[index - 1];
    slots.push({template, x: side * (arena.maxX - 1.25 - template.footprint.maxX),
      // The .7m navigation grid needs more than a hull-width-only slit.
      z: .375 + 1.9 - template.footprint.minZ, camp: false});
  }
  for (const [slot, placement] of slots.entries()) {
    const mirrorX = (placement.x < 0 ? -1 : 1) as -1 | 1;
    for (const side of [-1, 1] as const) {
      const placed = placePOI(placement.template, point(placement.x, side * placement.z), mirrorX, side, `poi-${slot}-${side}`, solids.length);
      const r = placed.instance.reservation;
      if (r.minX < arena.minX + .6 || r.maxX > arena.maxX - .6 || r.minZ < arena.minZ + .6 || r.maxZ > arena.maxZ - .6 ||
        reservations.some(other => footprintsOverlap(r, other))) return arena;
      const f = placed.instance.footprint;
      placed.instance.placement = {role: placement.camp ? 'spawn-compound' : placement.template.environment ? 'lane-traversal' : 'lane-cover',
        side: mirrorX, hemisphere: side, landmarkId: solids[0].id!,
        approach: point(mirrorX < 0 ? f.maxX + .75 : f.minX - .75, side * placement.z)};
      reservations.push(r); arena.pois!.push(placed.instance); solids.push(...placed.solids);
      arena.traversalVolumes!.push(...placed.volumes); arena.traversalLinks!.push(...placed.links);
      if (side !== -1) continue;
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
  for (let attempt = 0; attempt < ARENA_ATTEMPTS; attempt++) {
    const arena = candidate(seed, design, scale, theme, attempt);
    if (arena.pois!.length >= (scale < 1 ? 4 : 6) && validLayout(arena, scale)) return arena;
  }
  const fallback = fallbackCandidate(seed, design, scale, theme);
  if (!validLayout(fallback, scale) || fallback.pois?.length !== (scale < 1 ? 4 : 6)) throw new Error(`Invalid authored fallback arena: ${theme}, ${scale}`);
  return fallback;
}

function validLayout(arena: Arena, scale: number) {
  // An overhead lintel can share a footprint with its panel without intersecting it.
  if (arena.solids.some((a, i) => arena.solids.slice(i + 1).some(b => solidsOverlap(a, b)))) return false;
  const north = point(0, -8 * scale), south = point(0, 8 * scale);
  const water = arena.traversalVolumes!.filter(v => v.kind === 'water').map(v => footprintOf([v]));
  if (!midfieldRoutes(arena).every(route => route.slice(1).every((p, i) => clearSegment(route[i], p, arena) &&
    water.every(f => !footprintsOverlap(segmentFootprint(route[i], p), f))))) return false;
  if (!routeTo(north, south, arena).length) return false;
  if (!arena.pois!.every(poi => poi.placement && canFitInArena(poi.placement.approach, 0, 72 * UNIT, arena) &&
    routeTo(north, poi.placement.approach, arena).length > 0 && routeTo(south, poi.placement.approach, arena).length > 0)) return false;
  if (!arena.lanes!.every(lane => clearSegment(lane.anchor, lane.edge, arena) &&
    clearSegment(lane.anchor, lane.retreat, arena) &&
    [lane.anchor, lane.edge, lane.retreat].every(p => arena.solids.every(s =>
      Math.abs(p.x - s.center.x) >= s.size.x / 2 + .6 - 1e-8 || Math.abs(p.z - s.center.z) >= s.size.z / 2 + .6 - 1e-8)) &&
    routeTo(north, lane.anchor, arena).length > 0 && routeTo(south, lane.anchor, arena).length > 0)) return false;
  const approaches = arena.traversalLinks!.flatMap(l => [l.from, l.to, ...(l.boost ? [l.boost.dismount] : [])]).filter(p => p.y === 0);
  return approaches.every(p => canFitInArena(p, 0, 72 * UNIT, arena) &&
    routeTo(north, p, arena).length > 0 && routeTo(south, p, arena).length > 0) &&
    !!coveredSpawns(arena, arena.seed ?? 0, 5);
}

export function solidsOverlap(a: Solid, b: Solid) {
  return (['x', 'y', 'z'] as const).every(axis => Math.abs(a.center[axis] - b.center[axis]) < (a.size[axis] + b.size[axis]) / 2 - 1e-8);
}
