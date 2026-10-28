import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CoachingReview} from './CoachingReview';
import type {CoachingSummary} from './coaching-types';
import {defaults, modeNames, type Mode} from './config';
import {TipsDisplay} from './DrillPanel';
import {HearingPractice} from './HearingPractice';
import {HEARING_CONFIG_KEY, hearingDefaults} from './hearing-practice';
import RangeApp from './RangeApp';
import {DuelStage} from './duel/DuelStage';
import {PrefireSetup, type PrefireSetupProps} from './prefire/PrefireSetup';
import {prefireDefaults} from './prefire/config';
import {PrefireCoach} from './prefire/coaching';
import type {PrefireCatalog, PrefireRoute} from './prefire/schema';

const summary: CoachingSummary = {score: 72, focus: 'Brake before firing', evidence: '2 of 3 shots were settled.',
  action: 'Practice three slower openings.', goal: 'Three settled openings.', strength: 'Keep prepared aim.',
  confidence: '3 measured shots; local practice score.', metrics: [{label: 'Settled shots', value: '2/3', score: 67, detail: 'Grounded shot speed.'}]};
const baseAngle = {id: 'base-angle', name: 'Base hold', position: [100, 0, 0] as const};
const alternateAngle = {id: 'alternate-angle', name: 'Alternate hold', position: [300, 0, 0] as const};
const route: PrefireRoute = {id: 'route-a', name: 'Route A', startLabel: 'Outside cover', spawn: [0, 0, 0],
  look: [100, 0, 0], path: [], angles: [baseAngle], alternatives: [alternateAngle],
  lineups: [{id: 'route-a', name: 'Original lineup', angles: [baseAngle]}, {id: 'alternate', name: 'Alternate lineup', angles: [alternateAngle]}]};
const catalog: PrefireCatalog = {id: 'fixture-map', name: 'Fixture map', revision: 'test', routes: [route], sources: [],
  density: {schemaVersion: 1, mapId: 'fixture-map', source: {url: 'https://example.test/evidence', revision: 'test', license: 'CC0', author: 'Fixture'},
    sample: {matches: 1, rounds: 2, povs: 1}, layers: [{side: 'ct', context: 'preplant', rounds: 2, roundKeys: ['a', 'b']}],
    cells: [{position: [100, 0, 0], side: 'ct', context: 'preplant', rounds: 1, matches: 1, roundKeys: ['a'], episodeAnchors: 1, seconds: 1}]}};
const setupProps: PrefireSetupProps = {config: {...prefireDefaults, routeId: route.id}, routeId: route.id, routes: [route], catalog,
  update: () => {}, onNext: () => {}, onRepeat: () => {}};

