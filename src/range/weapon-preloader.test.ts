import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WeaponPreloader} from './weapon-preloader';

beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal('window', globalThis); vi.stubGlobal('requestIdleCallback', undefined);});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('idle carried weapon preparation', () => {
  it('deduplicates weapons and loads sequentially rather than decoding the entire loadout together', async () => {
    const preloader = new WeaponPreloader();
    let finish!: () => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;})).mockResolvedValue(undefined);
    preloader.start(['ak47', 'usp', 'usp', 'knife'], load, () => true);
    await vi.advanceTimersByTimeAsync(900);
    expect(load.mock.calls).toEqual([['ak47']]);
    finish(); await vi.advanceTimersByTimeAsync(600);
    expect(load.mock.calls).toEqual([['ak47'], ['usp'], ['knife']]);
    preloader.cancel();
  });
  it('does not begin a decode during training and resumes in the menu', async () => {
    const preloader = new WeaponPreloader(), load = vi.fn().mockResolvedValue(undefined);
    let available = false;
    preloader.start(['usp'], load, () => available);
    await vi.advanceTimersByTimeAsync(1200); expect(load).not.toHaveBeenCalled();
    available = true; await vi.advanceTimersByTimeAsync(300); expect(load).toHaveBeenCalledExactlyOnceWith('usp');
    preloader.cancel();
  });
  it('continues after an optional asset fails without unhandled rejection', async () => {
    const preloader = new WeaponPreloader(), load = vi.fn().mockRejectedValueOnce(new Error('missing')).mockResolvedValue(undefined);
    preloader.start(['usp', 'knife'], load, () => true);
    await vi.advanceTimersByTimeAsync(900); expect(load).toHaveBeenCalledTimes(2);
    preloader.cancel();
  });
  it('cancels old queues even when an old decode finishes after the new loadout starts', async () => {
    const preloader = new WeaponPreloader();
    let finish!: () => void;
    const old = vi.fn(() => new Promise<void>(resolve => {finish = resolve;})), next = vi.fn().mockResolvedValue(undefined);
    preloader.start(['ak47', 'usp'], old, () => true);
    await vi.advanceTimersByTimeAsync(300);
    preloader.start(['glock', 'knife'], next, () => true);
    finish(); await vi.advanceTimersByTimeAsync(600);
    expect(old).toHaveBeenCalledExactlyOnceWith('ak47');
    expect(next.mock.calls).toEqual([['glock'], ['knife']]);
    preloader.cancel(); await vi.advanceTimersByTimeAsync(900);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses and cancels browser idle callbacks where available', () => {
    const idle = vi.fn(() => 42), cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle); vi.stubGlobal('cancelIdleCallback', cancel);
    const preloader = new WeaponPreloader();
    preloader.start(['knife'], vi.fn(), () => true);
    expect(idle).toHaveBeenCalledOnce(); preloader.cancel();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42);
  });
});
