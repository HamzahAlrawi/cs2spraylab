import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import catalog from './real-map-catalog.json';
import release from './map-manifests.json';
import {localChunkManifest,localMapContextManifest} from './map-manifests';

afterEach(()=>{vi.doUnmock('./map-manifests.json');vi.resetModules();vi.unstubAllGlobals();});
const publicMetadata=(suffix:string)=>JSON.parse(readFileSync(`public/revamp/maps/dust2/duel/${suffix}`,'utf8'));
async function altered(change:(data:any)=>void) {
  const data=structuredClone(release);change(data);
  vi.doMock('./map-manifests.json',()=>({default:data}));vi.resetModules();
  return import('./map-manifests');
}

describe('release-pinned native map metadata',()=>{
  it('ships exactly eight root manifests and context, preserving every native field and delivery pin',()=>{
    expect(Object.keys(release.chunks).sort()).toEqual(catalog.chunks.map(c=>c.id).sort());
    expect(catalog.chunks).toHaveLength(8);
    for(const chunk of catalog.chunks) {
      const metadata=localChunkManifest(chunk.id);
      expect(metadata.delivery.url).toContain(metadata.delivery.sha256);
      expect(metadata.sourceMin).toEqual(chunk.sourceMin);expect(metadata.sourceMax).toEqual(chunk.sourceMax);
      expect(metadata).not.toHaveProperty('courses');
    }
    expect(localMapContextManifest().visualOnly).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(release))).toBeLessThan(64*1024);
  });
  it.skipIf(!existsSync('public/revamp/maps/dust2/duel/context/context.json'))('matches installed exported metadata when native assets are available',()=>{
    for(const chunk of catalog.chunks)expect(localChunkManifest(chunk.id)).toEqual(publicMetadata(chunk.id+'/chunk.json'));
    expect(localMapContextManifest()).toEqual(publicMetadata('context/context.json'));
  });
  it('does no network or storage work on repeated synchronous lookups',()=>{
    const network=vi.fn(()=>{throw Error('No metadata requests allowed');});vi.stubGlobal('fetch',network);
    const storage=vi.fn(()=>{throw Error('No metadata storage needed');});vi.stubGlobal('caches',{open:storage});
    for(let page=0;page<3;page++) {
      for(const chunk of catalog.chunks)expect(localChunkManifest(chunk.id)).not.toBeInstanceOf(Promise);
      expect(localMapContextManifest()).not.toBeInstanceOf(Promise);
    }
    expect(network).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();
  });
  it.each(['','dust2-unknown','../context','__proto__','constructor'])('fails closed for unsupported id %s',id=>{
    expect(()=>localChunkManifest(id)).toThrow('Unsupported map chunk');
  });
  it('protects nested delivery pins and native bounds from accidental caller mutation',()=>{
    const metadata=localChunkManifest(catalog.chunks[0].id);
    expect(Object.isFrozen(metadata.delivery)).toBe(true);expect(Object.isFrozen(metadata.sourceMin)).toBe(true);
    expect(()=>{metadata.delivery.sha256='0'.repeat(64);}).toThrow();
    expect(()=>{metadata.sourceMin[0]=999;}).toThrow();
  });
  it('rejects a supported course missing from the bundle without fallback',async()=>{
    const module=await altered(data=>{delete data.chunks[catalog.chunks[0].id];});
    expect(()=>module.localChunkManifest(catalog.chunks[0].id)).toThrow('Missing or stale');
  });
  it.each(['routeId','sourceMin','sourceMax','contextPaddingUnits','delivery'])('rejects stale %s metadata',async field=>{
    const module=await altered(data=>{
      const chunk=data.chunks[catalog.chunks[0].id];
      chunk[field]=field==='delivery'?{...chunk.delivery,url:'/maps/mutable.bin'}:null;
    });
    expect(()=>module.localChunkManifest(catalog.chunks[0].id)).toThrow('Missing or stale');
  });
  it('rejects unsupported catalog envelopes',async()=>{
    const module=await altered(data=>{data.version=2;});
    expect(()=>module.localChunkManifest(catalog.chunks[0].id)).toThrow('Unsupported bundled');
    expect(()=>module.localMapContextManifest()).toThrow('Unsupported bundled');
  });
  it.each(['missing','map','hash','budget'])('rejects %s context metadata',async fault=>{
    const module=await altered(data=>{
      if(fault==='missing')delete data.context;
      else if(fault==='map')data.context.map='other';
      else if(fault==='hash')data.context.sha256='0'.repeat(64);
      else data.context.delivery.decodedBytes=5_000_001;
    });
    expect(()=>module.localMapContextManifest()).toThrow('Missing or stale bundled map context');
  });
});
