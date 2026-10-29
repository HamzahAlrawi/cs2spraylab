import {describe, expect, it} from 'vitest';
import fixture from './native-flash-client-fixture.json';
import {nativeFlashClient, NATIVE_FLASH_CLIENT} from './grenade-flash-client';

describe('installed client flash compositor arithmetic', () => {
  it('pins current source identity independently of older server fixtures', () => {
    expect(fixture.source.build).toBe(NATIVE_FLASH_CLIENT.build);
    expect(fixture.source.sha256).toBe(NATIVE_FLASH_CLIENT.sha256);
    expect(fixture.source.helperRva).toBe(NATIVE_FLASH_CLIENT.helperRva);
    expect(fixture.constants.buildupSeconds).toBe(NATIVE_FLASH_CLIENT.buildupSeconds);
  });
  it.each(fixture.cases)('matches unmodified native helper case $id', row => {
    expect(nativeFlashClient(row.startTime, row.time, row.duration, row.maxAlpha, row.buildUp)).toEqual(row.expected);
  });
  it('does not turn a short rear-facing exposure into an opaque plateau', () => {
    expect(nativeFlashClient(10, 10, 1.07142854).overlayAlpha).toBeLessThan(.13);
    expect(nativeFlashClient(10, 10.5, 1.07142854).overlayAlpha).toBeLessThan(.04);
    expect(nativeFlashClient(10, 10, 5.35714293).overlayAlpha).toBe(1);
  });
});
