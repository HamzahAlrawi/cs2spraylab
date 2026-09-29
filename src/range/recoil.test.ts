import { describe, expect, it } from 'vitest';
import { nativeRecoilPattern, recoilTable, UniformRandomStream } from './recoil';
import fixture from './native-rng-fixture.json';
import tables from './native-table-fixture.json';
import provenance from './recoil-provenance.json';
import { gameData, weaponIds } from './config';
import {createHash} from 'node:crypto';

describe('installed CS2 recoil math', () => {
  it('pins freshly audited weapon data separately from the older native-math fixtures', () => {
    expect(gameData.build).toBe(provenance.weaponDataAudit.build);
    expect(createHash('sha256').update(JSON.stringify(gameData.weapons)).digest('hex')).toBe(provenance.weaponDataAudit.parametersSha256);
    expect(provenance.build).toBe('2000908');
    expect(provenance.weaponDataAudit.scope).toContain('NOT been re-emulated');
  });
  it('matches every float in independently emulated tier0 RNG fixtures', () => {
    for (const [seed, values] of Object.entries(fixture)) {
      const random = new UniformRandomStream(Number(seed));
      expect(values.map(() => random.float(-30, 30))).toEqual(values);
    }
  });
  it('applies suppression to retained magnitude before the next smoothing step', () => {
    const table = recoilTable({ ...gameData.weapons.ak47, recoilVariance: 0, recoilMagnitudeVariance: 0 });
    expect(table[0]).toEqual({ angle: 0, magnitude: 22.5 });
    expect(table[1].magnitude).toBeCloseTo((22.5 + (30 - 22.5) * .55) * .8125, 5);
  });
  it.each(weaponIds)('%s matches all 64 independently emulated native table entries', weapon => {
    expect(recoilTable(gameData.weapons[weapon])).toEqual(tables[weapon]);
  });
  it.each(weaponIds)('%s has a deterministic finite full-magazine angular profile', weapon => {
    const a = nativeRecoilPattern(gameData.weapons[weapon]);
    expect(a).toEqual(nativeRecoilPattern(gameData.weapons[weapon]));
    expect(a).toHaveLength(gameData.weapons[weapon].magazine);
    expect(a[0]).toEqual({ yaw: 0, pitch: 0 });
    expect(a.slice(1).every(p => Number.isFinite(p.yaw) && p.pitch > 0 && p.pitch < 45)).toBe(true);
  });
});
