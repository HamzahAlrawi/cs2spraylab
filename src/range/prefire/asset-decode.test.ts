import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {DeliveredAsset} from './asset-delivery';
import {decodeDeliveredBytes} from './asset-decode-core';
vi.mock('./asset-decode-core',()=>({decodeDeliveredBytes:vi.fn(async()=>new ArrayBuffer(16))}));
const asset={decodedBytes:512*1024,decodedSha256:'a'.repeat(64),encoding:'gzip'} as DeliveredAsset;
let workers:FakeWorker[]=[];
class FakeWorker {
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();constructor(){workers.push(this);}
}
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();workers=[];vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('serializes inflation and hash validation on one worker, keeps cached bytes intact and closes when idle',async()=>{
  const {decodeAsset}=await import('./asset-decode'),source=new ArrayBuffer(8);
  const a=decodeAsset(source,asset),b=decodeAsset(source,asset);
  expect(workers).toHaveLength(1);expect(workers[0].postMessage).toHaveBeenCalledOnce();
  expect(workers[0].postMessage.mock.calls[0][0].bytes).not.toBe(source);
  const bytes=new ArrayBuffer(asset.decodedBytes);workers[0].onmessage!({data:{bytes}} as MessageEvent);expect(await a).toBe(bytes);
  expect(workers[0].postMessage).toHaveBeenCalledTimes(2);workers[0].onmessage!({data:{bytes}} as MessageEvent);await b;
  await vi.advanceTimersByTimeAsync(1000);expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(decodeDeliveredBytes).not.toHaveBeenCalled();expect(source.byteLength).toBe(8);
});
it('aborts queued and active jobs without delivering an old reply to a new job',async()=>{
  const {decodeAsset}=await import('./asset-decode'),first=new AbortController(),second=new AbortController();
  const a=decodeAsset(new ArrayBuffer(8),asset,first.signal),b=decodeAsset(new ArrayBuffer(8),asset,second.signal);
  const ar=expect(a).rejects.toMatchObject({name:'AbortError'}),br=expect(b).rejects.toMatchObject({name:'AbortError'});
  second.abort();await br;first.abort();await ar;expect(workers[0].terminate).toHaveBeenCalledOnce();
  let settled=false;const c=decodeAsset(new ArrayBuffer(8),asset).then(()=>{settled=true;});
  workers[0].onmessage!({data:{bytes:new ArrayBuffer(asset.decodedBytes)}} as MessageEvent);await Promise.resolve();expect(settled).toBe(false);
  workers[1].onmessage!({data:{bytes:new ArrayBuffer(asset.decodedBytes)}} as MessageEvent);await c;await vi.advanceTimersByTimeAsync(1000);
});
it('preserves checksum/size errors instead of silently accepting corrupted content',async()=>{
  const {decodeAsset}=await import('./asset-decode'),pending=decodeAsset(new ArrayBuffer(8),asset);
  workers[0].onmessage!({data:{error:'Map checksum mismatch'}} as MessageEvent);
  await expect(pending).rejects.toThrow('checksum');expect(decodeDeliveredBytes).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1000);
});
it.each(['denied','failed','timeout'])('falls back safely when the worker is %s',async reason=>{
  if(reason==='denied')vi.stubGlobal('Worker',class{constructor(){throw Error('blocked');}});
  const {decodeAsset}=await import('./asset-decode'),pending=decodeAsset(new ArrayBuffer(8),asset);
  if(reason==='failed')workers[0].onerror!({preventDefault:vi.fn()} as unknown as ErrorEvent);
  if(reason==='timeout')await vi.advanceTimersByTimeAsync(30000);
  expect((await pending).byteLength).toBe(16);expect(decodeDeliveredBytes).toHaveBeenCalledOnce();
});
