import {existsSync,readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {dust2Catalog} from './routes';
import {validatePrefireMapQuality} from './map-quality';

const base='public/revamp/maps/dust2/';
it.skipIf(!existsSync(base+'quality.json'))('the shipped Dust 2 package can activate every current route',()=>{
  const manifest=JSON.parse(readFileSync(base+'collision.json','utf8')),
    quality=JSON.parse(readFileSync(base+'quality.json','utf8'));
  expect(validatePrefireMapQuality(dust2Catalog,{mapId:dust2Catalog.id,catalogRevision:dust2Catalog.revision,
    gameBuild:manifest.build,geometrySha256:manifest.collisionSha256},quality)).toEqual([]);
});
