import {describe, expect, it} from 'vitest';
import {equipmentStats, SHELL_RELOAD_START, SHELL_RELOAD_FINISH} from './equipment';
import {NativeReloadState} from './weapon-actions';
import {nativeReloadTiming} from './native-view-actions';
import timingEvidence from './native-reload-timing.json';
import type {Equipment} from './equipment';

describe('reserve-aware reload phases', () => {
  it('commits only the missing ammunition at the native marker, then waits for attack readiness', () => {
    const reload = new NativeReloadState('ak47'); reload.ammo = 11; reload.reserve = 9;
    expect(reload.start(10)).toBe(true);
    expect(reload.ammoCommitAt).toBeCloseTo(11.1);
    reload.advance(11.099); expect(reload.ammo).toBe(11);
    reload.advance(11.1); expect(reload.ammo).toBe(20); expect(reload.reserve).toBe(0);
    expect(reload.active).toBe(true); expect(reload.ammoCommitted).toBe(true);
    expect(reload.start(11.2)).toBe(false);
    reload.advance(10 + reload.stats.reload); expect(reload.ammo).toBe(20); expect(reload.reserve).toBe(0);
    expect(reload.active).toBe(false); expect(reload.start(20)).toBe(false);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-end']);
    expect(reload.drainActionEvents()).toEqual([]);
  });
  it('cancels magazine reloads without minting or losing ammo', () => {
    const reload = new NativeReloadState('mag7'); reload.ammo = 2;
    reload.start(0); reload.advance(1); reload.cancel(); reload.advance(100);
    expect(reload.ammo).toBe(2); expect(reload.reserve).toBe(15);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-cancel']);
  });
  it('accounts for hold-R changes using elapsed work, not a new shortened deadline', () => {
    const reload = new NativeReloadState('ak47'); reload.ammo = 0;
    reload.start(0, true); expect(reload.until).toBeCloseTo(reload.stats.reload * 2);
    reload.advance(1, false); expect(reload.until).toBeCloseTo(1 + reload.stats.reload - .5);
    reload.advance(1.5, true); expect(reload.until).toBeCloseTo(1.5 + (reload.stats.reload - 1) * 2);
    const commitAt = reload.ammoCommitAt;
    reload.advance(commitAt - .001, true); expect(reload.ammo).toBe(0);
    reload.advance(commitAt, true); expect(reload.ammo).toBe(30); expect(reload.active).toBe(true);
    reload.advance(reload.until - .001, true); expect(reload.active).toBe(true);
    reload.advance(reload.until, true); expect(reload.ammo).toBe(30); expect(reload.reserve).toBe(60);
  });
  it.each(['nova', 'xm1014', 'sawedoff'] as const)('%s inserts shells individually and finishes after interruption', id => {
    const reload = new NativeReloadState(id); reload.ammo = 0;
    reload.start(0); expect(reload.interrupt()).toBe(false);
    reload.advance(SHELL_RELOAD_START); expect(reload.phase).toBe('shell'); expect(reload.ammo).toBe(0);
    const insertedAt = SHELL_RELOAD_START + equipmentStats(id).reload;
    reload.advance(insertedAt); expect(reload.ammo).toBe(1); expect(reload.reserve).toBe(31);
    expect(reload.interrupt()).toBe(true); expect(reload.phase).toBe('finish');
    reload.advance(insertedAt + SHELL_RELOAD_FINISH); expect(reload.active).toBe(false);
    reload.advance(100); expect(reload.ammo).toBe(1); expect(reload.reserve).toBe(31);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-shell', 'reload-end']);
  });
  it('preserves loaded shells on holster and processes a whole reload across a long step', () => {
    const reload = new NativeReloadState('nova'); reload.ammo = 3;
    reload.start(0); reload.advance(SHELL_RELOAD_START + reload.stats.reload); reload.cancel();
    expect(reload.ammo).toBe(4); expect(reload.reserve).toBe(31);
    reload.start(10); reload.advance(100); expect(reload.ammo).toBe(8); expect(reload.reserve).toBe(27);
  });
  it('does not create reloads for full guns, knives, Zeus or exhausted reserves', () => {
    for (const id of ['ak47', 'knife', 'zeus'] as const) expect(new NativeReloadState(id).start(0)).toBe(false);
    const empty = new NativeReloadState('nova'); empty.ammo = 0; empty.reserve = 0;
    expect(empty.start(0)).toBe(false);
  });
  it('does not restart the finish timer on repeated trigger interruptions', () => {
    const reload = new NativeReloadState('nova'); reload.ammo = 1; reload.start(0); reload.interrupt();
    reload.advance(.1); reload.interrupt(); expect(reload.until).toBeCloseTo(SHELL_RELOAD_FINISH);
    reload.advance(SHELL_RELOAD_FINISH); expect(reload.active).toBe(false); expect(reload.ammo).toBe(1);
  });
  it('keeps the completion event silent flag from the interval that completed it', () => {
    const reload = new NativeReloadState('mag7'); reload.ammo = 0; reload.start(0, true);
    reload.advance(reload.until, false);
    const events = reload.drainActionEvents();
    expect(events[events.length - 1]).toMatchObject({kind: 'reload-end', silent: true});
    expect(reload.silent).toBe(false);
  });
  it('rejects invalid silent speed coefficients', () => {
    for (const speed of [0, .5, Infinity, NaN]) expect(() => new NativeReloadState('nova', speed)).toThrow();
  });

  it.each([false, true])('AK-47 holster before/after commit preserves only completed ammunition (empty=%s)', empty => {
    for (const at of [1.1 - 1e-6, 1.1, 1.1 + 1e-6]) {
      const reload = new NativeReloadState('ak47'); reload.ammo = empty ? 0 : 11;
      const total = reload.ammo + reload.reserve;
      reload.start(0); reload.advance(at);
      const committed = at >= 1.1, ammo = committed ? 30 : empty ? 0 : 11;
      reload.cancel();
      expect(reload.active).toBe(false); expect(reload.until).toBe(0);
      expect(reload.ammo).toBe(ammo); expect(reload.ammo + reload.reserve).toBe(total);
      expect(reload.fireReadyAt).toBeCloseTo(committed ? reload.stats.reload : 0);
      reload.advance(100); expect(reload.ammo).toBe(ammo);
      expect(reload.drainActionEvents().map(event => event.kind)).toEqual(['reload-start', 'reload-cancel']);
    }
  });

  it('retains the same AK attack floor when waiting or holstering a committed reload', () => {
    const waiting = new NativeReloadState('ak47'), switched = new NativeReloadState('ak47');
    for (const reload of [waiting, switched]) {reload.ammo = 0; reload.start(10); reload.advance(11.1);}
    switched.cancel();
    expect(switched.ammo).toBe(waiting.ammo);
    expect(switched.fireReadyAt).toBeCloseTo(waiting.fireReadyAt);
    // Deploy is a separate caller gate; quick-switching must not erase this floor.
    expect(Math.max(11.1 + switched.stats.deploy, switched.fireReadyAt)).toBeCloseTo(waiting.until);
    waiting.advance(100);
    expect(waiting.fireReadyAt).toBeCloseTo(switched.fireReadyAt);
    const events = waiting.drainActionEvents();
    expect(events[events.length - 1].at).toBeCloseTo(10 + waiting.stats.reload);
  });

  it.each(Object.entries(timingEvidence.weapons).filter(([, weapon]) => !weapon.singleShells).map(([id]) => id as Equipment))(
    '%s keeps tactical and empty commit/end/gate clocks separate', id => {
      for (const empty of [false, true]) {
        const timing = nativeReloadTiming(id, empty)!;
        const reload = new NativeReloadState(id); reload.ammo = empty ? 0 : 1;
        const before = reload.ammo, total = reload.ammo + reload.reserve;
        reload.start(5);
        expect(reload.until).toBeCloseTo(5 + timing.attackLock);
        expect(reload.ammoCommitAt).toBeCloseTo(5 + timing.ammoAt);
        reload.advance(5 + timing.ammoAt - 1e-6); expect(reload.ammo).toBe(before);
        reload.advance(5 + timing.ammoAt); expect(reload.ammo).toBe(reload.stats.magazine);
        expect(reload.ammo + reload.reserve).toBe(total); expect(reload.active).toBe(true);
        reload.advance(5 + timing.attackLock - 1e-6); expect(reload.active).toBe(true);
        reload.advance(5 + timing.attackLock); expect(reload.active).toBe(false);
        expect(reload.ammo + reload.reserve).toBe(total);
      }
    });

  it('does not reinsert ammo or extend deadlines after a coarse update, backwards time, or repeated cancel', () => {
    const reload = new NativeReloadState('ak47'); reload.ammo = 11; reload.reserve = 9;
    reload.start(10); reload.advance(100); reload.advance(50); reload.cancel(); reload.cancel();
    expect(reload.ammo).toBe(20); expect(reload.reserve).toBe(0);
    expect(reload.fireReadyAt).toBeCloseTo(10 + reload.stats.reload);
    expect(reload.drainActionEvents().map(event => event.kind)).toEqual(['reload-start', 'reload-end']);
  });

  it('keeps committed ammo and the last prospective silent deadline after cancellation', () => {
    const reload = new NativeReloadState('ak47'); reload.ammo = 0;
    reload.start(0, true); reload.advance(2, false); expect(reload.ammo).toBe(0);
    expect(reload.ammoCommitAt).toBeCloseTo(2.1);
    reload.advance(2.1, true); expect(reload.ammo).toBe(30);
    const ready = reload.until; reload.cancel(); reload.advance(100);
    expect(reload.fireReadyAt).toBeCloseTo(ready); expect(reload.reserve).toBe(60);
  });
});
