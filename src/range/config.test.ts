import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defaults, loadSettings, migrateLegacySettings, modeNames, sanitizeSettings, saveSettings, type Mode} from './config';

describe('Shared coaching tips setting', () => {
  const saved = new Map<string, string>();
  beforeEach(() => {
    saved.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults on for new settings and older saves', () => {
    expect(defaults.showTips).toBe(true);
    expect(loadSettings().showTips).toBe(true);
    expect(sanitizeSettings({mode: 'spray'}).showTips).toBe(true);
    expect(migrateLegacySettings({cs2Sensitivity: .5}).showTips).toBe(true);
  });

  it.each([undefined, null, 0, 1, '', 'false', {}, []])('does not interpret malformed %j as an opt-out', value => {
    expect(sanitizeSettings({showTips: value}).showTips).toBe(true);
  });

  it('preserves an explicit legacy opt-out', () => {
    expect(migrateLegacySettings({showTips: false}).showTips).toBe(false);
  });

  it.each(Object.keys(modeNames) as Mode[])('persists the opt-out in %s without altering the mode or guides', mode => {
    const settings = sanitizeSettings({...defaults, mode, showTips: false});
    expect(saveSettings(settings)).toBe(true);
    expect(JSON.parse(saved.get('spraylab.range.v2')!).showTips).toBe(false);
    expect(loadSettings()).toEqual(settings);
    expect(settings.showImpactPattern).toBe(true);
    expect(settings.showMousePath).toBe(true);
  });

  it('can re-enable tips through the same settings record', () => {
    saveSettings(sanitizeSettings({showTips: false}));
    saveSettings({...loadSettings(), showTips: true});
    expect(loadSettings().showTips).toBe(true);
  });

  it('falls back to tips on if storage is corrupt or unavailable', () => {
    saved.set('spraylab.range.v2', 'not json');
    expect(loadSettings().showTips).toBe(true);
    vi.stubGlobal('localStorage', {getItem: () => {throw new Error('Blocked');}, setItem: () => {throw new Error('Blocked');}});
    expect(loadSettings().showTips).toBe(true);
    expect(saveSettings(sanitizeSettings({showTips: false}))).toBe(false);
  });
});
