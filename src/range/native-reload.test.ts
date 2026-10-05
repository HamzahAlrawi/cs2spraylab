import {describe, expect, it} from 'vitest';
import {equipmentStats, SHELL_RELOAD_START, SHELL_RELOAD_FINISH} from './equipment';
import {NativeReloadState} from './weapon-actions';

describe('reserve-aware reload phases', () => {
  it('inserts only the missing ammunition, at completion, preserving the old partial magazine', () => {
    const reload = new NativeReloadState('ak47'); reload.ammo = 11; reload.reserve = 9;
    expect(reload.start(10)).toBe(true);
    reload.advance(10 + reload.stats.reload - .001); expect(reload.ammo).toBe(11);
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
    reload.advance(reload.until - .001, true); expect(reload.ammo).toBe(0);
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
});
