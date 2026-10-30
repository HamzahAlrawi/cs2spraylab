import {afterEach, describe, expect, it, vi} from 'vitest';
import {loadPrefireConfig, prefirePreset, prefirePresets, savePrefireConfig, sanitizePrefireConfig, updatePrefireConfig, type PrefireConfig} from './config';
import {prefireRoutes} from './routes';
import {legacyNativeMapId, nativeMaps} from './maps';

const defaults: PrefireConfig = {
  mapId: legacyNativeMapId,
  routeId: 'long-doors', population: 'random', botsPerRun: 4, botBehavior: 'angle-specific', movingBots: true, returnFire: false, tradeEnabled: true,
  reactionMs: 1000, autoAdvance: true, routeGuide: true, navigationHints: true, reviewSeconds: 5,
};
const storageKey = 'spraylab.prefire.v1';
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});

describe('Prefire configuration', () => {
  it('resets courses on map switches even when a caller supplies an overlapping stale course', () => {
    const index = {id: 'synthetic', routes: [{id: 'new-entry', name: 'New entry'},
      {id: 'long-doors', name: 'Other doors', lineups: [{id: 'pit-clear', name: 'Other pit'}]}]};
    const config = {...defaults, lineupId: 'pit-clear'};
    expect(updatePrefireConfig(config, {mapId: index.id, routeId: config.routeId, lineupId: config.lineupId}, index))
      .toEqual({...defaults, mapId: index.id, routeId: 'new-entry'});
    expect(updatePrefireConfig(config, {routeGuide: false}).lineupId).toBe('pit-clear');
  });
  it('validates overlapping route and lineup IDs only against the selected lightweight map index', () => {
    const index = {id: 'synthetic', routes: [
      {id: 'long-doors', name: 'Other doors', lineups: [{id: 'other-lineup', name: 'Other lineup'}]},
      {id: 'new-route', name: 'New route'},
    ], aliases: {'old-other': 'long-doors'}};
    expect(sanitizePrefireConfig({mapId: index.id, routeId: 'old-other', lineupId: 'other-lineup'}, index))
      .toMatchObject({mapId: index.id, routeId: 'long-doors', lineupId: 'other-lineup'});
    expect(sanitizePrefireConfig({mapId: index.id, routeId: 'long-doors', lineupId: 'pit-clear'}, index).lineupId).toBeUndefined();
    expect(sanitizePrefireConfig({mapId: index.id, routeId: 'short-a'}, index).routeId).toBe('long-doors');
    expect(sanitizePrefireConfig({routeId: 'short-a'}, index)).toMatchObject({mapId: legacyNativeMapId, routeId: 'short-a'});
    expect(sanitizePrefireConfig({mapId: 'unregistered', routeId: 'new-route'}, index).mapId).toBe(legacyNativeMapId);
  });
  it.each([undefined, null, false, 42, 'long-a', [], ['long-a'], {}])('defaults malformed input %j', raw => {
    expect(sanitizePrefireConfig(raw)).toEqual(defaults);
  });

  it.each(prefireRoutes.map(route => route.id))
    ('accepts route %s', routeId => {
      expect(sanitizePrefireConfig({routeId}).routeId).toBe(routeId);
    });

  it.each(['dust2', '__proto__', 'LONG-DOORS', '', 1, null])('rejects unknown route %j', routeId => {
    expect(sanitizePrefireConfig({routeId}).routeId).toBe('long-doors');
  });

  it('preserves valid settings, including disabled default-on toggles', () => {
    const config: PrefireConfig = {
      mapId: legacyNativeMapId,
      routeId: 'b-tunnels', population: 'random', botsPerRun: 3, botBehavior: 'static', movingBots: false, returnFire: true, tradeEnabled: false,
      reactionMs: 725, autoAdvance: false, routeGuide: false, navigationHints: false, reviewSeconds: 7,
    };
    expect(sanitizePrefireConfig(config)).toEqual(config);
    expect(sanitizePrefireConfig({...config, population: 'all'}).population).toBe('all');
  });

  it.each(['some', 'ALL', '', 0, false, null, []])('rejects invalid population %j', population => {
    expect(sanitizePrefireConfig({population}).population).toBe('random');
  });

  it.each([false, true])('migrates legacy movingBots=%s without changing combat settings', movingBots => {
    expect(sanitizePrefireConfig({movingBots, returnFire: true, reactionMs: 725})).toEqual({
      ...defaults, botBehavior: movingBots ? 'angle-specific' : 'static', movingBots, returnFire: true, reactionMs: 725,
    });
  });

  it('gives the explicit behavior precedence and keeps the legacy alias in sync', () => {
    expect(sanitizePrefireConfig({botBehavior: 'static', movingBots: true})).toEqual({...defaults, botBehavior: 'static', movingBots: false});
    expect(sanitizePrefireConfig({botBehavior: 'angle-specific', movingBots: false})).toEqual(defaults);
    expect(sanitizePrefireConfig({botBehavior: 'invalid'})).toEqual(defaults);
  });

  it.each(['false', 'true', 0, 1, null, [], {}])('does not coerce toggle value %j', value => {
    expect(sanitizePrefireConfig({movingBots: value, returnFire: value, tradeEnabled: value, autoAdvance: value, routeGuide: value}))
      .toEqual(defaults);
  });

  it.each([[-100, 300], [0, 300], [299, 300], [300, 300], [1000.5, 1000.5], [2500, 2500], [2501, 2500], [99999, 2500]])
    ('bounds reaction time %s to %s ms', (reactionMs, expected) => {
      expect(sanitizePrefireConfig({reactionMs}).reactionMs).toBe(expected);
    });

  it.each([NaN, Infinity, -Infinity, '1000', null, undefined, true, []])('defaults invalid reaction time %j', reactionMs => {
    expect(sanitizePrefireConfig({reactionMs}).reactionMs).toBe(1000);
  });

  it('does not retain unknown properties or mutate the input', () => {
    const raw = {routeId: 'short-a', reactionMs: 1, extra: 'ignored'};
    expect(sanitizePrefireConfig(raw)).toEqual({...defaults, routeId: 'short-a', reactionMs: 300});
    expect(raw).toEqual({routeId: 'short-a', reactionMs: 1, extra: 'ignored'});
  });
  it('migrates duplicate route IDs to their approach and preserves a valid fixed lineup', () => {
    expect(sanitizePrefireConfig({routeId: 'pit-clear', population: 'all'})).toMatchObject({
      routeId: 'long-doors', lineupId: 'pit-clear', population: 'all',
    });
    expect(sanitizePrefireConfig({routeId: 'long-doors', lineupId: 'pit-clear'}).lineupId).toBe('pit-clear');
    expect(sanitizePrefireConfig({routeId: 'long-doors', lineupId: 'not-a-lineup'}).lineupId).toBeUndefined();
    expect(sanitizePrefireConfig({routeId: 'short-a', lineupId: 'pit-clear'}).lineupId).toBeUndefined();
    expect(sanitizePrefireConfig({mapId: 'custom-map', routeId: 'pit-clear'}, {id: 'custom-map', routes: [{id: 'custom', name: 'Custom'}]}))
      .toEqual({...defaults, mapId: 'custom-map', routeId: 'custom'});
  });

  it('returns fresh configuration objects', () => {
    const first = sanitizePrefireConfig(undefined);
    first.routeId = 'b-doors';
    expect(sanitizePrefireConfig(undefined)).toEqual(defaults);
  });
  it.each([[-1, 1], [0, 1], [2, 2], [3.5, 4], [5, 5], [999, 5], [NaN, 4], [Infinity, 4]])('bounds bots per run %s to %s', (botsPerRun, expected) => {
    expect(sanitizePrefireConfig({botsPerRun}).botsPerRun).toBe(expected);
  });
  it.each([[-1, 2], [0, 2], [2, 2], [5, 5], [10, 10], [99, 10]])('bounds readable review duration %s to %s', (reviewSeconds, expected) => {
    expect(sanitizePrefireConfig({reviewSeconds}).reviewSeconds).toBe(expected);
  });
  it.each([NaN, Infinity, '5', null, undefined, false])('migrates missing or invalid review duration %j', reviewSeconds => {
    expect(sanitizePrefireConfig({reviewSeconds}).reviewSeconds).toBe(5);
  });
  it.each(['learn', 'entry', 'pressure'] as const)('applies and identifies the explicit %s preset with next-route defaults', name => {
    const config = sanitizePrefireConfig({...defaults, routeId: 'b-doors', reviewSeconds: 8, ...prefirePresets[name]});
    expect(prefirePreset(config)).toBe(name); expect(config.routeId).toBe('b-doors'); expect(config.reviewSeconds).toBe(8);
    expect(config.autoAdvance).toBe(true);
    expect(prefirePresets[name]).not.toHaveProperty('autoAdvance');
    expect(prefirePresets[name]).not.toHaveProperty('tradeEnabled');
    expect(prefirePresets[name]).not.toHaveProperty('routeGuide');
    expect(prefirePresets[name]).not.toHaveProperty('navigationHints');
  });
  it.each([true, false])('preserves progression=%s and disabled trading across every preset', autoAdvance => {
    let config = sanitizePrefireConfig({...defaults, routeId: 'b-doors', reviewSeconds: 8, autoAdvance, tradeEnabled: false});
    for (const name of ['learn', 'entry', 'pressure'] as const) {
      config = sanitizePrefireConfig({...config, ...prefirePresets[name]});
      expect(config).toMatchObject({routeId: 'b-doors', reviewSeconds: 8, autoAdvance, tradeEnabled: false});
      expect(prefirePreset(config)).toBe(name);
    }
  });
  it.each([true, false])('retains trading=%s while return fire is disabled or re-enabled', tradeEnabled => {
    const config = sanitizePrefireConfig({returnFire: false, tradeEnabled});
    expect(config.tradeEnabled).toBe(tradeEnabled);
    expect(sanitizePrefireConfig({...config, returnFire: true}).tradeEnabled).toBe(tradeEnabled);
  });
  it.each([true, false])('preserves the explicit route guidance choice %s across all presets', routeGuide => {
    let config = {...defaults, routeGuide, navigationHints: false};
    for (const preset of Object.values(prefirePresets)) {
      config = sanitizePrefireConfig({...config, ...preset});
      expect(config.routeGuide).toBe(routeGuide);
      expect(config.navigationHints).toBe(false);
      expect(prefirePreset(config)).not.toBe('custom');
    }
  });
  it('does not silently call edited combat settings a predefined difficulty', () => {
    expect(prefirePreset(defaults)).toBe('entry');
    const pressure = sanitizePrefireConfig({...defaults, ...prefirePresets.pressure, reactionMs: 600});
    expect(prefirePreset(pressure)).toBe('custom');
  });
});

