import fs from 'node:fs';
import {createServer} from 'vite';
import {Group} from 'three';

const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false, watch: null}, appType: 'custom', logLevel: 'error'});
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {buildRealMapCourses} = await vite.ssrLoadModule('/src/range/duel/real-map-rounds.ts');
  const catalog = JSON.parse(fs.readFileSync('src/range/duel/real-map-catalog.json', 'utf8'));
  const result = {version: 1, chunks: {}};
  for (const chunk of catalog.chunks) {
    const base = `public/revamp/maps/dust2/duel/${chunk.id}/`, bytes = fs.readFileSync(base + 'collision.bin');
    const collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync(base + 'collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      const courses = buildRealMapCourses({collision, scene: new Group()}, chunk);
      result.chunks[chunk.id] = {collisionSha256: collision.collisionSha256, courses};
      console.log(JSON.stringify({id: chunk.id, courses: courses.map(course => ({id: course.id, holds: course.holds.length,
        peeks: course.holds.filter(hold => Math.hypot(hold.lane.anchor.x - hold.lane.edge.x, hold.lane.anchor.z - hold.lane.edge.z) > .1).length,
        starts: course.starts.length}))}));
    } finally {collision.dispose();}
  }
  fs.writeFileSync('src/range/duel/real-map-round-data.json', JSON.stringify(result));
} finally {await vite.close();}
