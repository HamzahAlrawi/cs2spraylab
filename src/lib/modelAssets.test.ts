import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { weapons } from '../data/weapons';
import { getWeaponModelUrl, parseWeaponModelAsset } from './modelAssets';

describe('3D model asset loader', () => {
  it('maps each weapon to a static Cloudflare-friendly fallback JSON asset', () => {
    for (const weapon of weapons) {
      const url = getWeaponModelUrl(weapon.id);
      expect(url).toMatch(/^\/models\/(ak47|galil|m4a4|m4a1s|famas|mp9|mac10)\.json$/);
      const raw = readFileSync(resolve(process.cwd(), `public${url}`), 'utf8');
      const asset = parseWeaponModelAsset(JSON.parse(raw));
      expect(asset.parts.length).toBeGreaterThanOrEqual(18);
      expect(asset.license).toMatch(/Original realistic look-alike/i);
    }
  });

  it('rejects malformed assets', () => {
    expect(() => parseWeaponModelAsset({ schemaVersion: 1, name: 'Broken', family: 'rifle', license: 'none', parts: [] })).toThrow(/multiple mesh parts/i);
  });
});
