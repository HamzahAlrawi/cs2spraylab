import {describe, expect, it} from 'vitest';
import fixture from './native-grenade-flash-fixture.json';
import {applyNativeFlash, nativeFlashArguments, NATIVE_GRENADE_FLASH, NATIVE_GRENADE_FLASH_SOURCE} from './grenade-native-flash';

describe('installed CS2 flash arithmetic', () => {
  it('pins build, source RVAs and extracted float32 constants without a runtime fixture import', () => {
    expect(NATIVE_GRENADE_FLASH_SOURCE).toEqual(fixture.source);
    expect(NATIVE_GRENADE_FLASH).toEqual(fixture.constants);
    expect(fixture.cases).toHaveLength(315);
  });
  it.each(fixture.cases)('matches native scalar case $id', sample => {
    const args = nativeFlashArguments(sample.distanceUnits, sample.dot, sample.visibility);
    expect(args).toEqual(sample.arguments);
    if (sample.state !== null) expect(applyNativeFlash(undefined, args.hold, args.fade, sample.time)).toEqual(sample.state);
  });
  it.each(fixture.overlaps)('matches native overlap $name', sample => {
    const before = {...sample.prior};
    expect(applyNativeFlash(sample.prior, sample.hold, sample.fade, sample.time)).toEqual(sample.state);
    expect(sample.prior).toEqual(before);
  });
  it('has a hard radial cutoff and skips zero visibility without clamping facing', () => {
    expect(nativeFlashArguments(3000, 1, 1)).toEqual({hold: 0, fade: 0, duration: 0});
    expect(nativeFlashArguments(100, 1, 0)).toEqual({hold: 0, fade: 0, duration: 0});
    expect(nativeFlashArguments(100, 1.0000001, 1)).toEqual(nativeFlashArguments(100, 1, 1));
  });
  it('rejects invalid arithmetic inputs without mutating state', () => {
    for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      expect(() => nativeFlashArguments(value, 0, 1)).toThrow(RangeError);
      expect(() => applyNativeFlash(undefined, 1, 1, value)).toThrow(RangeError);
    }
    expect(() => nativeFlashArguments(-1, 0, 1)).toThrow(RangeError);
    expect(() => nativeFlashArguments(1, 0, 1.1)).toThrow(RangeError);
    expect(() => applyNativeFlash(undefined, -1, 1, 0)).toThrow(RangeError);
  });
});
