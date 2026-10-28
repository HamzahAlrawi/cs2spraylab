import fs from 'node:fs';
import {createServer} from 'vite';
import PF from 'pathfinding';

// Default: dense native cover/path validation. --search --floor-search uses
// early-out extrema; --connect/--connect-search authors supported A* connectors.
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {prefireRoutes, proposedPrefirePools, sourcePoint} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {placePrefireTarget} = await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const {prefireUpperBodyExtrema, prefireUpperBodySamples, prefireSpawnEyes, prefireBodyExposed, walkPrefireAuditPath} =
    await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const {UNIT, advanceActor, idleInput, STEP} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const {moveOnTerrain} = await vite.ssrLoadModule('/src/range/actor-collision.ts');
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  const manifest = JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
  collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const world = {floor: null, solids: [], native: collision};
  const source = p => [p.x / UNIT, -p.z / UNIT, p.y / UNIT];
  function canWalk(from, target) {
    let p = {...from}, d;
    for (let tick = 0; tick < 1000 && (d = Math.hypot(target.x - p.x, target.z - p.z)) > .025; tick++) {
      const step = Math.min(d, .05), moved = moveOnTerrain(p, {...p, x: p.x + (target.x - p.x) / d * step,
        z: p.z + (target.z - p.z) / d * step}, 72 * UNIT, world, true);
      const support = collision.vertical(moved.position, moved.position.y + 6 * UNIT, moved.position.y - 6 * UNIT, 72 * UNIT);
      if (!moved.grounded || !support.grounded || !collision.fits(moved.position, support.feet, 72 * UNIT) ||
        Math.hypot(moved.position.x - p.x, moved.position.z - p.z) < .0001) return false;
      p = moved.position;
    }
    return Math.hypot(target.x - p.x, target.z - p.z) < .05 && Math.abs(target.y - p.y) < .05;
  }
  function connect(from, target) {
    if (canWalk(from, target)) return [source(target)];
    const spacing = Number(process.argv.find(arg => arg.startsWith('--spacing='))?.slice(10) ?? .5);
    const padding = Number(process.argv.find(arg => arg.startsWith('--padding='))?.slice(10) ?? 8);
    const minX = Math.min(from.x, target.x) - padding, minZ = Math.min(from.z, target.z) - padding;
    const width = Math.ceil((Math.abs(from.x - target.x) + padding * 2) / spacing) + 1;
    const depth = Math.ceil((Math.abs(from.z - target.z) + padding * 2) / spacing) + 1;
    const grid = new PF.Grid(width, depth), cache = new Map(), edges = new Map();
    const point = node => {
      const key = node.y * width + node.x;
      if (!cache.has(key)) {
        const p = {x: minX + node.x * spacing, z: minZ + node.y * spacing, y: Math.max(from.y, target.y)};
        const support = collision.vertical(p, p.y + 18 * UNIT, Math.min(from.y, target.y) - 192 * UNIT, 72 * UNIT);
        cache.set(key, support.grounded && collision.fits(p, support.feet, 72 * UNIT) ? {...p, y: support.feet} : null);
      }
      return cache.get(key);
    };
    const sx = Math.round((from.x - minX) / spacing), sz = Math.round((from.z - minZ) / spacing);
    const tx = Math.round((target.x - minX) / spacing), tz = Math.round((target.z - minZ) / spacing);
    cache.set(sz * width + sx, from); cache.set(tz * width + tx, target);
    const original = grid.getNeighbors.bind(grid);
    grid.getNeighbors = node => {
      const a = point(node); if (!a) return [];
      return original(node, PF.DiagonalMovement.Always).filter(next => {
        const b = point(next); if (!b) return false;
        const key = `${node.x}:${node.y}>${next.x}:${next.y}`;
        if (!edges.has(key)) edges.set(key, canWalk(a, b));
        return edges.get(key);
      });
    };
    const path = new PF.AStarFinder({diagonalMovement: PF.DiagonalMovement.Always}).findPath(sx, sz, tx, tz, grid);
    if (!path.length) throw new Error(`No continuously supported native connector (${edges.size} tested edges, ${
      [...edges.values()].filter(Boolean).length} walkable)`);
    const points = path.map(([x, z]) => point(grid.getNodeAt(x, z)));
    const result = []; let p = from;
    for (let i = 1; i < points.length;) {
      let end = i;
      while (end + 1 < points.length && canWalk(p, points[end + 1])) end++;
      result.push(source(points[end]).map(Math.round)); p = points[end]; i = end + 1;
    }
    return result;
  }
  const filter = process.argv.find(arg => arg.startsWith('--route='))?.slice(8);
  const quick = process.argv.includes('--quick'), search = process.argv.includes('--search');
  const override = process.argv.find(arg => arg.startsWith('--spawn='))?.slice(8).split(',').map(Number);
  let failed = 0;
  console.log(JSON.stringify({build: manifest.build, collisionSha256: manifest.collisionSha256}));
  if (process.argv.includes('--inspect')) {
    for (const route of prefireRoutes.filter(route => !filter || filter.split(',').includes(route.id))) {
      for (const point of [override ?? route.spawn, ...route.path]) {
        const p = sourcePoint(point), support = collision.vertical(p, p.y + 6 * UNIT, p.y - 6 * UNIT, 72 * UNIT);
        const floor = collision.vertical(p, p.y + 32 * UNIT, p.y - 192 * UNIT, 72 * UNIT);
        console.log(JSON.stringify({route: route.id, point, grounded: support.grounded, fits: collision.fits(p, support.feet, 72 * UNIT),
          queriedFeet: support.feet / UNIT, nearbyFloor: floor.grounded ? floor.feet / UNIT : null,
          nearbyFits: floor.grounded && collision.fits(p, floor.feet, 72 * UNIT)}));
      }
    }
  }
  for (const route of prefireRoutes.filter(route => !filter || filter.split(',').includes(route.id))) {
    // Both envelopes are checked without changing the authored target stance.
    const auditAngles = process.argv.includes('--pool') ? proposedPrefirePools[route.id] : route.angles;
    const feet = auditAngles.map(angle => placePrefireTarget(collision, angle.position, angle.crouched));
    const bodies = sampler => feet.flatMap(p => [sampler(p), sampler(p, true)]);
    const extrema = bodies(prefireUpperBodyExtrema), full = quick ? extrema : bodies(prefireUpperBodySamples);
    const exposed = (p, samples = extrema, searching = false) => prefireBodyExposed(collision,
      searching ? [46, 64].map(height => ({...p, y: p.y + height * UNIT})) : prefireSpawnEyes(p), samples);
    if (search) {
      const candidates = [], base = override ?? route.spawn;
      const radius = Number(process.argv.find(arg => arg.startsWith('--radius='))?.slice(9) ?? 512);
      const step = Number(process.argv.find(arg => arg.startsWith('--search-step='))?.slice(14) ?? 32);
      for (let dx = -radius; dx <= radius; dx += step) for (let dy = -radius; dy <= radius; dy += step) {
        let point = [base[0] + dx, base[1] + dy, base[2]];
        if (process.argv.includes('--floor-search')) {
          const sample = sourcePoint(point), support = collision.vertical(sample, sample.y + 32 * UNIT, sample.y - 192 * UNIT, 72 * UNIT);
          if (!support.grounded) continue;
          point = [point[0], point[1], Math.round(support.feet / UNIT)];
        }
        let p; try {p = placePrefireTarget(collision, point);} catch {continue;}
        if (exposed(p, extrema, true)) continue;
        // A covered 32-unit square is a conservative corner margin, not yaw/FOV.
        const margin = [128, 96, 64, 32, 0].find(radius => [-radius, 0, radius].every(x => [-radius, 0, radius].every(y =>
          !exposed({...p, x: p.x + x * UNIT, z: p.z - y * UNIT}, extrema, true))));
        if (margin === undefined) continue;
        candidates.push({point, margin, distance: Math.hypot(dx, dy)});
      }
      const minimum = Number(process.argv.find(arg => arg.startsWith('--min-margin='))?.slice(13) ?? 64);
      const selected = candidates.filter(candidate => candidate.margin >= minimum).sort((a, b) => a.distance - b.distance);
      console.log(JSON.stringify({route: route.id, coveredCandidates: candidates.length, candidates: selected.slice(0, 30)}));
      if (process.argv.includes('--connect-search')) {
        const join = Number(process.argv.find(arg => arg.startsWith('--join='))?.slice(7) ?? 0);
        const target = placePrefireTarget(collision, route.path[join]);
        for (const candidate of selected) {
          const p = placePrefireTarget(collision, candidate.point);
          if (canWalk(p, target)) {
            console.log(JSON.stringify({route: route.id, connected: candidate, connector: [route.path[join]]}));
            break;
          }
        }
        for (const candidate of selected.filter(candidate => candidate.distance > 32).slice(0, 8)) {
          try {
            const connector = connect(placePrefireTarget(collision, candidate.point), target);
            console.log(JSON.stringify({route: route.id, connected: candidate, connector})); break;
          } catch { /* Reject disconnected ledges; do not snap or jump. */ }
        }
      }
      continue;
    }
    const spawn = override ?? route.spawn;
    const p = placePrefireTarget(collision, spawn);
    if (process.argv.includes('--motor')) {
      let a = {position: {...p, y: p.y + 64 * UNIT}, velocity: {x: 0, z: 0}, yaw: 0,
        feet: p.y, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true};
      for (const point of route.path) {
        const target = placePrefireTarget(collision, point), trace = [];
        const budget = Math.ceil(Math.hypot(target.x - a.position.x, target.z - a.position.z) / (215 * UNIT) / STEP) + 128;
        let tick = 0, air = 0;
        for (; tick < budget && Math.hypot(target.x - a.position.x, target.z - a.position.z) > .16; tick++) {
          a.yaw = Math.atan2(-(target.x - a.position.x), -(target.z - a.position.z));
          a = advanceActor(a, {...idleInput(), forward: 1}, 215 * UNIT, STEP, undefined, undefined, undefined, world);
          air += Number(!a.grounded);
          if (tick % 32 === 0) trace.push({tick, p: source({...a.position, y: a.feet}).map(v => +v.toFixed(1)),
            speed: +Math.hypot(a.velocity.x, a.velocity.z).toFixed(2)});
        }
        const gap = Math.hypot(target.x - a.position.x, target.z - a.position.z);
        console.log(JSON.stringify({route: route.id, point, ticks: tick, air, gap, trace}));
        if (gap > .16 || air) failed++;
      }
      continue;
    }
    if (process.argv.includes('--connect')) {
      const join = Number(process.argv.find(arg => arg.startsWith('--join='))?.slice(7) ?? 0);
      try {console.log(JSON.stringify({route: route.id, spawn, join: route.path[join],
        connector: connect(p, placePrefireTarget(collision, route.path[join]))}));}
      catch (e) {console.log(JSON.stringify({route: route.id, spawn, error: e.message})); process.exitCode = 1;}
      continue;
    }
    const visible = exposed(p, full);
    let walked, error;
    try {walked = walkPrefireAuditPath(collision, [spawn, ...route.path]);} catch (e) {error = e.message;}
    const firstBodies = [prefireUpperBodyExtrema(feet[0]), prefireUpperBodyExtrema(feet[0], true)];
    let distance = 0, firstExposure = null, anyExposure = null;
    for (let i = 0; i < (walked?.length ?? 0); i++) {
      if (i) distance += Math.hypot(walked[i].x - walked[i - 1].x, walked[i].z - walked[i - 1].z) / UNIT;
      if (anyExposure === null && exposed(walked[i])) anyExposure = +distance.toFixed(1);
      if (firstExposure === null && prefireBodyExposed(collision, prefireSpawnEyes(walked[i]), firstBodies)) firstExposure = +distance.toFixed(1);
      if (anyExposure !== null && firstExposure !== null) break;
    }
    const margin = [64, 32, 0].find(radius => [-radius, 0, radius].every(x => [-radius, 0, radius].every(y =>
      !exposed({...p, x: p.x + x * UNIT, z: p.z - y * UNIT}, full))));
    const look = sourcePoint(route.look), exit = sourcePoint(route.path[0]);
    const alignment = ((look.x - p.x) * (exit.x - p.x) + (look.z - p.z) * (exit.z - p.z)) /
      (Math.hypot(look.x - p.x, look.z - p.z) * Math.hypot(exit.x - p.x, exit.z - p.z));
    console.log(JSON.stringify({route: route.id, spawn, visible, margin, firstExposure, anyExposure,
      walkSteps: walked?.length, exitAlignment: +alignment.toFixed(3), error}));
    if (process.argv.includes('--exposure-detail')) for (const x of [-64,0,64]) for (const y of [-64,0,64]) {
      const eyes = prefireSpawnEyes({...p,x:p.x+x*UNIT,z:p.z-y*UNIT});
      const exposedAngles = route.angles.filter((_, index) => prefireBodyExposed(collision, eyes,
        [prefireUpperBodySamples(feet[index]),prefireUpperBodySamples(feet[index],true)])).map(angle => angle.name);
      if (exposedAngles.length) console.log(JSON.stringify({route:route.id,offset:[x,y],exposedAngles}));
    }
    if (visible || error || !(firstExposure >= 32) || !(anyExposure >= 32) || alignment < .9) failed++;
  }
  if (failed) {console.error(`${failed} covered-start checks failed`); process.exitCode = 1;}
} finally {collision?.dispose(); await vite.close();}
