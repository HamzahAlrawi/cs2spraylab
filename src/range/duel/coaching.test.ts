import {afterEach, describe, expect, it, vi} from 'vitest';
import {DuelCoach, damageBearing, loadDuelHistory} from './coaching';
import {DuelSimulation} from './simulation';
import type {DuelActorSnapshot, DuelEvent} from './types';
import {UNIT} from '../actor-physics';
import {observeBot} from './perception';
import type {VisibleEnemy} from './perception';
import {testArena} from './geometry';
import type {Equipment} from '../equipment';
import {equipmentStats} from '../equipment';

const player = () => new DuelSimulation().snapshot()[0];
const hit = (patch = {}): Extract<DuelEvent, {kind: 'hit'}> => ({kind: 'hit', tick: 1, shooter: 0, victim: 1,
  shotId: 1, group: 'head', point: {x: 0, y: 1.6, z: 0}, healthDamage: 20, armorDamage: 1, lethal: false, ...patch});
afterEach(() => vi.unstubAllGlobals());

describe('Duel coaching', () => {
  it('keeps utility damage out of gun accuracy and self-damage out of rewards', () => {
    const coach = new DuelCoach();
    coach.hit(hit({utility: 'he', group: 'chest', healthDamage: 35}), 1);
    expect(coach.review()).toMatchObject({shots: 0, hits: 0, heads: 0, damage: 35});
    coach.hit(hit({utility: 'he', victim: 0, lethal: true, healthDamage: 40}), 2);
    expect(coach.review()).toMatchObject({hits: 0, damage: 35, taken: 40, kills: 0});
  });
  it('counts the union of moving/airborne shots, not the sum', () => {
    const coach = new DuelCoach(), self = player();
    coach.shot({...self, grounded: false, velocity: {x: 215 * UNIT, z: 0}});
    coach.shot(self);
    expect(coach.review()).toMatchObject({shots: 2, airShots: 1, movingShots: 1, settled: 50});
    expect(coach.review().tip).toContain('Land before firing');
  });
  it('reports shots, head hit rate, damage and contact-to-damage separately', () => {
    const coach = new DuelCoach(), self = player();
    coach.observe(1, self, [{id: 1, position: {x: 0, y: 1.6, z: 0}, aimPoint: {x: 0, y: 1.6, z: 0}}]);
    coach.shot(self); coach.hit(hit(), 1.45);
    coach.shot(self); coach.hit(hit({shotId:2,group: 'chest', lethal: true}), 1.55);
    coach.hit(hit({shooter: 1, victim: 0, healthDamage: 17}), 1.6);
    expect(coach.review()).toMatchObject({shots: 2, hits: 2, heads: 1, kills: 1, damage: 40, taken: 17, headRate: 50, accuracy: 100, settled: 100});
    expect(coach.review().timeToDamage).toBeCloseTo(450);
    expect(coach.review().score).toBeLessThanOrEqual(100);
    expect(Object.keys(coach.review())).not.toContain('spotted');
  });
  it('excludes melee from gun accuracy but keeps its damage and kills', () => {
    const coach = new DuelCoach(); coach.shot({...player(), equipment: 'knife'});
    coach.hit(hit({lethal: true}), 1, true);
    expect(coach.review()).toMatchObject({shots: 0, hits: 0, heads: 0, damage: 20, kills: 1, score: null});
  });
  it('counts reveal time again when a target hides before the first hit', () => {
    const coach = new DuelCoach(), self = player(), visible = [{id: 1, position: {x: 0, y: 1.6, z: 0}, aimPoint: {x: 0, y: 1.6, z: 0}}];
    coach.observe(0, self, visible); coach.observe(.1, self, []); coach.observe(4, self, visible);
    coach.shot(self); coach.hit(hit(), 4.25);
    expect(coach.review().timeToDamage).toBeCloseTo(250);
  });
  it('rejects incomplete history and bounds stored rounds', () => {
    const review = new DuelCoach().review();
    const history = Array.from({length: 60}, () => ({date: new Date(0).toISOString(), outcome: 'won', review}));
    vi.stubGlobal('localStorage', {getItem: () => JSON.stringify([{...history[0], review: {...review, meanSpeed: undefined}}, ...history])});
    expect(loadDuelHistory()).toHaveLength(50);
    vi.stubGlobal('localStorage', {getItem: () => 'bad json'});
    expect(loadDuelHistory()).toEqual([]);
  });
  it('defines damage direction relative to the player, not world yaw', () => {
    const self = {x: 2, y: 1, z: 4};
    expect(damageBearing(self, {...self, z: -2})).toBe(0);
    expect(damageBearing(self, {...self, x: 5})).toBeCloseTo(Math.PI / 2);
    expect(damageBearing(self, {...self, x: -5})).toBeCloseTo(-Math.PI / 2);
  });
  it('uses the actual player viewport and pitch for coaching visibility', () => {
    const [self, enemy] = new DuelSimulation().snapshot();
    enemy.position = {x: 8, y: 1.6, z: 0};
    const view = {aspect: 16 / 9, verticalFov: 2 * Math.atan(.75)};
    expect(observeBot(0, self, [enemy], testArena(), view).visible).not.toBeNull();
    expect(observeBot(0, self, [enemy], testArena(), {...view, aspect: .5}).visible).toBeNull();
    expect(observeBot(0, {...self, pitch: 1.3}, [enemy], testArena(), view).visible).toBeNull();
  });
});

