import {createHash} from 'node:crypto';
import {Group} from 'three';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {RealMapSession,realMapChunks} from './real-map';
import {sanitizeDuelConfig} from './config';
import {loadNativeMap} from '../prefire/map';

vi.mock('../prefire/map',()=>({loadNativeMap:vi.fn()}));
vi.mock('./map-context',()=>({loadMapContext:async()=>undefined}));
vi.mock('./map-manifests',()=>({localChunkManifest:(id:string)=>{
  const chunk=realMapChunks.find(chunk=>chunk.id===id)!;
  return {version:1,id:chunk.id,map:'dust2',routeId:chunk.routeId,sourceMin:chunk.sourceMin,sourceMax:chunk.sourceMax,
    sourceCollisionSha256:digest('source'),collisionManifestSha256:digest('collision'),visualManifestSha256:digest('visual'),
    navigationSha256:digest(navigation(chunk))};
}}));
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const navigation=(chunk:typeof realMapChunks[number])=>JSON.stringify({version:1,nodes:[{point:{x:(chunk.sourceMin[0]+chunk.sourceMax[0])*.0254/2,y:0,
  z:-(chunk.sourceMin[1]+chunk.sourceMax[1])*.0254/2},links:[]}]});
const maps=new Map<string,{scene:Group;collision:{collisionSha256:string};dispose:ReturnType<typeof vi.fn>;updateVisibility:ReturnType<typeof vi.fn>}>();

beforeEach(()=>{
  vi.stubGlobal('navigator',{deviceMemory:4,hardwareConcurrency:4});
  maps.clear();vi.mocked(loadNativeMap).mockReset();
  vi.mocked(loadNativeMap).mockImplementation(async(_signal,options)=>{
    const id=options!.base.split('/').filter(Boolean).pop()!;
    const map={scene:new Group(),collision:{collisionSha256:digest(id)},dispose:vi.fn(),updateVisibility:vi.fn()};maps.set(id,map);
    return map as unknown as Awaited<ReturnType<typeof loadNativeMap>>;
  });
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    const chunk=realMapChunks.find(chunk=>url.includes(`/${chunk.id}/`))!;
    if(!url.endsWith('navigation.json'))throw Error('Unexpected map request');
    return new Response(navigation(chunk));
  }));
});
afterEach(()=>vi.unstubAllGlobals());

describe('bounded real-map reuse',()=>{
  it('keeps a bounded older chunk on capable devices without replacing the previous replay map',async()=>{
    vi.stubGlobal('navigator',{deviceMemory:8,hardwareConcurrency:16});
    const [a,b,c]=realMapChunks,signal=new AbortController().signal;
    const session=await RealMapSession.load(sanitizeDuelConfig({realMapChunk:a.id}),1,signal);
    for(const [seed,chunk] of [[2,b],[3,c],[4,a]] as const){
      session.configureDuel(sanitizeDuelConfig({realMapChunk:chunk.id}));await session.prepareRound(seed,signal);
    }
    expect(loadNativeMap).toHaveBeenCalledTimes(3);expect(maps.get(a.id)!.dispose).not.toHaveBeenCalled();
    session.replayMap(digest(c.id));session.updateView({x:1,y:2,z:3});
    expect(maps.get(c.id)!.updateVisibility).toHaveBeenCalledOnce();
    session.dispose();for(const chunk of [a,b,c])expect(maps.get(chunk.id)!.dispose).toHaveBeenCalledOnce();
  });
  it('reuses the previous loaded chunk without fetching or decoding it again',async()=>{
    const [a,b,c]=realMapChunks,signal=new AbortController().signal;
    const session=await RealMapSession.load(sanitizeDuelConfig({realMapChunk:a.id}),1,signal);
    session.configureDuel(sanitizeDuelConfig({realMapChunk:b.id}));await session.prepareRound(2,signal);
    const requests=vi.mocked(fetch).mock.calls.length;
    session.replayMap(digest(a.id));session.updateView({x:1,y:2,z:3});
    expect(maps.get(a.id)!.updateVisibility).toHaveBeenCalledOnce();expect(maps.get(b.id)!.updateVisibility).not.toHaveBeenCalled();
    session.replayMap();session.updateView({x:4,y:5,z:6});expect(maps.get(b.id)!.updateVisibility).toHaveBeenCalledOnce();
    session.configureDuel(sanitizeDuelConfig({realMapChunk:a.id}));await session.prepareRound(3,signal);
    expect(session.chunk.id).toBe(a.id);expect(loadNativeMap).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
    expect(maps.get(a.id)!.dispose).not.toHaveBeenCalled();
    session.configureDuel(sanitizeDuelConfig({realMapChunk:c.id}));await session.prepareRound(4,signal);
    expect(maps.get(b.id)!.dispose).toHaveBeenCalledOnce();
    expect(maps.get(a.id)!.dispose).not.toHaveBeenCalled();
    session.dispose();session.dispose();
    expect(maps.get(a.id)!.dispose).toHaveBeenCalledOnce();expect(maps.get(c.id)!.dispose).toHaveBeenCalledOnce();
  });
});
