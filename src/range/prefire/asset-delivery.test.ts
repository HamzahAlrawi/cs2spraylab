import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {validateDelivery,validDeliveredAsset,persistentAssetBudget,type DeliveredAsset} from './asset-delivery';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fixture(text:string){const raw=new TextEncoder().encode(text),bytes=gzipSync(raw),hash=sha(bytes);
  return {bytes,asset:{url:`/maps/dust2/duel/objects/${hash}.gz`,bytes:bytes.byteLength,sha256:hash,
    decodedBytes:raw.byteLength,decodedSha256:sha(raw),encoding:'gzip'} satisfies DeliveredAsset};}
const CACHE='spraylab-map-bytes-v1',METADATA_CACHE='spraylab-map-bytes-metadata-v1';
function mockStorage() {
  const key=(value:string|Request)=>new URL(typeof value==='string'?value:value.url,'https://spraylab.local').href;
  const makeCache=()=>{
    const store=new Map<string,Response>();
    return {store,match:vi.fn(async(value:string|Request)=>store.get(key(value))?.clone()),
      put:vi.fn(async(value:string|Request,response:Response)=>{store.set(key(value),response.clone());}),
      keys:vi.fn(async()=>[...store.keys()].map(url=>new Request(url))),
      delete:vi.fn(async(value:string|Request)=>store.delete(key(value)))};
  };
  const body=makeCache(),metadata=makeCache(),open=vi.fn(async(name:string)=>{
    if(name===CACHE)return body;if(name===METADATA_CACHE)return metadata;throw new Error('Unexpected cache');
  });
  const seed=(f:ReturnType<typeof fixture>,used=1)=>body.store.set(key(f.asset.url),new Response(f.bytes,
    {headers:{'x-spraylab-size':String(f.bytes.byteLength),'x-spraylab-used':String(used)}}));
  vi.stubGlobal('caches',{open});
  return {body,metadata,open,seed,key};
}
beforeEach(()=>{vi.resetModules();vi.stubGlobal('caches',undefined);});
afterEach(async()=>{await (await import('./asset-delivery')).settleAssetCache();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('verified compressed map delivery',()=>{
  it('separates persistent capacity from the RAM cache and leaves quota headroom',()=>{
    expect(persistentAssetBudget()).toBe(512*1024*1024);
    expect(persistentAssetBudget({quota:1024*1024*1024,usage:100*1024*1024})).toBeLessThan(160*1024*1024);
    expect(persistentAssetBudget({quota:1000,usage:980})).toBe(10);
    expect(persistentAssetBudget({quota:1000,usage:1200})).toBe(0);
    expect(persistentAssetBudget({quota:0})).toBe(0);
    expect(persistentAssetBudget({quota:1000,usage:NaN})).toBe(150);
  });
  it('survives a new page/module lifetime without downloading cached content again',async()=>{
    const f=fixture('persistent exact map bytes'),{body,metadata}=mockStorage();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    let module=await import('./asset-delivery');await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    expect(body.put).toHaveBeenCalledOnce();expect(metadata.put).toHaveBeenCalledOnce();
    body.match.mockClear();vi.resetModules();module=await import('./asset-delivery');
    vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Offline');}));
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(f.asset))).toBe('persistent exact map bytes');
    expect(fetch).not.toHaveBeenCalled();await module.settleAssetCache();
    expect(body.put).toHaveBeenCalledOnce();expect(body.match).toHaveBeenCalledOnce();
  });
  it('repairs corrupt persistent content and works when browser storage is denied',async()=>{
    const f=fixture('cache fallback'),cache={match:vi.fn(async()=>new Response(new Uint8Array(f.bytes.byteLength))),
      delete:vi.fn(async()=>true),put:vi.fn(async()=>{throw new DOMException('denied','SecurityError');}),keys:vi.fn(async()=>[])};
    vi.stubGlobal('caches',{open:async()=>cache});vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    const module=await import('./asset-delivery');
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(f.asset))).toBe('cache fallback');await module.settleAssetCache();
    expect(cache.delete).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
  });
  it('batches many writes and touches without quadratic cache IO or body rewrites',async()=>{
    const fixtures=Array.from({length:64},(_,i)=>fixture(`chunk-${i}`)),{body,metadata}=mockStorage();
    const byUrl=new Map(fixtures.map(f=>[f.asset.url,f.bytes]));
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(byUrl.get(url)!)));
    let module=await import('./asset-delivery');
    await Promise.all(fixtures.map(f=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(body.keys).toHaveBeenCalledOnce();expect(body.match).toHaveBeenCalledTimes(fixtures.length);
    expect(body.put).toHaveBeenCalledTimes(fixtures.length);expect(metadata.put).toHaveBeenCalledOnce();
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);
    await Promise.all(fixtures.map(f=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(body.keys).toHaveBeenCalledOnce();expect(body.put).toHaveBeenCalledTimes(fixtures.length);
    expect(metadata.put).toHaveBeenCalledTimes(2);expect(fetch).toHaveBeenCalledTimes(fixtures.length);
    vi.resetModules();module=await import('./asset-delivery');body.match.mockClear();
    await Promise.all(fixtures.map(f=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(body.keys).toHaveBeenCalledTimes(2);expect(body.match).toHaveBeenCalledTimes(fixtures.length);
    expect(body.put).toHaveBeenCalledTimes(fixtures.length);expect(fetch).toHaveBeenCalledTimes(fixtures.length);
  });
  it('migrates existing bodies once and persists recency without rewriting them',async()=>{
    const fixtures=Array.from({length:8},(_,i)=>fixture(`legacy-${i}`)),{body,metadata,seed}=mockStorage();
    fixtures.forEach(f=>seed(f));vi.stubGlobal('fetch',vi.fn());
    let module=await import('./asset-delivery');
    await Promise.all(fixtures.map(f=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(body.keys).toHaveBeenCalledOnce();expect(body.match).toHaveBeenCalledTimes(fixtures.length*2);
    expect(body.put).not.toHaveBeenCalled();expect(metadata.put).toHaveBeenCalledOnce();
    body.match.mockClear();vi.resetModules();module=await import('./asset-delivery');
    await Promise.all(fixtures.map(f=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(body.match).toHaveBeenCalledTimes(fixtures.length);expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['size','digest'] as const)('repairs a cached %s mismatch and reuses the repair on reload',async(kind)=>{
    const f=fixture('repaired disk bytes'),{body,key}=mockStorage();
    body.store.set(key(f.asset.url),new Response(new Uint8Array(kind==='size'?1:f.bytes.byteLength)));
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    let module=await import('./asset-delivery');
    await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();expect(body.delete).toHaveBeenCalledOnce();
    vi.resetModules();module=await import('./asset-delivery');
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(f.asset))).toBe('repaired disk bytes');
    await module.settleAssetCache();expect(fetch).toHaveBeenCalledOnce();
  });
  it('treats metadata as hints and still hashes bodies on reload',async()=>{
    const f=fixture('index is not proof'),{body,key}=mockStorage();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    let module=await import('./asset-delivery');await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    body.store.set(key(f.asset.url),new Response(new Uint8Array(f.bytes.byteLength)));
    vi.resetModules();module=await import('./asset-delivery');
    await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();expect(fetch).toHaveBeenCalledTimes(2);
    expect(body.delete).toHaveBeenCalledOnce();
  });
  it('repairs broken metadata without a network request or loss of old bodies',async()=>{
    const f=fixture('recover metadata'),{body,metadata,seed}=mockStorage();seed(f);
    metadata.match.mockResolvedValueOnce(new Response('{broken json'));vi.stubGlobal('fetch',vi.fn());
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    expect(fetch).not.toHaveBeenCalled();expect(body.delete).not.toHaveBeenCalled();expect(body.put).not.toHaveBeenCalled();
    expect(metadata.put).toHaveBeenCalledOnce();
  });
  it('reconciles a stale index with independently added and removed cache entries',async()=>{
    const a=fixture('removed'),b=fixture('added'),{body,seed,key}=mockStorage();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(a.bytes)));
    let module=await import('./asset-delivery');await module.fetchDeliveredAsset(a.asset);await module.settleAssetCache();
    body.store.delete(key(a.asset.url));seed(b);vi.resetModules();module=await import('./asset-delivery');
    await module.fetchDeliveredAsset(b.asset);await module.settleAssetCache();
    await module.fetchDeliveredAsset(a.asset);await module.settleAssetCache();expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps unchanged hashes across deployments and downloads only the changed asset',async()=>{
    const old=fixture('old chunk'),updated=fixture('new chunk'),shared=fixture('shared texture'),{body}=mockStorage();
    const byUrl=new Map([old,updated,shared].map(f=>[f.asset.url,f.bytes]));
    const fetch=vi.fn(async(url:string)=>new Response(byUrl.get(url)!));vi.stubGlobal('fetch',fetch);
    let module=await import('./asset-delivery');
    await Promise.all([old,shared].map(f=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    vi.resetModules();module=await import('./asset-delivery');fetch.mockClear();
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(updated.asset))).toBe('new chunk');
    await module.fetchDeliveredAsset(shared.asset);await module.settleAssetCache();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(updated.asset.url,expect.anything());expect(body.store.size).toBe(3);
  });
  it('accepts safe future map slugs and preserves their cache entries across reloads',async()=>{
    const f=fixture('inferno chunk'),asset={...f.asset,url:f.asset.url.replace('/dust2/','/inferno/')};
    mockStorage();vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    expect(validateDelivery({version:1,files:{'chunk.bin':asset}}).files['chunk.bin']).toEqual(asset);
    expect(validDeliveredAsset({...asset,url:asset.url.replace('/inferno/','/de-inferno-2/')})).toBe(true);
    expect(validDeliveredAsset({...asset,url:`/models/objects/${asset.sha256}.gz`})).toBe(true);
    let module=await import('./asset-delivery');await module.fetchDeliveredAsset(asset);await module.settleAssetCache();
    vi.resetModules();module=await import('./asset-delivery');
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(asset))).toBe('inferno chunk');
    expect(await module.assetCacheStats()).toMatchObject({storedBytes:f.bytes.byteLength,count:1});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(['%69nferno','inferno%2fother','inferno%5cother','%2e%2e','..','inferno/..','inferno/../dust2',
    'inferno\\..','Inferno','-inferno','inferno_extra'])('rejects unsafe map slug %s',slug=>{
    const f=fixture('unsafe slug'),url=f.asset.url.replace('/dust2/',`/${slug}/`);
    expect(validDeliveredAsset({...f.asset,url})).toBe(false);
  });
  it('rejects foreign origins, query/fragment suffixes and encoded object paths',()=>{
    const f=fixture('unsafe URL');
    for(const url of [`https://foreign.test${f.asset.url}`,`//foreign.test${f.asset.url}`,
      `${f.asset.url}?v=2`,`${f.asset.url}#fragment`,f.asset.url.replace('/objects/','/%6fbjects/'),
      f.asset.url.replace('/objects/','/duel/../objects/')])expect(validDeliveredAsset({...f.asset,url})).toBe(false);
  });
  it('falls back to verified RAM bytes when CacheStorage access is denied',async()=>{
    const f=fixture('private browsing'),open=vi.fn(async()=>{throw new DOMException('denied','SecurityError');});
    vi.stubGlobal('caches',{open});vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    const module=await import('./asset-delivery');
    await module.fetchDeliveredAsset(f.asset);await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    expect(fetch).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledOnce();
  });
  it('keeps verified disk hits usable even when inventory/metadata storage is denied',async()=>{
    const f=fixture('read-only cache'),{body,seed}=mockStorage();seed(f);
    body.keys.mockRejectedValue(new DOMException('denied','SecurityError'));vi.stubGlobal('fetch',vi.fn());
    const module=await import('./asset-delivery');
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(f.asset))).toBe('read-only cache');
    await module.settleAssetCache();expect(fetch).not.toHaveBeenCalled();expect(body.put).not.toHaveBeenCalled();
  });
  it('does not evict bodies or stop cache writes when saving metadata fails',async()=>{
    const a=fixture('first'),b=fixture('second'),{body,metadata}=mockStorage();
    metadata.put.mockRejectedValue(new DOMException('full','QuotaExceededError'));
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(url===a.asset.url?a.bytes:b.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(a.asset);await module.settleAssetCache();
    await module.fetchDeliveredAsset(b.asset);await module.settleAssetCache();
    expect(body.store.size).toBe(2);expect(body.delete).not.toHaveBeenCalled();expect(metadata.put).toHaveBeenCalledOnce();
  });
  it('continues storing bodies when the metadata cache cannot be opened or storage estimates fail',async()=>{
    const f=fixture('optional metadata'),{body,open}=mockStorage();
    open.mockImplementation(async(name:string)=>{if(name===CACHE)return body;throw new DOMException('denied','SecurityError');});
    vi.stubGlobal('navigator',{storage:{estimate:async()=>{throw new Error('unavailable');}}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    let module=await import('./asset-delivery');await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    expect(body.put).toHaveBeenCalledOnce();vi.resetModules();module=await import('./asset-delivery');
    await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();expect(fetch).toHaveBeenCalledOnce();
  });
  it('flushes a burst of metadata updates automatically on its bounded timer',async()=>{
    const f=fixture('automatic flush'),{metadata}=mockStorage();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    try {
      const module=await import('./asset-delivery');await module.fetchDeliveredAsset(f.asset);
      expect(metadata.put).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1000);
      expect(metadata.put).toHaveBeenCalledOnce();await module.settleAssetCache();
      expect(metadata.put).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it('never requests persistent storage permission during asset loading',async()=>{
    const f=fixture('no automatic prompt'),persist=vi.fn(async()=>true);
    vi.stubGlobal('navigator',{storage:{persist}});vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    expect(persist).not.toHaveBeenCalled();
  });
  it('reports persisted body counts, bytes and quota-based capacity without extra scans or downloads',async()=>{
    const a=fixture('stats-a'),b=fixture('stats-b'),{body,seed}=mockStorage();seed(a);
    const estimate=vi.fn(async()=>({quota:10000,usage:100})),persist=vi.fn();
    vi.stubGlobal('navigator',{storage:{estimate,persist}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(b.bytes)));
    const module=await import('./asset-delivery');
    expect(await module.assetCacheStats()).toEqual({storedBytes:a.bytes.byteLength,count:1,budget:1500});
    expect(fetch).not.toHaveBeenCalled();expect(body.put).not.toHaveBeenCalled();
    await module.fetchDeliveredAsset(b.asset);
    expect(await module.assetCacheStats()).toEqual({storedBytes:a.bytes.byteLength+b.bytes.byteLength,count:2,budget:1500});
    await module.assetCacheStats();expect(body.keys).toHaveBeenCalledOnce();expect(estimate).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });
  it('reports unavailable storage without allocating or fetching anything',async()=>{
    vi.stubGlobal('fetch',vi.fn());const module=await import('./asset-delivery');
    expect(await module.assetCacheStats()).toEqual({storedBytes:0,count:0,budget:0});expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps diagnostic totals in sync with quota evictions',async()=>{
    const a=fixture('stats-a'),b=fixture('stats-b'),{body,seed}=mockStorage();seed(a);
    vi.stubGlobal('navigator',{storage:{estimate:async()=>({quota:Math.ceil(a.bytes.byteLength/.15),usage:0})}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(b.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(b.asset);
    expect(await module.assetCacheStats()).toMatchObject({storedBytes:b.bytes.byteLength,count:1});
    expect(body.delete).toHaveBeenCalledOnce();
  });
  it('evicts the least recently played asset within budget and preserves other cache entries',async()=>{
    const a=fixture('old-a'),b=fixture('old-b'),c=fixture('new-c'),{body,seed,key}=mockStorage();seed(a);seed(b,2);
    const budget=a.bytes.byteLength+b.bytes.byteLength,estimate=vi.fn(async()=>({quota:Math.ceil(budget/.15),usage:0}));
    vi.stubGlobal('navigator',{storage:{estimate}});
    body.store.set(key('/unrelated-settings'),new Response('keep'));
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(c.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(a.asset);await module.settleAssetCache();
    await module.fetchDeliveredAsset(c.asset);await module.settleAssetCache();
    expect(body.delete).toHaveBeenCalledExactlyOnceWith(key(b.asset.url));
    expect(body.store.has(key(a.asset.url))).toBe(true);expect(body.store.has(key(c.asset.url))).toBe(true);
    expect(body.store.has(key('/unrelated-settings'))).toBe(true);
    expect(estimate).toHaveBeenCalledOnce();
  });
  it('persists LRU touches across reloads without replacing body headers',async()=>{
    const a=fixture('lru-a'),b=fixture('lru-b'),c=fixture('lru-c'),{body,seed,key}=mockStorage();seed(a);seed(b,2);
    const size=a.bytes.byteLength;
    vi.stubGlobal('navigator',{storage:{estimate:async()=>({quota:Math.ceil(size*2/.15),usage:0})}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(c.bytes)));
    let module=await import('./asset-delivery');await module.fetchDeliveredAsset(a.asset);await module.settleAssetCache();
    expect(body.store.get(key(a.asset.url))!.headers.get('x-spraylab-used')).toBe('1');
    vi.resetModules();module=await import('./asset-delivery');await module.fetchDeliveredAsset(c.asset);await module.settleAssetCache();
    expect(body.delete).toHaveBeenCalledExactlyOnceWith(key(b.asset.url));
    expect(body.store.has(key(a.asset.url))).toBe(true);expect(body.store.has(key(c.asset.url))).toBe(true);
  });
  it('does not shrink capacity by double-counting already cached bytes on reload',async()=>{
    const a=fixture('cached-a'),b=fixture('cached-b'),c=fixture('cached-c'),{body,seed}=mockStorage();seed(a);seed(b,2);
    const size=a.bytes.byteLength;
    vi.stubGlobal('navigator',{storage:{estimate:async()=>({quota:size*30,usage:size*27})}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(c.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(c.asset);await module.settleAssetCache();
    expect(body.store.size).toBe(2);expect(body.delete).toHaveBeenCalledOnce();expect(body.put).toHaveBeenCalledOnce();
  });
  it('skips oversized writes without evicting existing assets',async()=>{
    const a=fixture('keep'),b=fixture('oversized new asset'),{body,seed}=mockStorage();seed(a);
    vi.stubGlobal('navigator',{storage:{estimate:async()=>({quota:1,usage:0})}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(b.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(b.asset);await module.settleAssetCache();
    expect(body.delete).not.toHaveBeenCalled();expect(body.put).not.toHaveBeenCalled();expect(body.store.size).toBe(1);
  });
  it('retries quota errors after reclaiming only enough oldest asset bytes',async()=>{
    const a=fixture('quota-a'),b=fixture('quota-b'),c=fixture('quota-c'),{body,seed,key}=mockStorage();seed(a);seed(b,2);
    body.store.set(key('/unrelated-settings'),new Response('keep'));
    // Name-based detection also handles quota errors from another realm.
    body.put.mockRejectedValueOnce({name:'QuotaExceededError'});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(c.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(c.asset);await module.settleAssetCache();
    expect(body.put).toHaveBeenCalledTimes(2);expect(body.delete).toHaveBeenCalledExactlyOnceWith(key(a.asset.url));
    expect(body.store.has(key(b.asset.url))).toBe(true);expect(body.store.has(key('/unrelated-settings'))).toBe(true);
    expect(body.store.has(key(c.asset.url))).toBe(true);
  });
  it('bounds eviction when quota retries keep failing and leaves verified bytes usable in RAM',async()=>{
    const fixtures=Array.from({length:8},(_,i)=>fixture(`quota-${i}`)),f=fixture('quota-x'),{body,seed}=mockStorage();
    fixtures.forEach((value,i)=>seed(value,i));body.put.mockRejectedValue({name:'QuotaExceededError'});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    const module=await import('./asset-delivery');
    expect(new TextDecoder().decode(await module.fetchDeliveredAsset(f.asset))).toBe('quota-x');await module.settleAssetCache();
    await module.fetchDeliveredAsset(f.asset);await module.settleAssetCache();
    expect(body.put).toHaveBeenCalledTimes(2);expect(body.delete).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not evict entries on non-quota write failure',async()=>{
    const a=fixture('keep security'),b=fixture('new security'),{body,seed}=mockStorage();seed(a);
    vi.stubGlobal('navigator',{storage:{estimate:async()=>({quota:Math.ceil(b.bytes.byteLength/.15),usage:0})}});
    body.put.mockRejectedValue(new DOMException('denied','SecurityError'));
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(b.bytes)));
    const module=await import('./asset-delivery');await module.fetchDeliveredAsset(b.asset);await module.settleAssetCache();
    expect(body.put).toHaveBeenCalledOnce();expect(body.delete).not.toHaveBeenCalled();
  });
  it('serializes concurrent persistence so quota accounting retains only the newest fitting assets',async()=>{
    const fixtures=Array.from({length:12},(_,i)=>fixture(`same-size-${String(i).padStart(2,'0')}`)),{body}=mockStorage();
    const size=fixtures[0].bytes.byteLength;expect(fixtures.every(f=>f.bytes.byteLength===size)).toBe(true);
    vi.stubGlobal('navigator',{storage:{estimate:async()=>({quota:Math.ceil(size*3/.15),usage:0})}});
    const byUrl=new Map(fixtures.map(f=>[f.asset.url,f.bytes]));
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(byUrl.get(url)!)));
    const module=await import('./asset-delivery');
    await Promise.all(fixtures.map(f=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(body.keys).toHaveBeenCalledOnce();expect(body.put).toHaveBeenCalledTimes(fixtures.length);
    expect(body.store.size).toBe(3);expect(body.delete).toHaveBeenCalledTimes(fixtures.length-3);
  });
  it('deduplicates concurrent cold and reloaded disk requests into one write and one verification read',async()=>{
    const f=fixture('concurrent persistent bytes'),{body}=mockStorage();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(f.bytes)));
    let module=await import('./asset-delivery');
    await Promise.all(Array.from({length:12},()=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(fetch).toHaveBeenCalledOnce();expect(body.put).toHaveBeenCalledOnce();
    vi.resetModules();module=await import('./asset-delivery');body.match.mockClear();
    await Promise.all(Array.from({length:12},()=>module.fetchDeliveredAsset(f.asset)));await module.settleAssetCache();
    expect(body.match).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();expect(body.put).toHaveBeenCalledOnce();
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
