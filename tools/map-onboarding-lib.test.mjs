import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {digest,sourceDigest,inside,writeNew,validateDependencies,validateReports,readDelivered} from './map-onboarding-lib.mjs';

test('source/evidence text hashes tolerate checkout line endings, never changed content',()=>{
  assert.equal(sourceDigest(Buffer.from('one\r\ntwo\r\n')),sourceDigest('one\ntwo\n'));
  assert.notEqual(sourceDigest('one\ntwo\n'),sourceDigest('one\nchanged\n'));
  assert.notEqual(digest('one\r\n'),digest('one\n')); // Native binaries/report bodies remain byte-exact.
});

test('workspace evidence paths reject traversal and preserve existing files',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'spraylab-admission-'));
  try{
    for(const file of ['../outside.json','.git/config','.codex/key','node_modules/x.json'])assert.throws(()=>inside(root,file));
    writeNew(root,'reports/proof.json',{test:true});assert.throws(()=>writeNew(root,'reports/proof.json',{test:false}));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'reports/proof.json'),'utf8')),{test:true});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('dependency checks reject changed, missing and newly added implementation inputs',()=>{
  assert.deepEqual(validateDependencies({a:'sha'},{a:'sha'}),[]);
  for(const pair of [[{a:'sha'},{a:'changed'}],[{a:'sha'},{}],[{a:'sha'},{a:'sha',b:'new'}],[null,{a:'sha'}]])
    assert.ok(validateDependencies(...pair).length);
});
test('native audit reads only checksum-matching delivered collision metadata',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'spraylab-delivery-'));
  try{
    const decoded=Buffer.from('{"synthetic":true}'),bytes=gzipSync(decoded),sha256=digest(bytes),url=`/maps/fixture/duel/objects/${sha256}.bin`;
    const target=path.join(root,'public/revamp',url);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    const asset={url,sha256,bytes:bytes.length,decodedBytes:decoded.length,decodedSha256:digest(decoded),encoding:'gzip'};
    assert.deepEqual(readDelivered(root,asset),decoded);
    assert.throws(()=>readDelivered(root,{...asset,decodedSha256:'0'.repeat(64)}));
    assert.throws(()=>readDelivered(root,{...asset,sha256:'0'.repeat(64)}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
const identity={mapId:'synthetic',revision:'v1',packageKey:'fixture',catalogSha256:'c',planSha256:'p'},deps={'fixture.ts':'s'};
const report=()=>({...identity,complete:true,findings:[],dependencies:deps,inputs:{capture:'Synthetic'},reviewer:'Synthetic',
  results:[{id:'visual-reference:yard',kind:'reference-review'}]});
const artifact=r=>{const body=JSON.stringify(r);return {sha256:digest(body),body};};
test('evidence verification checks raw bytes, identity, complete results and code snapshot',()=>{
  const good=artifact(report());assert.deepEqual(validateReports([good],identity,deps).errors,[]);
  for(const bad of [{...good,body:good.body+' '},artifact({...report(),revision:'stale'}),artifact({...report(),complete:false}),
    artifact({...report(),findings:['collision-gap']}),artifact({...report(),dependencies:{}}),artifact({...report(),reviewer:''}),artifact({...report(),inputs:{}})])
    assert.ok(validateReports([bad],identity,deps).errors.length);
  assert.ok(validateReports([good,good],identity,deps).errors.length);
  assert.ok(validateReports([],identity,deps).errors.length);
});
