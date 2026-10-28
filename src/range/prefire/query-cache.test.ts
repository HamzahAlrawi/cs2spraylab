import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {COLLISION_WASM_SHA256} from './query-cache';
import type {PreparedNativeQueries} from './native-collision';

const data:PreparedNativeQueries={schema:1,engine:'0.19.3',collisionSha256:'a'.repeat(64),bounds:{minX:0,maxX:2,minZ:0,maxZ:2},
  ids:[[1,2]],columns:[['0:0',[1,2]]],solids:[],open:[]};
let store:Map<string,Response>,cache:{match:ReturnType<typeof vi.fn>;put:ReturnType<typeof vi.fn>;keys:ReturnType<typeof vi.fn>;delete:ReturnType<typeof vi.fn>};
beforeEach(()=>{
  vi.resetModules();store=new Map();
  const path=(key:string|Request)=>typeof key==='string'?key:new URL(key.url).pathname;
  cache={match:vi.fn(async(key:string|Request)=>store.get(path(key))?.clone()),put:vi.fn(async(key:string,response:Response)=>{store.set(path(key),response.clone());}),
    keys:vi.fn(async()=>[...store.keys()].map(key=>new Request('https://spraylab.local'+key))),delete:vi.fn(async(key:string|Request)=>store.delete(path(key)))};
  vi.stubGlobal('caches',{open:async()=>cache});
});
afterEach(()=>vi.unstubAllGlobals());
describe('locally generated collision snapshots',()=>{
  it('keys compatibility by the actual installed WASM bytes, not semver alone',()=>{
    expect(createHash('sha256').update(readFileSync('node_modules/@dimforge/rapier3d-compat/rapier_wasm3d_bg.wasm')).digest('hex')).toBe(COLLISION_WASM_SHA256);
  });
  it('restores exact snapshot bytes in a new module lifetime and reuses checked immutable indexes',async()=>{
    let module=await import('./query-cache');const snapshot=new Uint8Array([7,8,9,10]).buffer;
    module.saveCachedQueries({metadata:data,snapshot});await module.settleQueryCache();expect(store.size).toBe(1);
    vi.resetModules();module=await import('./query-cache');
    const restored=await module.readCachedQueries(data,new AbortController().signal);
    expect(restored?.snapshot).toEqual(snapshot);expect(restored?.metadata.ids).toEqual(data.ids);
    expect(restored?.metadata.columns).toBe(data.columns);
    expect(await module.readCachedQueries({...data,engine:'different'},new AbortController().signal)).toBeUndefined();
    expect(await module.readCachedQueries({...data,collisionSha256:'b'.repeat(64)},new AbortController().signal)).toBeUndefined();
  });
  it('rejects corrupt, excessive and truncated cache entries without affecting map loading',async()=>{
    const module=await import('./query-cache');module.saveCachedQueries({metadata:data,snapshot:new ArrayBuffer(16)});await module.settleQueryCache();
    const [key,response]=[...store][0];store.set(key,new Response(new Uint8Array([1,2,3]),{headers:response.headers}));
    expect(await module.readCachedQueries(data,new AbortController().signal)).toBeUndefined();expect(cache.delete).toHaveBeenCalled();
    const headers=new Headers(response.headers);headers.set('x-query-raw',String(256*1024*1024));store.set(key,new Response(new Uint8Array([1]),{headers}));
    expect(await module.readCachedQueries(data,new AbortController().signal)).toBeUndefined();
  });
  it('survives storage denial and honors cancellation',async()=>{
    const module=await import('./query-cache');cache.put.mockRejectedValue(new DOMException('full','QuotaExceededError'));
    module.saveCachedQueries({metadata:data,snapshot:new ArrayBuffer(16)});await expect(module.settleQueryCache()).resolves.toBeUndefined();
    const controller=new AbortController();controller.abort();
    // With a pending cached body, an abort cannot trigger a rebuild on the main thread.
    cache.put.mockReset();cache.match.mockRejectedValue(new Error('private mode'));
    await expect(module.readCachedQueries(data,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('delegates compression to a worker with compact ownership and a transferable copy',async()=>{
    let worker!:{onmessage:(event:unknown)=>void;terminate:ReturnType<typeof vi.fn>;postMessage:ReturnType<typeof vi.fn>};
    vi.stubGlobal('Worker',class{onmessage=()=>{};terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
    const module=await import('./query-cache'),snapshot=new ArrayBuffer(32);
    module.saveCachedQueries({metadata:data,snapshot});await Promise.resolve();
    const [message,transfer]=worker.postMessage.mock.calls[0];
    expect(message.metadata).not.toHaveProperty('columns');expect(message.metadata).not.toHaveProperty('solids');
    expect(message.snapshot).not.toBe(snapshot);expect(transfer).toEqual([message.snapshot]);
    expect(cache.put).not.toHaveBeenCalled();worker.onmessage({data:{done:true}});await module.settleQueryCache();
    expect(worker.terminate).toHaveBeenCalledOnce();expect(snapshot.byteLength).toBe(32);
  });
  it('does not fall back to main-thread compression when a browser prohibits workers',async()=>{
    vi.stubGlobal('Worker',class{constructor(){throw new DOMException('worker blocked','SecurityError');}});
    const module=await import('./query-cache');module.saveCachedQueries({metadata:data,snapshot:new ArrayBuffer(16)});
    await expect(module.settleQueryCache()).resolves.toBeUndefined();expect(cache.put).not.toHaveBeenCalled();
  });
});
