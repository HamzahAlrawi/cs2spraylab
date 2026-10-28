import PF from 'pathfinding';
import {createServer} from 'vite';
import {prefireAuthoringMaps} from './prefire-map-adapters.mjs';
import {writePrefireAuthoringPreview} from './prefire-authoring-preview.mjs';
const mapId = process.argv.find(arg => arg.startsWith('--map='))?.slice(6) ?? 'de_dust2';
const filter = process.argv.find(arg => arg.startsWith('--route='))?.slice(8).split(',');
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const adapter = await prefireAuthoringMaps.load(mapId, vite);
  collision = adapter.collision;
  const prefireRoutes = adapter.catalog.routes.filter(route => !filter || filter.includes(route.id));
  if (!prefireRoutes.length || filter?.some(id => !prefireRoutes.some(route => route.id === id))) throw new Error('Unknown/empty route filter');
  const preview = process.argv.find(arg => arg.startsWith('--preview='))?.slice(10);
  if (preview) writePrefireAuthoringPreview(preview, adapter, prefireRoutes);
  function walk(from, target) {
    let p = {...from}, d;
    for (let step = 0; step < 800 && (d = Math.hypot(target.x - p.x, target.z - p.z)) > .06; step++) {
      const moved = adapter.move(p, {...p, x: p.x + (target.x - p.x) / d * Math.min(d, .08),
        z: p.z + (target.z - p.z) / d * Math.min(d, .08)}, 72 * adapter.unit);
      if (Math.hypot(moved.position.x - p.x, moved.position.z - p.z) < .0001 || !moved.grounded) return false;
      p = moved.position;
    }
    return Math.hypot(target.x - p.x, target.z - p.z) < .15 && Math.abs(p.y - target.y) < .6;
  }
  function find(from, target) {
    if (walk(from, target)) return [target];
    const spacing = .5, padding = 6, minX = Math.min(from.x, target.x) - padding, minZ = Math.min(from.z, target.z) - padding;
    const width = Math.ceil((Math.abs(from.x - target.x) + padding * 2) / spacing) + 1;
    const depth = Math.ceil((Math.abs(from.z - target.z) + padding * 2) / spacing) + 1;
    const grid = new PF.Grid(width, depth), cache = new Map(), edges = new Map();
    const point = node => {
      const key = node.y * width + node.x;
      if (!cache.has(key)) {
        const p = {x: minX + node.x * spacing, z: minZ + node.y * spacing, y: Math.max(from.y, target.y)};
        const support = collision.vertical(p, p.y + .7, Math.min(from.y, target.y) - 4, 72 * adapter.unit);
        cache.set(key, support.grounded && collision.fits(p, support.feet, 72 * adapter.unit) ? {...p, y: support.feet} : null);
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
        if (!edges.has(key)) edges.set(key, walk(a, b));
        return edges.get(key);
      });
    };
    const path = new PF.AStarFinder({diagonalMovement: PF.DiagonalMovement.Always}).findPath(sx, sz, tx, tz, grid);
    if (!path.length) throw new Error('No native route found');
    const points = path.map(([x, z]) => point(grid.getNodeAt(x, z)));
    const simplified = []; let start = from;
    for (let i = 1; i < points.length;) {
      let end = i;
      while (end + 1 < points.length && walk(start, points[end + 1])) end++;
      simplified.push(points[end]); start = points[end]; i = end + 1;
    }
    return simplified;
  }
  let failures = 0;
  for (const route of prefireRoutes) {
    if (process.argv.includes('--playback')) {
      for (const crouched of [false, true]) adapter.audit.walkPrefireAuditPath(collision, [route.spawn, ...route.path], crouched);
      adapter.audit.auditPrefireMotorPath(collision, [route.spawn, ...route.path]);
      console.log(JSON.stringify({route: route.id, playback: 'passed', bothStances: true, fullSpeedMotor: true}));
      continue;
    }
    let p = adapter.settle(route.spawn); const result = [];
    for (const source of route.path) {
      const target = adapter.settle(source);
      try {const path = find(p, target); result.push(...path.map(p => [Math.round(p.x / adapter.unit), Math.round(-p.z / adapter.unit), Math.round(p.y / adapter.unit)]));}
      catch {failures++; console.log('UNREACHABLE', route.id, source);}
      p = target;
    }
    console.log(route.id, JSON.stringify(result));
  }
  if (failures) throw new Error(`${failures} unreachable authoring segments; no routes were published.`);
} finally {collision?.dispose(); await vite.close();}
