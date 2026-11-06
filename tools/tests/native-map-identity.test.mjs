import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeMapIdentity,nativeMapFiles} from '../native-map-identity.mjs';
import fs from 'node:fs';

test('map authoring namespaces isolate native inputs and outputs without changing legacy defaults',()=>{
  const mirage=nativeMapFiles('mirage'),dust=nativeMapFiles();
  assert.equal(mirage.mapId,'de_mirage');assert.equal(mirage.out,'public/revamp/maps/mirage');
  assert.equal(mirage.catalog,'src/range/prefire/maps/mirage-chunks.json');
  assert.equal(dust.catalog,'src/range/duel/real-map-catalog.json');
  assert.notEqual(mirage.radar,dust.radar);assert.notEqual(mirage.manifests,dust.manifests);
  for(const id of ['../de_mirage','de_mirage/../../x','C:/maps/de_mirage','de_mirage;bad',undefined])assert.throws(()=>nativeMapIdentity(id));
});
test('map cache rules use one Pages wildcard and cover both published map object roots',()=>{
  const text=fs.readFileSync('public/revamp/_headers','utf8');
  const paths=text.split(/\r?\n/).filter(line=>line.startsWith('/'));
  for(const path of paths)assert.equal((path.match(/\*/g)??[]).length,1);
  assert.ok(paths.includes('/maps/dust2/duel/objects/*'));assert.ok(paths.includes('/maps/mirage/duel/objects/*'));
});
