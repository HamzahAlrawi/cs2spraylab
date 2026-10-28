import {afterEach, describe, expect, it, vi} from 'vitest';
import {WarmBitmapCache,SharedBitmapCache} from './bitmap-cache';
import {createTaskLimiter} from './map-loading';
afterEach(() => vi.useRealTimers());
describe('bounded warm bitmap ownership', () => {
  it('never closes an image after ownership has transferred to an active map', () => {
    vi.useFakeTimers(); const cache = new WarmBitmapCache(100, 1000);
    const image = {width: 5, height: 5, close: vi.fn()};
    cache.retire('hash', image); expect(cache.take('hash')).toBe(image);
    vi.advanceTimersByTime(2000); expect(image.close).not.toHaveBeenCalled(); expect(cache.retainedBytes).toBe(0);
    cache.retire('hash', image); vi.advanceTimersByTime(1002); expect(image.close).toHaveBeenCalledTimes(1);
    cache.clear();
  });
  it('evicts idle images within the pixel budget and keys reuse by content hash', () => {
    vi.useFakeTimers(); const cache = new WarmBitmapCache(100, 1000);
    const first = {width: 5, height: 5, close: vi.fn()}, next = {width: 5, height: 5, close: vi.fn()};
    cache.retire('old-content', first); cache.retire('new-content', next);
    expect(first.close).toHaveBeenCalledTimes(1); expect(cache.retainedBytes).toBe(100);
    expect(cache.take('old-content')).toBeUndefined(); expect(cache.take('new-content')).toBe(next);
    cache.retire('new-content', next); cache.clear(); expect(next.close).toHaveBeenCalledTimes(1);
  });
});

describe('shared live bitmap ownership',()=>{
  it('decodes once across simultaneous maps and closes only after the last lease expires',async()=>{
    vi.useFakeTimers();const cache=new SharedBitmapCache(100,1000),image={width:5,height:5,close:vi.fn()};
    const decode=vi.fn(async()=>image),first=cache.acquire('hash',decode),second=cache.acquire('hash',decode);
    expect(await first.value).toBe(await second.value);expect(decode).toHaveBeenCalledOnce();expect(second.reused).toBe(true);
    first.release();await Promise.resolve();vi.advanceTimersByTime(2000);expect(image.close).not.toHaveBeenCalled();
    second.release();await Promise.resolve();expect(cache.retainedBytes).toBe(100);
    vi.advanceTimersByTime(1002);expect(image.close).toHaveBeenCalledOnce();cache.clear();
  });
  it('keeps a shared in-flight source alive and recovers from decode failure',async()=>{
    vi.useFakeTimers();const cache=new SharedBitmapCache(100,1000),image={width:5,height:5,close:vi.fn()};
    let resolve!:(value:typeof image)=>void;
    const first=cache.acquire('pending',()=>new Promise<typeof image>(done=>resolve=done));
    await Promise.resolve();
    const second=cache.acquire('pending',async()=>{throw Error('must share');});first.release();resolve(image);
    await second.value;await Promise.resolve();vi.advanceTimersByTime(2000);expect(image.close).not.toHaveBeenCalled();
    second.release();await Promise.resolve();cache.clear();expect(image.close).toHaveBeenCalledOnce();
    const failed=cache.acquire('failed',async()=>{throw Error('decode');});await expect(failed.value).rejects.toThrow('decode');failed.release();
    const retry=cache.acquire('failed',async()=>image);expect(await retry.value).toBe(image);retry.release();await Promise.resolve();cache.clear();
  });
  it('cancels queued decodes with no consumers without poisoning a new lease',async()=>{
    const cache=new SharedBitmapCache(100,1000),run=createTaskLimiter(1);
    let unblock!:()=>void;
    const blocking=run(()=>new Promise<void>(done=>unblock=done));await Promise.resolve();
    const stale=vi.fn(async()=>({width:5,height:5,close:vi.fn()}));
    const first=cache.acquire('pending',signal=>run(stale,signal));await Promise.resolve();first.release();
    const image={width:5,height:5,close:vi.fn()},fresh=vi.fn(async()=>image);
    const second=cache.acquire('pending',signal=>run(fresh,signal));
    const cancelled=expect(first.value).rejects.toMatchObject({name:'AbortError'});
    unblock();await blocking;await cancelled;expect(await second.value).toBe(image);
    expect(stale).not.toHaveBeenCalled();expect(fresh).toHaveBeenCalledOnce();expect(image.close).not.toHaveBeenCalled();
    second.release();await Promise.resolve();cache.clear();expect(image.close).toHaveBeenCalledOnce();
  });
  it('closes a late uncancellable decode after its last consumer leaves',async()=>{
    const cache=new SharedBitmapCache(100,1000),image={width:5,height:5,close:vi.fn()};
    let resolve!:(value:typeof image)=>void;
    const lease=cache.acquire('late',()=>new Promise<typeof image>(done=>resolve=done));await Promise.resolve();
    const cancelled=expect(lease.value).rejects.toMatchObject({name:'AbortError'});
    lease.release();resolve(image);await cancelled;expect(image.close).toHaveBeenCalledOnce();expect(cache.retainedBytes).toBe(0);
    cache.clear();
  });
});
