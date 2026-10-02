import {describe, expect, it} from 'vitest';
import {cosmeticCatalog, DEFAULT_GLOVE_PREVIEW} from './cosmetics';
import {cosmeticsForEquipment, prepareCosmeticCatalog, sanitizeProgression, xpForLevel} from './progression';
import actors from './actor-cosmetics-data.json';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const catalog = prepareCosmeticCatalog(cosmeticCatalog);
const finishes = (equipment: string) => catalog.filter(item => item.equipment === equipment && !item.isDefault);

describe('equipment-focused cosmetic collections', () => {
  it('shows stock only even if every level gate is open and every finish is affordable', () => {
    const profile = sanitizeProgression({version: 2, xp: xpForLevel(100), balance: 1_000_000}, catalog);
    expect(cosmeticsForEquipment(profile, catalog, 'ak47').map(item => item.id)).toEqual(['ak47-standard']);
    expect(cosmeticsForEquipment(profile, catalog, 'ak47', 'unowned')).toHaveLength(10);
  });
  it('includes owned finishes only for the selected gun, without mutating the catalog', () => {
    const ak = finishes('ak47')[0], deagle = finishes('deagle')[0];
    const profile = sanitizeProgression({version: 2, owned: [ak.id, deagle.id]}, catalog);
    expect(cosmeticsForEquipment(profile, catalog, 'ak47').map(item => item.id)).toEqual(['ak47-standard', ak.id]);
    expect(cosmeticsForEquipment(profile, catalog, 'deagle').map(item => item.id)).toEqual(['deagle-standard', deagle.id]);
    expect(cosmeticsForEquipment(profile, catalog, 'missing')).toEqual([]);
    expect(catalog.filter(item => item.equipment === 'ak47')).toHaveLength(11);
  });
  it('keeps legacy ownership visible even when the new level gate is higher', () => {
    const item = finishes('ak47')[9];
    const profile = sanitizeProgression({version: 1, xp: 0, equipped: {ak47: item.id}}, catalog);
    expect(cosmeticsForEquipment(profile, catalog, 'ak47')).toContain(item);
    expect(cosmeticsForEquipment(profile, catalog, 'ak47', 'unowned')).not.toContain(item);
  });
  it('separates gloves and agents, including their stock options', () => {
    const gloves = finishes('gloves')[0], agent = finishes('agent')[0];
    const profile = sanitizeProgression({version: 2, owned: [gloves.id, agent.id]}, catalog);
    expect(cosmeticsForEquipment(profile, catalog, 'gloves').map(item => item.id)).toEqual(['gloves-standard', gloves.id]);
    expect(cosmeticsForEquipment(profile, catalog, 'agent')).toHaveLength(2);
  });
});

describe('authored native glove inventory previews', () => {
  it('provides a real local preview for standard gloves rather than a raised-hand icon', () => {
    expect(catalog.find(item => item.id === 'gloves-standard')?.imageUrl).toBe(DEFAULT_GLOVE_PREVIEW);
    expect(readFileSync(`public/revamp${DEFAULT_GLOVE_PREVIEW}`).subarray(0, 4).toString()).toBe('RIFF');
  });
  it.each(actors.cosmetics.filter(item => item.equipment === 'gloves'))('$id uses the matching extracted inventory image', item => {
    expect(item.imageSource).toMatch(/^panorama\/images\/econ\/default_generated\/.+_light_png\.vtex_c$/);
    expect(item.imageSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(item.imageUrl).toBe(`/textures/cosmetics/${item.id}-preview.webp`);
    const bytes = readFileSync(`public/revamp${item.imageUrl}`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.imageSha256);
  });
});
