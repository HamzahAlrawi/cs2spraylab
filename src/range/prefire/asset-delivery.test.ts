import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {validateDelivery,persistentAssetBudget,type DeliveredAsset} from './asset-delivery';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fixture(text:string){const raw=new TextEncoder().encode(text),bytes=gzipSync(raw),hash=sha(bytes);
  return {bytes,asset:{url:`/maps/dust2/duel/objects/${hash}.gz`,bytes:bytes.byteLength,sha256:hash,
    decodedBytes:raw.byteLength,decodedSha256:sha(raw),encoding:'gzip'} satisfies DeliveredAsset};}
beforeEach(()=>{vi.resetModules();vi.stubGlobal('caches',undefined);});
afterEach(()=>vi.unstubAllGlobals());
describe('verified compressed map delivery',()=>{
  it('separates persistent capacity from the RAM cache and leaves quota headroom',()=>{
    expect(persistentAssetBudget()).toBe(512*1024*1024);
    expect(persistentAssetBudget({quota:1024*1024*1024,usage:100*1024*1024})).toBeLessThan(160*1024*1024);
    expect(persistentAssetBudget({quota:1000,usage:980})).toBe(10);
    expect(persistentAssetBudget({quota:1000,usage:1200})).toBe(0);
  });
  it('survives a new page/module lifetime without downloading cached content again',async()=>{
    const f=fixture('persistent exact map bytes'),store=new Map<string,Response>();
    const cache={match:vi.fn(async(key:string|Request)=>store.get(typeof key==='string'?key:new URL(key.url).pathname)?.clone()),
      put:vi.fn(async(key:string,response:Response)=>{store.set(key,response.clone());}),
      keys:vi.fn(async()=>[...store.keys()].map(key=>new Request('https://spraylab.local'+key))),
      delete:vi.fn(async(key:string|Request)=>store.delete(typeof key==='string'?key:new URL(key.url).pathname))};
    vi.stubGlobal('caches',{open:async()=>cache});vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    let module=await import('./asset-delivery');await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    expect(cache.put).toHaveBeenCalledOnce();vi.resetModules();module=await import('./asset-delivery');
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(f.asset))).toBe('persistent exact map bytes');
    expect(fetch).toHaveBeenCalledOnce();await module.settleAssetCache();
  });
  it('repairs corrupt persistent content and works when browser storage is denied',async()=>{
    const f=fixture('cache fallback'),cache={match:vi.fn(async()=>new Response(new Uint8Array(f.bytes.byteLength))),
      delete:vi.fn(async()=>true),put:vi.fn(async()=>{throw new DOMException('denied','SecurityError');}),keys:vi.fn(async()=>[])};
    vi.stubGlobal('caches',{open:async()=>cache});vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    const module=await import('./asset-delivery');
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(f.asset))).toBe('cache fallback');await module.settleAssetCache();
    expect(cache.delete).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
  });
  it('decompresses exact bytes and reuses verified compressed content',async()=>{
    const f=fixture('map binary with exact float bytes'),fetch=vi.fn(async()=>new Response(f.bytes));vi.stubGlobal('fetch',fetch);
    const {fetchDeliveredAsset}=await import('./asset-delivery');
    expect(new TextDecoder().decode(await fetchDeliveredAsset(f.asset))).toBe('map binary with exact float bytes');
    await fetchDeliveredAsset(f.asset);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects compressed corruption and wrong decoded content',async()=>{
    const f=fixture('expected'),{fetchDeliveredAsset}=await import('./asset-delivery');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(f.bytes.byteLength))));
    await expect(fetchDeliveredAsset(f.asset)).rejects.toThrow('checksum');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    await expect(fetchDeliveredAsset({...f.asset,decodedSha256:'0'.repeat(64)})).rejects.toThrow('checksum');
  });
  it('shares an in-flight download without letting one cancelled consumer abort another',async()=>{
    const f=fixture('shared bytes');let finish!:(response:Response)=>void;
    const fetch=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((resolve,reject)=>{
      finish=resolve;options.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')));
    }));vi.stubGlobal('fetch',fetch);
    const {fetchDeliveredAsset}=await import('./asset-delivery');
    const first=new AbortController(),second=new AbortController();
    const a=fetchDeliveredAsset(f.asset,first.signal),b=fetchDeliveredAsset(f.asset,second.signal);
    const rejected=expect(a).rejects.toMatchObject({name:'AbortError'});
    first.abort();await rejected;finish(new Response(f.bytes));
    expect(new TextDecoder().decode(await b)).toBe('shared bytes');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds decompression before allocating an oversized output',async()=>{
    const f=fixture('longer than the declared buffer');vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    const {fetchDeliveredAsset}=await import('./asset-delivery');
    await expect(fetchDeliveredAsset({...f.asset,decodedBytes:2})).rejects.toThrow('size budget');
  });
  it('never fetches after cancellation and refuses foreign or unbounded manifests',async()=>{
    const f=fixture('cancelled'),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const {fetchDeliveredAsset}=await import('./asset-delivery'),controller=new AbortController();controller.abort();
    await expect(fetchDeliveredAsset(f.asset,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(fetch).not.toHaveBeenCalled();
    expect(()=>validateDelivery({version:1,files:{'collision.bin':{...f.asset,url:'https://external.test/file.gz'}}})).toThrow();
    expect(()=>validateDelivery({version:1,files:{'collision.bin':{...f.asset,decodedBytes:128*1024*1024}}})).toThrow();
  });
  it('validates shared image bounds and duplicate names',()=>{
    const f=fixture('image-pack'),name='texture-'+'a'.repeat(24)+'.webp';
    const textures={bundles:[f.asset],images:[{name,bundle:0,offset:0,length:2}]};
    expect(validateDelivery({version:1,files:{},textures}).textures?.images).toHaveLength(1);
    expect(()=>validateDelivery({version:1,files:{},textures:{...textures,images:[...textures.images,...textures.images]}})).toThrow();
    expect(()=>validateDelivery({version:1,files:{},textures:{...textures,images:[{name,bundle:0,offset:8,length:8}]}})).toThrow();
  });
});
