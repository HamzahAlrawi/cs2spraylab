import {expect, it} from 'vitest';
import {NativeReloadState} from './weapon-actions';

it.each(['ak47','usp','nova','xm1014'] as const)('%s keeps normal reload gates with unlimited practice reserves', id => {
  const state = new NativeReloadState(id); state.infiniteReserve = true;
  const reserve = state.reserve;
  let time = 0;
  for (let magazine = 0; magazine < 20; magazine++) {
    state.ammo = 0;
    expect(state.start(time)).toBe(true);
    expect(state.ammo).toBe(0); expect(state.active).toBe(true);
    state.advance(time + .01); expect(state.ammo).toBe(0);
    time += 60; state.advance(time);
    expect(state.ammo).toBe(state.stats.magazine);
    expect(state.reserve).toBe(reserve); expect(state.active).toBe(false);
  }
});
it('finite Duel reserves remain consumed normally and empty stocks cannot reload', () => {
  const state = new NativeReloadState('ak47'); state.ammo = 0;
  const reserve = state.reserve; state.start(0); state.advance(10);
  expect(state.reserve).toBe(reserve - state.stats.magazine);
  state.reserve = 0; state.ammo = 0; expect(state.start(11)).toBe(false);
});
