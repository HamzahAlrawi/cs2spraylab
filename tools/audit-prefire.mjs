import fs from 'node:fs';
import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {settleNativePosition} = await vite.ssrLoadModule('/src/range/prefire/map.ts');
  const {prefireRoutes} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {placePrefireTarget} = await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const {prefireUpperBodySamples, prefireSpawnEyes, nativeSightBlocked} = await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const {moveOnTerrain} = await vite.ssrLoadModule('/src/range/actor-collision.ts');
  const {actorHeadPoint, traceActor} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let failed = 0;
  for (const route of prefireRoutes) {
    let p = settleNativePosition(collision, route.spawn);
    const spawnEyes = prefireSpawnEyes(p);
    const routePoints = [p]; const segments = [];
    for (const point of route.path) {
      const target = settleNativePosition(collision, point);
      for (let step = 0; step < 2400 && Math.hypot(target.x - p.x, target.z - p.z) > .08; step++) {
        const d = Math.hypot(target.x - p.x, target.z - p.z);
        const moved = moveOnTerrain(p, {...p, x: p.x + (target.x - p.x) / d * .05, z: p.z + (target.z - p.z) / d * .05}, 72 * .0254,
          {floor: null, solids: [], native: collision}, true);
        if (Math.hypot(moved.position.x - p.x, moved.position.z - p.z) < .0001) break;
        p = moved.position;
        if (step % 10 === 0) routePoints.push({...p});
      }
      const gap = Math.hypot(target.x - p.x, target.z - p.z);
      segments.push({point, gap: +gap.toFixed(2), stopped: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(2)]))});
      if (gap > .15) failed++;
      routePoints.push({...p});
    }
    const angles = route.angles.map(angle => {
      const target = placePrefireTarget(collision, angle.position, angle.crouched);
      const body = prefireUpperBodySamples(target, angle.crouched);
      const concealed = spawnEyes.every(eye => body.every(sample => nativeSightBlocked(collision, eye, sample)));
      if (!concealed) failed++;
      let visible = false;
      const yaw = angle.rotation ? (angle.rotation[1] - 90) * Math.PI / 180
        : Math.atan2(-(spawnEyes[0].x - target.x), -(spawnEyes[0].z - target.z));
      for (const eye of routePoints) {
        const from = {...eye, y: eye.y + 64 * .0254}, to = actorHeadPoint(target, !!angle.crouched, yaw);
        const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
        if (!d) continue;
        const direction = {x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d};
        const hit = traceActor(from, direction, target, !!angle.crouched, d, yaw);
        if (hit.group === 'head' && !collision.ray(from, direction, hit.distance - .0001)) {visible = true; break;}
      }
      if (!visible) {
        failed++;
        if (process.argv.includes('--suggest')) {
          const suggestions = [];
          for (let dx = -160; dx <= 160; dx += 40) for (let dy = -160; dy <= 160; dy += 40) {
            const source = [angle.position[0] + dx, angle.position[1] + dy, angle.position[2]];
            let p; try {p = settleNativePosition(collision, source);} catch {continue;}
            for (const eye of routePoints) {
              const from = {...eye, y: eye.y + 64 * .0254}, to = {...p, y: p.y + 64 * .0254};
              const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
              if (d && !collision.ray(from, {x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d}, d - .15)) {
                suggestions.push({source, shift: Math.hypot(dx, dy), feet: Math.round(p.y / .0254)}); break;
              }
            }
          }
          console.log('Visible alternatives', angle.name, suggestions.sort((a, b) => a.shift - b.shift).slice(0, 5));
        }
      }
      return {name: angle.name, concealedAtSpawn: concealed, visible, feet: +target.y.toFixed(2)};
    });
    for (let i = 0; i < route.angles.length; i++) for (let j = i + 1; j < route.angles.length; j++) {
      const a = route.angles[i].position, b = route.angles[j].position;
      if (Math.abs(a[2] - b[2]) < 72 && Math.abs(a[0] - b[0]) < 32 && Math.abs(a[1] - b[1]) < 32) {
        failed++; console.error(`Overlapping targets: ${route.id}: ${route.angles[i].name}, ${route.angles[j].name}`);
      }
    }
    console.log(JSON.stringify({id: route.id, segments, angles}));
  }
  if (failed) {console.error(`${failed} native route checks need attention`); process.exitCode = 1;}
} finally {collision?.dispose(); await vite.close();}
