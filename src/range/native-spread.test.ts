import {describe, expect, it} from 'vitest';
import fixture from './native-spread-fixture.json';
import {sampleShotSpread} from './shot-model';

describe('build-2000930 independently emulated spread sampler', () => {
  it.each(fixture.cases)('$weaponId alternate=$alternateFire index=$recoilIndex, cone=$inaccuracy', sample => {
    let draw = 0;
    const actual = sampleShotSpread(sample, () => sample.random[draw++]);
    expect(draw).toBe(4);
    // Native import stubs and JavaScript use different trigonometric runtimes.
    expect(Math.abs(actual.horizontal - sample.horizontal)).toBeLessThan(2e-8);
    expect(Math.abs(actual.vertical - sample.vertical)).toBeLessThan(2e-8);
  });
});
