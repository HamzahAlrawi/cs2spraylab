import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

async function verifyDelivery(root,asset) {
  if(!asset||!digest(asset.sha256)||!digest(asset.decodedSha256)||
    asset.url!==`/maps/dust2/duel/objects/${asset.sha256}.bin`||
    !Number.isSafeInteger(asset.bytes)||asset.bytes<=0||asset.bytes>25*1024*1024||
    !Number.isSafeInteger(asset.decodedBytes)||asset.decodedBytes<=0||asset.decodedBytes>64*1024*1024||
    !['gzip','identity'].includes(asset.encoding))throw Error('Invalid pinned delivery reference');
  const bytes=await fs.readFile(path.join(root,'public/revamp',asset.url.slice(1)));
  if(bytes.length!==asset.bytes||hash(bytes)!==asset.sha256)throw Error('Stale pinned delivery bytes');
  const decoded=asset.encoding==='gzip'?gunzipSync(bytes,{maxOutputLength:asset.decodedBytes}):bytes;
  if(decoded.length!==asset.decodedBytes||hash(decoded)!==asset.decodedSha256)throw Error('Stale decoded delivery bytes');
}

/** Only root metadata is bundled. Resource manifests, textures and round data
 * remain content-addressed assets managed by the existing browser byte cache. */
export async function buildMapManifests(root=process.cwd(),{check=false}={}) {
  const catalogBytes=await fs.readFile(path.join(root,'src/range/duel/real-map-catalog.json'));
  const catalog=JSON.parse(catalogBytes),base=path.join(root,'public/revamp/maps/dust2/duel');
  if(catalog.version!==1||catalog.map!=='dust2'||!Array.isArray(catalog.chunks)||!catalog.chunks.length||
    catalog.chunks.some(chunk=>!/^dust2-[a-z0-9-]+$/.test(chunk.id))||
    new Set(catalog.chunks.map(chunk=>chunk.id)).size!==catalog.chunks.length)throw Error('Unsupported map catalog');
  const chunks={};
  for(const chunk of catalog.chunks) {
    const metadata=JSON.parse(await fs.readFile(path.join(base,chunk.id,'chunk.json'),'utf8'));
    if(metadata.version!==1||metadata.map!==catalog.map||metadata.id!==chunk.id||metadata.routeId!==chunk.routeId||
      !same(metadata.sourceMin,chunk.sourceMin)||!same(metadata.sourceMax,chunk.sourceMax)||
      metadata.contextPaddingUnits!==chunk.contextPaddingUnits||
      ['sourceCollisionSha256','collisionManifestSha256','visualManifestSha256','navigationSha256'].some(key=>!digest(metadata[key])))
      throw Error(`Stale map catalog entry: ${chunk.id}`);
    await verifyDelivery(root,metadata.delivery);
    chunks[chunk.id]=metadata;
  }
  const context=JSON.parse(await fs.readFile(path.join(base,'context/context.json'),'utf8'));
  if(![1,2].includes(context.version)||context.map!==catalog.map||context.visualOnly!==true||
    !digest(context.sha256)||context.delivery?.decodedSha256!==context.sha256||context.delivery.decodedBytes>5_000_000||
    Object.values(chunks).some(chunk=>chunk.sourceVisualManifestSha256!==context.sourceVisualManifestSha256))
    throw Error('Stale map context metadata');
  await verifyDelivery(root,context.delivery);
  const data={version:1,map:catalog.map,chunks,context};
  const output=path.join(root,'src/range/duel/map-manifests.json'),serialized=JSON.stringify(data)+'\n';
  if(check) {
    if(await fs.readFile(output,'utf8')!==serialized)throw Error('Bundled map metadata is stale. Run node tools/build-map-manifests.mjs.');
  }else await fs.writeFile(output,serialized);
  return data;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await buildMapManifests(process.cwd(),{check:process.argv.includes('--check')});
}
