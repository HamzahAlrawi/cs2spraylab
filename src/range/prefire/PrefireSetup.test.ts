import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {PrefireSetup, type PrefireSetupProps} from './PrefireSetup';
import {prefireDefaults, prefirePresets} from './config';
import type {PrefireCatalog, PrefireRoute} from './schema';
import {PrefireCoach} from './coaching';
import {summarizePrefireHistory} from './training-log';

const route: PrefireRoute = {
  id: 'route-a', name: 'Outside Long to pit', region: 'Long', startLabel: 'Outside Long / T approach',
  spawn: [0, 0, 0], look: [100, 0, 0], path: [[100, 0, 0]],
  angles: [{id: 'base', name: 'Core hold', position: [100, 100, 0]}],
  alternatives: [{id: 'alternate', name: 'Alternate hold', position: [200, 100, 0]}],
  lineups: [
    {id: 'route-a', name: 'Core course', angles: [{id: 'base', name: 'Core hold', position: [100, 100, 0]}]},
    {id: 'alternate-course', name: 'Close & blue', angles: [{id: 'alternate', name: 'Alternate hold', position: [200, 100, 0]}]},
  ],
};
const catalog: PrefireCatalog = {id: 'fixture', name: 'Dust 2', revision: 'test', routes: [route], sources: []};
const props: PrefireSetupProps = {
  config: {...prefireDefaults, routeId: route.id}, routeId: route.id, routes: [route], catalog,
  update: () => {}, onNext: () => {}, onRepeat: () => {},
};
const render = (patch: Partial<PrefireSetupProps> = {}) => renderToStaticMarkup(createElement(PrefireSetup, {...props, ...patch}));

describe('Prefire setup hierarchy', () => {
  it('keeps route, preset and lineup mode before the first closed native disclosure', () => {
    const html = render();
    const essentials = html.slice(0, html.indexOf('<details'));
    expect(essentials).toContain('aria-label="Route and training essentials"');
    expect(essentials).toContain('Dust 2 / Long');
    expect(essentials).toContain('Start: Outside Long / T approach');
    expect(essentials).toContain('aria-label="Prefire route"');
    expect(essentials).toContain('aria-label="Training preset"');
    expect(essentials).toContain('Floor route arrows');
    expect(html.match(/Floor route arrows/g)).toHaveLength(1);
    expect(essentials).toContain('<legend>Enemy positions</legend>');
    for (const value of ['all', 'random', 'contextual']) expect(essentials).toContain(`value="${value}"`);
    expect(html.match(/<details class="prefire-disclosure">/g)).toHaveLength(5);
    expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
    for (const title of ['Encounter options', 'Combat', 'Guidance &amp; run options', 'Run review', 'Possible holds']) {
      expect(html).toContain(`<summary>${title}`);
    }
  });

  it('shows the selected course under its route without changing the lineup fallback', () => {
    const config = {...props.config, ...prefirePresets.learn, lineupId: 'alternate-course'};
    const html = render({config, showTips: false});
    const essentials = html.slice(0, html.indexOf('<details'));
    expect(essentials).toContain('aria-label="Practice lineup"');
    expect(essentials).toContain('<small>Course</small>');
    expect(essentials).toContain('<optgroup label="Outside Long to pit">');
    expect(essentials).toContain('value="alternate-course" selected=""');
    expect(html).toContain('Alternate hold');
    expect(html).not.toContain('Core hold');
    const fallback = render({config: {...config, lineupId: 'old-route-course'}});
    expect(fallback).toContain('value="route-a" selected=""');
    expect(fallback).toContain('Core hold');
  });

  it('retains every advanced control and its accessible label behind the relevant disclosure', () => {
    const html = render({config: {...props.config, returnFire: true, reactionMs: 1250}});
    for (const label of ['Bot behavior', 'Prefire bots per run', 'Return fire', 'Bot trading', 'Bot reaction time', 'Prefire review time']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('aria-label="Bot combat"');
    expect(html).toContain('aria-valuetext="1250 milliseconds"');
    expect(html).toContain('Floor route arrows');
    expect(html).toContain('Route directions');
    expect(html).toContain('<legend>After clearing a route</legend>');
    const encounter = html.slice(html.indexOf('<summary>Encounter options'), html.indexOf('<summary>Combat'));
    expect(encounter).toContain('aria-label="Bot behavior"');
    expect(encounter).toContain('aria-label="Prefire bots per run"');
    const combat = html.slice(html.indexOf('<summary>Combat'), html.indexOf('<summary>Guidance'));
    expect(combat).toContain('aria-label="Return fire"');
    expect(combat).toContain('aria-label="Bot reaction time"');
  });

  it('keeps combat dependencies and contextual evidence intact', () => {
    const html = render({config: {...props.config, population: 'contextual'}});
    expect(html).toContain('aria-label="Bot trading" disabled=""');
    expect(html).not.toContain('aria-label="Bot reaction time"');
    expect(html).not.toContain('aria-label="Prefire bots per run"');
    expect(html).not.toContain('aria-label="Practice lineup"');
    expect(html).toContain('aria-label="Encounter evidence"');
    expect(html).toContain('Authored defender setups');
    expect(html).toContain('Verified match-level setup data is not available');
  });

  it.each(['learn', 'entry', 'pressure'] as const)('preserves the %s preset without applying changes during render', name => {
    const update = vi.fn();
    const config = {...props.config, ...prefirePresets[name]};
    const html = render({config, update});
    expect(html).toContain(`value="${name}" selected=""`);
    expect(update).not.toHaveBeenCalled();
    expect(html).toContain('<option value="custom" disabled=""');
    expect(html).toContain('value="learn"');
    expect(html).toContain('value="entry"');
    expect(html).toContain('value="pressure"');
  });

  it('keeps unavailable-route actions disabled and the empty state readable', () => {
    const html = render({routes: [], routeId: 'missing'});
    expect(html).toContain('aria-label="Prefire route" disabled=""');
    expect(html).toContain('aria-label="Repeat route" disabled=""');
    expect(html).toContain('aria-label="Next route" disabled=""');
    expect(html).toContain('No routes available');
    expect(html).toContain('No angles available');
  });

  it('keeps review closed with an empty live report and opens existing completed feedback', () => {
    const stats: NonNullable<PrefireSetupProps['stats']> = {
      ...new PrefireCoach([]).review(), routeId: route.id, routeName: route.name,
      headshotPercent: 0, stoppedPercent: 0, seconds: 0, progress: summarizePrefireHistory([], 'fixture'),
    };
    const empty = render({stats});
    expect(empty).toContain('<summary>Run review <span class="prefire-disclosure-state">No engagements yet</span>');
    expect(empty).not.toMatch(/<details class="prefire-disclosure"[^>]*\bopen[= >]/);
    const completed = render({stats: {...stats, kills: 5, total: 5, progress: summarizePrefireHistory([{
      key: 'fixture', route: route.name, outcome: 'won', date: '2026-10-18T10:00:00.000Z',
      score: 80, seconds: 12, goalMet: true,
    }], 'fixture')}});
    expect(completed).toContain('<details class="prefire-disclosure" open=""><summary>Run review');
    expect(completed).toContain('5 / 5 cleared');
  });
});
