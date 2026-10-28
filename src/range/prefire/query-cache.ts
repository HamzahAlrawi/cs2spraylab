import type {PreparedNativeQueries} from './native-collision';
import {verifyMapDigest} from './map-loading';
import {COLLISION_WASM_SHA256,QUERY_CACHE as CACHE,MAX_QUERY_RAW as MAX_RAW,queryCacheKey as key,
  writeCachedQueries,type CachedQueries} from './query-cache-writer';

// Engine bytes, not just its semver, define snapshot compatibility.
export {COLLISION_WASM_SHA256};
export type {CachedQueries};
let writes:Promise<void>=Promise.resolve(),pending=0;
async function bounded(reader:ReadableStreamDefaultReader<Uint8Array>,size:number,signal:AbortSignal) {
  if(!Number.isSafeInteger(size)||size<8||size>MAX_RAW){await reader.cancel().catch(()=>{});reader.releaseLock();throw new Error('Invalid cached query size');}
  const bytes=new Uint8Array(size);let offset=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try {while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;
    if(offset+value.length>size)throw new Error('Cached query exceeds budget');bytes.set(value,offset);offset+=value.length;
  }if(offset!==size)throw new Error('Truncated cached queries');return bytes.buffer;}
  finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readCachedQueries(metadata:PreparedNativeQueries,signal:AbortSignal):Promise<CachedQueries|undefined> {
  if(!globalThis.caches||typeof DecompressionStream==='undefined')return;
  const url=key(metadata);
  try {
    const cache=await caches.open(CACHE),response=await cache.match(url);if(!response?.body)return;
    try {
      const bytes=await bounded(response.body.pipeThrough(new DecompressionStream('gzip')).getReader(),Number(response.headers.get('x-query-raw')),signal);
      await verifyMapDigest(bytes,response.headers.get('x-query-sha256')??'');signal.throwIfAborted();
      const length=new DataView(bytes).getUint32(0,true);if(length>16*1024*1024||length+4>=bytes.byteLength)throw new Error('Invalid prepared metadata');
      const stored=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,4,length))) as PreparedNativeQueries;
      if(stored.engine!==metadata.engine||stored.schema!==metadata.schema||stored.collisionSha256!==metadata.collisionSha256)
        throw new Error('Cached query identity mismatch');
      if(!Array.isArray(stored.ids)||!Array.isArray(stored.open))throw new Error('Missing cached collider ownership');
      return {metadata:{...metadata,ids:stored.ids,open:stored.open},snapshot:bytes.slice(length+4)};
    }catch(error){signal.throwIfAborted();await cache.delete(url);throw error;}
  }catch{signal.throwIfAborted();return;}
}
/** Optional disk-only snapshots generated from checked bytes; no extra network payload. */
export function saveCachedQueries(prepared:CachedQueries) {
  if(!globalThis.caches||typeof CompressionStream==='undefined'||pending>=2)return;
  pending++;
  writes=writes.then(async()=>{try {
    if(typeof Worker==='undefined'){await writeCachedQueries(prepared);return;}
    const {schema,engine,collisionSha256,ids,open}=prepared.metadata;
    if(prepared.snapshot.byteLength>64*1024*1024)return;
    const worker=new Worker(new URL('./query-cache.worker.ts',import.meta.url),{type:'module'});
    try {await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Snapshot cache worker timed out')),30000);
      worker.onmessage=()=>{clearTimeout(timer);resolve();};
      worker.onerror=event=>{event.preventDefault?.();clearTimeout(timer);reject(new Error('Snapshot cache worker unavailable'));};
      // Preserve the caller's buffer; neither a large structured clone nor
      // synchronous deflate belongs on the combat thread.
      try{const snapshot=prepared.snapshot.slice(0);worker.postMessage({metadata:{schema,engine,collisionSha256,ids,open},snapshot},[snapshot]);}
      catch(error){clearTimeout(timer);reject(error);}
    });}finally{worker.terminate();}
  }catch{/* Optional cache: denied workers/private mode/quota must not prevent gameplay. */}finally{pending--;}}).catch(()=>{});
}
export async function settleQueryCache(){await writes;}
