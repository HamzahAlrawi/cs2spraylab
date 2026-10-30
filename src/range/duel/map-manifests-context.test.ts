import {afterEach,describe,expect,it,vi} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshBasicMaterial} from 'three';
import {localMapContextManifest} from './map-manifests';
import {defaultNativeMapId,nativeMaps} from '../prefire/maps';
import type {NativeMapDefinition} from '../prefire/native-map-schema';

const mocks=vi.hoisted(()=>({delivered:vi.fn(),parse:vi.fn()}));
vi.mock('../prefire/asset-delivery',async importOriginal=>({
  ...await importOriginal<typeof import('../prefire/asset-delivery')>(),fetchDeliveredAsset:mocks.delivered,
}));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js',()=>({GLTFLoader:class {
  setMeshoptDecoder(){return this;}
  parseAsync(...args:unknown[]){return mocks.parse(...args);}
}}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();vi.resetModules();});

function secondMap():NativeMapDefinition {
  const original=nativeMaps.get(defaultNativeMapId),assetId='test-map';
  return {...original,id:'de_test_map',assetId,base:'/maps/test-map/',
    release:{...original.release,map:assetId,context:{...original.release.context!,map:assetId,
      delivery:{...original.release.context!.delivery}}}};
}
function scene() {
  const root=new Group(),geometry=new BoxGeometry(),material=new MeshBasicMaterial();root.add(new Mesh(geometry,material));
  return {scene:root,geometry,dispose:vi.spyOn(geometry,'dispose')};
}

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
    expect(mocks.parse).toHaveBeenCalledWith(bytes,nativeMaps.get(defaultNativeMapId).base+'duel/context/');
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
  it('isolates maps even when their verified delivery URL and hashes are identical',async()=>{
    const {loadMapContext,disposeMapContextCache}=await import('./map-context');
    const map=secondMap(),first=scene(),second=scene();mocks.delivered.mockResolvedValue(new ArrayBuffer(0));
    mocks.parse.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const [a,joined,b]=await Promise.all([loadMapContext(),loadMapContext(),loadMapContext(undefined,map)]);
    expect(mocks.delivered).toHaveBeenCalledTimes(2);expect(mocks.parse).toHaveBeenCalledTimes(2);
    expect((a.root.children[0] as Mesh).geometry).toBe(first.geometry);
    expect((joined.root.children[0] as Mesh).geometry).toBe(first.geometry);
    expect((b.root.children[0] as Mesh).geometry).toBe(second.geometry);
    expect(mocks.parse.mock.calls.map(call=>call[1])).toEqual([
      nativeMaps.get(defaultNativeMapId).base+'duel/context/',map.base+'duel/context/']);
    await expect(disposeMapContextCache(map)).rejects.toThrow('leases');
    b.dispose();await disposeMapContextCache(map);expect(second.dispose).toHaveBeenCalledOnce();
    expect(first.dispose).not.toHaveBeenCalled();a.dispose();joined.dispose();await disposeMapContextCache();
    expect(first.dispose).toHaveBeenCalledOnce();
  });
  it.each(['identity','revision','base','URL','encoded hash','decoded hash'])(
    'does not reuse a context after changing its %s',async change=>{
      const {loadMapContext,disposeMapContextCache}=await import('./map-context');
      const map=secondMap(),original=structuredClone(map.release.context!),updated=secondMap();
      if(change==='identity')updated.id+='-other';
      if(change==='revision')updated.revision+='-other';
      if(change==='base')updated.base='/maps/other/';
      if(change==='URL')updated.release.context!.delivery.url=original.delivery.url.replace(nativeMaps.get(defaultNativeMapId).base,map.base);
      if(change==='encoded hash') {
        updated.release.context!.delivery.sha256='a'.repeat(64);
        updated.release.context!.delivery.url=original.delivery.url.replace(original.delivery.sha256,'a'.repeat(64));
      }
      if(change==='decoded hash')updated.release.context!.sha256=updated.release.context!.delivery.decodedSha256='b'.repeat(64);
      const first=scene(),second=scene();mocks.delivered.mockResolvedValue(new ArrayBuffer(0));
      mocks.parse.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      const a=await loadMapContext(undefined,map),b=await loadMapContext(undefined,updated);
      expect(mocks.delivered).toHaveBeenCalledTimes(2);
      expect((a.root.children[0] as Mesh).geometry).toBe(first.geometry);
      expect((b.root.children[0] as Mesh).geometry).toBe(second.geometry);
      a.dispose();b.dispose();await disposeMapContextCache(map);await disposeMapContextCache(updated);
      expect(first.dispose).toHaveBeenCalledOnce();expect(second.dispose).toHaveBeenCalledOnce();
    });
  it('cancels one map waiter without cancelling another waiter or another map',async()=>{
    const {loadMapContext,disposeMapContextCache}=await import('./map-context'),map=secondMap();
    const downloads:{signal:AbortSignal;resolve:(value:ArrayBuffer)=>void}[]=[];
    mocks.delivered.mockImplementation((_asset,signal)=>new Promise<ArrayBuffer>(resolve=>downloads.push({signal,resolve})));
    mocks.parse.mockImplementation(async()=>scene());
    const controller=new AbortController(),cancelled=loadMapContext(controller.signal,map);
    const rejected=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
    const survivor=loadMapContext(undefined,map),other=loadMapContext();
    await vi.waitFor(()=>expect(downloads).toHaveLength(2));controller.abort();await rejected;
    expect(downloads.every(download=>!download.signal.aborted)).toBe(true);
    downloads.forEach(download=>download.resolve(new ArrayBuffer(0)));
    const [a,b]=await Promise.all([survivor,other]);
    expect((a.root.children[0] as Mesh).geometry).not.toBe((b.root.children[0] as Mesh).geometry);
    a.dispose();b.dispose();await disposeMapContextCache(map);await disposeMapContextCache();
  });
  it('releases a cancelled map late decode without poisoning another map or its own replacement',async()=>{
    const {loadMapContext,disposeMapContextCache}=await import('./map-context'),map=secondMap();
    const old=scene(),current=scene(),other=scene();let resolve!:(value:ReturnType<typeof scene>)=>void;
    mocks.delivered.mockResolvedValue(new ArrayBuffer(0));
    mocks.parse.mockReturnValueOnce(new Promise(done=>{resolve=done;})).mockResolvedValueOnce(other).mockResolvedValueOnce(current);
    const controller=new AbortController(),pending=loadMapContext(controller.signal,map);
    const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(mocks.parse).toHaveBeenCalledOnce());
    const b=await loadMapContext();controller.abort();await rejection;
    const a=await loadMapContext(undefined,map);resolve(old);
    await vi.waitFor(()=>expect(old.dispose).toHaveBeenCalledOnce());
    const joined=await loadMapContext(undefined,map);expect(mocks.parse).toHaveBeenCalledTimes(3);
    expect((joined.root.children[0] as Mesh).geometry).toBe(current.geometry);
    expect(other.dispose).not.toHaveBeenCalled();expect(current.dispose).not.toHaveBeenCalled();
    a.dispose();joined.dispose();b.dispose();await disposeMapContextCache(map);await disposeMapContextCache();
  });
  it('retains at most one unused map decode while protecting active leases',async()=>{
    const {loadMapContext,disposeMapContextCache}=await import('./map-context'),activeScene=scene(),values:ReturnType<typeof scene>[]=[];
    mocks.delivered.mockResolvedValue(new ArrayBuffer(0));mocks.parse.mockResolvedValueOnce(activeScene).mockImplementation(async()=>{
      const value=scene();values.push(value);return value;
    });
    const active=await loadMapContext();let last!:NativeMapDefinition;
    for(let i=0;i<12;i++) {
      last={...secondMap(),id:`de_test_${i}`};const lease=await loadMapContext(undefined,last);lease.dispose();
      await Promise.resolve();
    }
    expect(activeScene.dispose).not.toHaveBeenCalled();
    values.slice(0,-1).forEach(value=>expect(value.dispose).toHaveBeenCalledOnce());
    expect(values[values.length-1].dispose).not.toHaveBeenCalled();
    await disposeMapContextCache(last);expect(values[values.length-1].dispose).toHaveBeenCalledOnce();
    active.dispose();await disposeMapContextCache();expect(activeScene.dispose).toHaveBeenCalledOnce();
  });
  it('rejects missing or mismatched context metadata without falling back to the default map',async()=>{
    const {loadMapContext}=await import('./map-context'),map=secondMap();
    delete map.release.context;await expect(loadMapContext(undefined,map)).rejects.toThrow('context');
    const mismatched=secondMap();mismatched.release.context!.map='other';
    await expect(loadMapContext(undefined,mismatched)).rejects.toThrow('context');
    expect(mocks.delivered).not.toHaveBeenCalled();expect(mocks.parse).not.toHaveBeenCalled();
  });
  it('reuses the single idle decode across chunk leases until selected-map teardown',async()=>{
    const {loadMapContext,disposeMapContextCache}=await import('./map-context'),map=secondMap(),value=scene();
    mocks.delivered.mockResolvedValue(new ArrayBuffer(0));mocks.parse.mockResolvedValue(value);
    const first=await loadMapContext(undefined,map);first.dispose();
    const next=await loadMapContext(undefined,secondMap());
    expect(mocks.parse).toHaveBeenCalledOnce();expect(value.dispose).not.toHaveBeenCalled();
    next.dispose();await disposeMapContextCache();expect(value.dispose).not.toHaveBeenCalled();
    await disposeMapContextCache(map);expect(value.dispose).toHaveBeenCalledOnce();
  });
  it('clears a selected pending map without disturbing another map lease or its replacement',async()=>{
    const {loadMapContext,disposeMapContextCache}=await import('./map-context'),map=secondMap();
    mocks.delivered.mockResolvedValue(new ArrayBuffer(0));mocks.parse.mockImplementation(async()=>scene());
    const other=await loadMapContext();let downloadSignal!:AbortSignal;
    mocks.delivered.mockImplementationOnce((_asset,signal)=>new Promise((_resolve,reject)=>{
      downloadSignal=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    }));
    const pending=loadMapContext(undefined,map),rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(downloadSignal).toBeDefined());
    const clearing=disposeMapContextCache(map),replacement=loadMapContext(undefined,map);
    await rejection;await clearing;expect(downloadSignal.aborted).toBe(true);
    const current=await replacement,joined=await loadMapContext(undefined,map);
    expect((joined.root.children[0] as Mesh).geometry).toBe((current.root.children[0] as Mesh).geometry);
    expect((other.root.children[0] as Mesh).geometry).not.toBe((current.root.children[0] as Mesh).geometry);
    current.dispose();joined.dispose();other.dispose();await disposeMapContextCache(map);await disposeMapContextCache();
  });
});
