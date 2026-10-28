import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildMapManifests} from '../build-map-manifests.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=(file,data)=>fs.writeFile(file,JSON.stringify(data)+'\n');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spraylab-map-manifests-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const catalog=await read(path.join(repo,'src/range/duel/real-map-catalog.json'));
  const files=['src/range/duel/real-map-catalog.json','src/range/duel/map-manifests.json'];
  for(const name of [...catalog.chunks.map(chunk=>chunk.id+'/chunk.json'),'context/context.json']) {
    const file='public/revamp/maps/dust2/duel/'+name,metadata=await read(path.join(repo,file));
    files.push(file,'public/revamp'+metadata.delivery.url);
  }
  for(const file of files) {
    const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(repo,file),target);
  }
  return {root,catalog,output:path.join(root,'src/range/duel/map-manifests.json'),
    first:path.join(root,'public/revamp/maps/dust2/duel',catalog.chunks[0].id,'chunk.json')};
}

test('current generated metadata is deterministic and consistent with every published root',async()=>{
  const data=await buildMapManifests(repo,{check:true});
  assert.deepEqual(data,await read(path.join(repo,'src/range/duel/map-manifests.json')));
});
test('regeneration refreshes source metadata without rewriting public geometry or delivery bytes',async t=>{
  const f=await fixture(t),metadata=await read(f.first);metadata.name+=' release';await write(f.first,metadata);
  await assert.rejects(buildMapManifests(f.root,{check:true}),/Bundled map metadata is stale/);
  await buildMapManifests(f.root);await buildMapManifests(f.root,{check:true});
  assert.deepEqual((await read(f.output)).chunks[metadata.id],metadata);assert.deepEqual(await read(f.first),metadata);
});
test('missing root metadata fails instead of producing a partial catalog',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.output);await fs.unlink(f.first);
  await assert.rejects(buildMapManifests(f.root),{code:'ENOENT'});assert.deepEqual(await fs.readFile(f.output),before);
});
test('stale native catalog identity fails without modifying the output',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.output),metadata=await read(f.first);
  metadata.sourceMin[0]++;await write(f.first,metadata);
  await assert.rejects(buildMapManifests(f.root),/Stale map catalog entry/);assert.deepEqual(await fs.readFile(f.output),before);
});
test('unsupported maps and unsafe catalog ids fail before looking up files',async t=>{
  const f=await fixture(t),file=path.join(f.root,'src/range/duel/real-map-catalog.json');
  for(const change of [catalog=>{catalog.map='other';},catalog=>{catalog.chunks[0].id='../context';},
    catalog=>{catalog.chunks.push(catalog.chunks[0]);}]) {
    const catalog=structuredClone(f.catalog);change(catalog);await write(file,catalog);
    await assert.rejects(buildMapManifests(f.root),/Unsupported map catalog/);
  }
});
test('delivery pins must resolve to the exact compressed and decoded bytes',async t=>{
  const f=await fixture(t),metadata=await read(f.first);
  metadata.delivery.decodedSha256='0'.repeat(64);await write(f.first,metadata);
  await assert.rejects(buildMapManifests(f.root),/Stale decoded delivery bytes/);
  metadata.delivery.url='/maps/dust2/duel/mutable.bin';await write(f.first,metadata);
  await assert.rejects(buildMapManifests(f.root),/Invalid pinned delivery reference/);
});
test('a context from a different visual generation cannot be bundled',async t=>{
  const f=await fixture(t),file=path.join(f.root,'public/revamp/maps/dust2/duel/context/context.json'),context=await read(file);
  context.sourceVisualManifestSha256='0'.repeat(64);await write(file,context);
  await assert.rejects(buildMapManifests(f.root),/Stale map context metadata/);
});
test('both asset authoring entry points refresh local manifests after public metadata writes',async()=>{
  for(const tool of ['build-duel-delivery.mjs','build-duel-context.mjs']) {
    const source=await fs.readFile(new URL('../'+tool,import.meta.url),'utf8');
    assert.match(source,/import \{buildMapManifests\} from '\.\/build-map-manifests.mjs'/);
    assert.ok(source.lastIndexOf('await buildMapManifests(')>source.lastIndexOf('await fs.writeFile('));
  }
});
