import fs from 'node:fs';
import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {prefireRoutes, sourcePoint} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {placePrefireTarget} = await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const {prefireSpawnEyes, prefireUpperBodyExtrema, nativeSightBlocked, walkPrefireAuditPath} = await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const {actorHeadPoint} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const dataset = JSON.parse(fs.readFileSync('src/range/prefire/data/openprefire-dust2.json', 'utf8'));
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const filter = process.argv.find(arg => arg.startsWith('--route='))?.slice(8).split(',');
  const rows = [];
  for (const route of prefireRoutes.filter(route => !filter || filter.includes(route.id))) {
    const spawn = placePrefireTarget(collision, route.spawn), eyes = prefireSpawnEyes(spawn);
    const walked = walkPrefireAuditPath(collision, [route.spawn, ...route.path]);
    const views = walked.filter((_, index) => index % 8 === 0).map(p => ({...p, y: p.y + 64 * .0254}));
    const candidates = [];
    for (const [profile, data] of Object.entries(dataset.profiles)) for (const [index, angle] of data.angles.entries()) {
      let feet;
      try {feet = placePrefireTarget(collision, angle.position, angle.crouched);} catch {continue;}
      const samples = prefireUpperBodyExtrema(feet, angle.crouched);
      if (eyes.some(eye => samples.some(sample => !nativeSightBlocked(collision, eye, sample)))) continue;
      const yaw = (angle.rotation[1] - 90) * Math.PI / 180;
      const head = actorHeadPoint(feet, angle.crouched, yaw);
      const first = views.findIndex(eye => !nativeSightBlocked(collision, eye, head));
      if (first < 0) continue;
      const pathGap = Math.min(...walked.map(p => Math.abs(p.y - feet.y) < 54 * .0254
        ? Math.hypot(p.x - feet.x, p.z - feet.z) / .0254 : Infinity));
      if (pathGap < 40) continue;
      candidates.push({key: `${profile}/${index + 1}`, position: angle.position.map(Math.round), crouched: angle.crouched,
        first: Math.round(first / views.length * 100), pathGap: Math.round(pathGap)});
    }
    rows.push({route: route.id, candidates});
    console.log(JSON.stringify(rows.at(-1)));
  }
  if (process.argv.includes('--save')) fs.writeFileSync('research/dust2/prefire-candidates.json', JSON.stringify(rows, null, 2));
} finally {collision?.dispose(); await vite.close();}
