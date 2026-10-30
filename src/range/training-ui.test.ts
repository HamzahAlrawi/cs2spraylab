import {describe, expect, it} from 'vitest';
import {modeNames, weaponIds} from './config';
import {drillGroups, matchesDrill, matchesWeapon, weaponGroup} from './training-ui';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {DrillChooser} from './DrillChooser';

describe('training discovery', () => {
  it('lists every available drill once, with no retired modes', () => {
    const modes = drillGroups.flatMap(group => group.modes);
    expect(modes.slice().sort()).toEqual(Object.keys(modeNames).sort());
    expect(new Set(modes).size).toBe(modes.length);
  });
  it('finds drills by skill and name without case or whitespace sensitivity', () => {
    expect(matchesDrill('precision', ' STOP-shot  timing ', modeNames.precision, '')).toBe(true);
    expect(matchesDrill('guided', 'recoil', modeNames.guided, '')).toBe(true);
    expect(matchesDrill('hearing', 'dust 2', modeNames.hearing, '')).toBe(false);
  });
  it('renders an explicitly selected, accessible current mode', () => {
    const html = renderToStaticMarkup(createElement(DrillChooser, {mode: 'prefire', choose: () => {}}));
    expect(html).toContain('aria-label="Find a drill"');
    expect(html).toContain('aria-label="Choose Map prefire" aria-pressed="true"');
    expect((html.match(/class="drill-choice current"/g) ?? []).length).toBe(1);
  });
});
describe('loadout filtering', () => {
  it('classifies every selectable weapon without losing equipment or sidearms', () => {
    expect(weaponIds.every(id => !!weaponGroup(id))).toBe(true);
    expect(weaponGroup('elite')).toBe('Pistols');
    expect(weaponGroup('nova')).toBe('Heavy');
    expect(weaponGroup('awp')).toBe('Snipers');
    expect(weaponGroup('zeus')).toBe('Equipment');
  });
  it('combines category and text search and keeps the full original inventory', () => {
    expect(weaponIds.filter(id => matchesWeapon(id, 'All', ''))).toEqual(weaponIds);
    expect(matchesWeapon('deagle', 'Pistols', ' Desert Eagle ')).toBe(true);
    expect(matchesWeapon('awp', 'Rifles', '')).toBe(false);
  });
});
