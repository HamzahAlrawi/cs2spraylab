import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const mocks=vi.hoisted(()=>({parseAsync:vi.fn(async(_bytes:ArrayBuffer,_path:string)=>({parsed:true})),loadAsync:vi.fn(async(_url:string)=>({fallback:true}))}));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js',()=>({GLTFLoader:class {parseAsync=mocks.parseAsync;loadAsync=mocks.loadAsync;}}));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
beforeEach(()=>{vi.resetModules();vi.stubGlobal('caches',undefined);vi.clearAllMocks();});
afterEach(()=>vi.unstubAllGlobals());
describe('critical model byte delivery',()=>{
  it('prepares only selected compressed bytes and parses the exact verified GLB later',async()=>{
    const raw=new TextEncoder().encode('exact native GLB bytes'),bytes=gzipSync(raw),hash=sha(bytes);
    const asset={url:`/models/objects/${hash}.bin`,sha256:hash,bytes:bytes.length,
      decodedSha256:sha(raw),decodedBytes:raw.length,encoding:'gzip'};
    const fetch=vi.fn(async(url:string)=>url.endsWith('.json')?Response.json({version:1,assets:{'/models/target.glb':asset}}):new Response(bytes));
    vi.stubGlobal('fetch',fetch);
    const {loadCombatModel,prefetchCombatModels}=await import('./combat-model-delivery');
    await prefetchCombatModels(['/models/target.glb'],new AbortController().signal);
    expect(mocks.parseAsync).not.toHaveBeenCalled();await loadCombatModel('/models/target.glb?revision=1');
    expect(new TextDecoder().decode(mocks.parseAsync.mock.calls[0][0])).toBe('exact native GLB bytes');
    expect(fetch).toHaveBeenCalledTimes(2);expect(mocks.loadAsync).not.toHaveBeenCalled();
  });
  it('retains raw GLB compatibility for unavailable manifests or unlisted cosmetics',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:404})));
    const {loadCombatModel}=await import('./combat-model-delivery');
    await loadCombatModel('/models/view-custom-knife.glb');
    expect(mocks.loadAsync).toHaveBeenCalledWith('/models/view-custom-knife.glb');
  });
  it('does not silently accept corrupt listed content or begin prefetch after cancellation',async()=>{
    const raw=new TextEncoder().encode('model'),bytes=gzipSync(raw),hash=sha(bytes);
    const asset={url:`/models/objects/${hash}.bin`,sha256:hash,bytes:bytes.length,
      decodedSha256:sha(raw),decodedBytes:raw.length,encoding:'gzip'};
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('.json')?Response.json({version:1,assets:{'/models/target.glb':asset}}):new Response(new Uint8Array(bytes.length))));
    const {loadCombatModel,prefetchCombatModels}=await import('./combat-model-delivery');
    await expect(loadCombatModel('/models/target.glb')).rejects.toThrow('checksum');
    const abort=new AbortController();abort.abort();
    await expect(prefetchCombatModels(['/models/target.glb'],abort.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(mocks.loadAsync).not.toHaveBeenCalled();
  });
});