const facing = (equipment: Equipment = 'ak47', range = 20): DuelActorSnapshot => ({...player(),
  equipment, position: {x: 0, y: 1.6, z: 0}, grounded: true, velocity: {x: 0, z: 0},
  yaw: 0, pitch: ['awp', 'ssg08', 'g3sg1', 'scar20', 'nova', 'xm1014', 'mag7', 'sawedoff', 'zeus'].includes(equipment)
    ? Math.atan2(-.4, range) : 0});
const target = (range = 20, id = 1): VisibleEnemy => ({id, position: {x: 0, y: 1.6, z: -range},
  aimPoint: {x: 0, y: 1.6, z: -range}, headPoint: {x: 0, y: 1.6, z: -range},
  bodyPoint: {x: 0, y: 1.2, z: -range}});
const metric = (coach: DuelCoach, label: string) => coach.review().coaching!.metrics.find(value => value.label === label)!;
const fireAt = (coach: DuelCoach, self: DuelActorSnapshot, time: number, id: number, enemies = [target()]) => {
  coach.observe(time, self, enemies); coach.shot(self, id, time);
};

describe('Contextual duel feedback', () => {
  it('excludes blind prefire, stale sight samples and unseen wallbang hits from spotted accuracy', () => {
    const coach = new DuelCoach(), self = facing();
    coach.shot(self, 1, 0);
    coach.observe(1, self, [target()]); coach.shot(self, 2, 1.2);
    fireAt(coach, self, 2, 3); coach.hit(hit({shotId: 3, victim: 2}), 2);
    fireAt(coach, self, 3, 4); coach.hit(hit({shotId: 4}), 3);
    expect(coach.review()).toMatchObject({shots: 4, hits: 2, accuracy: 50});
    expect(metric(coach, 'Visible-target accuracy').value).toBe('1/1 (100%)');
    expect(coach.review().coaching!.confidence).toContain('1 visible-target shots');
  });

  it('does not grade blind or knife activity as zero-percent aim', () => {
    const coach = new DuelCoach(), self = facing();
    coach.shot(self, 1, 0); coach.hit(hit({shotId: 1, lethal: true}), .1);
    coach.hit(hit({shotId: 2, victim: 2, lethal: true}), .2, true);
    expect(coach.review()).toMatchObject({kills: 2, damage: 40, score: null});
    expect(coach.review().coaching!.goal).toContain('blind prefire and knife');
  });

  it('does not count unrelated on-screen enemies as a target for blind spam', () => {
    const coach = new DuelCoach(), self = facing();
    const enemy = {...target(), position: {x: 15, y: 1.6, z: -20}, aimPoint: {x: 15, y: 1.6, z: -20}};
    fireAt(coach, self, 1, 1, [enemy]);
    expect(metric(coach, 'Visible-target accuracy').score).toBeNull();
    expect(coach.review().score).toBeNull();
  });

  it('counts shotgun pellets and collateral victims only once per actual shot', () => {
    const coach = new DuelCoach(), self = facing('nova', 5);
    fireAt(coach, self, 1, 14, [target(5), target(5, 2)]);
    coach.shot(self, 14, 1);
    coach.hit(hit({shotId: 14}), 1);
    coach.hit(hit({shotId: 14, victim: 2}), 1);
    coach.hit(hit({shotId: 14, victim: 2, group: 'chest'}), 1);
    expect(coach.review()).toMatchObject({shots: 1, hits: 1, heads: 1, accuracy: 100, damage: 60});
    expect(metric(coach, 'Visible-target accuracy').value).toBe('1/1 (100%)');
  });

  it.each(['awp', 'ssg08', 'g3sg1', 'scar20', 'nova', 'xm1014', 'mag7', 'sawedoff', 'zeus'] as Equipment[])
    ('accepts prepared %s center-mass openings and never demands a headshot', weapon => {
      const coach = new DuelCoach(), range = weapon === 'zeus' ? 2 : 10, self = facing(weapon, range);
      fireAt(coach, self, 1, 1, [target(range)]); coach.hit(hit({shotId: 1, group: 'chest', lethal: true}), 1);
      expect(metric(coach, 'Prepared openings').value).toBe('1/1 (100%)');
      expect(coach.review()).toMatchObject({headRate: 0, score: 100});
      expect(coach.review().message).not.toContain('head');
    });

  it('does not criticize later body hits when the rifle opening was prepared at head height', () => {
    const coach = new DuelCoach(), self = facing();
    for (let i = 1; i <= 5; i++) {
      fireAt(coach, self, i * .1, i); coach.hit(hit({shotId: i, group: 'chest'}), i * .1);
    }
    expect(coach.review()).toMatchObject({headRate: 0, score: 100});
    expect(coach.review().message).toBe('Make the first bullet count');
  });

  it('does not mistake recoil compensation during a transfer for low fresh pre-aim', () => {
    const coach = new DuelCoach(), self = facing();
    fireAt(coach, self, 1, 1); coach.hit(hit({lethal: true}), 1);
    fireAt(coach, {...self, pitch: -.05}, 1.1, 2, [target(20, 2)]);
    coach.hit(hit({shotId: 2, victim: 2, group: 'chest'}), 1.1);
    expect(metric(coach, 'Prepared openings').value).toBe('1/1 (100%)');
    expect(coach.review().message).not.toContain('head height');
    expect(metric(coach, 'Prepared openings').detail).toContain('spray-transfer');
  });

  it('gives a head-height cue only for a measured low rifle opening, including long range', () => {
    const coach = new DuelCoach(), self = {...facing('ak47', 100), pitch: Math.atan2(-.4, 100)};
    fireAt(coach, self, 1, 1, [target(100)]); coach.hit(hit({group: 'chest'}), 1);
    expect(coach.review().message).toBe('Pre-aim at head height');
    expect(coach.review().coaching!.evidence).toContain('1/1 measured rifle openings started below');
    expect(metric(coach, 'Prepared openings').score).toBe(0);
  });

  it('omits covered head preparation instead of inventing the hidden head position', () => {
    const coach = new DuelCoach(), self = facing(), enemy = target();
    delete enemy.headPoint;
    fireAt(coach, self, 1, 1, [enemy]); coach.hit(hit({group: 'chest'}), 1);
    expect(metric(coach, 'Prepared openings')).toMatchObject({score: null, value: '0/0'});
    expect(coach.review().score).toBe(100);
    expect(coach.review().message).not.toContain('head height');
  });

  it('uses the exposed head for a body-focused weapon when center mass is covered', () => {
    const coach = new DuelCoach(), self = {...facing('awp'), pitch: 0}, enemy = target();
    delete enemy.bodyPoint;
    fireAt(coach, self, 1, 1, [enemy]); coach.hit(hit(), 1);
    expect(metric(coach, 'Prepared openings').value).toBe('1/1 (100%)');
    expect(coach.review().score).toBe(100);
  });

  it('distinguishes a close SMG running shot from the same shot at range', () => {
    const near = new DuelCoach(), far = new DuelCoach();
    const stats = equipmentStats('mp9');
    const self = {...facing('mp9'), velocity: {x: stats.speed * UNIT, z: 0}};
    fireAt(near, self, 1, 1, [target(3)]); near.hit(hit(), 1);
    fireAt(far, self, 1, 1, [target(35)]); far.hit(hit(), 1);
    expect(near.review().movingShots).toBe(1);
    expect(metric(near, 'Shot timing').score).toBe(100);
    expect(metric(far, 'Shot timing').score).toBe(0);
    expect(far.review().message).toBe('Counter-strafe, then shoot');
  });

  it('grades actual firing-mode movement parameters, not a guessed universal speed cutoff', () => {
    const coach = new DuelCoach(), self = {...facing('awp'), velocity: {x: 50 * UNIT, z: 0}};
    coach.observe(1, self, [target()]);
    coach.shot(self, 1, 1, {stats: {...equipmentStats('awp'), speed: 100}, walking: false});
    expect(coach.review().movingShots).toBe(1);
    expect(metric(coach, 'Shot timing').score).toBe(0);
  });

  it('does not call a settled shot proof of counterstrafing or penalize an angle hold', () => {
    const hold = new DuelCoach(), entry = new DuelCoach(), self = facing();
    entry.observe(.9, {...self, velocity: {x: 220 * UNIT, z: 0}}, []);
    for (const coach of [hold, entry]) {
      fireAt(coach, self, 1, 1); coach.hit(hit(), 1);
    }
    expect(hold.review().score).toBe(entry.review().score);
    expect(metric(hold, 'Entered / held openings').value).toBe('0 / 1');
    expect(metric(entry, 'Entered / held openings').value).toBe('1 / 0');
    expect(metric(entry, 'Shot timing').detail).toContain('does not prove');
  });

  it('does not penalize information exposure when the committed opening isolates one enemy', () => {
    const info = new DuelCoach(), direct = new DuelCoach(), self = facing();
    info.observe(0, self, [target(), target(20, 2)]);
    info.observe(.04, self, [target(), target(20, 2)]);
    for (const coach of [info, direct]) {
      fireAt(coach, self, .08, 1); coach.hit(hit(), .08);
    }
    expect(info.review().multipleAnglesSeconds).toBeGreaterThan(0);
    expect(info.review().score).toBe(direct.review().score);
    expect(metric(info, 'Single-angle openings').score).toBe(100);
  });

  it('uses opening evidence rather than a blanket anti-wide-peek rule', () => {
    const coach = new DuelCoach(), self = facing();
    fireAt(coach, self, 1, 1, [target(), target(20, 2)]);
    coach.hit(hit(), 1);
    expect(coach.review().message).toBe('Isolate a 1v1');
    expect(coach.review().coaching!.evidence).toContain('1/1 opening shots');
    expect(coach.review().coaching!.evidence).toContain('Information peeks without firing are not penalized');
    expect(coach.review().tip).toContain('Slice the pie');
  });

  it('reports time to damage but does not score deliberate holding as slow reactions', () => {
    const scores: (number | null)[] = [], times: (number | null)[] = [];
    for (const delay of [.4, 3]) {
      const coach = new DuelCoach(), self = facing();
      coach.observe(0, self, [target()]); fireAt(coach, self, delay, 1);
      coach.hit(hit(), delay); scores.push(coach.review().score); times.push(coach.review().timeToDamage);
      expect(coach.review().coaching!.confidence).toContain('not a reaction-time grade');
    }
    expect(scores[0]).toBe(scores[1]); expect(times).toEqual([400, 3000]);
  });

  it('identifies deteriorating later-shot control without blaming every miss on recoil', () => {
    const coach = new DuelCoach(), self = facing('ak47', 30);
    for (let i = 1; i <= 9; i++) {
      fireAt(coach, self, i * .1, i, [target(30)]);
      if (i <= 3) coach.hit(hit({shotId: i, group: 'chest'}), i * .1);
    }
    expect(coach.review().message).toBe('Keep your spray on target');
    expect(coach.review().coaching!.evidence).toContain('100% on their first three shots, then 0%');
    expect(coach.review().tip).toContain('shorter controlled bursts');
    expect(metric(coach, 'Spray accuracy').value).toBe('3/9 (33%)');
  });

  it('does not invent a spray-control problem from one random miss', () => {
    const coach = new DuelCoach(); fireAt(coach, facing(), 1, 1);
    expect(coach.review().message).toBe('Make the first bullet count');
    expect(coach.review().coaching!.confidence).toContain('Provisional');
    expect(metric(coach, 'Visible-target accuracy').detail).toContain('one spread miss alone does not prove bad aim');
    expect(metric(coach, 'Spray accuracy').score).toBeNull();
  });

  it('keeps the first opening measurement when later shots improve', () => {
    const coach = new DuelCoach(), self = facing(), moving = {...self, velocity: {x: 220 * UNIT, z: 0}};
    fireAt(coach, moving, 1, 1); fireAt(coach, self, 1.1, 2); coach.hit(hit({shotId: 2}), 1.1);
    expect(coach.review().message).toBe('Counter-strafe, then shoot');
    expect(coach.review().coaching!.evidence).toContain('1/1 openings');
    expect(metric(coach, 'Shot timing').value).toBe('1/2 (50%)');
  });

  it('adapts recurring movement feedback to a focused easier practice step', () => {
    const coach = new DuelCoach(), self = {...facing(), velocity: {x: 220 * UNIT, z: 0}};
    for (let i = 1; i <= 3; i++) fireAt(coach, self, i, i, [target(20, i)]);
    expect(coach.review().coaching!.evidence).toContain('3/3 openings');
    expect(coach.review().tip).toContain('Slow the rep down');
    expect(coach.review().tip).toContain('Counterstrafing practice');
  });

  it('caches the expanded summary between shot/hit events, not per sight or render sample', () => {
    const coach = new DuelCoach(), self = facing(); fireAt(coach, self, 1, 1);
    const before = coach.review().coaching;
    coach.observe(1.03, self, [target()]);
    expect(coach.review().coaching).toBe(before);
    coach.hit(hit(), 1.03);
    const after = coach.review().coaching;
    expect(after).not.toBe(before);
    expect(metric(coach, 'Visible-target accuracy').score).toBe(100);
    expect(before?.metrics.find(value => value.label === 'Visible-target accuracy')?.score).toBe(0);
  });

  it('retains legacy history while discarding unsafe optional coaching payloads', () => {
    const review = new DuelCoach().review();
    const malformed = {...review, coaching: {...review.coaching, metrics: [{label: 'bad', value: {}, detail: '', score: 100}]}};
    vi.stubGlobal('localStorage', {getItem: () => JSON.stringify([
      {date: 'today', outcome: 'won', review: malformed},
      {date: 'yesterday', outcome: 'lost', review: {...review, coaching: undefined}},
      {date: 'now', outcome: 'won', review},
    ])});
    const history = loadDuelHistory();
    expect(history).toHaveLength(3);
    expect(history[0].review.coaching).toBeUndefined();
    expect(history[1].review.coaching).toBeUndefined();
    expect(history[2].review.coaching).toEqual(review.coaching);
  });
});

