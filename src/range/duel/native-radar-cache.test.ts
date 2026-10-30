import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import loadNativeRadar,{SharedNativeRadarCache,type NativeRadarOverview} from './native-radar-cache';
import {fetchDeliveredAsset} from '../prefire/asset-delivery';
import manifest from './native-radar.json';
import {defaultNativeMapId,nativeMaps} from '../prefire/maps';
import type {NativeMapDefinition} from '../prefire/native-map-schema';

vi.mock('../prefire/asset-delivery',()=>({fetchDeliveredAsset:vi.fn()}));
beforeEach(()=>{vi.mocked(fetchDeliveredAsset).mockReset();});

function deferred<T>() {
  let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const overview=()=>({image:{close:vi.fn()} as unknown as NativeRadarOverview['image'],
  bounds:{minX:0,maxX:100,minZ:0,maxZ:100},detail:'preserved'});
afterEach(()=>vi.unstubAllGlobals());

function secondMap():NativeMapDefinition {
  const original=nativeMaps.get(defaultNativeMapId),assetId='test-map';
  return {...original,id:'de_test_map',assetId,base:'/maps/test-map/',radar:{...original.radar!,map:assetId,
    metadata:{...original.radar!.metadata,pos_x:100,pos_y:200,scale:2},delivery:{...original.radar!.delivery}}};
}

describe('shared native radar ownership',()=>{
  it('coalesces fetch/decode and shares ready data until the last idempotent lease release',async()=>{
    const pending=deferred<ReturnType<typeof overview>>(),value=overview();
    const loader=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(overview());
    const cache=new SharedNativeRadarCache<ReturnType<typeof overview>>(loader);
    const a=cache.acquire(),b=cache.acquire();await Promise.resolve();expect(loader).toHaveBeenCalledOnce();
    pending.resolve(value);const [first,second]=await Promise.all([a,b]);
    expect(first.overview).toBe(value);expect(second.overview).toBe(value);expect(first.overview.detail).toBe('preserved');
    const third=await cache.acquire();expect(loader).toHaveBeenCalledOnce();
    first.dispose();first.dispose();second.dispose();expect(value.image.close).not.toHaveBeenCalled();
    third.dispose();third.dispose();expect(value.image.close).toHaveBeenCalledOnce();
    const next=await cache.acquire();expect(loader).toHaveBeenCalledTimes(2);next.dispose();
  });
  it('cancels one waiter independently without aborting a shared load',async()=>{
    const pending=deferred<NativeRadarOverview>(),value=overview(),signals:AbortSignal[]=[];
    const cache=new SharedNativeRadarCache(signal=>{signals.push(signal);return pending.promise;});
    const controller=new AbortController(),reason=new Error('first cancelled');
    const cancelled=cache.acquire(controller.signal),survivor=cache.acquire();
    const rejection=expect(cancelled).rejects.toBe(reason);await Promise.resolve();controller.abort(reason);await rejection;
    expect(signals[0].aborted).toBe(false);pending.resolve(value);
    const lease=await survivor;expect(lease.overview).toBe(value);lease.dispose();expect(value.image.close).toHaveBeenCalledOnce();
  });
  it('aborts when all waiters leave and closes an uninterruptible late decode exactly once',async()=>{
    const old=deferred<NativeRadarOverview>(),oldImage=overview(),newImage=overview(),signals:AbortSignal[]=[];
    const cache=new SharedNativeRadarCache(signal=>{signals.push(signal);return signals.length===1?old.promise:Promise.resolve(newImage);});
    const a=new AbortController(),b=new AbortController();
    const first=cache.acquire(a.signal),second=cache.acquire(b.signal);
    const rejected=Promise.all([expect(first).rejects.toMatchObject({name:'AbortError'}),expect(second).rejects.toMatchObject({name:'AbortError'})]);
    await Promise.resolve();a.abort();expect(signals[0].aborted).toBe(false);b.abort();await rejected;
    expect(signals[0].aborted).toBe(true);
    const current=await cache.acquire();old.resolve(oldImage);await old.promise;await Promise.resolve();await Promise.resolve();
    expect(oldImage.image.close).toHaveBeenCalledOnce();expect(newImage.image.close).not.toHaveBeenCalled();
    const joined=await cache.acquire();expect(signals).toHaveLength(2);
    current.dispose();joined.dispose();expect(newImage.image.close).toHaveBeenCalledOnce();
  });
  it('retains acquired leases after their acquisition signal aborts',async()=>{
    const value=overview(),controller=new AbortController(),cache=new SharedNativeRadarCache(async()=>value);
    const lease=await cache.acquire(controller.signal);controller.abort();
    const next=await cache.acquire();expect(next.overview).toBe(value);next.dispose();
    expect(value.image.close).not.toHaveBeenCalled();lease.dispose();expect(value.image.close).toHaveBeenCalledOnce();
  });
  it('lets a ready waiter acquire while another lease is disposed',async()=>{
    const value=overview(),loader=vi.fn(async()=>value),cache=new SharedNativeRadarCache(loader);
    const first=await cache.acquire(),waiting=cache.acquire();first.dispose();
    expect(value.image.close).not.toHaveBeenCalled();const next=await waiting;
    expect(loader).toHaveBeenCalledOnce();next.dispose();expect(value.image.close).toHaveBeenCalledOnce();
  });
  it('retries failures and synchronous loader throws without retaining rejected entries',async()=>{
    const value=overview(),error=new Error('decode failed');
    const loader=vi.fn().mockImplementationOnce(()=>{throw error;}).mockRejectedValueOnce(error).mockResolvedValue(value);
    const cache=new SharedNativeRadarCache(loader),a=cache.acquire(),b=cache.acquire();
    await expect(a).rejects.toBe(error);await expect(b).rejects.toBe(error);expect(loader).toHaveBeenCalledOnce();
    await expect(cache.acquire()).rejects.toBe(error);
    const lease=await cache.acquire();expect(loader).toHaveBeenCalledTimes(3);lease.dispose();
  });
  it('does not start work for an already aborted or immediately cancelled only waiter',async()=>{
    const loader=vi.fn(async()=>overview()),cache=new SharedNativeRadarCache(loader),aborted=new AbortController();aborted.abort();
    await expect(cache.acquire(aborted.signal)).rejects.toMatchObject({name:'AbortError'});
    const controller=new AbortController(),pending=cache.acquire(controller.signal);controller.abort();
    await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(loader).not.toHaveBeenCalled();
  });
  it('does not let an old aborted failure clear a newer ready entry',async()=>{
    const old=deferred<NativeRadarOverview>(),value=overview();
    const loader=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(value),cache=new SharedNativeRadarCache(loader);
    const controller=new AbortController(),pending=cache.acquire(controller.signal);
    const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();controller.abort();await rejection;
    const next=await cache.acquire();old.reject(Error('late failure'));await Promise.resolve();await Promise.resolve();
    const joined=await cache.acquire();expect(loader).toHaveBeenCalledTimes(2);next.dispose();joined.dispose();
    expect(value.image.close).toHaveBeenCalledOnce();
  });
});

describe('manifest-backed default native radar loader',()=>{
  it('fetches and decodes once for concurrent leases, projects native metadata and reloads after release',async()=>{
    const first=overview().image as ImageBitmap,second=overview().image as ImageBitmap;
    const decode=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal('createImageBitmap',decode);vi.mocked(fetchDeliveredAsset).mockResolvedValue(new Uint8Array([1,2,3]).buffer);
    const [a,b]=await Promise.all([loadNativeRadar(),loadNativeRadar()]);
    expect(fetchDeliveredAsset).toHaveBeenCalledOnce();expect(decode).toHaveBeenCalledOnce();
    expect(fetchDeliveredAsset).toHaveBeenCalledWith(manifest.delivery,expect.any(AbortSignal));
    const blob=decode.mock.calls[0][0] as Blob;expect(blob.type).toBe('image/webp');expect(blob.size).toBe(3);
    expect(a.overview).toBe(b.overview);expect(a.overview.image).toBe(first);
    expect(a.overview.bounds.minX).toBeCloseTo(manifest.metadata.pos_x*.0254);
    expect(a.overview.bounds.minZ).toBeCloseTo(-manifest.metadata.pos_y*.0254);
    expect(a.overview.bounds.maxX-a.overview.bounds.minX).toBeCloseTo(manifest.metadata.scale*1024*.0254);
    a.dispose();expect(first.close).not.toHaveBeenCalled();b.dispose();expect(first.close).toHaveBeenCalledOnce();
    const next=await loadNativeRadar();expect(fetchDeliveredAsset).toHaveBeenCalledTimes(2);expect(next.overview.image).toBe(second);
    next.dispose();expect(second.close).toHaveBeenCalledOnce();
  });
  it('aborts a sole fetch and retries after a delivery failure',async()=>{
    const controller=new AbortController(),signals:AbortSignal[]=[];
    vi.mocked(fetchDeliveredAsset).mockImplementationOnce((_asset,signal)=>new Promise((_resolve,reject)=>{
      signals.push(signal!);signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true});
    }));
    const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode);
    const pending=loadNativeRadar(controller.signal),rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(signals).toHaveLength(1));controller.abort();await rejection;
    expect(signals[0].aborted).toBe(true);expect(decode).not.toHaveBeenCalled();
    const failure=Error('delivery failed');vi.mocked(fetchDeliveredAsset).mockRejectedValueOnce(failure);
    await expect(loadNativeRadar()).rejects.toBe(failure);
    const value=overview().image;vi.mocked(fetchDeliveredAsset).mockResolvedValue(new ArrayBuffer(0));decode.mockResolvedValue(value);
    const lease=await loadNativeRadar();lease.dispose();expect(value.close).toHaveBeenCalledOnce();
  });
  it('closes a bitmap that finishes decoding after cancellation and recovers from decode failure',async()=>{
    const controller=new AbortController(),late=deferred<ImageBitmap>(),value=overview().image as ImageBitmap;
    const decode=vi.fn().mockReturnValueOnce(late.promise);vi.stubGlobal('createImageBitmap',decode);
    vi.mocked(fetchDeliveredAsset).mockResolvedValue(new ArrayBuffer(0));
    const pending=loadNativeRadar(controller.signal),rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(decode).toHaveBeenCalledOnce());controller.abort();await rejection;
    late.resolve(value);await vi.waitFor(()=>expect(value.close).toHaveBeenCalledOnce());
    const failure=Error('decode failed');decode.mockRejectedValueOnce(failure);await expect(loadNativeRadar()).rejects.toBe(failure);
    const next=overview().image;decode.mockResolvedValueOnce(next);
    const lease=await loadNativeRadar();lease.dispose();expect(next.close).toHaveBeenCalledOnce();
    expect(value.close).toHaveBeenCalledOnce();
  });
  it('isolates second-map bitmaps and projection metadata even with identical delivery URLs and hashes',async()=>{
    const map=secondMap(),first=overview().image,second=overview().image;
    const decode=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);vi.stubGlobal('createImageBitmap',decode);
    vi.mocked(fetchDeliveredAsset).mockResolvedValue(new ArrayBuffer(0));
    const [a,b,joined]=await Promise.all([loadNativeRadar(),loadNativeRadar(undefined,map),loadNativeRadar(undefined,map)]);
    expect(fetchDeliveredAsset).toHaveBeenCalledTimes(2);expect(decode).toHaveBeenCalledTimes(2);
    expect(a.overview.image).toBe(first);expect(b.overview.image).toBe(second);expect(joined.overview).toBe(b.overview);
    expect(b.overview.bounds.minX).toBeCloseTo(100*.0254);expect(b.overview.bounds.minZ).toBeCloseTo(-200*.0254);
    expect(b.overview.bounds.maxX-b.overview.bounds.minX).toBeCloseTo(2*1024*.0254);
    a.dispose();expect(first.close).toHaveBeenCalledOnce();expect(second.close).not.toHaveBeenCalled();
    b.dispose();joined.dispose();expect(second.close).toHaveBeenCalledOnce();
  });
  it.each(['identity','revision','base','URL','encoded hash','decoded hash','metadata'])(
    'does not reuse an active radar after changing its %s',async change=>{
      const map=secondMap(),updated=secondMap(),first=overview().image,second=overview().image;
      if(change==='identity')updated.id+='-other';
      if(change==='revision')updated.revision+='-other';
      if(change==='base')updated.base='/maps/other/';
      if(change==='URL')updated.radar!.delivery.url=map.radar!.delivery.url.replace(nativeMaps.get(defaultNativeMapId).base,map.base);
      if(change==='encoded hash') {
        updated.radar!.delivery.sha256='a'.repeat(64);
        updated.radar!.delivery.url=map.radar!.delivery.url.replace(map.radar!.delivery.sha256,'a'.repeat(64));
      }
      if(change==='decoded hash')updated.radar!.delivery.decodedSha256='b'.repeat(64);
      if(change==='metadata')updated.radar!.metadata.pos_x=300;
      vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second));
      vi.mocked(fetchDeliveredAsset).mockResolvedValue(new ArrayBuffer(0));
      const a=await loadNativeRadar(undefined,map),b=await loadNativeRadar(undefined,updated);
      expect(fetchDeliveredAsset).toHaveBeenCalledTimes(2);expect(a.overview.image).toBe(first);expect(b.overview.image).toBe(second);
      expect(fetchDeliveredAsset).toHaveBeenLastCalledWith(updated.radar!.delivery,expect.any(AbortSignal));
      a.dispose();expect(first.close).toHaveBeenCalledOnce();expect(second.close).not.toHaveBeenCalled();
      b.dispose();expect(second.close).toHaveBeenCalledOnce();
    });
  it('cancels a second-map waiter without affecting its peer or the default map',async()=>{
    const map=secondMap(),downloads:{signal:AbortSignal;resolve:(value:ArrayBuffer)=>void}[]=[];
    vi.mocked(fetchDeliveredAsset).mockImplementation((_asset,signal)=>new Promise<ArrayBuffer>(resolve=>downloads.push({signal:signal!,resolve})));
    const first=overview().image,second=overview().image;
    vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second));
    const controller=new AbortController(),pending=loadNativeRadar(controller.signal,map);
    const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    const survivor=loadNativeRadar(undefined,map),other=loadNativeRadar();
    await vi.waitFor(()=>expect(downloads).toHaveLength(2));controller.abort();await rejection;
    expect(downloads.every(download=>!download.signal.aborted)).toBe(true);
    downloads.forEach(download=>download.resolve(new ArrayBuffer(0)));
    const [a,b]=await Promise.all([survivor,other]);expect(a.overview.image).not.toBe(b.overview.image);
    a.dispose();b.dispose();expect(first.close).toHaveBeenCalledOnce();expect(second.close).toHaveBeenCalledOnce();
  });
  it('closes an aborted map late decode without poisoning either map cache',async()=>{
    const map=secondMap(),late=deferred<ImageBitmap>(),old=overview().image as ImageBitmap;
    const first=overview().image,second=overview().image;
    const decode=vi.fn().mockReturnValueOnce(late.promise).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal('createImageBitmap',decode);vi.mocked(fetchDeliveredAsset).mockResolvedValue(new ArrayBuffer(0));
    const controller=new AbortController(),pending=loadNativeRadar(controller.signal,map);
    const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(decode).toHaveBeenCalledOnce());
    const a=await loadNativeRadar();controller.abort();await rejection;
    const b=await loadNativeRadar(undefined,map);late.resolve(old);
    await vi.waitFor(()=>expect(old.close).toHaveBeenCalledOnce());
    const joined=await loadNativeRadar(undefined,map),other=await loadNativeRadar();
    expect(decode).toHaveBeenCalledTimes(3);expect(joined.overview.image).toBe(second);expect(other.overview.image).toBe(first);
    a.dispose();b.dispose();joined.dispose();other.dispose();
    expect(first.close).toHaveBeenCalledOnce();expect(second.close).toHaveBeenCalledOnce();
  });
  it('drops released map history and reloads rather than keeping unused radar bitmaps',async()=>{
    const values:NativeRadarOverview['image'][]=[];
    const decode=vi.fn(async()=>{const value=overview().image;values.push(value);return value;});
    vi.stubGlobal('createImageBitmap',decode);vi.mocked(fetchDeliveredAsset).mockResolvedValue(new ArrayBuffer(0));
    for(let i=0;i<12;i++) {
      const map={...secondMap(),id:`de_test_${i}`},lease=await loadNativeRadar(undefined,map);
      lease.dispose();lease.dispose();expect(values[i].close).toHaveBeenCalledOnce();
    }
    const again=await loadNativeRadar(undefined,{...secondMap(),id:'de_test_0'});
    expect(decode).toHaveBeenCalledTimes(13);again.dispose();values.forEach(value=>expect(value.close).toHaveBeenCalledOnce());
  });
  it('rejects missing or mismatched radar manifests without using a default map asset',async()=>{
    const missing=secondMap();delete missing.radar;await expect(loadNativeRadar(undefined,missing)).rejects.toThrow('radar');
    const invalid=secondMap();invalid.radar!.map='other';await expect(loadNativeRadar(undefined,invalid)).rejects.toThrow('radar');
    expect(fetchDeliveredAsset).not.toHaveBeenCalled();
  });
  it('never decodes rejected delivery bytes and closes a bitmap with invalid projection metadata',async()=>{
    const map=secondMap(),decode=vi.fn();vi.stubGlobal('createImageBitmap',decode);
    vi.mocked(fetchDeliveredAsset).mockRejectedValueOnce(Error('Map download digest mismatch'));
    await expect(loadNativeRadar(undefined,map)).rejects.toThrow('digest mismatch');expect(decode).not.toHaveBeenCalled();
    const invalid=secondMap();invalid.radar!.metadata.scale=0;const image=overview().image;
    vi.mocked(fetchDeliveredAsset).mockResolvedValue(new ArrayBuffer(0));decode.mockResolvedValue(image);
    await expect(loadNativeRadar(undefined,invalid)).rejects.toThrow('metadata');expect(image.close).toHaveBeenCalledOnce();
  });
});
