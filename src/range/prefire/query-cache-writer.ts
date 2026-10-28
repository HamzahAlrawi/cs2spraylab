import type {PreparedNativeQueries} from './native-collision';

export const COLLISION_WASM_SHA256='1ce1c8c4036b4dcd3bde86c6efdb0f270cf5e274979b1de6ab8052947ef166c5';
export const QUERY_CACHE='spraylab-query-worlds-v1',MAX_QUERY_RAW=80*1024*1024;
const BUDGET=128*1024*1024;
export type CachedQueries={metadata:PreparedNativeQueries;snapshot:ArrayBuffer};
export type CacheableQueries={metadata:Pick<PreparedNativeQueries,'schema'|'engine'|'collisionSha256'|'ids'|'open'>;snapshot:ArrayBuffer};
export const queryCacheKey=(data:Pick<PreparedNativeQueries,'schema'|'engine'|'collisionSha256'>)=>`/__spraylab_queries__/${COLLISION_WASM_SHA256}/${data.schema}/${encodeURIComponent(data.engine)}/${data.collisionSha256}`;

/** CompressionStream performs native CPU work on its calling thread. Run in a worker. */
export async function writeCachedQueries(prepared:CacheableQueries) {
  const {schema,engine,collisionSha256,ids,open}=prepared.metadata;
  const json=new TextEncoder().encode(JSON.stringify({schema,engine,collisionSha256,ids,open})),size=4+json.byteLength+prepared.snapshot.byteLength;
  if(size>MAX_QUERY_RAW||prepared.snapshot.byteLength>64*1024*1024)return;
  const bytes=new Uint8Array(size);new DataView(bytes.buffer).setUint32(0,json.byteLength,true);
  bytes.set(json,4);bytes.set(new Uint8Array(prepared.snapshot),4+json.byteLength);
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const compressed=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const cache=await caches.open(QUERY_CACHE),url=queryCacheKey(prepared.metadata);
  const absolute=new URL(url,globalThis.location?.origin??'https://spraylab.local').href;
  const entries=await Promise.all((await cache.keys()).map(async request=>({request,response:await cache.match(request)})));
  let total=compressed.byteLength;
  for(const entry of entries)if(entry.request.url!==absolute)total+=Number(entry.response?.headers.get('x-query-size'))||0;
  for(const entry of entries.filter(entry=>entry.request.url!==absolute)
    .sort((a,b)=>Number(a.response?.headers.get('x-query-used'))-Number(b.response?.headers.get('x-query-used'))))
    if(total>BUDGET){await cache.delete(entry.request);total-=Number(entry.response?.headers.get('x-query-size'))||0;}
  await cache.put(url,new Response(compressed,{headers:{'x-query-size':String(compressed.byteLength),'x-query-used':String(Date.now()),
    'x-query-raw':String(size),'x-query-sha256':digest}}));
}
