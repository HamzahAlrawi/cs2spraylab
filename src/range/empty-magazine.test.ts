import {describe, expect, it} from 'vitest';
import {shouldAutoReloadEmptyMagazine, type EmptyMagazineState} from './empty-magazine';

const idle = (extra: Partial<EmptyMagazineState> = {}): EmptyMagazineState => ({
  equipment: 'ak47', ammo: 0, reserve: 90, active: true, reloading: false,
  attackHeld: false, readyAt: 1, ...extra,
});

describe('shared empty-magazine idle policy', () => {
  it('starts at readiness, without inventing an extra idle timer', () => {
    expect(shouldAutoReloadEmptyMagazine(1 - 1e-6, idle())).toBe(false);
    expect(shouldAutoReloadEmptyMagazine(1, idle())).toBe(true);
    expect(shouldAutoReloadEmptyMagazine(50, idle())).toBe(true);
  });
  it('does not require an earlier empty trigger attempt', () => {
    expect(shouldAutoReloadEmptyMagazine(0, idle({readyAt: 0}))).toBe(true);
  });
  it.each<Partial<EmptyMagazineState>>([
    {attackHeld: true}, {secondaryHeld: true}, {burstPending: true},
    {reloading: true}, {active: false}, {equipment: 'knife'}, {equipment: 'zeus'},
    {ammo: 1}, {ammo: -1}, {ammo: NaN}, {reserve: 0}, {reserve: -1},
    {reserve: NaN}, {reserve: Infinity}, {readyAt: NaN}, {readyAt: Infinity},
  ])('does not start for a blocked/invalid state: %j', extra => {
    expect(shouldAutoReloadEmptyMagazine(5, idle(extra))).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])('rejects a non-finite clock: %s', time => {
    expect(shouldAutoReloadEmptyMagazine(time, idle())).toBe(false);
  });
  it('is stateless: release is eligible immediately if existing gates are satisfied', () => {
    const state = idle({attackHeld: true});
    expect(shouldAutoReloadEmptyMagazine(5, state)).toBe(false);
    state.attackHeld = false;
    expect(shouldAutoReloadEmptyMagazine(5, state)).toBe(true);
    expect(state).toEqual(idle());
  });
});