describe('Duel coaching copy', () => {
  const liveSummary = (coach: DuelCoach) => {
    const summary = coach.review().coaching!;
    expect(summary.action.length).toBeLessThanOrEqual(220);
    expect(summary.action.match(/[.!?](?: |$)/g)?.length).toBeLessThanOrEqual(2);
    expect(summary.action).not.toMatch(/\b(?:WASD|A\/D|Shift|Ctrl|Space)\b|\b(?:press|release|tap|hold) [ADWS]\b/);
    expect([summary.focus, summary.evidence, summary.action, summary.goal, summary.strength].join(' '))
      .not.toMatch(/suitable movement timing|prepared exposed points|never (?:wide peek|crouch|hold)/i);
    return summary;
  };

  it('gives a first-bullet focus without diagnosing one missed shot as bad aim', () => {
    const coach = new DuelCoach(); fireAt(coach, facing(), 1, 1);
    const summary = liveSummary(coach);
    expect(summary.focus).toBe('Make the first bullet count');
    expect(summary.action).toContain('first-bullet accuracy');
    expect(summary.goal).toBe('Next five openings: confirm the crosshair is on the exposed target before each first shot.');
    expect(summary.strength).toContain('swing or hold an angle');
    expect(summary.evidence).toContain('1/1 (100%) shots had no excess movement spread');
    expect(summary.confidence).toContain('not a reaction-time grade');
    expect(metric(coach, 'Visible-target accuracy').detail).toContain('one spread miss alone does not prove bad aim');
    expect(metric(coach, 'Spray accuracy').score).toBeNull();
  });

  it.each([false, true])('keeps unmeasured advice short, including airborne fire: %s', airborne => {
    const coach = new DuelCoach();
    if (airborne) coach.shot({...facing(), grounded: false});
    const summary = liveSummary(coach);
    expect(summary.score).toBeNull();
    expect(summary.evidence).toContain(airborne ? 'no fresh visible-target sequence' : 'No gunshots');
    expect(summary.action).toContain(airborne ? 'Land before firing' : 'Hold an angle or pre-aim');
  });

  it('ties jump-peek advice to airborne shots and keeps the accuracy caveat in evidence', () => {
    const coach = new DuelCoach(); fireAt(coach, {...facing(), grounded: false}, 1, 1);
    const summary = liveSummary(coach);
    expect(summary.evidence).toContain('1/1 visible-target shots were airborne');
    expect(summary.evidence).toContain('Crouching mid-air does not restore grounded accuracy');
    expect(summary.action).toContain('jump peek for info, then land and settle');
    expect(metric(coach, 'Shot timing').score).toBe(0);
  });

  it.each([1, 3])('coaches a stop before the shot, not a claimed keypress, across %s moving openings', count => {
    const coach = new DuelCoach(), self = {...facing(), velocity: {x: 220 * UNIT, z: 0}};
    for (let i = 1; i <= count; i++) {
      fireAt(coach, self, i * 5, i, [target(20, i)]);
      coach.hit(hit({shotId: i, victim: i}), i * 5);
    }
    const summary = liveSummary(coach);
    expect(summary.focus).toBe('Counter-strafe, then shoot');
    expect(summary.evidence).toContain(`${count}/${count} openings and ${count}/${count} shots still had excess movement spread`);
    expect(summary.evidence).toContain('a crouch spray can still be valid once settled');
    expect(summary.action).toContain(count === 1 ? 'Release the strafe key, tap the opposite direction' : 'Counterstrafing practice');
    expect(metric(coach, 'Shot timing').detail).toContain('does not prove an opposite-key counterstrafe');
    expect(summary.score).toBe(65);
  });

  it.each([1, 3])('suggests slicing the pie for %s multi-enemy openings, not a blanket wide-peek ban', count => {
    const coach = new DuelCoach(), self = facing();
    for (let i = 1; i <= count; i++) fireAt(coach, self, i * 5, i, [target(20, i * 2), target(20, i * 2 + 1)]);
    const summary = liveSummary(coach);
    expect(summary.focus).toBe('Isolate a 1v1');
    expect(summary.action).toMatch(/slice the pie/i);
    expect(summary.action).toContain('1v1');
    expect(summary.evidence).toContain(`${count}/${count} opening shots were taken with multiple enemies visible`);
    expect(summary.evidence).toContain('Information peeks without firing are not penalized');
    expect(metric(coach, 'Single-angle openings').detail).toContain('a wide swing is not automatically wrong');
    expect(metric(coach, 'Single-angle openings').score).toBe(0);
  });

  it.each([1, 3])('keeps mouse corrections and elevation in the head-height cue for %s low openings', count => {
    const coach = new DuelCoach(), self = {...facing(), pitch: Math.atan2(-.4, 20)};
    for (let i = 1; i <= count; i++) {
      fireAt(coach, self, i * 5, i, [target(20, i)]);
      coach.hit(hit({shotId: i, victim: i, group: 'chest'}), i * 5);
    }
    const summary = liveSummary(coach);
    expect(summary.focus).toBe('Pre-aim at head height');
    expect(summary.action).toContain('mouse');
    expect(summary.action).toContain('off-angle');
    expect(summary.action).toContain('crouched');
    expect(summary.evidence).toContain('Body hits later in a spray are fine');
    expect(metric(coach, 'Prepared openings').value).toBe(`0/${count} (0%)`);
    expect(summary.score).toBe(75);
  });

  it.each(['ak47', 'awp', 'nova', 'zeus'] as Equipment[])
    ('uses contextual pre-aim and mouse advice for unprepared %s openings', weapon => {
      const coach = new DuelCoach(), range = weapon === 'zeus' ? 2 : 10;
      const self = {...facing(weapon, range), yaw: weapon === 'zeus' ? .25 : .06};
      for (let i = 1; i <= 2; i++) fireAt(coach, self, i * 5, i, [target(range, i)]);
      const summary = liveSummary(coach);
      expect(summary.focus).toBe('Pre-aim the next fight');
      expect(summary.evidence).toContain('0/2 (0%) openings had the crosshair near the exposed target');
      expect(summary.action).toContain('mouse');
      if (weapon === 'ak47') {
        expect(summary.action).toContain('off-angle');
        expect(summary.action).toContain('not to replace every mouse adjustment');
      } else {
        expect(summary.action).toContain('center mass');
        expect(summary.action).toContain('If only the head is exposed');
        expect(summary.action).not.toContain('head height');
      }
      expect(metric(coach, 'Prepared openings').score).toBe(0);
    });

  it.each([10, 30])('adapts later-shot advice at %s m while preserving all metric identifiers and values', range => {
    const coach = new DuelCoach(), self = facing('ak47', range);
    for (let i = 1; i <= 9; i++) {
      fireAt(coach, self, i * .1, i, [target(range)]);
      if (i <= 3) coach.hit(hit({shotId: i, group: 'chest'}), i * .1);
    }
    const summary = liveSummary(coach);
    expect(summary.focus).toBe('Keep your spray on target');
    expect(summary.evidence).toContain('100% on their first three shots, then 0%');
    expect(summary.evidence).toContain('Aim, recoil and spread can all affect this');
    expect(summary.action).toContain(range > 20 ? 'shorter controlled bursts and let recoil reset' : 'commit to a close-range spray');
    expect(summary.action).toContain(range > 20 ? 'Re-peek from cover' : 'body hits still count');
    expect(summary.metrics.map(({label, value, score}) => ({label, value, score}))).toEqual([
      {label: 'Shot timing', value: '9/9 (100%)', score: 100},
      {label: 'Prepared openings', value: '1/1 (100%)', score: 100},
      {label: 'Visible-target accuracy', value: '3/9 (33%)', score: 3 / 9 * 100},
      {label: 'Single-angle openings', value: '1/1 (100%)', score: 100},
      {label: 'Spray accuracy', value: '3/9 (33%)', score: 3 / 9 * 100},
      {label: 'Entered / held openings', value: '0 / 1', score: null},
    ]);
    expect(coach.review()).toMatchObject({shots: 9, hits: 3, heads: 0, damage: 60, taken: 0,
      movingShots: 0, airShots: 0, settled: 100, headRate: 0, score: 83, placement: 0, timeToDamage: 0});
    expect(coach.review().accuracy).toBeCloseTo(100 / 3);
  });

  it.each([
    {weapon: 'ak47', range: 10, cue: 'Line up the first bullet'},
    {weapon: 'ak47', range: 30, cue: 'taps or short bursts'},
    {weapon: 'awp', range: 30, cue: 'Favor center mass when it is visible'},
    {weapon: 'nova', range: 5, cue: 'Favor center mass when it is visible'},
    {weapon: 'zeus', range: 2, cue: 'Favor center mass when it is visible'},
  ] as const)('keeps low-hit-rate advice specific to $weapon at $range m', ({weapon, range, cue}) => {
    const coach = new DuelCoach(), self = facing(weapon, range);
    for (let i = 1; i <= 6; i++) fireAt(coach, self, i * 5, i, [target(range, i)]);
    const summary = liveSummary(coach);
    expect(summary.focus).toBe('Line up the shot before committing');
    expect(summary.evidence).toContain('0/6 (0%) visible-target shots connected');
    expect(summary.evidence).toContain('aim, recovery and spread can all contribute');
    expect(summary.action).toContain(cue);
    expect(summary.score).toBe(75);
    expect(metric(coach, 'Spray accuracy').score).toBeNull();
  });
});
