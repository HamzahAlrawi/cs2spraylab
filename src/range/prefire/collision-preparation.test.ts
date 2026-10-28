import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NativeMapCollision,type NativeCollisionManifest,type PreparedNativeQueries} from './native-collision';
import {prepareCollision} from './collision-preparation';
vi.mock('./native-collision',()=>({NativeMapCollision:{create:vi.fn()}}));
const manifest={collisionSha256:'fixture'} as NativeCollisionManifest,metadata={schema:1,ids:[[1,2]],open:[],columns:[['0:0',[1,2]]]} as unknown as PreparedNativeQueries;
let workers:FakeWorker[]=[];
class FakeWorker {
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;
  terminate=vi.fn();postMessage=vi.fn();
  constructor(){workers.push(this);}
}
beforeEach(()=>{workers=[];vi.stubGlobal('Worker',FakeWorker);vi.mocked(NativeMapCollision.create).mockReset();});
afterEach(()=>vi.unstubAllGlobals());
describe('worker collision preparation',()=>{
  it('restores a worker snapshot with checked source bytes and terminates the worker',async()=>{
    const source=new ArrayBuffer(16),snapshot=new ArrayBuffer(32),dispose=vi.fn();
    vi.mocked(NativeMapCollision.create).mockResolvedValue({dispose} as unknown as NativeMapCollision);
    const pending=prepareCollision(manifest,source,metadata);expect(workers).toHaveLength(1);
    expect(workers[0].postMessage.mock.calls[0][0].binary).not.toBe(source);
    expect(workers[0].postMessage.mock.calls[0][0]).not.toHaveProperty('metadata');
    workers[0].onmessage!({data:{ownership:{ids:metadata.ids,open:metadata.open},snapshot}} as MessageEvent);await pending;
    expect(NativeMapCollision.create).toHaveBeenCalledWith(manifest,source,{metadata,snapshot});expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(vi.mocked(NativeMapCollision.create).mock.calls[0][2]?.metadata.columns).toBe(metadata.columns);
  });
  it('falls back for unsupported workers or incompatible snapshots',async()=>{
    vi.mocked(NativeMapCollision.create).mockRejectedValueOnce(new Error('incompatible')).mockResolvedValueOnce({dispose:vi.fn()} as unknown as NativeMapCollision);
    const source=new ArrayBuffer(16),pending=prepareCollision(manifest,source,metadata);
    workers[0].onmessage!({data:{ownership:{ids:metadata.ids,open:metadata.open},snapshot:new ArrayBuffer(32)}} as MessageEvent);await pending;
    expect(NativeMapCollision.create).toHaveBeenLastCalledWith(manifest,source,{metadata});
  });
  it('does not build on the main thread after abort',async()=>{
    const controller=new AbortController(),pending=prepareCollision(manifest,new ArrayBuffer(16),metadata,controller.signal);
    const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;
    expect(NativeMapCollision.create).not.toHaveBeenCalled();expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('uses normal construction when workers are unavailable',async()=>{
    vi.stubGlobal('Worker',undefined);vi.mocked(NativeMapCollision.create).mockResolvedValue({dispose:vi.fn()} as unknown as NativeMapCollision);
    await prepareCollision(manifest,new ArrayBuffer(16));expect(NativeMapCollision.create).toHaveBeenCalledOnce();
  });
});