describe('Tips display boundaries', () => {
  const saved = new Map<string, string>();
  beforeEach(() => {
    saved.clear();
    vi.stubGlobal('document', {hidden: false});
    vi.stubGlobal('localStorage', {getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value)});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the default shared review markup unchanged', () => {
    const review = createElement(CoachingReview, {summary});
    expect(renderToStaticMarkup(createElement(TipsDisplay, {children: review}))).toBe(renderToStaticMarkup(review));
  });

  it('scopes hidden prose without hiding evidence, scores, metric values or controls', () => {
    const html = renderToStaticMarkup(createElement(TipsDisplay, {showTips: false, children: createElement(CoachingReview, {summary})}));
    expect(html).toContain('data-coaching-tips="false"');
    expect(html).toContain('.coaching-review > p:not(.coaching-evidence)');
    expect(html).toContain('72/100');expect(html).toContain('2 of 3 shots were settled.');
    expect(html).toContain('<dd>2/3</dd>');expect(html).toContain('aria-label="Stop-shoot timing practice score"');
    expect(html).toContain('.coaching-terms');
    expect(html).not.toContain('.coaching-review {');expect(html).not.toContain('.duel-hud');
  });

  it.each(Object.keys(modeNames) as Mode[])('omits the automatic mode brief in %s but retains the manual tutorial command', mode => {
    saved.set('spraylab.range.v2', JSON.stringify({...defaults, mode, showTips: false}));
    const html = renderToStaticMarkup(createElement(RangeApp));
    expect(html).not.toContain('settings-nudge');expect(html).not.toContain('settings-hint-text');
    expect(html).not.toContain('mode-brief" aria-label="Drill purpose"><div>');
    expect(html).toContain('Learn the fundamentals');expect(html).toContain('aria-label="Training mode"');
    if (['guided', 'spray', 'transfer'].includes(mode)) {
      expect(html).not.toContain('coach-instruction');expect(html).not.toContain('coach-awaiting');
      expect(html).toContain('hit-marker');expect(html).toContain('data-testid="accuracy"');
      expect(html).toContain('HEAD');expect(html).toContain('BODY');expect(html).toContain('MISS');
    }
  });

  it('suppresses the unseen duel setup hint but retains map-loading status and setup controls', () => {
    const props = {settings: {...defaults, showTips: false}, openSettings: () => {}, onEnter: () => {}, suspended: false};
    const html = renderToStaticMarkup(createElement(DuelStage, props));
    expect(html).not.toContain('Set up your opponent here');expect(html).not.toContain('Changes start a new round');
    expect(html).toContain('Loading map chunk');expect(html).toContain('aria-label="Bot behavior"');
    expect(html).toContain('HEALTH');expect(html).toContain('DAMAGE');
    expect(renderToStaticMarkup(createElement(DuelStage, {...props, settings: defaults}))).toContain('Set up your opponent here');
    expect(saved.has('spraylab.duel.hint.v1')).toBe(false);
  });

  it('hides hearing instructions while retaining answer, calibration, score and storage controls', () => {
    saved.set(HEARING_CONFIG_KEY, JSON.stringify({...hearingDefaults, device: 'stereo'}));
    const html = renderToStaticMarkup(createElement(HearingPractice, {volume: .2, showTips: false}));
    expect(html).not.toContain('Speaker placement affects direction cues');expect(html).not.toContain('Keep device volume fixed');
    expect(html).not.toContain('Keep system volume fixed');expect(html).toContain('not exact CS2 HRTF');
    expect(html).toContain('Confirm estimate');expect(html).toContain('Level calibration');expect(html).toContain('Mean score');
    expect(html).toContain('Estimated bearing');expect(html).toContain('Estimated distance');expect(html).toContain('Saved history');
  });

  it('retains the mono scoring warning even with tips off', () => {
    saved.set(HEARING_CONFIG_KEY, JSON.stringify({...hearingDefaults, device: 'mono'}));
    expect(renderToStaticMarkup(createElement(HearingPractice, {volume: .2, showTips: false}))).toContain('only distance is scored');
  });

  it('hides prefire goals and angle tips while keeping shot results and position evidence', () => {
    const stats: NonNullable<PrefireSetupProps['stats']> = {...new PrefireCoach(['Base hold']).review(), routeId: route.id,
      routeName: route.name, score: 72, coaching: summary, shots: 3, kills: 1, total: 1, headshotPercent: 33,
      stoppedPercent: 67, seconds: 4, progress: {attempts: 1, last: {key: 'fixture', route: route.name, outcome: 'won',
        date: '2026-10-11T00:00:00.000Z', score: 72, seconds: 4, goalMet: true}, best: 72, streak: 1},
      angles: [{id: 1, name: 'Base hold', cleared: true, shots: 3, openingStopped: true, readyAim: true,
        entry: true, openingHit: true, openingHead: false, threats: 1, contactToHitMs: 200,
        message: 'Prepare the next angle', tip: 'Angle coaching instruction'}]};
    const html = renderToStaticMarkup(createElement(PrefireSetup, {...setupProps, showTips: false, stats,
      lastShot: {weapon: 'ak47', state: {speedUnits: 120, grounded: true, movementInaccuracy: .02, inaccuracy: .03,
        recoveringInaccuracy: 0, spread: .01, recoil: {yaw: 0, pitch: 0}}}}));
    expect(html).not.toContain('Clean route goal');expect(html).not.toContain('90% stopped first bullets.');
    expect(html).not.toContain('Angle coaching instruction');expect(html).not.toContain('Prepare the next angle');
    expect(html).not.toContain('Brake before firing. Releasing');expect(html).not.toContain('Pre-aim before leaving cover.');
    expect(html).toContain('Shot while moving / 120 u/s');expect(html).toContain('<dt>Speed</dt><dd>120 u/s</dd>');
    expect(html).toContain('2 of 3 shots were settled.');expect(html).toContain('<dt>Quality score</dt><dd>72</dd>');
    expect(html).not.toContain('class="prefire-goal"');expect(html).toContain('Clean streak <b>1</b>');
    expect(html).toContain('Position evidence');expect(html).toContain('1/2');expect(html).toContain('Fixture / CC0');
    expect(html).toContain('Opening hit');expect(html).toContain('Shot totals');expect(html).toContain('Repeat route');
  });

  it('shows prefire tips by default', () => {
    const html = renderToStaticMarkup(createElement(PrefireSetup, setupProps));
    expect(html).toContain('Clean route goal');expect(html).toContain('90% stopped first bullets.');
    expect(html).toContain('With rifles, pre-aim at head level before peeking.');
  });

  it('displays the selected fixed lineup and start label independently of tips', () => {
    const html = renderToStaticMarkup(createElement(PrefireSetup, {...setupProps, showTips: false,
      config: {...setupProps.config, population: 'all', lineupId: 'alternate'}}));
    expect(html).toContain('Start: Outside cover');expect(html).toContain('Fixed lineup');
    expect(html).toContain('aria-label="Practice lineup"');expect(html).toContain('value="alternate" selected=""');
    expect(html).toContain('Alternate hold');expect(html).not.toContain('Base hold');
  });

  it('omits lineup selection for weighted practice and single-lineup routes', () => {
    const weighted = renderToStaticMarkup(createElement(PrefireSetup, setupProps));
    expect(weighted).not.toContain('Practice lineup');expect(weighted).toContain('Base hold');expect(weighted).toContain('Alternate hold');
    const single = {...route, lineups: route.lineups!.slice(0, 1)};
    expect(renderToStaticMarkup(createElement(PrefireSetup, {...setupProps, routes: [single],
      config: {...setupProps.config, population: 'all'}}))).not.toContain('Practice lineup');
  });
  it('falls back to the active approach core lineup when an old lineup ID belongs elsewhere', () => {
    const html = renderToStaticMarkup(createElement(PrefireSetup, {...setupProps,
      config: {...setupProps.config, population: 'all', lineupId: 'previous-approach'}}));
    expect(html).toContain('value="route-a" selected=""');
    expect(html).not.toContain('value="previous-approach"');
    expect(html).toContain('Base hold');
  });
});
