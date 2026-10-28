import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {DuelCoach, type DuelReview} from './coaching';
import {DuelScorecard} from './DuelScorecard';
import {DuelSimulation} from './simulation';
import {CoachingActions} from '../CoachingReview';

const render = (review?: DuelReview, history: Parameters<typeof DuelScorecard>[0]['history'] = []) =>
  renderToStaticMarkup(createElement(DuelScorecard, {review, history}));
const incomplete = (review: Record<string, unknown>) => review as unknown as DuelReview;

function measuredReview() {
  const coach = new DuelCoach(), self = {...new DuelSimulation().snapshot()[0],
    position: {x: 0, y: 1.6, z: 0}, yaw: 0, pitch: 0, grounded: true, velocity: {x: 0, z: 0}};
  const point = {x: 0, y: 1.6, z: -20};
  coach.observe(1, self, [{id: 1, position: point, aimPoint: point, headPoint: point}]);
  coach.shot(self, 1, 1);
  coach.hit({kind: 'hit', tick: 1, shooter: 0, victim: 1, shotId: 1, group: 'head',
    point, healthDamage: 40, armorDamage: 0, lethal: false}, 1.2);
  return coach.review();
}

describe('Persistent Duel skill review', () => {
  it('does not offer an inert practice action for saved history without its active round context', () => {
    const review = measuredReview();
    const card = (completedReview?: DuelReview) => renderToStaticMarkup(createElement(CoachingActions.Provider,
      {value: {practice: () => {}, lesson: () => {}}}, createElement(DuelScorecard,
        {review, completedReview, history: []})));
    expect(card()).not.toContain('Practice this'); expect(card()).toContain('Review lesson');
    expect(card(review)).toContain('Practice this');
  });
  it('keeps completed feedback readable when automatic advance starts an unmeasured round', () => {
    const last: DuelReview = {...new DuelCoach().review(), shots: 5, hits: 3,
      message: 'Review this completed opening', coaching: undefined};
    const html = renderToStaticMarkup(createElement(DuelScorecard, {review: new DuelCoach().review(),
      history: [{date: '2026-10-10T10:00:00Z', outcome: 'won', review: last}]}));
    expect(html).toContain('Last completed round'); expect(html).toContain('Review this completed opening');
  });
  it('prefers the completed-round snapshot over older history after an automatic restart', () => {
    const completedReview = {...measuredReview(), message: 'Newest completed round', coaching: undefined};
    const html = renderToStaticMarkup(createElement(DuelScorecard, {review: new DuelCoach().review(), completedReview,
      history: [{date: '2026-10-10T10:00:00Z', outcome: 'won', review: {...measuredReview(), message: 'Older history', coaching: undefined}}]}));
    expect(html).toContain('Last completed round'); expect(html).toContain('Newest completed round');
    expect(html).not.toContain('Older history');
  });
  it('switches to current measured feedback once the player takes the next fight', () => {
    const live: DuelReview = {...new DuelCoach().review(), shots: 1, message: 'Current measured opening', coaching: undefined};
    const html = renderToStaticMarkup(createElement(DuelScorecard, {review: live, history: []}));
    expect(html).toContain('Current round'); expect(html).toContain('Current measured opening');
  });

  it('renders a real measured review with one verdict, one action and collapsed advanced metrics', () => {
    const review = measuredReview(), html = render(review);
    expect(html).toContain(`<h3>${review.coaching!.focus}</h3>`);
    expect(html.split(review.coaching!.action)).toHaveLength(2);
    expect(html).toContain('1 / 1');
    expect(html).toContain('40 / 0');
    expect(html).toContain('200 ms');
    expect(html).toContain('100/100');
    expect(html).toMatch(/<details[^>]*><summary>Skill breakdown<\/summary>/);
    expect(html).not.toContain('class="coaching-metrics"');
    expect(html).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/);
  });

  it('keeps a legacy review without coaching readable without inventing optional measurements', () => {
    const html = render(incomplete({shots: 3, hits: 1, damage: 20, taken: 0, score: 64,
      message: 'Stop before shooting', tip: 'Settle before the first shot.'}));
    expect(html).toContain('Stop before shooting');
    expect(html).toContain('Settle before the first shot.');
    expect(html).toContain('3');
    expect(html).toContain('64/100');
    expect(html).not.toMatch(/NaN|undefined|Infinity|Invalid Date/);
    expect(html).not.toContain('0 ms');
  });

  it('shows missing, non-finite and out-of-range measurements as unavailable', () => {
    const html = render(incomplete({shots: 3, hits: undefined, heads: null, kills: -1,
      accuracy: NaN, headRate: Infinity, settled: 101, score: Infinity, meanSpeed: NaN,
      damage: Infinity, taken: 0, placement: undefined, timeToDamage: undefined,
      movingShots: NaN, airShots: undefined, multipleAnglesSeconds: -1}));
    expect(html).toContain('Not measured');
    expect(html).not.toMatch(/NaN|undefined|Infinity|Invalid Date|-1|101%/);
    expect(html).not.toContain('0 ms');
    expect(html).not.toContain('0.0 deg');
  });

  it('uses available partial coaching without trusting malformed fields or metric rows', () => {
    const review = incomplete({shots: 2, hits: 1, message: 'Legacy focus', tip: 'Legacy action',
      coaching: {focus: 'Prepare the next fight', action: 'Aim before firing.', metrics: [null,
        {label: 'Broken', value: 'NaN%', score: NaN, detail: 'undefined'},
        {label: 'Shot timing', value: '1/2 (50%)', score: 50, detail: 'Measured grounded shots.'}]}});
    const html = render(review);
    expect(html).toContain('Prepare the next fight');
    expect(html).toContain('Aim before firing.');
    expect(html).toContain('1/2 (50%)');
    expect(html).not.toMatch(/NaN|undefined|Infinity|Legacy focus|Broken/);
    expect(() => render(incomplete({shots: 1, coaching: {metrics: {}}}))).not.toThrow();
  });

  it('rejects junk coaching text and unknown history metadata without losing valid rounds', () => {
    const review = incomplete({shots: 1, message: 'undefined', tip: '[object Object]',
      coaching: {focus: 'NaN', action: null, metrics: []}});
    const html = render(review, [{date: 'not-a-date', outcome: 'undefined', review},
      {date: '2026-10-10T10:00:00Z', outcome: 'won', review: measuredReview()}]);
    expect(html).toContain('Review this round');
    expect(html).toContain('Round recorded');
    expect(html).toContain('Time unavailable');
    expect(html).toContain('Won');
    expect(html).not.toMatch(/NaN|undefined|Infinity|Invalid Date|\[object Object\]/);
  });

  it('keeps current melee damage instead of replacing it with an older gun round', () => {
    const coach = new DuelCoach();
    coach.hit({kind: 'hit', tick: 1, shooter: 0, victim: 1, shotId: 1, group: 'chest',
      point: {x: 0, y: 1, z: 0}, healthDamage: 25, armorDamage: 0, lethal: false}, 1, true);
    const html = render(coach.review(), [{date: '2026-10-10T10:00:00Z', outcome: 'won', review: measuredReview()}]);
    expect(html).toContain('Current round');
    expect(html).toContain('25 / 0');
    expect(html).toContain('Unscored');
    expect(html).not.toMatch(/>0%<|>0 u\/s</);
  });

  it('preserves a genuine zero score and zero timing without treating them as missing', () => {
    const html = render({...measuredReview(), score: 0, timeToDamage: 0, coaching: undefined});
    expect(html).toContain('0/100'); expect(html).toContain('0 ms');
  });

  it('does not replace measured history with an empty completed snapshot', () => {
    const html = renderToStaticMarkup(createElement(DuelScorecard, {review: new DuelCoach().review(),
      completedReview: new DuelCoach().review(), history: [{date: '2026-10-10', outcome: 'won', review: measuredReview()}]}));
    expect(html).toContain('Last completed round'); expect(html).toContain('100/100');
    expect(html).toContain('40 / 0'); expect(html).not.toContain('Unscored');
  });

  it('handles an empty review and a missing review in legacy history', () => {
    expect(render()).toContain('Complete a duel');
    expect(() => render(undefined, [{date: '2026-10-10', outcome: 'won', review: undefined as unknown as DuelReview}])).not.toThrow();
  });
});
