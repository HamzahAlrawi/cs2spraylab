import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import PrefirePractice from './PrefirePractice';
import {defaults} from '../config';
import {legacyNativeMapId, nativeMaps} from './maps';

vi.mock('../duel/DuelStage', () => ({DuelStage: () => null}));

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

const render = () => renderToStaticMarkup(createElement(PrefirePractice, {
  settings: defaults, openSettings() {}, onEnter() {}, suspended: false,
}));

describe('Prefire map-aware loading', () => {
  it('labels a single-map legacy setup without an unnecessary map selector', () => {
    vi.stubGlobal('localStorage', {getItem: () => null});
    const html = render();
    expect(html).toContain(`Loading ${nativeMaps.get(legacyNativeMapId).name}`);
    expect(html).not.toContain('aria-label="Prefire map"');
  });
  it('uses the selected registered map name and leaves selection available while loading', () => {
    const get = nativeMaps.get, has = nativeMaps.has, first = get(legacyNativeMapId);
    const second = {...first, id: 'synthetic', name: 'Synthetic Map',
      index: {...first.index, id: 'synthetic', routes: [{id: 'entry', name: 'Entry'}]}};
    vi.spyOn(nativeMaps, 'get').mockImplementation(id => id === second.id ? second : get(id));
    vi.spyOn(nativeMaps, 'has').mockImplementation((id: unknown): id is string => id === second.id || has(id));
    vi.spyOn(nativeMaps, 'list').mockReturnValue([first, second]);
    vi.stubGlobal('localStorage', {getItem: (key: string) => key === 'spraylab.prefire.v1'
      ? JSON.stringify({mapId: second.id, routeId: 'entry'}) : null});
    const html = render();
    expect(html).toContain('Loading Synthetic Map');
    expect(html).toContain('aria-label="Prefire map"');
    expect(html).toContain('value="synthetic" selected=""');
    expect(html).not.toContain(`Loading ${first.name}`);
  });
});
