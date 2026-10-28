import {describe,expect,it,vi} from 'vitest';
import {createTaskLimiter,loadBounded,validateMapResources,verifyMapDigest,validateTexturePack} from './map-loading';

const delay=()=>new Promise<void>(resolve=>setTimeout(resolve,2));
describe('bounded map loading lifecycle',()=>{
  it('bounds concurrency and preserves manifest ordering',async()=>{
    let active=0,peak=0;
    const result=await loadBounded([0,1,2,3,4],2,async n=>{active++;peak=Math.max(peak,active);await delay();active--;return n;});
    expect(result).toEqual([0,1,2,3,4]); expect(peak).toBe(2);
  });
  it('drains late decodes before exposing failure for disposal',async()=>{
    const owned:number[]=[],closed:number[]=[];
    await expect(loadBounded([0,1,2],2,async n=>{
      if(n===0){await delay();throw new Error('decode failed');}
      await delay();await delay();owned.push(n);return n;
    })).rejects.toThrow('decode failed');
    closed.push(...owned);
    expect(closed).toEqual([1]); await delay();expect(owned).toEqual(closed);
  });
  it('never starts queued work after abort and handles already aborted signals',async()=>{
    const controller=new AbortController(),run=createTaskLimiter(1),called=vi.fn();
    const first=run(async()=>{controller.abort();await delay();return 1;});
    const second=run(async()=>called(),controller.signal);
    await expect(second).rejects.toMatchObject({name:'AbortError'});await first;expect(called).not.toHaveBeenCalled();
    await expect(loadBounded([1],2,async()=>called(),controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('bounds all external resource work through one queue',async()=>{
    const run=createTaskLimiter(3);let active=0,peak=0;
    await loadBounded([1,2],2,async()=>Promise.all(Array.from({length:8},()=>run(async()=>{active++;peak=Math.max(peak,active);await delay();active--;}))));
    expect(peak).toBe(3);
  });
  it('rejects incoherent or over-budget resource inventories',()=>{
    const resource={name:'visual-0.bin',bytes:10,sha256:'0'.repeat(64)};
    expect(validateMapResources([resource]).size).toBe(1);
    expect(()=>validateMapResources([resource,resource])).toThrow();
    expect(()=>validateMapResources([{...resource,name:'../foreign.bin'}])).toThrow();
    expect(()=>validateMapResources([resource],9)).toThrow('budget');
  });
  it('verifies exact bytes instead of reusing same-name stale resources',async()=>{
    const bytes=new TextEncoder().encode('abc').buffer;
    await expect(verifyMapDigest(bytes,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).resolves.toBeUndefined();
    await expect(verifyMapDigest(bytes,'0'.repeat(64))).rejects.toThrow('checksum mismatch');
  });
  it('validates packed-image ranges, complete inventory, names and byte budgets',()=>{
    const name='texture-'+'0'.repeat(24)+'.webp',other='texture-'+'1'.repeat(24)+'.webp';
    const resources=validateMapResources([{name,bytes:10,sha256:'0'.repeat(64)},{name:other,bytes:5,sha256:'1'.repeat(64)}]);
    const pack={name:'textures.bin',bytes:15,sha256:'2'.repeat(64),images:[{name,offset:0,length:10},{name:other,offset:10,length:5}]};
    expect(validateTexturePack(pack,resources)).toEqual(pack);expect(validateTexturePack(undefined,resources)).toBeUndefined();
    for(const invalid of [{...pack,name:'../other.bin'},{...pack,bytes:26*1024*1024},
      {...pack,images:[pack.images[0]]},{...pack,images:[pack.images[0],{...pack.images[1],offset:9}]},
      {...pack,images:[pack.images[0],{...pack.images[1],length:6}]},
      {...pack,images:[pack.images[0],{...pack.images[1],offset:Infinity}]}])expect(()=>validateTexturePack(invalid,resources)).toThrow();
  });
});
