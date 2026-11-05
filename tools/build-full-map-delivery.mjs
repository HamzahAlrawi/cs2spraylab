import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const assetId=process.argv[2]??'dust2';
if(!/^[a-z0-9][a-z0-9_-]*$/.test(assetId))throw Error('Invalid native map asset ID');
const base=`public/revamp/maps/${assetId}/`,objects=path.join(base,'duel/objects');
const visual=JSON.parse(await fs.readFile(path.join(base,'visual.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(objects,{recursive:true});
const deliver=async(raw,compress=true)=>{
  const bytes=compress?gzipSync(raw,{level:6}):raw,sha256=hash(bytes);
  if(bytes.length>25*1024*1024||raw.length>64*1024*1024)throw Error('Full map resource exceeds delivery budget');
  await fs.writeFile(path.join(objects,`${sha256}.bin`),bytes);
  return {url:`/maps/${assetId}/duel/objects/${sha256}.bin`,bytes:bytes.length,sha256,
    decodedBytes:raw.length,decodedSha256:hash(raw),encoding:compress?'gzip':'identity'};
};
const files={},bundles=[],images=[];
const names=['collision.json','collision.bin','visual.json','visibility.json','visibility.bin',...visual.files,
  ...visual.resources.filter(r=>!r.name.endsWith('.webp')).map(r=>r.name)];
for(const name of names){
  if(!/^[a-z0-9-]+\.(json|bin|gltf)$/.test(name))throw Error('Invalid full map resource name');
  files[name]=await deliver(await fs.readFile(path.join(base,name)));
}
let pending=[],size=0;
const flush=async()=>{
  if(!pending.length)return;const buffers=[];let offset=0;
  for(const resource of pending){
    const bytes=await fs.readFile(path.join(base,resource.name));
    if(bytes.length!==resource.bytes||hash(bytes)!==resource.sha256)throw Error('Full map texture digest mismatch');
    buffers.push(bytes);images.push({name:resource.name,bundle:bundles.length,offset,length:bytes.length});offset+=bytes.length;
  }
  bundles.push(await deliver(Buffer.concat(buffers),false));pending=[];size=0;
};
for(const resource of visual.resources.filter(r=>r.name.endsWith('.webp')).sort((a,b)=>a.sha256.localeCompare(b.sha256))){
  if(!/^texture-[a-f0-9]{24}\.webp$/.test(resource.name))throw Error('Invalid texture name');
  if(size+resource.bytes>2*1024*1024)await flush();pending.push(resource);size+=resource.bytes;
}
await flush();
if(bundles.length>64)throw Error('Full map exceeds texture bundle budget');
const delivery={version:1,files,textures:{bundles,images}},pin=await deliver(Buffer.from(JSON.stringify(delivery)));
await fs.writeFile(`src/range/prefire/maps/${assetId}-full-delivery.json`,JSON.stringify(pin,null,2)+'\n');
console.log(JSON.stringify({map:assetId,files:Object.keys(files).length,images:images.length,bundles:bundles.length,
  deliveredBytes:pin.bytes+Object.values(files).reduce((s,a)=>s+a.bytes,0)+bundles.reduce((s,a)=>s+a.bytes,0)}));
