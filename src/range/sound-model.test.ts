import {describe, expect, it} from 'vitest';
import {equipmentIds} from './equipment';
import soundEvents from './sound-events-data.json';
import {curveGain, gunshotGain, gunshotRange} from './sound-model';

describe('native weapon hearing metadata', () => {
  it('covers every equipped weapon with ordered, finite native curve knots', () => {
    expect(Object.keys(soundEvents.weapons).sort()).toEqual([...equipmentIds].sort());
    expect(soundEvents.build).toBe('2000922');
    for (const equipment of equipmentIds) {
      const event = soundEvents.weapons[equipment];
      expect(event.source).toMatch(/^Weapon_/);
      expect(event.volume).toBeGreaterThan(0);
      expect(event.distanceCurve.length).toBeGreaterThan(1);
      event.distanceCurve.forEach(([units, gain], index) => {
        expect(Number.isFinite(units) && Number.isFinite(gain)).toBe(true);
        expect(units).toBeGreaterThanOrEqual(0);
        expect(gain).toBeGreaterThanOrEqual(0);
        if (index) expect(units).toBeGreaterThan(event.distanceCurve[index - 1][0]);
        expect(gunshotGain(equipment, units * .0254)).toBeCloseTo(event.volume * gain, 8);
      });
      expect(gunshotGain(equipment, gunshotRange(equipment) + .01)).toBe(0);
    }
  });

  it('converts metres into native units and interpolates between adjacent knots', () => {
    const event = soundEvents.weapons.ak47;
    const [a, b] = event.distanceCurve.slice(3, 5);
    const units = (a[0] + b[0]) / 2;
    expect(curveGain(units, event.distanceCurve)).toBeCloseTo((a[1] + b[1]) / 2, 8);
    expect(gunshotGain('ak47', units * .0254)).toBeCloseTo(event.volume * (a[1] + b[1]) / 2, 8);
  });

  it('does not assign unsuppressed rifle range to a suppressed weapon', () => {
    expect(gunshotRange('ak47')).toBeCloseTo(2500 * .0254, 8);
    expect(gunshotRange('m4a1s')).toBeLessThan(gunshotRange('ak47'));
    expect(gunshotGain('m4a1s', 40)).toBe(0);
    expect(gunshotGain('ak47', 40)).toBeGreaterThan(.1);
  });
});
