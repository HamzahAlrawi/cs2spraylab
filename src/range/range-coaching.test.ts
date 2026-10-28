import {describe, expect, it} from 'vitest';
import {DEG, UNIT} from './actor-physics';
import {gameData} from './config';
import {coachRangeAttempt, comparableRangePractice, measureRangeShot} from './range-coaching';
import {parseRangeResults} from './range-results';
import {readCoachingSummary} from './coaching-types';
import {Simulation, type ImpactSample, type Result} from './simulation';
import {defaults} from './config';

const shot = (i: number, patch: Partial<ImpactSample> = {}): ImpactSample => ({x: 0, y: 0, hit: true, head: true, bullet: i + 1,
  at: i * .1, distance: 12, aimX: 0, aimY: 0, settled: true, target: 0, targetAlive: true, wrongTarget: false, ...patch});
const attempt = (patch: Partial<Result> = {}): Result => ({id: 'one', weapon: 'ak47', mode: 'guided', shots: 10, hits: 10,
  heads: 10, seconds: 1, tracking: 0, date: '2026-10-10T10:00:00Z', samples: Array.from({length: 10}, (_, i) => shot(i)),
  practice: {spread: false, moving: false, distance: 12, burst: 10, transferRule: 'bullet', transferAfter: 5}, ...patch});

