import fs from 'node:fs';
import {createServer} from 'vite';
import {Group} from 'three';

const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false, watch: null}, appType: 'custom', logLevel: 'error'});
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {buildRealMapCourses} = await vite.ssrLoadModule('/src/range/duel/real-map-rounds.ts');
  const {nativeMaps,defaultNativeMapId} = await vite.ssrLoadModule('/src/range/prefire/maps/index.ts');
  const mapId = process.argv[2] ?? defaultNativeMapId, definition = nativeMaps.get(mapId);
  const sourceCatalog = await nativeMaps.loadCatalog(mapId);
  const output = process.argv[3] ?? (mapId === defaultNativeMapId ? 'src/range/duel/real-map-round-data.json' : undefined);
  if(!output)throw Error('Provide an explicit round-catalog output for a non-default map.');
  const result = {version: 1, chunks: {}};
  for (const chunk of definition.chunks) {
    const base = `public/revamp${definition.base}duel/${chunk.id}/`, bytes = fs.readFileSync(base + 'collision.bin');
    const collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync(base + 'collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      const courses = buildRealMapCourses({collision, scene: new Group()}, chunk,sourceCatalog);
      result.chunks[chunk.id] = {collisionSha256: collision.collisionSha256, courses};
      console.log(JSON.stringify({id: chunk.id, courses: courses.map(course => ({id: course.id, holds: course.holds.length,
        peeks: course.holds.filter(hold => Math.hypot(hold.lane.anchor.x - hold.lane.edge.x, hold.lane.anchor.z - hold.lane.edge.z) > .1).length,
        starts: course.starts.length}))}));
    } finally {collision.dispose();}
  }
  fs.writeFileSync(output, JSON.stringify(result));
} finally {await vite.close();}
