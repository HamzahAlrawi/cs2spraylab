import {readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'vite';

const [modulePath, chunkPath, output, exportName = 'mapCatalog'] = process.argv.slice(2);
if (!modulePath || !chunkPath || !output) throw Error('Usage: node tools/build-map-index.mjs <catalog module> <chunk catalog JSON> <output JSON> [export name]');
const server = await createServer({server: {middlewareMode: true}, appType: 'custom'});
try {
  const module = await server.ssrLoadModule(modulePath), catalog = module[exportName];
  if (!catalog?.routes?.length) throw Error('No map catalog exported.');
  const {chunks} = JSON.parse(await readFile(chunkPath, 'utf8'));
  const summary = route => ({id: route.id, name: route.name, ...(route.lineups ? {lineups: route.lineups.map(({id, name}) => ({id, name}))} : {})});
  const inside = (chunk, p) => p[0] > chunk.sourceMin[0] + 17 && p[0] < chunk.sourceMax[0] - 17 &&
    p[1] > chunk.sourceMin[1] + 17 && p[1] < chunk.sourceMax[1] - 17 && p[2] >= chunk.sourceMin[2] && p[2] <= chunk.sourceMax[2];
  const index = {id: catalog.id, revision: catalog.revision, routes: catalog.routes.map(summary), aliases: module.prefireRouteAliases ?? {},
    approaches: Object.fromEntries(chunks.map(chunk => [chunk.id, catalog.routes.filter(route =>
      [route.spawn, ...route.path].every(p => inside(chunk, p))).map(summary)]))};
  await writeFile(output, JSON.stringify(index, null, 2) + '\n');
  console.log(`Indexed ${catalog.id}: ${index.routes.length} routes, ${chunks.length} chunks`);
} finally {await server.close();}