describe('Prefire storage', () => {
  it('round-trips a registered second map with its own colliding route and lineup IDs', () => {
    const get = nativeMaps.get, has = nativeMaps.has;
    const index = {id: 'synthetic', revision: 'r1', routes: [{id: 'long-doors', name: 'Other doors',
      lineups: [{id: 'other-lineup', name: 'Other lineup'}]}], aliases: {}, approaches: {}};
    const descriptor = {...get(legacyNativeMapId), id: index.id, name: 'Synthetic Map', index};
    vi.spyOn(nativeMaps, 'has').mockImplementation((id: unknown): id is string => id === index.id || has(id));
    vi.spyOn(nativeMaps, 'get').mockImplementation(id => id === index.id ? descriptor : get(id));
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value)});
    const config = sanitizePrefireConfig({mapId: index.id, routeId: 'long-doors', lineupId: 'other-lineup'});
    expect(savePrefireConfig(config)).toBe(true);
    expect(loadPrefireConfig()).toEqual(config);
    expect(loadPrefireConfig().mapId).toBe(index.id);
  });
  it.each(['entry', 'pressure'] as const)('restores arrows disabled by the legacy %s preset, then respects an explicit opt-out', name => {
    let saved = JSON.stringify({...defaults, ...prefirePresets[name], routeGuide: false});
    vi.stubGlobal('localStorage', {getItem: () => saved, setItem: (_key: string, value: string) => {saved = value;}});
    const migrated = loadPrefireConfig();
    expect(migrated).toEqual({...defaults, ...prefirePresets[name], routeGuide: true});
    expect(savePrefireConfig({...migrated, routeGuide: false})).toBe(true);
    expect(loadPrefireConfig().routeGuide).toBe(false);
  });
  it('does not reset custom legacy navigation choices or other settings', () => {
    const custom = {...defaults, returnFire: true, reactionMs: 1600, routeGuide: false, navigationHints: false};
    vi.stubGlobal('localStorage', {getItem: () => JSON.stringify(custom)});
    expect(loadPrefireConfig()).toEqual(custom);
  });
  it('round-trips settings using only the versioned Prefire key', () => {
    const values = new Map<string, string>([['spraylab.duel.v1', 'unrelated']]);
    const getItem = vi.fn((key: string) => values.get(key) ?? null);
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('localStorage', {getItem, setItem});
    const config = {...defaults, routeId: 'a-retake', population: 'random' as const, returnFire: true, reactionMs: 1500};
    expect(savePrefireConfig(config)).toBe(true);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(storageKey, JSON.stringify({...config, routeGuidePreference: 1}));
    expect(loadPrefireConfig()).toEqual(config);
    expect(getItem).toHaveBeenCalledExactlyOnceWith(storageKey);
    expect(values.get('spraylab.duel.v1')).toBe('unrelated');
  });

  it.each([null, '', '{', 'not json', 'null', '[]', 'false', '42', '"long-a"'])
    ('tolerates missing or malformed saved data %j', saved => {
      vi.stubGlobal('localStorage', {getItem: () => saved});
      expect(loadPrefireConfig()).toEqual(defaults);
    });

  it('sanitizes partial and stale stored settings', () => {
    vi.stubGlobal('localStorage', {getItem: () => JSON.stringify({routeId: 'old-route', reactionMs: 9000, movingBots: false, extra: true})});
    expect(loadPrefireConfig()).toEqual({...defaults, botBehavior: 'static', movingBots: false, reactionMs: 2500});
  });

  it.each([true, false])('preserves explicitly saved progression=%s while migrating missing trading', autoAdvance => {
    vi.stubGlobal('localStorage', {getItem: () => JSON.stringify({autoAdvance, returnFire: false})});
    expect(loadPrefireConfig()).toEqual({...defaults, autoAdvance});
  });

  it('round-trips repeat-route and disabled trading without changing return fire', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value)});
    const config = {...defaults, autoAdvance: false, tradeEnabled: false, returnFire: false};
    expect(savePrefireConfig(config)).toBe(true);
    expect(loadPrefireConfig()).toEqual(config);
  });

  it('persists migrated Static targets and explicit Angle-specific behavior', () => {
    const values = new Map([[storageKey, JSON.stringify({movingBots: false, returnFire: true})]]);
    vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value)});
    const migrated = loadPrefireConfig();
    expect(migrated.botBehavior).toBe('static');
    expect(savePrefireConfig(migrated)).toBe(true);
    expect(loadPrefireConfig()).toEqual(migrated);
    expect(savePrefireConfig({...migrated, botBehavior: 'angle-specific'})).toBe(true);
    expect(loadPrefireConfig()).toEqual({...migrated, botBehavior: 'angle-specific', movingBots: true});
  });

  it('sanitizes before saving without mutating configuration', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', {setItem});
    const config = {...defaults, routeId: 'invalid', reactionMs: -50, extra: 'ignored'};
    expect(savePrefireConfig(config)).toBe(true);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(storageKey, JSON.stringify({...defaults, reactionMs: 300, routeGuidePreference: 1}));
    expect(config.reactionMs).toBe(-50);
  });

  it('does not throw when storage access or quota fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {throw new Error('Access denied');},
      setItem: () => {throw new Error('Quota exceeded');},
    });
    expect(loadPrefireConfig()).toEqual(defaults);
    expect(savePrefireConfig(defaults)).toBe(false);
  });

  it('works without browser storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadPrefireConfig()).toEqual(defaults);
    expect(savePrefireConfig(defaults)).toBe(false);
  });

  it('tolerates a blocked localStorage getter', () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get: () => {throw new Error('Blocked');}});
    expect(loadPrefireConfig()).toEqual(defaults);
    expect(savePrefireConfig(defaults)).toBe(false);
  });
});
