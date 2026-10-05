import { describe, expect, it } from 'vitest';
import { nativeRecoilPattern, recoilTable, shotgunSpreadTable, sourceRandom, UniformRandomStream } from './recoil';
import fixture from './native-rng-fixture.json';
import tables from './native-table-fixture.json';
import alternateTables from './native-alternate-table-fixture.json';
import shotgunTables from './native-shotgun-table-fixture.json';
import {weaponModeStats} from './equipment';
import provenance from './recoil-provenance.json';
import { gameData, weaponIds, shotgunIds } from './config';
import {createHash} from 'node:crypto';

describe('installed CS2 recoil math', () => {
  it('pins current weapon data and recoil tables separately from the older full-math audit', () => {
    expect(gameData.build).toBe(provenance.weaponDataAudit.build);
    expect(createHash('sha256').update(JSON.stringify(gameData.weapons)).digest('hex')).toBe(provenance.weaponDataAudit.parametersSha256);
    expect(provenance.build).toBe('2000908');
    expect(provenance.tableAudit.build).toBe(gameData.build);
    expect(provenance.tableAudit.clientSha256).toBe(provenance.weaponDataAudit.clientSha256);
  });
  it('matches every float in independently emulated tier0 RNG fixtures', () => {
    for (const [seed, values] of Object.entries(fixture)) {
      const random = new UniformRandomStream(Number(seed));
      expect(values.map(() => random.float(-30, 30))).toEqual(values);
    }
  });
  it('has independently emulated primary and alternate fixtures for every imported weapon, not just legacy IDs', () => {
    expect(Object.keys(tables).sort()).toEqual(Object.keys(gameData.weapons).sort());
    expect(Object.keys(alternateTables).sort()).toEqual(Object.keys(gameData.weapons).sort());
    expect(Object.keys(shotgunTables).sort()).toEqual([...shotgunIds].sort());
  });
  it('supports reproducible Source RNG closures without global state', () => {
    const a = sourceRandom(223), b = sourceRandom(223), other = sourceRandom(224);
    expect(Array.from({length: 32}, a)).toEqual(Array.from({length: 32}, b));
    expect(other()).not.toBe(sourceRandom(223)());
    expect(() => sourceRandom(NaN)).toThrow(RangeError);
    expect(() => sourceRandom(1.5)).toThrow(RangeError);
    expect(() => sourceRandom(2147483648)).toThrow(RangeError);
    expect(() => sourceRandom(-2147483648)).toThrow(RangeError);
    expect(() => shotgunSpreadTable(NaN, 9)).toThrow(RangeError);
  });
  it.each(shotgunIds)('%s matches all 64 native angle/radius shotgun table entries', id => {
    const weapon = gameData.weapons[id];
    expect(shotgunSpreadTable(weapon.spreadSeed, weapon.pellets)).toEqual(shotgunTables[id]);
  });
  it('applies suppression to retained magnitude before the next smoothing step', () => {
    const table = recoilTable({ ...gameData.weapons.ak47, recoilVariance: 0, recoilMagnitudeVariance: 0 });
    expect(table[0]).toEqual({ angle: 0, magnitude: 22.5 });
    expect(table[1].magnitude).toBeCloseTo((22.5 + (30 - 22.5) * .55) * .8125, 5);
  });
  it('keeps the extracted Zeus table zero rather than borrowing a firearm profile', () => {
    const table = recoilTable(gameData.weapons.zeus);
    expect(table.every(p => p.angle === 0 && p.magnitude === 0)).toBe(true);
    expect(table).toEqual(tables.zeus);
    expect(table).toEqual(alternateTables.zeus);
  });
  it.each(weaponIds)('%s matches all 64 independently emulated native table entries', weapon => {
    expect(recoilTable(gameData.weapons[weapon])).toEqual(tables[weapon]);
  });
  it.each(weaponIds)('%s alternate mode matches all 64 offline native table entries', weapon => {
    expect(recoilTable(weaponModeStats(weapon, true))).toEqual(alternateTables[weapon]);
  });
  it.each(weaponIds)('%s has a deterministic finite full-magazine angular profile', weapon => {
    const a = nativeRecoilPattern(gameData.weapons[weapon]);
    expect(a).toEqual(nativeRecoilPattern(gameData.weapons[weapon]));
    expect(a).toHaveLength(gameData.weapons[weapon].magazine);
    expect(a[0]).toEqual({ yaw: 0, pitch: 0 });
    expect(a.slice(1).every(p => Number.isFinite(p.yaw) && p.pitch > 0 && p.pitch < 45)).toBe(true);
  });
});
