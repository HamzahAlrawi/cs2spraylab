import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const root=path.resolve('public/revamp/models'),objects=path.join(root,'objects');
const data=JSON.parse(await fs.readFile('src/range/game-data.json','utf8'));
const names=['target','duel-motion','duel-flinches','utility-gestures',...['knife',...Object.keys(data.weapons)].flatMap(id=>[id,`view-${id}`]),
  ...['he','flash','smoke','molotov','incendiary','decoy'].flatMap(id=>[`utility-${id}`,`utility-${id}-projectile`,`view-utility-${id}`])];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),assets={},used=new Set();
await fs.mkdir(objects,{recursive:true});
for(const name of new Set(names)) {
  const source=path.join(root,`${name}.glb`);let raw;
  try{raw=await fs.readFile(source);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const bytes=gzipSync(raw,{level:6}),hash=sha(bytes),file=`${hash}.bin`;
  if(bytes.length>25*1024*1024||raw.length>64*1024*1024)throw new Error(`Model delivery exceeds budget: ${name}`);
  await fs.writeFile(path.join(objects,file),bytes);used.add(file);
  assets[`/models/${name}.glb`]={url:`/models/objects/${file}`,bytes:bytes.length,sha256:hash,
    decodedBytes:raw.length,decodedSha256:sha(raw),encoding:'gzip'};
}
await fs.writeFile(path.join(root,'combat-delivery.json'),JSON.stringify({version:1,assets}));
for(const file of await fs.readdir(objects))if(/^[a-f0-9]{64}\.bin$/.test(file)&&!used.has(file)) {
  const target=path.resolve(objects,file);if(path.dirname(target)!==objects)throw new Error('Invalid generated model path');
  await fs.unlink(target);
}
console.log(JSON.stringify({models:Object.keys(assets).length,rawBytes:Object.values(assets).reduce((s,a)=>s+a.decodedBytes,0),
  transferBytes:Object.values(assets).reduce((s,a)=>s+a.bytes,0)}));
