import {describe, expect, it} from 'vitest';
import {GrenadePointerInput} from './grenade-pointer-input';

describe('mouse chords for grenade throws', () => {
  it.each([[1, 3, 2, 0], [2, 3, 1, 0]])('retains both buttons until their actual release: %j', (...buttons) => {
    const input = new GrenadePointerInput();
    const samples = buttons.map(value => input.update({buttons: value}));
    expect(samples[1]).toMatchObject({fireHeld: true, secondaryHeld: true});
    expect(samples[2]!.fireHeld || samples[2]!.secondaryHeld).toBe(true);
    expect(samples[3]).toEqual({fireHeld: false, secondaryHeld: false});
  });
  it('deduplicates compatibility events and clears focus loss without emitting a throw', () => {
    const input = new GrenadePointerInput();
    expect(input.update({buttons: 2})).toEqual({fireHeld: false, secondaryHeld: true, secondaryPressed: true});
    expect(input.update({buttons: 2})).toBeUndefined();
    input.reset();
    expect(input.update({buttons: 0})).toBeUndefined();
    expect(input.update({buttons: 1, pointerType: 'touch'})).toBeUndefined();
  });
});
