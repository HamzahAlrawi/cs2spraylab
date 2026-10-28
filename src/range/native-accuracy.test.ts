import {describe, expect, it} from 'vitest';
import fixture from './native-accuracy-fixture.json';
import {movementInaccuracy, recoveryTime, WeaponRecovery} from './ballistics';
import data from './game-data.json';

const weapon = (id: string) => data.weapons[id as keyof typeof data.weapons];

// These expectations come from hash-pinned machine instructions, not runtime formulas.
// Imports/owner lookups and full engine firing state are explicitly excluded by the fixture.
describe('Build 2000930 isolated native accuracy arithmetic', () => {
  it('compares current archive fields independently of the older export build label', () => {
    expect(fixture.weaponStatAudit.installedBuild).toBe('2000930');
    expect(fixture.weaponStatAudit.comparisons).toBe(2030);
    expect(fixture.weaponStatAudit.weaponCount).toBe(35);
    expect(fixture.weaponStatAudit.differences).toEqual([]);
    expect(fixture.clientSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.limitations).toContain('Penalty baseline is supplied, not captured from the complete native entity state machine.');
  });

  it.each(fixture.movement)('$weapon movement ratio=$speedRatio walking=$walking', sample => {
    const actual = movementInaccuracy(weapon(sample.weapon), sample.speedRatio, sample.walking);
    // Float32 speed*cap/remap is sensitive at the lower boundary of the fourth-root curve.
    expect(actual).toBeCloseTo(sample.result, 5);
  });

  it.each(fixture.recoveryTime)('$weapon recovery index=$index crouch=$crouch airborne=$airborne', sample => {
    expect(recoveryTime(weapon(sample.weapon), sample.index, sample.crouch, sample.airborne)).toBeCloseTo(sample.result, 6);
  });

  it.each(fixture.penalty)('$weapon penalty before=$before crouch=$crouch airborne=$airborne', sample => {
    const state = new WeaponRecovery(weapon(sample.weapon));
    state.index = sample.index;
    state.penalty = sample.before;
    state.advance(sample.dt, sample.crouch, sample.airborne);
    expect(state.penalty).toBeCloseTo(sample.result, 7);
  });

  it.each(fixture.penalty)('$weapon two 128 Hz steps vs one native 64 Hz step before=$before crouch=$crouch airborne=$airborne', sample => {
    const state = new WeaponRecovery(weapon(sample.weapon));
    state.index = sample.index;
    state.penalty = sample.before;
    state.advance(sample.dt / 2, sample.crouch, sample.airborne);
    state.advance(sample.dt / 2, sample.crouch, sample.airborne);
    expect(state.penalty).toBeCloseTo(sample.result, 7);
  });

  it.each(fixture.firing)('$weapon firing penalty before=$before', sample => {
    const state = new WeaponRecovery(weapon(sample.weapon));
    state.penalty = sample.before;
    state.fire();
    expect(state.penalty).toBeCloseTo(sample.result, 7);
  });
});
