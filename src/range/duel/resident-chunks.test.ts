import {describe,expect,it,vi} from 'vitest';
import {ResidentChunks} from './resident-chunks';
describe('bounded recent decoded chunks',()=>{
  const chunk=()=>({dispose:vi.fn()});
  it('transfers ownership on take and evicts only the least recent idle resource',()=>{
    const pool=new ResidentChunks<ReturnType<typeof chunk>>(2,100),a=chunk(),b=chunk(),c=chunk();
    pool.retire('a',a,30);pool.retire('b',b,30);
    expect(pool.take('a')).toBe(a);expect(pool.has('a')).toBe(false);pool.retire('a',a,30);
    pool.retire('c',c,30);expect(b.dispose).toHaveBeenCalledOnce();expect(a.dispose).not.toHaveBeenCalled();
    expect(pool.take('c')).toBe(c);pool.clear();pool.clear();
    expect(a.dispose).toHaveBeenCalledOnce();expect(c.dispose).not.toHaveBeenCalled();
  });
  it('enforces memory as well as entry limits and disposes unsupported resources',()=>{
    const pool=new ResidentChunks<ReturnType<typeof chunk>>(5,100),a=chunk(),b=chunk(),large=chunk();
    pool.retire('a',a,70);pool.retire('b',b,60);expect(a.dispose).toHaveBeenCalledOnce();
    pool.retire('large',large,101);expect(large.dispose).toHaveBeenCalledOnce();
    expect(pool.has('b')).toBe(true);pool.clear();expect(b.dispose).toHaveBeenCalledOnce();
    const small=chunk();new ResidentChunks(0,100).retire('off',small,1);expect(small.dispose).toHaveBeenCalledOnce();
  });
});
