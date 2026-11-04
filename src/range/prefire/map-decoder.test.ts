import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {createMapDecoder} from './map-decoder';
vi.mock('three/examples/jsm/libs/meshopt_decoder.module.js',()=>({MeshoptDecoder:{supported:true,ready:Promise.resolve(),
  decodeGltfBuffer:vi.fn((bytes:Uint8Array)=>bytes.set([7,8]))}}));
let workers:FakeWorker[]=[];
class FakeWorker {
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();
  constructor(){workers.push(this);}
}
beforeEach(()=>{workers=[];vi.stubGlobal('Worker',FakeWorker);
  vi.stubGlobal('requestAnimationFrame',(run:FrameRequestCallback)=>{queueMicrotask(()=>run(0));return 1;});vi.clearAllMocks();});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('shares one worker across sectors, transfers only copied compressed spans and retains decoded bytes',async()=>{
  const source=new Uint8Array([0,1,2,3]),lease=createMapDecoder(new AbortController().signal);
  const a=lease.decoder.decodeGltfBufferAsync(2,4,source.subarray(1,3),'ATTRIBUTES');
  const b=lease.decoder.decodeGltfBufferAsync(3,2,source,'TRIANGLES');
  await vi.waitFor(()=>expect(workers[0].postMessage).toHaveBeenCalledTimes(2));
  expect(workers).toHaveLength(1);expect(workers[0].postMessage.mock.calls[0][0].source).toEqual(new Uint8Array([1,2]));
  expect(workers[0].postMessage.mock.calls[0][0].source.buffer).not.toBe(source.buffer);
  const bytes=new Uint8Array([4,5,6]);workers[0].onmessage!({data:{id:1,bytes}} as MessageEvent);
  workers[0].onmessage!({data:{id:0,bytes}} as MessageEvent);
  expect(await a).toBe(bytes);expect(await b).toBe(bytes);expect(MeshoptDecoder.decodeGltfBuffer).not.toHaveBeenCalled();
  lease.dispose();expect(workers[0].terminate).toHaveBeenCalledOnce();
});
it('cancels pending work and terminates ownership on abort',async()=>{
  const controller=new AbortController(),lease=createMapDecoder(controller.signal);
  const pending=lease.decoder.decodeGltfBufferAsync(2,4,new Uint8Array(8),'ATTRIBUTES');
  const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;
  lease.dispose();expect(workers[0].terminate).toHaveBeenCalledOnce();expect(MeshoptDecoder.decodeGltfBuffer).not.toHaveBeenCalled();
});
it.each(['unavailable','failed','timeout'])('retains a frame-yielding fallback when workers are %s',async(reason)=>{
  if(reason==='unavailable')vi.stubGlobal('Worker',undefined);
  if(reason==='timeout')vi.useFakeTimers();
  const lease=createMapDecoder(new AbortController().signal),pending=lease.decoder.decodeGltfBufferAsync(2,4,new Uint8Array(8),'ATTRIBUTES');
  if(reason==='failed')workers[0].onerror!({preventDefault:vi.fn()} as unknown as ErrorEvent);
  if(reason==='timeout'){await vi.advanceTimersByTimeAsync(30000);await vi.runAllTimersAsync();}
  expect((await pending).subarray(0,2)).toEqual(new Uint8Array([7,8]));expect(MeshoptDecoder.decodeGltfBuffer).toHaveBeenCalledOnce();lease.dispose();
});
it('rejects invalid geometry instead of silently changing it',async()=>{
  const lease=createMapDecoder(new AbortController().signal),pending=lease.decoder.decodeGltfBufferAsync(2,4,new Uint8Array(8),'ATTRIBUTES');
  workers[0].onmessage!({data:{id:0,error:'Invalid compressed data'}} as MessageEvent);
  await expect(pending).rejects.toThrow('Invalid compressed data');expect(MeshoptDecoder.decodeGltfBuffer).not.toHaveBeenCalled();lease.dispose();
});
