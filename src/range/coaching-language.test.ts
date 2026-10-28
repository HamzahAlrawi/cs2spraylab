import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {CoachingReview} from './CoachingReview';
import {PracticeBlock, SkillTrends} from './PracticeBlock';
import {startPractice, practicePlan, recordPractice} from './adaptive-practice';
import {coachingTerms, skillName} from './coaching-language';
import type {CoachingSummary} from './coaching-types';

const summary: CoachingSummary = {score: 65, focus: 'Control the later climb',
  action: 'The spray is climbing. Add downward correction as it rises.',
  evidence: '4 late centers high.', goal: 'Repeat this range before adding rounds.', confidence: '10 shots, not a rank.',
  metrics: [{label: 'Shot discipline', value: '100%', score: 100, detail: 'Actual movement eligibility.'},
    {label: 'Recoil containment', value: '30%', score: 30, detail: 'Centers before spread.'}]};

describe('CS2 coaching presentation without stored-key migrations', () => {
  it('uses familiar display names but keeps the original practice key and recording behavior', () => {
    const before = JSON.stringify(summary), plan = practicePlan(summary)!;
    expect(plan.skill).toBe('Recoil containment');
    expect(skillName(plan.skill)).toBe('Spray control');
    expect(skillName('Unknown future skill')).toBe('Unknown future skill');
    const block = startPractice(plan, 'same-setup');
    const recorded = recordPractice(block, 'rep-1', 'same-setup', summary);
    expect(recorded.values).toEqual([30]);
    const html = renderToStaticMarkup(createElement(PracticeBlock, {block: recorded, onEnd: () => {}}));
    expect(html).toContain('<strong>Spray control</strong>');
    expect(JSON.stringify(summary)).toBe(before);
  });
  it('puts the next action before evidence and leaves the beginner definitions collapsed', () => {
    const html = renderToStaticMarkup(createElement(CoachingReview, {summary}));
    expect(html.indexOf(summary.action)).toBeLessThan(html.indexOf(summary.evidence));
    expect(html).toContain('aria-label="Spray control practice score"');
    expect(html).toContain('<details class="coaching-terms">');
    expect(html).not.toContain('<details class="coaching-terms" open');
    expect(html).toContain('Releasing the trigger or changing targets does not instantly reset recoil');
    expect(html).not.toContain('<dt>Recoil containment</dt>');
  });
  it('keeps compact live reviews free of extra glossary text', () => {
    const html = renderToStaticMarkup(createElement(CoachingReview, {summary, compact: true}));
    expect(html).not.toContain('CS2 terms');
    expect(html).toContain(summary.action);
  });
  it('keeps displayed skill names consistent in trend summaries', () => {
    const rows = [{label: 'Recoil containment', recent: 60, recentCount: 3, previous: 40, previousCount: 3, samples: 6}];
    const html = renderToStaticMarkup(createElement(SkillTrends, {rows}));
    expect(html).toContain('<b>Spray control</b>');
    expect(rows[0].label).toBe('Recoil containment');
  });
  it('only explains relevant terms, without blanket bans on wide swings or mouse correction', () => {
    expect(coachingTerms(['Direction error', 'Distance error'])).toEqual([]);
    const terms = coachingTerms(['Prepared openings', 'Single-angle openings', 'Prepared aim']);
    expect(terms).toHaveLength(2);
    expect(terms[0].meaning).toContain('Do not force movement-only aim');
    expect(terms[1].meaning).toContain('wide swing can still be useful');
  });
});
