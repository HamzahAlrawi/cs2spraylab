import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function verifyCombatModelDelivery(root='public/revamp') {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'models/combat-delivery.json'),'utf8'));
  assert.equal(manifest.version,1);assert(Object.keys(manifest.assets).length<=128);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const [source,asset] of Object.entries(manifest.assets)) {
    assert.match(source,/^\/models\/[a-z0-9-]+\.glb$/);
    assert.match(asset.url,/^\/models\/objects\/[a-f0-9]{64}\.bin$/);assert.equal(asset.encoding,'gzip');
    const encoded=fs.readFileSync(path.join(root,asset.url)),raw=fs.readFileSync(path.join(root,source));
    assert.equal(encoded.length,asset.bytes);assert.equal(raw.length,asset.decodedBytes);
    assert.equal(hash(encoded),asset.sha256);assert.equal(hash(raw),asset.decodedSha256);
    assert(gunzipSync(encoded,{maxOutputLength:64*1024*1024}).equals(raw),`Stale compressed model: ${source}`);
  }
  console.log(`Combat model delivery: ${Object.keys(manifest.assets).length} exact-byte verified models`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)verifyCombatModelDelivery();
