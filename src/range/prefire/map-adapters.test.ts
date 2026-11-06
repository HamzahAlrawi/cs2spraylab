import {afterEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({load:vi.fn(),delivered:vi.fn(),validate:vi.fn((value:unknown)=>value),
  descriptor:{url:'/maps/fixture/full.json',sha256:'a'.repeat(64)},catalog:{id:'de_fixture',revision:'test'},
  beta:{state:'beta',beta:{test:true}}}));
vi.mock('./maps',()=>({defaultNativeMapId:'de_fixture',nativeMaps:{
  list:()=>[{id:'de_fixture',name:'Fixture',base:'/maps/fixture/',sharedTextureBase:'/maps/fixture/shared/',fullDelivery:mocks.descriptor,onboarding:mocks.beta}],
  loadCatalog:async()=>mocks.catalog,
}}));
vi.mock('./asset-delivery',()=>({fetchDeliveredAsset:mocks.delivered,validateDelivery:mocks.validate}));
vi.mock('./map',()=>({loadNativeMap:mocks.load}));
import {prefireMaps} from './map-adapters';

afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('Prefire full-map grenade collision delivery',()=>{
  it('passes the checked full-map delivery to the runtime, including supplemental grenade clips',async()=>{
    const delivery={files:{'grenade-collision.json':{sha256:'b'.repeat(64)},'grenade-query.bin':{sha256:'c'.repeat(64)}}};
    mocks.delivered.mockResolvedValue(new TextEncoder().encode(JSON.stringify(delivery)));
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({build:'fixture',collisionSha256:'d'.repeat(64)}))));
    const pack=await prefireMaps.load('de_fixture'),abort=new AbortController();
    await pack.loadRuntime!(abort.signal);
    expect(mocks.delivered).toHaveBeenCalledWith(mocks.descriptor,abort.signal);
    expect(mocks.validate).toHaveBeenCalledWith(delivery);
    expect(mocks.load).toHaveBeenCalledWith(abort.signal,{base:'/maps/fixture/',sharedTextureBase:'/maps/fixture/shared/',delivery});
  });
  it('does not start a geometry load after cancellation during delivery preparation',async()=>{
    const abort=new AbortController();
    mocks.delivered.mockImplementationOnce(async()=>{abort.abort();return new TextEncoder().encode('{"files":{}}');});
    const pack=await prefireMaps.load('de_fixture');
    await expect(pack.loadRuntime!(abort.signal)).rejects.toThrow();
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
