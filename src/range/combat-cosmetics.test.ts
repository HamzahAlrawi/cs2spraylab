import {describe, expect, it} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import data from './cosmetics-data.json';
import audit from '../../docs/weapon-cosmetics-inventory.json';
import {gameData} from './config';

describe('new native weapon finish imports', () => {
  it('pins the installed build and authored item catalog', () => {
    expect(audit.build).toBe(gameData.build); expect(data.build).toBe(gameData.build);
    expect(audit.itemsSha256).toBe(data.itemsSha256);
  });
  it.each(['nova', 'xm1014', 'mag7', 'sawedoff', 'zeus'] as const)('%s has real distinct supported native pairings and matching asset files', id => {
    const native = audit.weapons[id], finishes = data.cosmetics.filter(item => item.equipment === id);
    expect(native.exported).toBe(id === 'zeus' ? 7 : 10); expect(finishes).toHaveLength(native.exported);
    expect(native.minimumExpected).toBe(native.exported);
    expect(new Set(native.finishes.map(item => item.kitId)).size).toBe(native.exported);
    expect(new Set(native.finishes.map(item => item.imageSha256)).size).toBe(native.exported);
    for (const finish of finishes) {
      const source = native.finishes.find(item => item.id === finish.id)!;
      expect(source).toBeDefined(); expect(source.kitId).toBe(finish.kitId);
      expect(source.imageSource).toBe(`panorama/images/econ/default_generated/weapon_${id === 'zeus' ? 'taser' : id}_${source.kitName}_light_png.vtex_c`);
      expect(source.materialSha256).toBe(finish.sourceSha256);
      expect(finish.colors).toBeDefined();
      expect(finish.colors?.every(color => color.length >= 3 && color.slice(0,3).every(Number.isFinite))).toBe(true);
      const preview = readFileSync(`public/revamp${finish.imageUrl}`);
      expect(createHash('sha256').update(preview).digest('hex')).toBe(source.imageSha256);
      expect(preview.length).toBeGreaterThan(1000);
      expect(existsSync(`public/revamp/models/${finish.assetKey}.glb`)).toBe(true);
      if (finish.map) expect(existsSync(`public/revamp${finish.map}`)).toBe(true);
    }
  });
  it('documents the Zeus-only native availability limit without weakening other guns', () => {
    expect(audit.weapons.zeus.nativeAvailable).toBe(7); expect(audit.weapons.zeus.limitation).toContain('no fabricated finishes');
    for (const id of ['nova', 'xm1014', 'mag7', 'sawedoff'] as const) {
      expect(audit.weapons[id].nativeAvailable).toBeGreaterThanOrEqual(10); expect(audit.weapons[id].limitation).toBeNull();
    }
  });
});
