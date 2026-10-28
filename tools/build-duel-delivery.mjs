import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildMapManifests} from './build-map-manifests.mjs';

const root='public/revamp/maps/dust2/duel',objects=path.join(root,'objects');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=JSON.parse(await fs.readFile('src/range/duel/real-map-catalog.json','utf8'));
const rounds=JSON.parse(await fs.readFile('src/range/duel/real-map-round-data.json','utf8'));
await fs.mkdir(objects,{recursive:true});
const chunks=[],images=new Map();
const referencedObjects=new Set();
for(const [index,chunk] of catalog.chunks.entries()) {
  const folder=path.join(root,chunk.id),visual=JSON.parse(await fs.readFile(path.join(folder,'visual.json'),'utf8'));
  const metadata=JSON.parse(await fs.readFile(path.join(folder,'chunk.json'),'utf8'));
  chunks.push({chunk,folder,visual,metadata,index});
  for(const resource of visual.resources.filter(r=>r.name.endsWith('.webp'))) {
    let image=images.get(resource.sha256);
    if(!image){image={...resource,folder,mask:0};images.set(resource.sha256,image);}
    image.mask|=1<<index;
  }
}
// Start with exact co-occurrence, then merge small groups with the least extra
// transfer cost. This avoids dozens of tiny requests for rare decorations.
const groups=new Map();
for(const image of images.values()){const group=groups.get(image.mask)??[];group.push(image);groups.set(image.mask,group);}
const bitCount=n=>n.toString(2).replaceAll('0','').length;
const packedGroups=[...groups].map(([mask,images])=>({mask,images,size:images.reduce((s,i)=>s+i.bytes,0)}));
while(true) {
  packedGroups.sort((a,b)=>a.size-b.size||a.mask-b.mask);
  const small=packedGroups[0];if(!small||small.size>=384*1024)break;
  const choices=packedGroups.slice(1).filter(other=>other.size+small.size<=2*1024*1024);
  const best=choices.sort((a,b)=>{
    const cost=other=>(small.size*bitCount(other.mask&~small.mask)+other.size*bitCount(small.mask&~other.mask))/
      (1+bitCount(small.mask&other.mask));return cost(a)-cost(b)||a.mask-b.mask;
  })[0];
  if(!best)break;
  best.mask|=small.mask;best.images.push(...small.images);best.size+=small.size;packedGroups.shift();
}
async function deliver(raw,compress=true) {
  // .gz is transparently decoded by some static servers. Keep transport bytes
  // explicit in the manifest and use .bin so cache checks see identical bytes.
  const encoded=compress?gzipSync(raw,{level:6}):raw,sha256=hash(encoded),extension='bin';
  const name=`${sha256}.${extension}`;await fs.writeFile(path.join(objects,name),encoded);
  referencedObjects.add(name);
  return {url:`/maps/dust2/duel/objects/${name}`,bytes:encoded.length,sha256,
    decodedBytes:raw.length,decodedSha256:hash(raw),encoding:compress?'gzip':'identity'};
}
const bundles=[];
for(const {mask,images:group} of packedGroups.sort((a,b)=>b.mask-a.mask)) {
  let pending=[],size=0;
  const flush=async()=>{
    if(!pending.length)return;
    const body=Buffer.concat(await Promise.all(pending.map(i=>fs.readFile(path.join(i.folder,i.name)))));
    const asset=await deliver(body,false);let offset=0;
    bundles.push({mask,asset,images:pending.map(i=>{const result={name:i.name,offset,length:i.bytes};offset+=i.bytes;return result;})});
    pending=[];size=0;
  };
  for(const image of group.sort((a,b)=>a.sha256.localeCompare(b.sha256))) {
    if(size+image.bytes>2*1024*1024)await flush();pending.push(image);size+=image.bytes;
  }
  await flush();
}
for(const {chunk,folder,visual,metadata,index} of chunks) {
  const files={};
  files['round-data.json']=await deliver(Buffer.from(JSON.stringify(rounds.chunks[chunk.id])));
  const names=['navigation.json','collision.json','collision.bin','visual.json',...visual.files,
    ...visual.resources.filter(r=>!r.name.endsWith('.webp')).map(r=>r.name),...(metadata.radar?['radar.json','radar.png']:[])];
  for(const name of ['query-cache.json','visibility.json','visibility.bin'])try{await fs.stat(path.join(folder,name));names.push(name);}catch{}
  for(const name of names)files[name]=await deliver(await fs.readFile(path.join(folder,name)),!name.endsWith('.png'));
  const selected=bundles.filter(bundle=>bundle.mask&(1<<index));
  const delivery={version:1,files,textures:{bundles:selected.map(b=>b.asset),
    images:selected.flatMap((b,i)=>b.images.map(image=>({...image,bundle:i})))}};
  const bytes=Buffer.from(JSON.stringify(delivery)),asset=await deliver(bytes);
  metadata.delivery=asset;
  const baseBytes=(await Promise.all((await fs.readdir(folder)).filter(name=>name!=='chunk.json').map(async name=>(await fs.stat(path.join(folder,name))).size))).reduce((a,b)=>a+b,0);
  metadata.outputBytes=baseBytes;
  for(let previous=-1;previous!==metadata.outputBytes;){previous=metadata.outputBytes;metadata.outputBytes=baseBytes+Buffer.byteLength(JSON.stringify(metadata));}
  await fs.writeFile(path.join(folder,'chunk.json'),JSON.stringify(metadata));
  console.log(JSON.stringify({chunk:chunk.id,bundles:selected.length,textureBytes:selected.reduce((s,b)=>s+b.asset.bytes,0),
    deliveredBytes:asset.bytes+Object.values(files).reduce((s,a)=>s+a.bytes,0)+selected.reduce((s,b)=>s+b.asset.bytes,0)}));
}
const headers='/maps/dust2/duel/objects/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/models/objects/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n';
await fs.writeFile('public/revamp/_headers',headers);
// This directory owns only generated, content-addressed delivery objects.
// Delete stale generations only after every referencing manifest was written.
const resolvedObjects=path.resolve(objects);
if(resolvedObjects!==path.resolve(root,'objects'))throw new Error('Invalid delivery output root');
try {
  const context=JSON.parse(await fs.readFile(path.join(root,'context/context.json'),'utf8'));
  const asset=context.delivery;
  if(asset&&new RegExp(`^/maps/dust2/duel/objects/[a-f0-9]{64}\\.bin$`).test(asset.url)&&
    path.basename(asset.url)===`${asset.sha256}.bin`)referencedObjects.add(path.basename(asset.url));
}catch(error){if(error.code!=='ENOENT')throw error;}
for(const name of await fs.readdir(resolvedObjects))if(/^[a-f0-9]{64}\.(bin|gz)$/.test(name)&&!referencedObjects.has(name)) {
  const target=path.resolve(resolvedObjects,name);
  if(path.dirname(target)!==resolvedObjects)throw new Error('Invalid generated object path');
  await fs.unlink(target);
}
await buildMapManifests();
console.log(JSON.stringify({uniqueImages:images.size,bundles:bundles.length,uniqueTextureBytes:bundles.reduce((s,b)=>s+b.asset.bytes,0)}));
