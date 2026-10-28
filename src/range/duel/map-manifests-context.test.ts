import {afterEach,describe,expect,it,vi} from 'vitest';
import {Group} from 'three';
import {localMapContextManifest} from './map-manifests';

const mocks=vi.hoisted(()=>({delivered:vi.fn(),parse:vi.fn()}));
vi.mock('../prefire/asset-delivery',async importOriginal=>({
  ...await importOriginal<typeof import('../prefire/asset-delivery')>(),fetchDeliveredAsset:mocks.delivered,
}));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js',()=>({GLTFLoader:class {
  setMeshoptDecoder(){return this;}
  parseAsync(...args:unknown[]){return mocks.parse(...args);}
}}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();vi.resetModules();});

describe('local context metadata loading',()=>{
  it('uses only the verified delivery path across evictions and fresh page modules',async()=>{
    const network=vi.fn(()=>{throw Error('Mutable metadata HTTP forbidden');});vi.stubGlobal('fetch',network);
    const bytes=new ArrayBuffer(12);mocks.delivered.mockResolvedValue(bytes);
    mocks.parse.mockImplementation(async()=>({scene:new Group()}));
    for(let page=0;page<2;page++) {
      vi.resetModules();const {loadMapContext,disposeMapContextCache}=await import('./map-context');
      for(let visit=0;visit<2;visit++) {
        const lease=await loadMapContext();lease.dispose();await disposeMapContextCache();
      }
    }
    expect(network).not.toHaveBeenCalled();expect(mocks.delivered).toHaveBeenCalledTimes(4);
    for(const [asset,signal] of mocks.delivered.mock.calls) {
      expect(asset).toEqual(localMapContextManifest().delivery);expect(signal).toBeInstanceOf(AbortSignal);
    }
    expect(mocks.parse).toHaveBeenCalledWith(bytes,'/maps/dust2/duel/context/');
  });
  it('does not decode unverified bytes after the delivery layer rejects',async()=>{
    mocks.delivered.mockRejectedValueOnce(Error('Map download digest mismatch'));
    const {loadMapContext,disposeMapContextCache}=await import('./map-context');
    await expect(loadMapContext()).rejects.toThrow('digest mismatch');
    expect(mocks.parse).not.toHaveBeenCalled();await disposeMapContextCache();
  });
  it('honors cancellation before any delivery work',async()=>{
    const {loadMapContext}=await import('./map-context');const controller=new AbortController();controller.abort();
    await expect(loadMapContext(controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(mocks.delivered).not.toHaveBeenCalled();expect(mocks.parse).not.toHaveBeenCalled();
  });
});