describe('Measured range skills', () => {
  it('uses the physical recoil sign and pitch for shot-center feedback without altering impacts', () => {
    const m = measureRangeShot({origin: {x: 0, y: 1.63, z: 0}, targetPoint: {x: 0, y: 1.63, z: -20},
      yaw: 2 * DEG, pitch: -3 * DEG, recoil: {yaw: 2, pitch: 3}, velocity: {x: 0, z: 0},
      stats: gameData.weapons.ak47, walking: false, grounded: true, at: 0, target: 0, targetAlive: true, wrongTarget: false});
    expect(m.aimX).toBeCloseTo(0); expect(m.aimY).toBeCloseTo(0); expect(m.settled).toBe(true);
  });
  it('grades firing-mode native movement thresholds and ground contact, not just raw key state', () => {
    const input = {origin: {x: 0, y: 1.63, z: 0}, targetPoint: {x: 0, y: 1.63, z: -20},
      yaw: 0, pitch: 0, recoil: {yaw: 0, pitch: 0}, velocity: {x: 73.1 * UNIT, z: 0},
      stats: gameData.weapons.ak47, walking: false, grounded: true, at: 0, target: 0, targetAlive: true, wrongTarget: false};
    expect(measureRangeShot(input).settled).toBe(true);
    expect(measureRangeShot({...input, velocity: {x: 73.2 * UNIT, z: 0}}).settled).toBe(false);
    expect(measureRangeShot({...input, grounded: false}).settled).toBe(false);
  });
  it('does not fabricate a perfect score from one lucky hit', () => {
    const c = coachRangeAttempt(attempt({shots: 1, hits: 1, heads: 1, samples: [shot(0)]}));
    expect(c.score).toBeNull(); expect(c.confidence).toContain('too few');
  });
  it('keeps actual random misses separate from recoil containment', () => {
    const r = attempt({mode: 'spray', hits: 3, heads: 3, samples: Array.from({length: 10}, (_, i) => shot(i, {hit: i < 3, head: i < 3, distance: 60})),
      practice: {...attempt().practice!, spread: true, distance: 60}});
    const c = coachRangeAttempt(r); expect(c.score).toBe(100); expect(c.focus).toContain('dispersion');
    expect(c.metrics.find(m => m.label === 'Physical hit rate')?.value).toBe('3/10');
    expect(c.action).toContain('short bursts');
  });
  it('late uncontrolled fire scores lower even with an eventual hit', () => {
    const r = attempt({hits: 6, heads: 6, samples: Array.from({length: 10}, (_, i) => shot(i, i < 6 ? {} : {hit: false, head: false, aimY: 1}))});
    const c = coachRangeAttempt(r); expect(c.score).toBe(80); expect(c.focus).toBe('Control the later climb');
    expect(c.evidence).toContain('4 centers high'); expect(c.goal).toContain('late-section');
    expect(c.action).toContain('spray is climbing');
  });
  it('diagnoses over-pulling and horizontal drift differently', () => {
    for (const [patch, expected] of [[{aimY: -2}, 'Ease the downward correction'], [{aimX: 2}, 'Match the sideways recoil']] as const) {
      const c = coachRangeAttempt(attempt({samples: Array.from({length: 10}, (_, i) => shot(i, i < 6 ? {} : patch))}));
      expect(c.focus).toBe(expected);
    }
  });
  it('diagnoses head-guide misses using the head area rather than the free-spray body envelope', () => {
    for (const [patch, expected] of [[{aimY: -.25}, 'Ease the downward correction'],
      [{aimX: .25}, 'Match the sideways recoil'], [{aimX: .15, aimY: .15}, 'Control the later climb']] as const) {
      const c = coachRangeAttempt(attempt({samples: Array.from({length: 10}, (_, i) => shot(i, i < 6 ? {} : patch))}));
      expect(c.focus).toBe(expected);
      expect(c.score).toBe(80);
    }
  });
  it('does not blame a clean late spray for errors in the opening rounds', () => {
    const c = coachRangeAttempt(attempt({samples: Array.from({length: 10}, (_, i) => shot(i, i > 0 && i < 6 ? {aimX: .8} : {}))}));
    expect(c.focus).toBe('Control the opening shots');
    expect(c.evidence).toContain('later rounds: 100%');
    expect(c.action).not.toMatch(/late spray|spray is climbing|overpulling/);
    expect(c.score).toBe(75);
  });
  it('does not call lateral moving-target errors proof of a wrong recoil pattern', () => {
    const c = coachRangeAttempt(attempt({practice: {...attempt().practice!, moving: true},
      samples: Array.from({length: 10}, (_, i) => shot(i, i < 6 ? {} : {aimX: .8}))}));
    expect(c.focus).toBe('Track while controlling recoil');
    expect(c.action).toContain('tracking error');
    expect(c.action).toContain('recoil correction');
    expect(c.score).toBe(80);
  });
  it('measures starting error before diagnosing the sustained pattern', () => {
    const c = coachRangeAttempt(attempt({samples: Array.from({length: 10}, (_, i) => shot(i, {aimX: 2}))}));
    expect(c.focus).toBe('Prepare the opening aim'); expect(c.evidence).toContain('2.00 m sideways');
  });
  it('accepts body follow-ups in free spray, but keeps guided head control specific', () => {
    const samples = Array.from({length: 10}, (_, i) => shot(i, {aimY: i ? -.6 : 0, head: !i}));
    expect(coachRangeAttempt(attempt({mode: 'spray', samples, heads: 1})).score).toBe(100);
    expect(coachRangeAttempt(attempt({samples, heads: 1})).score).toBeLessThan(100);
  });
  it.each(['awp', 'nova', 'zeus'] as const)('does not penalize upper-body aim with %s', weapon => {
    const c = coachRangeAttempt(attempt({weapon, mode: 'spray', heads: 0, samples: Array.from({length: 10}, (_, i) => shot(i, {aimY: -.65, head: false}))}));
    expect(c.score).toBe(100); expect(c.action).toContain('Headshot percentage is not');
  });
  it('cannot call a transfer complete without shots scheduled on B', () => {
    const c = coachRangeAttempt(attempt({mode: 'transfer'}));
    expect(c.score).toBeLessThanOrEqual(50); expect(c.focus).toBe('Complete the second target');
  });
  it('reports exact B acquisition and wrong-target hits, not only the total hit rate', () => {
    const r = attempt({mode: 'transfer', hits: 7, heads: 7, samples: Array.from({length: 10}, (_, i) => shot(i,
      {target: i < 5 ? 0 : 1, hit: i < 5 || i >= 8, head: i < 5 || i >= 8, wrongTarget: i === 6}))});
    const c = coachRangeAttempt(r); expect(c.focus).toContain('Acquire B');
    expect(c.evidence).toContain('3 missed rounds'); expect(c.evidence).toContain('1 shots struck the wrong');
    expect(c.metrics[c.metrics.length - 1]?.value).toBe('Round 4');
  });
  it('only compares like weapon, range, mode, spread and transfer setup', () => {
    const a = attempt(); expect(comparableRangePractice(a, attempt())).toBe(true);
    expect(comparableRangePractice(a, attempt({weapon: 'm4a4'}))).toBe(false);
    expect(comparableRangePractice(a, attempt({practice: {...a.practice!, distance: 80}}))).toBe(false);
    expect(comparableRangePractice(a, attempt({practice: {...a.practice!, spread: true}}))).toBe(false);
  });
  it('repeated coaching reacts only to comparable measured attempts', () => {
    const r = attempt({samples: Array.from({length: 10}, (_, i) => shot(i, {settled: false}))});
    const previous = {...r, coaching: coachRangeAttempt(r)};
    expect(coachRangeAttempt(r, [previous, previous]).action).toContain('three comparable');
    expect(coachRangeAttempt(r, [{...previous, weapon: 'm4a4'}, previous]).action).not.toContain('three comparable');
  });
  it('old attempts have unmeasured quality instead of silently converting hit rates', () => {
    const old = attempt({samples: [{x: 0, y: 0, hit: true, head: true, bullet: 1}], practice: undefined});
    const [r] = parseRangeResults([old]); expect(r.coaching?.score).toBeNull(); expect(r.coaching?.evidence).toContain('older attempt');
  });
  it('validates persisted measurements and recomputes scores rather than trusting stored scores', () => {
    const r = attempt({coaching: {...coachRangeAttempt(attempt()), score: 0}});
    expect(parseRangeResults([r])[0].coaching?.score).toBe(100);
    expect(parseRangeResults([{...r, hits: 11}])).toEqual([]);
    expect(readCoachingSummary({...r.coaching, score: 500})).toBeUndefined();
    expect(readCoachingSummary({...r.coaching, metrics: [{label: 'bad', score: NaN}]})).toBeUndefined();
  });
  it('publishes measured coaching without changing shot directions or stored impact positions', () => {
    const sim = new Simulation({...defaults, mode: 'guided', burst: 5, spread: false});
    sim.onShot = s => {sim.hits++; sim.heads++; sim.samples.push(shot(s.index));};
    sim.start(true); sim.advance(.25); sim.advance(.25);
    expect(sim.latest?.coaching?.score).toBe(100); expect(sim.latest?.samples.map(s => [s.x, s.y])).toEqual(Array.from({length: 5}, () => [0, 0]));
  });
  it('retains scoped firing stats after a bolt-action weapon unscopes, including the drill opening', () => {
    const sim = new Simulation({...defaults, mode: 'precision', weapon: 'awp', spread: true});
    sim.actions.zoom = 1; sim.velocity = {x: 55 * UNIT, z: 0};
    let eventCap = 0;
    sim.onShot = event => {eventCap = event.accuracy?.stats.speed ?? 0;};
    sim.start(true);
    expect(sim.actions.zoom).toBe(0); expect(sim.stats.speed).toBe(200);
    expect(eventCap).toBe(100); expect(sim.drillResult?.firstSettled).toBe(false);
    expect(sim.drillResult?.speedLimit).toBeCloseTo(34);
  });
  it('grades short semi-automatic tap series across real presses without resetting recoil', () => {
    const one = attempt({weapon: 'deagle', mode: 'spray', shots: 1, hits: 1, heads: 1, samples: [shot(0)], practice: {...attempt().practice!, burst: 7}});
    const second = {...one, id: 'two', date: '2026-10-10T10:00:01Z'};
    const third = {...one, id: 'three', date: '2026-10-10T10:00:02Z'};
    expect(coachRangeAttempt(one).score).toBeNull();
    const summary = coachRangeAttempt(third, [second, one]);
    expect(summary.score).toBe(100); expect(summary.evidence).toContain('Recent 3 taps');
    expect(parseRangeResults([third, second, one])[0].coaching?.score).toBe(100);
    const drifting = {...third, samples: [shot(0, {aimY: 1.8})]};
    expect(coachRangeAttempt(drifting, [second, one]).focus).toBe('Recenter the follow-up taps');
    expect(coachRangeAttempt({...third, date: '2026-10-10T10:01:00Z'}, [second, one]).score).toBeNull();
  });
});
