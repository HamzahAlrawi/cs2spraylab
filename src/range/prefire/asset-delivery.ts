import {verifyMapDigest} from './map-loading';

export type DeliveredAsset={url:string;bytes:number;sha256:string;decodedBytes:number;decodedSha256:string;encoding:'gzip'|'identity'};
export type MapDelivery={version:1;files:Record<string,DeliveredAsset>;
  textures?:{bundles:DeliveredAsset[];images:{name:string;bundle:number;offset:number;length:number}[]}};
const CACHE='spraylab-map-bytes-v1',BUDGET=80*1024*1024;
const MiB=1024*1024;
export function persistentAssetBudget(estimate?:{quota?:number;usage?:number}) {
  const quota=estimate?.quota,usage=estimate?.usage??0;
  return quota&&Number.isFinite(quota)&&quota>0
    ? Math.max(0,Math.floor(Math.min(512*MiB,quota*.15,Math.max(0,quota-usage)*.5))):512*MiB;
}
const retained=new Map<string,{bytes:ArrayBuffer;used:number}>();
const downloads=new Map<string,{promise:Promise<ArrayBuffer>;controller:AbortController;refs:number}>();
let retainedBytes=0,maintenance:Promise<void>=Promise.resolve(),diskBudget:Promise<number>|undefined;
export async function settleAssetCache(){await maintenance;}
export function validDeliveredAsset(value:unknown):value is DeliveredAsset {
  const a=value as DeliveredAsset;
  return !!a && /^\/(?:maps\/dust2\/duel|models)\/objects\/[a-f0-9]{64}\.(gz|bin)$/.test(a.url) &&
    /^[a-f0-9]{64}$/.test(a.sha256) && /^[a-f0-9]{64}$/.test(a.decodedSha256) &&
    Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=25*1024*1024&&
    Number.isSafeInteger(a.decodedBytes)&&a.decodedBytes>0&&a.decodedBytes<=64*1024*1024&&
    (a.encoding==='gzip'||a.encoding==='identity') && a.url.includes(a.sha256);
}
export function validateDelivery(raw:unknown):MapDelivery {
  const d=raw as MapDelivery;
  if(d?.version!==1||!d.files||Object.keys(d.files).length>128||
    Object.entries(d.files).some(([name,a])=>!/^([a-z0-9-]+\.(json|bin|gltf|png))$/.test(name)||!validDeliveredAsset(a)))
    throw new Error('Invalid map delivery manifest');
  if(d.textures) {
    const {bundles,images}=d.textures;
    if(!Array.isArray(bundles)||bundles.length>64||bundles.some(a=>!validDeliveredAsset(a))||
      !Array.isArray(images)||images.length>8192||new Set(images.map(i=>i.name)).size!==images.length||images.some(i=>
      !/^texture-[a-f0-9]{24}\.webp$/.test(i.name)||!Number.isSafeInteger(i.bundle)||!bundles[i.bundle]||
      !Number.isSafeInteger(i.offset)||i.offset<0||!Number.isSafeInteger(i.length)||i.length<=0||
      i.offset+i.length>bundles[i.bundle].decodedBytes))throw new Error('Invalid shared texture bundles');
  }
  return d;
}
function remember(key:string,bytes:ArrayBuffer) {
  const old=retained.get(key);if(old)retainedBytes-=old.bytes.byteLength;
  retained.set(key,{bytes,used:Date.now()});retainedBytes+=bytes.byteLength;
  while(retainedBytes>BUDGET&&retained.size){const first=retained.keys().next().value!;
    retainedBytes-=retained.get(first)!.bytes.byteLength;retained.delete(first);}
}
async function persist(asset:DeliveredAsset,bytes:ArrayBuffer) {
  if(!globalThis.caches)return;
  // Disk and RAM are separate budgets: all eight chunks should fit on disk
  // without keeping their decoded scenes or compressed bytes alive in RAM.
  maintenance=maintenance.then(async()=>{try {
    const cache=await caches.open(CACHE);
    const budget=await (diskBudget??=Promise.resolve().then(async()=>{
      try{return persistentAssetBudget(await navigator.storage?.estimate?.());}catch{return persistentAssetBudget();}
    }));
    if(bytes.byteLength>budget)return;
    const entries=await Promise.all((await cache.keys()).map(async request=>{
        const response=await cache.match(request);return {request,size:Number(response?.headers.get('x-spraylab-size'))||0,
          used:Number(response?.headers.get('x-spraylab-used'))||0};}));
    const absolute=new URL(asset.url,globalThis.location?.origin??'https://spraylab.local').href;
    let total=entries.reduce((sum,e)=>sum+(e.request.url===absolute?0:e.size),0)+bytes.byteLength;
    const oldest=entries.filter(entry=>entry.request.url!==absolute).sort((a,b)=>a.used-b.used);
    while(total>budget&&oldest.length){const entry=oldest.shift()!;await cache.delete(entry.request);total-=entry.size;}
    const response=()=>new Response(bytes,{headers:{'x-spraylab-size':String(bytes.byteLength),'x-spraylab-used':String(Date.now())}});
    try{await cache.put(asset.url,response());}
    catch(error){
      if(!(error instanceof DOMException)||error.name!=='QuotaExceededError'||!oldest.length)throw error;
      // A quota estimate can race other tabs. Reclaim only our oldest assets.
      for(const entry of oldest.slice(0,Math.max(1,Math.ceil(oldest.length/4))))await cache.delete(entry.request);
      await cache.put(asset.url,response());
    }
  }catch{/* Storage may be unavailable or full; verified network bytes remain usable. */}}).catch(()=>{});
  await maintenance;
}
async function readCompressed(asset:DeliveredAsset,signal:AbortSignal,priority:'auto'|'low') {
  let bytes:ArrayBuffer|undefined;
  if(globalThis.caches)try {
    const cache=await caches.open(CACHE),response=await cache.match(asset.url);
    if(response) {
      const cached=await response.arrayBuffer();
      if(cached.byteLength===asset.bytes)try{
        await verifyMapDigest(cached,asset.sha256);bytes=cached;
        if(Date.now()-(Number(response.headers.get('x-spraylab-used'))||0)>60000)void persist(asset,cached);
      }catch{await cache.delete(asset.url);}
      else await cache.delete(asset.url);
    }
  }catch{/* Fall back to the network when browser storage is disabled. */}
  if(!bytes) {
    const response=await fetch(asset.url,{signal,cache:'force-cache',priority} as RequestInit);
    if(!response.ok)throw new Error('Map download unavailable');
    bytes=await response.arrayBuffer();if(bytes.byteLength!==asset.bytes)throw new Error('Map download size mismatch');
    await verifyMapDigest(bytes,asset.sha256);signal?.throwIfAborted();
    void persist(asset,bytes.slice(0));
  }
  signal?.throwIfAborted();remember(asset.sha256,bytes);return bytes;
}
async function compressedBytes(asset:DeliveredAsset,signal?:AbortSignal,priority:'auto'|'low'='auto') {
  signal?.throwIfAborted();
  const warm=retained.get(asset.sha256);
  if(warm){
    retained.delete(asset.sha256);retained.set(asset.sha256,warm);
    if(Date.now()-warm.used>60000){warm.used=Date.now();void persist(asset,warm.bytes);}
    return warm.bytes;
  }
  let entry=downloads.get(asset.sha256);
  if(entry?.controller.signal.aborted)entry=undefined;
  if(!entry) {
    const controller=new AbortController();entry={controller,refs:0,promise:readCompressed(asset,controller.signal,priority)};
    downloads.set(asset.sha256,entry);const owner=entry;
    void entry.promise.finally(()=>{if(downloads.get(asset.sha256)===owner)downloads.delete(asset.sha256);}).catch(()=>{});
  }
  const owner=entry;owner.refs++;
  let abort:()=>void=()=>{};
  const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal?.reason??new DOMException('Map download cancelled','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([owner.promise,cancelled]);}
  finally{signal?.removeEventListener('abort',abort);owner.refs--;if(owner.refs===0)owner.controller.abort();}
}
export async function fetchDeliveredAsset(asset:DeliveredAsset,signal?:AbortSignal) {
  if(!validDeliveredAsset(asset))throw new Error('Invalid delivered asset');
  const bytes=await compressedBytes(asset,signal);
  let decoded:ArrayBuffer;
  if(asset.encoding==='gzip') {
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const output=new Uint8Array(asset.decodedBytes);let offset=0;
    const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try {
      signal?.throwIfAborted();
      while(true){const {value,done}=await reader.read();signal?.throwIfAborted();if(done)break;
        if(offset+value.length>output.length){await reader.cancel();throw new Error('Map decompression exceeds size budget');}
        output.set(value,offset);offset+=value.length;
      }
      if(offset!==output.length)throw new Error('Map decompression size mismatch');
      decoded=output.buffer;
    }finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  }else decoded=bytes.slice(0);
  signal?.throwIfAborted();
  if(decoded.byteLength!==asset.decodedBytes)throw new Error('Map decompression size mismatch');
  await verifyMapDigest(decoded,asset.decodedSha256);return decoded;
}
export async function prefetchDeliveredAssets(assets:readonly DeliveredAsset[],signal:AbortSignal) {
  let next=0;
  await Promise.all(Array.from({length:2},async()=>{while(next<assets.length){signal.throwIfAborted();await compressedBytes(assets[next++],signal,'low');}}));
}
