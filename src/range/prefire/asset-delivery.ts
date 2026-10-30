import {verifyMapDigest} from './map-loading';

export type DeliveredAsset={url:string;bytes:number;sha256:string;decodedBytes:number;decodedSha256:string;encoding:'gzip'|'identity'};
export type MapDelivery={version:1;files:Record<string,DeliveredAsset>;
  textures?:{bundles:DeliveredAsset[];images:{name:string;bundle:number;offset:number;length:number}[]}};
const CACHE='spraylab-map-bytes-v1',BUDGET=80*1024*1024;
const METADATA_CACHE='spraylab-map-bytes-metadata-v1',INDEX='/__spraylab-map-bytes-index-v1__';
const ASSET_URL=/^\/(?:maps\/[a-z0-9][a-z0-9_-]*\/duel|models)\/objects\/[a-f0-9]{64}\.(gz|bin)$/;
const MiB=1024*1024;
export function persistentAssetBudget(estimate?:{quota?:number;usage?:number}) {
  const quota=estimate?.quota,usage=Number.isFinite(estimate?.usage)?Math.max(0,estimate!.usage!):0;
  return quota!==undefined&&Number.isFinite(quota)&&quota>=0
    ? Math.max(0,Math.floor(Math.min(512*MiB,quota*.15,Math.max(0,quota-usage)*.5))):512*MiB;
}
const retained=new Map<string,{bytes:ArrayBuffer;used:number}>();
const downloads=new Map<string,{promise:Promise<ArrayBuffer>;controller:AbortController;refs:number}>();
let retainedBytes=0,maintenance:Promise<void>=Promise.resolve(),diskBudget:Promise<number>|undefined;
type DiskEntry={size:number;used:number};
type DiskIndex={cache:Cache;metadata?:Cache;entries:Map<string,DiskEntry>;total:number;dirty:boolean};
let diskCache:Promise<Cache|undefined>|undefined,diskIndex:Promise<DiskIndex|undefined>|undefined;
let metadataTimer:ReturnType<typeof setTimeout>|undefined;
const origin=()=>globalThis.location?.origin??'https://spraylab.local';
const absolute=(url:string)=>new URL(url,origin()).href;
function enqueue(task:()=>Promise<void>) {maintenance=maintenance.then(task).catch(()=>{});return maintenance;}
function openDiskCache() {
  return diskCache??=Promise.resolve().then(async()=>{try{return await globalThis.caches?.open(CACHE);}catch{return undefined;}});
}
function dirty(state:DiskIndex) {
  state.dirty=true;
  if(metadataTimer===undefined)metadataTimer=setTimeout(()=>{metadataTimer=undefined;void enqueue(flushMetadata);},1000);
}
function setEntry(state:DiskIndex,url:string,entry?:DiskEntry) {
  state.total-=state.entries.get(url)?.size??0;
  if(entry){state.entries.set(url,entry);state.total+=entry.size;}else state.entries.delete(url);
  dirty(state);
}
function inventory() {
  return diskIndex??=Promise.resolve().then(async()=>{
    const cache=await openDiskCache();if(!cache)return;
    let metadata:Cache|undefined;
    const saved=new Map<string,DiskEntry>();
    try {
      metadata=await caches.open(METADATA_CACHE);
      const response=await metadata.match(INDEX),raw=await response?.json();
      if(raw?.version===1&&Array.isArray(raw.entries))for(const row of raw.entries) {
        if(Array.isArray(row)&&row.length===3&&typeof row[0]==='string'&&
          Number.isSafeInteger(row[1])&&row[1]>0&&row[1]<=25*MiB&&Number.isFinite(row[2])&&row[2]>=0)
          saved.set(row[0],{size:row[1],used:row[2]});
      }
    }catch{/* Metadata is optional; recover legacy entries from their headers. */}
    const state:DiskIndex={cache,metadata,entries:new Map(),total:0,dirty:false};
    // Reconcile keys once per page, including writes from older deployments/tabs.
    // Only legacy/unindexed entries need a match; normal reloads read metadata only.
    for(const request of await cache.keys()) {
      const url=new URL(request.url);
      if(url.origin!==origin()||url.search||!ASSET_URL.test(url.pathname))continue;
      let entry=saved.get(url.href);
      if(!entry) {
        const response=await cache.match(request);if(!response)continue;
        let size=Number(response.headers.get('x-spraylab-size'));
        if(!Number.isSafeInteger(size)||size<=0||size>25*MiB)size=(await response.blob()).size;
        const used=Number(response.headers.get('x-spraylab-used'));
        entry={size,used:Number.isFinite(used)&&used>=0?used:0};
      }
      state.entries.set(url.href,entry);state.total+=entry.size;
    }
    if(saved.size!==state.entries.size||[...state.entries.keys()].some(url=>!saved.has(url)))dirty(state);
    return state;
  }).catch(()=>undefined);
}
async function flushMetadata() {
  if(metadataTimer!==undefined){clearTimeout(metadataTimer);metadataTimer=undefined;}
  const state=await diskIndex;if(!state?.dirty)return;
  state.dirty=false;
  if(state.metadata)try {
    await state.metadata.put(INDEX,new Response(JSON.stringify({version:1,
      entries:[...state.entries].map(([url,e])=>[url,e.size,e.used])})));
  }catch{state.metadata=undefined;/* Never evict asset bodies just to save recency. */}
}
export async function settleAssetCache(){
  let pending:Promise<void>;
  do {pending=enqueue(flushMetadata);await pending;}while(pending!==maintenance||metadataTimer!==undefined);
}
function storageBudget(state:DiskIndex) {
  return diskBudget??=Promise.resolve().then(async()=>{
    try {
      const estimate=await globalThis.navigator?.storage?.estimate?.();
      // Usage includes our existing bodies. Do not count that space twice on reload.
      return persistentAssetBudget(estimate&&{...estimate,usage:Math.max(0,(estimate.usage??0)-state.total)});
    }catch{return persistentAssetBudget();}
  });
}
// Compressed asset bodies only; metadata, RAM, and decoded/GPU resources are excluded.
export async function assetCacheStats():Promise<{storedBytes:number;count:number;budget:number}> {
  await maintenance;
  const state=await inventory();
  if(!state)return {storedBytes:0,count:0,budget:0};
  const budget=await storageBudget(state);
  return {storedBytes:state.total,count:state.entries.size,budget};
}
export function validDeliveredAsset(value:unknown):value is DeliveredAsset {
  const a=value as DeliveredAsset;
  return !!a && ASSET_URL.test(a.url) &&
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
function touch(asset:DeliveredAsset) {
  void enqueue(async()=>{
    const state=await inventory();if(!state)return;
    const url=absolute(asset.url),entry=state.entries.get(url),used=Date.now();
    if(entry&&(used-entry.used>60000||entry.size!==asset.bytes))setEntry(state,url,{size:asset.bytes,used});
  });
}
function discard(asset:DeliveredAsset) {
  void enqueue(async()=>{
    const state=await inventory();if(!state)return;
    const url=absolute(asset.url);await state.cache.delete(url);setEntry(state,url);
  });
}
function persist(asset:DeliveredAsset,bytes:ArrayBuffer) {
  return enqueue(async()=>{
    const state=await inventory();if(!state)return;
    const budget=await storageBudget(state);
    if(bytes.byteLength>budget)return;
    const url=absolute(asset.url);
    let oldest:[string,DiskEntry][]|undefined,nextOldest=0;
    const evict=async(needed:number)=>{
      oldest??=[...state.entries].filter(([key])=>key!==url).sort((a,b)=>a[1].used-b[1].used);
      let reclaimed=0;
      while(reclaimed<needed&&nextOldest<oldest.length) {
        const [key,entry]=oldest[nextOldest++];await state.cache.delete(key);
        setEntry(state,key);reclaimed+=entry.size;
      }
      return reclaimed;
    };
    const response=()=>new Response(bytes,{headers:{'x-spraylab-size':String(bytes.byteLength),'x-spraylab-used':String(Date.now())}});
    try{await state.cache.put(asset.url,response());}
    catch(error){
      if((error as {name?:string})?.name!=='QuotaExceededError')throw error;
      // Estimates race other storage users. Retry once after bounded, asset-only eviction.
      const excess=state.total-(state.entries.get(url)?.size??0)+bytes.byteLength-budget;
      if(!await evict(Math.max(excess,bytes.byteLength)))return;
      await state.cache.put(asset.url,response());
    }
    setEntry(state,url,{size:bytes.byteLength,used:Date.now()});
    // Do not discard played chunks for a new write that fails with a permission error.
    if(state.total>budget)await evict(state.total-budget);
  });
}
async function readCompressed(asset:DeliveredAsset,signal:AbortSignal,priority:'auto'|'low') {
  let bytes:ArrayBuffer|undefined;
  try {
    const cache=await openDiskCache(),response=await cache?.match(asset.url);
    if(response) {
      const cached=await response.arrayBuffer();
      if(cached.byteLength===asset.bytes)try{
        await verifyMapDigest(cached,asset.sha256);bytes=cached;
        touch(asset);
      }catch{discard(asset);}
      else discard(asset);
    }
  }catch{/* Fall back to the network when browser storage is disabled. */}
  if(!bytes) {
    signal.throwIfAborted();
    const response=await fetch(asset.url,{signal,cache:'force-cache',priority} as RequestInit);
    if(!response.ok)throw new Error('Map download unavailable');
    bytes=await response.arrayBuffer();if(bytes.byteLength!==asset.bytes)throw new Error('Map download size mismatch');
    await verifyMapDigest(bytes,asset.sha256);signal?.throwIfAborted();
    void persist(asset,bytes);
  }
  signal?.throwIfAborted();remember(asset.sha256,bytes);return bytes;
}
async function compressedBytes(asset:DeliveredAsset,signal?:AbortSignal,priority:'auto'|'low'='auto') {
  signal?.throwIfAborted();
  const warm=retained.get(asset.sha256);
  if(warm){
    retained.delete(asset.sha256);retained.set(asset.sha256,warm);
    if(warm.bytes.byteLength!==asset.bytes)throw new Error('Map download size mismatch');
    if(Date.now()-warm.used>60000){warm.used=Date.now();touch(asset);}
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
  try{const bytes=await Promise.race([owner.promise,cancelled]);
    if(bytes.byteLength!==asset.bytes)throw new Error('Map download size mismatch');return bytes;}
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
