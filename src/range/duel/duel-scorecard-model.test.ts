import {describe, expect, it} from 'vitest';
import type {DuelReview} from './coaching';
import {emptyAimMetrics} from './aim-metrics';
import type {DuelDebrief, FightFinding} from './fight-feedback';
import {duelScorecardModel, selectScorecardReview} from './duel-scorecard-model';

const review = (value: Record<string, unknown> = {}) => value as unknown as DuelReview;
const finding = (key: string): FightFinding => ({key, title: `${key} observed`, evidence: `Measured ${key} evidence.`,
  action: `Original ${key} action.`, goal: 'Compare the next five openings.'});
const debrief = (findings: FightFinding[] = [], openings = 5): DuelDebrief => ({findings, openings, openingHits: 2,
  firstShotMs: 300, misses: {aim: 2, spread: 1, cover: 0, unclassified: 0}, fights: []});
const metric = (label: string, value: string, score = 100) => ({label, value, score, detail: 'Recorded evidence.'});

describe('Duel scorecard view model', () => {
  it('uses raw measured categories without inventing a combined skill score', () => {
    const model = duelScorecardModel(review({coaching: {metrics: [metric('Prepared openings', '1/5 (20%)'),
      metric('Shot timing', '2/10 (20%)'), metric('Single-angle openings', '3/5 (60%)')]}}));
    expect(model.skills.map(row => row.value)).toEqual(['1/5', '2/10', '3/5']);
    expect(model.skills.map(row => row.detail)).toEqual(['prepared openings', 'disciplined shots', 'isolated openings']);
  });

  it('selects at most two different evidenced weaknesses in recorded priority order', () => {
    const model = duelScorecardModel(review({debrief: debrief([finding('movement'), finding('air'), finding('control')])}));
    expect(model.weaknesses.map(row => row.key)).toEqual(['movement', 'control']);
    expect(model.weaknesses[0]).toMatchObject({evidence: 'Measured movement evidence.',
      action: 'Original movement action.'});
    expect(model.provisional).toBe(false);
  });

  it('preserves context-specific actions rather than replacing them with category advice', () => {
    const action = 'Your opening stop was clean. Finish the follow-up burst before strafing, or reset behind cover.';
    const model = duelScorecardModel(review({debrief: debrief([{...finding('movement'), action}, finding('control')])}));
    expect(model.weaknesses[0].action).toBe(action);
    expect(model.weaknesses[1].action).toBe('Original control action.');
    expect(duelScorecardModel(review({debrief: debrief([{...finding('movement'), action: 'undefined'}])})).weaknesses).toEqual([]);
  });

  it('does not label random dispersion, strengths or unexplained outcomes as skill weaknesses', () => {
    const model = duelScorecardModel(review({debrief: debrief([finding('spread'), finding('strength'), finding('opening-result')])}));
    expect(model.weaknesses).toEqual([]);
    expect(model.nextRep).toBe('Original spread action.');
  });

  it('keeps one observed error provisional instead of asserting a consistent weakness', () => {
    const model = duelScorecardModel(review({debrief: {...debrief([finding('aim-sample')], 1), openingHits: 0}}));
    expect(model.weaknesses).toHaveLength(1);
    expect(model.provisional).toBe(true);
    expect(model.sample).toBe('1 measured opening');
  });

  it('has six headline stats with timing denominators and a distinct all-shot denominator', () => {
    const aim = emptyAimMetrics();
    aim.counts = {...aim.counts, encounters: 5, damaged: 3, killed: 2, shots: 10, hits: 3};
    aim.measurements.damage = [0, 200, 1600]; aim.measurements.kill = [800, 1200];
    const model = duelScorecardModel(review({shots: 30, hits: 5, aim, debrief: debrief()}));
    expect(model.headline).toHaveLength(6);
    expect(model.headline[0]).toMatchObject({value: '200 ms', sample: 'n=3 damaged contacts'});
    expect(model.headline[1]).toMatchObject({value: '1000 ms', sample: 'n=2 lethal contacts'});
    expect(model.headline[2]).toMatchObject({value: '40%', sample: '2/5 openings hit'});
    expect(model.headline[3]).toMatchObject({value: '30%', sample: '3/10 visible-target shots'});
    expect(model.headline[5].value).toBe('5 / 30');
  });

  it('displays all holds in raw TTD and preserves genuine zero times', () => {
    const aim = emptyAimMetrics(); aim.counts.encounters = 1; aim.counts.damaged = 1;
    aim.measurements.damage = [1800];
    expect(duelScorecardModel(review({aim})).headline[0].value).toBe('1800 ms');
    aim.measurements.damage = [0];
    expect(duelScorecardModel(review({aim})).headline[0].value).toBe('0 ms');
  });

  it('never treats empty timing samples, zero openings or absent legacy metrics as zero performance', () => {
    const model = duelScorecardModel(review({aim: emptyAimMetrics(), debrief: {...debrief([], 0), openingHits: 0}}));
    expect(model.headline.slice(0, 4).map(row => row.value)).toEqual(['--', '--', '--', '--']);
    expect(model.skills.map(row => row.value)).toEqual(['--', '--', '--']);
    expect(model.weaknesses).toEqual([]);
    expect(model.provisional).toBe(true);
    const legacy = duelScorecardModel(review({timeToDamage: 250, accuracy: 99, score: 85}));
    expect(legacy.headline[0]).toMatchObject({value: '250 ms', sample: 'Legacy timing; sample unknown'});
    expect(legacy.headline[3].value).toBe('--');
    expect(legacy.skills.every(row => row.value === '--')).toBe(true);
  });

  it('does not display a pre-spread scoring percentage as actual spotted accuracy', () => {
    const model = duelScorecardModel(review({coaching: {metrics: [metric('Visible-target accuracy', '2/10 (20%)', 100)]}}));
    expect(model.headline[3].value).toBe('20%');
    expect(model.skills[0]).toMatchObject({value: '2/10', detail: 'visible-target hits'});
  });

  it('rejects malformed metrics, impossible counts and unsafe optional measurements', () => {
    const aim = emptyAimMetrics(); aim.counts.hits = 10;
    const model = duelScorecardModel(review({aim, damage: Infinity, taken: -1, shots: 1.5, hits: NaN,
      timeToDamage: -1, debrief: {...debrief(), openings: 1.5, openingHits: 0},
      coaching: {metrics: [null, metric('Prepared openings', '9/2 (450%)'), metric('Shot timing', '0/0'),
        metric('Single-angle openings', 'NaN'), metric('Broken', '[object Object]')]}}));
    expect(model.aim).toBeUndefined(); expect(model.debrief).toBeUndefined();
    expect(model.skills.every(row => row.value === '--')).toBe(true);
    expect(model.headline[0].value).toBe('--');
    expect(model.headline[4].value).toBe('-- / --');
    expect(model.headline[5].value).toBe('-- / --');
    expect(model.metrics.some(row => row.label === 'Broken')).toBe(false);
  });

  it('rejects corrupt finding text and unknown finding keys', () => {
    const model = duelScorecardModel(review({debrief: debrief([
      {...finding('movement'), evidence: 'Infinity'}, finding('unrecorded-skill'), finding('cover')])}));
    expect(model.weaknesses.map(row => row.key)).toEqual(['cover']);
    expect(duelScorecardModel(review({debrief: debrief([finding('__proto__'), finding('constructor')])})).weaknesses).toEqual([]);
  });

  it('withholds contradictory hit counts and timing sample counts', () => {
    const aim = emptyAimMetrics(); aim.counts.encounters = 1; aim.measurements.damage = [500];
    const model = duelScorecardModel(review({aim, shots: 2, hits: 5}));
    expect(model.aim).toBeUndefined();
    expect(model.headline[5].value).toBe('-- / 2');
  });

  it('preserves recorded scores and inputs without modifying them', () => {
    const source = review({debrief: debrief([finding('movement')]), coaching: {score: 41, metrics: [metric('Shot timing', '2/10 (20%)', 20)]}});
    const before = structuredClone(source);
    duelScorecardModel(source);
    expect(source).toEqual(before);
  });

  it('selects completed evidence through auto-advance and rejects non-object history', () => {
    const old = review({shots: 1}), completed = review({damage: 25});
    const result = selectScorecardReview({review: review(), completedReview: completed, completedSetupKey: 'completed',
      history: [null, {review: 'bad'}, {review: old, setupKey: 'old'}] as never});
    expect(result.review).toBe(completed); expect(result.profileKey).toBe('completed');
    expect(result.rounds).toHaveLength(1); expect(result.current).toBe(false);
  });
});
