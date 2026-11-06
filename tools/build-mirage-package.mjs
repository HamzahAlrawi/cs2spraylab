import {execFileSync} from 'node:child_process';
import {buildDuelMapChunks} from './build-duel-map-chunks.mjs';
import {buildDuelNavigation} from './build-duel-navigation.mjs';
import {optimizeDuelVisuals} from './optimize-duel-visuals.mjs';
import {buildDuelContext} from './build-duel-context.mjs';

const run=(file,...args)=>execFileSync(process.execPath,[`tools/${file}`,...args],{stdio:'inherit',windowsHide:true});
if(!process.argv.includes('--pack-only')){
  run('import-dust2.mjs','--map=de_mirage');run('import-native-radar.mjs','de_mirage');
  run('import-prefire-profiles.mjs','de_mirage');run('author-mirage.mjs');
  run('build-map-index.mjs','/src/range/prefire/mirage-routes.ts','src/range/prefire/maps/mirage-chunks.json','src/range/prefire/maps/mirage-index.json','mirageCatalog');
  await buildDuelMapChunks({assetId:'mirage'});
  run('build-duel-rounds.mjs','de_mirage','research/mirage/round-data.json');
  await buildDuelNavigation({assetId:'mirage'});await optimizeDuelVisuals({assetId:'mirage',apply:true});
  run('build-duel-query-cache.mjs','mirage');
  run('build-duel-visibility.mjs','mirage');
}
run('build-duel-delivery.mjs','mirage');
await buildDuelContext(process.cwd(),{assetId:'mirage'});
console.log('Mirage assets built. Re-run native/beta evidence after reviewing changed source hashes; this command never approves a map.');
