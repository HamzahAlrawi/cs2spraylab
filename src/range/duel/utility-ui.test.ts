import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {duelDefaults} from './config';
import {utilityInventory, utilityKinds, utilityNames} from './utility-loadout';
import {changeUtilityLoadout, nextUtility, UtilityHud, UtilityLoadout} from './utility-ui';

describe('utility selection and loadout presentation', () => {
  it('cycles only carried grenades, wraps, and leaves an empty inventory unselected', () => {
    const inventory = utilityInventory(['he', 'flash', 'flash', 'decoy']);
    expect(nextUtility(inventory)).toBe('he');
    expect(nextUtility(inventory, 'he')).toBe('flash');
    expect(nextUtility(inventory, 'flash')).toBe('decoy');
    expect(nextUtility(inventory, 'decoy')).toBe('he');
    expect(nextUtility(utilityInventory(['smoke']), 'smoke')).toBe('smoke');
    expect(nextUtility(utilityInventory([]), 'he')).toBeNull();
  });

  it('enforces capacity and per-kind limits without mutating the selected loadout', () => {
    const loadout = ['he', 'flash', 'smoke', 'molotov'] as const;
    expect(changeUtilityLoadout(loadout, 'decoy', 1)).toEqual(loadout);
    expect(changeUtilityLoadout(loadout, 'flash', 2)).toEqual(['he', 'smoke', 'molotov', 'flash']);
    expect(changeUtilityLoadout(['he'], 'flash', 9)).toEqual(['he', 'flash', 'flash']);
    expect(changeUtilityLoadout([], 'smoke', 2)).toEqual(['smoke']);
    expect(changeUtilityLoadout(loadout, 'he', 0)).toEqual(['flash', 'smoke', 'molotov']);
    expect(loadout).toEqual(['he', 'flash', 'smoke', 'molotov']);
  });

  it('replaces the conflicting fire grenade even when all four slots are filled', () => {
    const loadout = ['he', 'flash', 'smoke', 'molotov'] as const;
    expect(changeUtilityLoadout(loadout, 'incendiary', 1)).toEqual(['he', 'flash', 'smoke', 'incendiary']);
    expect(changeUtilityLoadout(['incendiary'], 'molotov', 1)).toEqual(['molotov']);
    expect(changeUtilityLoadout(['incendiary'], 'molotov', 0)).toEqual(['incendiary']);
  });

  it('renders all six named counts, a selected state, and full/lob commands', () => {
    const html = renderToStaticMarkup(createElement(UtilityHud, {
      inventory: utilityInventory(['he', 'flash', 'flash']), selected: 'flash', disabled: false, onSelect: vi.fn(), onThrow: vi.fn(),
    }));
    expect(html).toContain('role="group" aria-label="Grenades"');
    for (const kind of utilityKinds) expect(html).toContain(`aria-label="Equip ${utilityNames[kind]},`);
    expect(html).toMatch(/aria-label="Equip Flashbang, 2 remaining" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Equip Smoke grenade, 0 remaining" aria-pressed="false" disabled=""/);
    expect(html).toContain('aria-label="Throw grenade"');
    expect(html).toContain('aria-label="Lob grenade"');
  });

  it('disables all inputs when paused and hides throws when a gun is held', () => {
    const html = renderToStaticMarkup(createElement(UtilityHud, {
      inventory: utilityInventory(['he']), disabled: true, onSelect: vi.fn(), onThrow: vi.fn(),
    }));
    expect(html.match(/disabled=""/g)).toHaveLength(6);
    expect(html).not.toContain('aria-label="Throw grenade"');
  });

  it('shows enable/bot toggles, six loadout choices, and disables conflicting capacity additions', () => {
    const html = renderToStaticMarkup(createElement(UtilityLoadout, {config: duelDefaults, update: vi.fn()}));
    expect(html).toContain('aria-label="Enable utilities" type="checkbox" checked=""');
    expect(html).toContain('aria-label="Bot utilities" type="checkbox" checked=""');
    expect(html).toContain('aria-label="Flashbang count"');
    expect(html).toMatch(/aria-label="Carry Decoy grenade"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Carry Incendiary grenade"[^>]*type="checkbox"/);
    expect(html.match(/<option value="2" disabled=""/g)).toHaveLength(1);
    const disabled = renderToStaticMarkup(createElement(UtilityLoadout, {config: {...duelDefaults, utilitiesEnabled: false}, update: vi.fn()}));
    expect(disabled).toContain('<fieldset class="duel-setup-fieldset duel-setup-wide" disabled="">');
    expect(disabled).toMatch(/aria-label="Bot utilities"[^>]*disabled=""/);
  });
});
