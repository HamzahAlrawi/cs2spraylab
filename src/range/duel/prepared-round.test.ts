import {describe,expect,it,vi} from 'vitest';
import {PreparedRound,decodedPreloadAllowed} from './prepared-round';

const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
describe('one prepared next round',()=>{
  it('can await readiness while the current scene retains ownership and remains playable',async()=>{
    const slot=new PreparedRound<{dispose():void}>(),pending=deferred<{dispose():void}>(),map={dispose:vi.fn()};
    slot.start('a',()=>pending.promise);let ready=false;
    const waited=slot.wait('a',new AbortController().signal).then(()=>{ready=true;});await Promise.resolve();
    expect(ready).toBe(false);pending.resolve(map);await waited;
    expect(slot.ready).toBe(true);expect(slot.key).toBe('a');expect(map.dispose).not.toHaveBeenCalled();
    expect(await slot.take('a',new AbortController().signal)).toBe(map);expect(slot.key).toBeUndefined();
  });
  it('aborts readiness waiting promptly and releases a late map exactly once',async()=>{
    const slot=new PreparedRound<{dispose():void}>(),pending=deferred<{dispose():void}>(),map={dispose:vi.fn()},controller=new AbortController();
    slot.start('a',()=>pending.promise);await Promise.resolve();
    const rejected=expect(slot.wait('a',controller.signal)).rejects.toMatchObject({name:'AbortError'});
    controller.abort();await rejected;expect(slot.key).toBeUndefined();pending.resolve(map);
    await new Promise(resolve=>setTimeout(resolve,0));expect(map.dispose).toHaveBeenCalledOnce();
    await expect(slot.wait('missing',new AbortController().signal)).rejects.toThrow('not prepared');
  });
  it('adopts a completed map without another load and transfers ownership',async()=>{
    const slot=new PreparedRound<{dispose():void}>(),map={dispose:vi.fn()},load=vi.fn(async()=>map);
    slot.start('mid',load);slot.start('mid',load);await Promise.resolve();await Promise.resolve();
    expect(await slot.take('mid',new AbortController().signal)).toBe(map);
    slot.cancel();expect(load).toHaveBeenCalledOnce();expect(map.dispose).not.toHaveBeenCalled();expect(slot.key).toBeUndefined();
  });
  it('waits for the same in-flight map rather than downloading it twice',async()=>{
    const slot=new PreparedRound<{dispose():void}>(),pending=deferred<{dispose():void}>(),map={dispose:vi.fn()};
    slot.start('a',()=>pending.promise);await Promise.resolve();
    const taken=slot.take('a',new AbortController().signal);pending.resolve(map);expect(await taken).toBe(map);
  });
  it('disposes late results from superseded settings and releases ready scenes once',async()=>{
    const slot=new PreparedRound<{dispose():void}>(),old=deferred<{dispose():void}>(),a={dispose:vi.fn()},b={dispose:vi.fn()};
    slot.start('a',()=>old.promise);await Promise.resolve();slot.start('b',async()=>b);old.resolve(a);
    await new Promise(resolve=>setTimeout(resolve,0));expect(a.dispose).toHaveBeenCalledOnce();expect(slot.ready).toBe(true);
    slot.cancel();slot.cancel();expect(b.dispose).toHaveBeenCalledOnce();
  });
  it('aborts preparation on a cancelled transition and cleans late resources',async()=>{
    const slot=new PreparedRound<{dispose():void}>(),pending=deferred<{dispose():void}>(),map={dispose:vi.fn()};let signal!:AbortSignal;
    slot.start('a',s=>{signal=s;return pending.promise;});await Promise.resolve();
    const controller=new AbortController(),take=slot.take('a',controller.signal),rejected=expect(take).rejects.toMatchObject({name:'AbortError'});
    controller.abort();expect(signal.aborted).toBe(true);pending.resolve(map);await rejected;expect(map.dispose).toHaveBeenCalledOnce();
  });
  it('does not retain a failed preparation or a map for the wrong key',async()=>{
    const slot=new PreparedRound<{dispose():void}>();slot.start('a',async()=>{throw new Error('offline');});
    await expect(slot.take('a',new AbortController().signal)).rejects.toThrow('offline');expect(slot.key).toBeUndefined();
    expect(await slot.take('b',new AbortController().signal)).toBeUndefined();
  });
  it('respects constrained memory and data-saving without disabling capable desktops',()=>{
    expect(decodedPreloadAllowed({deviceMemory:4})).toBe(false);expect(decodedPreloadAllowed({deviceMemory:8})).toBe(true);
    expect(decodedPreloadAllowed({})).toBe(false);expect(decodedPreloadAllowed({hardwareConcurrency:8})).toBe(true);
    expect(decodedPreloadAllowed({deviceMemory:8,connection:{saveData:true}})).toBe(false);
    expect(decodedPreloadAllowed({connection:{effectiveType:'2g'}})).toBe(false);
  });
});
