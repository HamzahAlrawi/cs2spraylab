import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {preparePagesDeploy} from './prepare-pages-deploy.mjs';
const roots=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spraylab-pages-test-'));roots.push(root);
  const dist=path.join(root,'dist'),pins=path.join(root,'pins'),source=path.join(root,'source.bin');
  const objects=path.join(dist,'maps/test/duel/objects');await fs.mkdir(objects,{recursive:true});await fs.mkdir(pins);
  const raw=Buffer.alloc(25*1024*1024+1),hash=b=>createHash('sha256').update(b).digest('hex');await fs.writeFile(source,raw);
  const delivered=async raw=>{const bytes=gzipSync(raw),sha256=hash(bytes);await fs.writeFile(path.join(objects,`${sha256}.bin`),bytes);
    return {url:`/maps/test/duel/objects/${sha256}.bin`,bytes:bytes.length,sha256,decodedBytes:raw.length,decodedSha256:hash(raw),encoding:'gzip'};};
  const asset=await delivered(raw),pin=await delivered(Buffer.from(JSON.stringify({version:1,files:{'grenade-query.bin':asset}})));
  await fs.writeFile(path.join(pins,'test-full-delivery.json'),JSON.stringify(pin));
  const file=path.join(dist,'maps/test/grenade-query.bin');await fs.writeFile(file,raw);
  return {root,dist,pins,file,source,asset};
}
test('omits a verified redundant snapshot, keeps the source and compressed object, and is repeatable',async()=>{
  const f=await fixture();assert.deepEqual(await preparePagesDeploy(f.dist,f.pins),[{path:'maps/test/grenade-query.bin',bytes:25*1024*1024+1}]);
  await assert.rejects(fs.stat(f.file),{code:'ENOENT'});assert.equal((await fs.stat(f.source)).size,25*1024*1024+1);
  assert.equal((await fs.stat(path.join(f.dist,f.asset.url.slice(1)))).size,f.asset.bytes);
  assert.deepEqual(await preparePagesDeploy(f.dist,f.pins),[]);
});
test('rejects an unknown oversized file without partially pruning the build',async()=>{
  const f=await fixture();await fs.copyFile(f.source,path.join(f.dist,'unmapped.bin'));
  await assert.rejects(preparePagesDeploy(f.dist,f.pins),/Oversized runtime asset/);await fs.stat(f.file);
});
test('rejects a changed raw snapshot rather than silently changing collision',async()=>{
  const f=await fixture(),handle=await fs.open(f.file,'r+');await handle.write(Buffer.from([1]),0,1,0);await handle.close();
  await assert.rejects(preparePagesDeploy(f.dist,f.pins),/differs from verified delivery/);await fs.stat(f.file);
});
test('rejects corrupt compressed delivery and keeps the raw build copy',async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.dist,f.asset.url.slice(1)),Buffer.from('corrupt'));
  await assert.rejects(preparePagesDeploy(f.dist,f.pins),/digest mismatch/);await fs.stat(f.file);
});
