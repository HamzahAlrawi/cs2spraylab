import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {DEG, UNIT} from '../actor-physics';
import {gameData} from '../config';
import {DuelSimulation} from '../duel/simulation';
import type {VisibleEnemy} from '../duel/perception';
import type {DuelActorSnapshot, DuelEvent} from '../duel/types';
import {PrefireCoach} from './coaching';

const player = (): DuelActorSnapshot => ({...new DuelSimulation().snapshot()[0], position: {x: 0, y: 64 * UNIT, z: 0}, yaw: 0});
const enemy = (id = 1, distance = 20): VisibleEnemy => ({id, position: {x: 0, y: 64 * UNIT, z: -distance},
  aimPoint: {x: 0, y: 64 * UNIT, z: -distance}, headPoint: {x: 0, y: 64 * UNIT, z: -distance},
  bodyPoint: {x: 0, y: 1.3, z: -distance}});
const hit = (shotId = 10, patch = {}): Extract<DuelEvent, {kind: 'hit'}> => ({kind: 'hit', tick: 1,
  shooter: 0, victim: 1, shotId, group: 'head', point: enemy().aimPoint, healthDamage: 100, armorDamage: 0, lethal: true, ...patch});
function opening(patch: Partial<DuelActorSnapshot> = {}, targets = [enemy()]) {
  const coach = new PrefireCoach(['Car', 'Pit']), self = {...player(), ...patch};
  coach.observe(1, {...self, velocity: {x: 180 * UNIT, z: 0}}, targets);
  coach.observe(1.2, self, targets); coach.shot(self, 10, 1.21);
  return {coach, self};
}

describe('Prefire first-contact coaching', () => {
  it('keeps idle scores and unmeasured metrics empty instead of granting free perfect scores', () => {
    const review = new PrefireCoach(['Car']).review();
    expect(review).toMatchObject({score: null, openingStopped: null, readyAim: null, cleanEntries: null, openingHits: null, isolation: null, goalMet: false});
  });
  it('reports settled pre-aimed entries, first-bullet hits and physical hit feedback separately', () => {
    const {coach} = opening(); coach.hit(hit(), 1.21);
    expect(coach.review()).toMatchObject({shots: 1, hits: 1, kills: 1, openingStopped: 100, readyAim: 100,
      cleanEntries: 100, openingHits: 100, isolation: 100, completed: 1, total: 2, goalMet: false});
    expect(coach.review().feedback?.angle).toBe('Car');
    expect(coach.review().feedback?.message).toBe('Clean opening');
    expect(coach.review().coaching?.evidence).toContain('1/2 angles cleared');
    expect(coach.review().score).toBe(90);
  });
  it('later correct shots do not erase a bad opening shot', () => {
    const {coach, self} = opening({velocity: {x: 215 * UNIT, z: 0}});
    coach.shot({...self, velocity: {x: 0, z: 0}}, 11, 1.4); coach.hit(hit(11), 1.4);
    expect(coach.review()).toMatchObject({shots: 2, openingStopped: 0, openingHits: 0, cleanEntries: 0});
    expect(coach.review().feedback?.message).toBe('Stop before the opening shot');
  });
  it('uses native float32 movement accuracy at the crouch cap, without requiring literal zero velocity', () => {
    const {coach} = opening({velocity: {x: 73.1 * UNIT, z: 0}, duckAmount: 1});
    expect(coach.review().openingStopped).toBe(100);
    expect(coach.review().settled).toBe(100);
    const moving = opening({velocity: {x: 73.2 * UNIT, z: 0}}).coach.review();
    expect(moving.openingStopped).toBe(0);
  });
  it('uses the firing-mode cap, not the unscoped cap, when grading a scoped opening', () => {
    const coach = new PrefireCoach(['Car']), self = {...player(), equipment: 'awp' as const, velocity: {x: 55 * UNIT, z: 0}};
    coach.observe(1, self, [enemy()]);
    coach.shot(self, 10, 1.01, {stats: {...gameData.weapons.awp, speed: 100}, walking: false});
    expect(coach.review().openingStopped).toBe(0);
    expect(coach.review().movingShots).toBe(1);
  });
  it('does not treat accurate-looking airborne hits as settled openings', () => {
    const {coach} = opening({grounded: false}); coach.hit(hit(), 1.3);
    expect(coach.review().openingStopped).toBe(0);
    expect(coach.review().cleanEntries).toBe(0);
  });
  it('stationary shooting is not falsely labelled an entry or counterstrafe', () => {
    const coach = new PrefireCoach(['Car']), self = player();
    coach.observe(1, self, [enemy()]); coach.observe(1.1, self, [enemy()]);
    coach.shot(self, 10, 1.2); coach.hit(hit(), 1.2);
    expect(coach.review()).toMatchObject({openingStopped: 100, cleanEntries: 0, goalMet: false});
    expect(coach.review().feedback?.message).toContain('practice the entry');
    expect(coach.review().feedback?.tip).toContain('A stationary shot is valid');
    expect(coach.review().feedback?.tip).toContain('this entry drill needs a peek from cover');
    expect(coach.review().score).toBeLessThan(100);
  });
  it('two visible threats at the opening shot receive isolation coaching', () => {
    const {coach} = opening({}, [enemy(), {...enemy(2), aimPoint: {x: 1, y: 1.6, z: -20}}]);
    coach.hit(hit(), 1.21);
    expect(coach.review()).toMatchObject({cleanEntries: 0, isolation: 0});
    expect(coach.review().feedback?.message).toContain('Multiple enemies visible');
    expect(coach.review().feedback?.tip).toContain('isolate a 1v1');
  });
  it.each([-8, 8])('recognizes vertical pre-aim error of %s degrees at actual first exposure', degrees => {
    const {coach} = opening({pitch: degrees * DEG}); coach.hit(hit(), 1.4);
    expect(coach.review().readyAim).toBe(0);
    expect(coach.review().feedback?.message).toContain(degrees < 0 ? 'low' : 'high');
  });
  it.each([10, 30, 80, 100])('allows a small required mouse correction at %s metres', distance => {
    const {coach} = opening({yaw: .8 * DEG}, [enemy(1, distance)]);
    expect(coach.review().readyAim).toBe(100);
  });
  it.each([10, 50, 100])('does not mistake chest-level rifle pre-aim for head-height preparation at %s metres', distance => {
    const self = {pitch: Math.atan2(1.3 - 64 * UNIT, distance)};
    const {coach} = opening(self, [enemy(1, distance)]); coach.hit(hit(), 1.4);
    expect(coach.review().readyAim).toBe(0);
    expect(coach.review().feedback?.message).toContain('low');
  });
  it('never samples hidden head coordinates or penalizes aiming at a visible body with an AWP', () => {
    const target = {...enemy(), headPoint: undefined};
    const rifle = opening({}, [target]);
    expect(rifle.coach.review().readyAim).toBeNull();
    const self = {...player(), equipment: 'awp' as const, pitch: Math.atan2(1.3 - 64 * UNIT, 20)};
    const coach = new PrefireCoach(['Car']); coach.observe(1, self, [target]);
    expect(coach.review().readyAim).toBe(100);
  });
  it('does not change the quality score because spread made an otherwise identical first shot miss', () => {
    const a = opening(), b = opening();
    a.coach.hit(hit(), 1.21);
    b.coach.shot(b.self, 11, 1.4); b.coach.hit(hit(11), 1.4);
    expect(a.coach.review().score).toBe(b.coach.review().score);
    expect(a.coach.review().openingHits).toBe(100); expect(b.coach.review().openingHits).toBe(0);
  });
  it('handles an impact before the next perception sample without fabricating prepared aim', () => {
    const coach = new PrefireCoach(['Car']);
    coach.observe(1, player(), []); coach.shot(player(), 10, 1.025); coach.hit(hit(), 1.025);
    expect(coach.review()).toMatchObject({shots: 1, hits: 1, openingStopped: 100, openingHits: 100, readyAim: null, completed: 1});
    expect(coach.review().angles[0].contactToHitMs).toBe(0);
  });
  it('does not count shotgun/collateral hit events as several fired bullets', () => {
    const {coach} = opening({}, [enemy(), enemy(2)]);
    coach.hit(hit(10, {lethal: false, healthDamage: 20}), 1.21);
    coach.hit(hit(10, {group: 'chest', healthDamage: 80}), 1.21);
    coach.hit(hit(10, {victim: 2}), 1.21);
    expect(coach.review()).toMatchObject({shots: 1, hits: 1, heads: 1, kills: 2, openingHits: 100});
  });
  it('melee remains outside opening-shot accuracy and prepared-aim goals', () => {
    const coach = new PrefireCoach(['Car']); coach.observe(1, player(), []);
    coach.shot({...player(), equipment: 'knife'}, 10, 1.1); coach.hit(hit(), 1.1, true);
    expect(coach.review()).toMatchObject({score: null, shots: 0, completed: 0, goalMet: false});
  });
  it('samples first-exposure aim once, rather than rerolling it after a bad pre-aim or mouse correction', () => {
    const coach = new PrefireCoach(['Car']);
    coach.observe(1, {...player(), yaw: 10 * DEG}, [enemy()]);
    coach.observe(1.1, player(), []); coach.observe(2, player(), [enemy()]);
    expect(coach.review().readyAim).toBe(0);
  });
  it('contact-to-hit excludes time hidden before the first hit and feedback expires in simulation time', () => {
    const coach = new PrefireCoach(['Car']);
    coach.observe(1, player(), [enemy()]); coach.observe(1.1, player(), []); coach.observe(3, player(), [enemy()]);
    coach.shot(player(), 10, 3.2); coach.hit(hit(), 3.2);
    expect(coach.review().angles[0].contactToHitMs).toBeCloseTo(200);
    expect(coach.review().feedback).toBeDefined();
    coach.observe(6.3, player(), []); expect(coach.review().feedback).toBeUndefined();
  });
  it('requires a complete clean route, not a lucky kill, to meet the training goal', () => {
    const coach = new PrefireCoach(['Car', 'Pit', 'Goose']);
    for (let id = 1; id <= 3; id++) {
      coach.observe(id, {...player(), velocity: {x: 180 * UNIT, z: 0}}, [enemy(id)]);
      coach.observe(id + .2, player(), [enemy(id)]);
      coach.shot(player(), id, id + .21); coach.hit(hit(id, {victim: id}), id + .21);
      expect(coach.review().goalMet).toBe(id === 3);
    }
    expect(coach.review().score).toBe(100);
  });
  it('does not promote uncontrolled long sprays even with good opening timing and eventual kills', () => {
    const {coach, self} = opening();
    for (let id = 11; id <= 30; id++) coach.shot(self, id, 1.21 + (id - 10) * .1);
    coach.hit(hit(30), 3.21);
    expect(coach.review().accuracy).toBeLessThan(10);
    expect(coach.review().goalMet).toBe(false);
    expect(coach.review().score).toBeLessThan(85);
    expect(coach.review().message).toBe('Low hit rate across the run');
    expect(coach.review().coaching?.evidence).toContain('1/21 hits');
  });
});

describe('Prefire coaching copy contract', () => {
  const clearedOpening = (patch: Partial<DuelActorSnapshot> = {}, targets = [enemy()]) => {
    const {coach} = opening(patch, targets); coach.hit(hit(), 1.21);
    return coach.review();
  };

  it('keeps persisted practice metric identifiers and scoring values unchanged', () => {
    const review = clearedOpening();
    expect(review.coaching?.metrics.map(row => row.label)).toEqual([
      'Route completion', 'Settled openings', 'Prepared aim', 'Clean entries', 'Angle isolation', 'Shot efficiency',
    ]);
    expect(review.coaching?.metrics.map(row => row.score)).toEqual([50, 100, 100, 100, 100, 100]);
    expect(review.score).toBe(90);
  });

  it.each([-8, 8])('keeps the %s-degree first-sight measurement in evidence, not live cues', degrees => {
    const review = clearedOpening({pitch: degrees * DEG});
    expect(review.coaching?.evidence).toContain('8.0 deg aim gap');
    expect(review.feedback?.message).toBe(`Crosshair placement was ${degrees < 0 ? 'low' : 'high'}`);
    expect(review.feedback?.message).not.toMatch(/deg|\d/);
    expect(review.message).toBe('Pre-aim before exposing yourself');
  });

  it('coaches first-sight placement without forbidding mouse corrections or off-angle aim', () => {
    const review = clearedOpening({yaw: 10 * DEG});
    expect(review.readyAim).toBe(0);
    expect(review.feedback?.tip).toContain('Pre-aim the likely hold before exposing yourself');
    expect(review.feedback?.tip).toContain('Make a mouse correction');
    expect(review.tip).toContain('off-angle normally with your mouse');
  });

  it('does not infer opposite-key use from a grounded, low-speed opening', () => {
    const review = clearedOpening({velocity: {x: 70 * UNIT, z: 0}, duckAmount: 1});
    expect(review.openingStopped).toBe(100);
    expect(review.feedback?.message).toBe('Clean opening');
    expect(review.coaching?.strength).toContain('avoided movement inaccuracy while grounded');
    expect(`${review.feedback?.tip} ${review.coaching?.strength}`).not.toMatch(/you counter-strafed|opposite key|never crouch/i);
  });

  it('keeps a single stopped miss separate from recoil diagnosis or a blanket tap rule', () => {
    const {coach, self} = opening();
    expect(coach.review().angles[0].message).toBe('Stopped opening shot missed');
    coach.shot(self, 11, 1.4); coach.hit(hit(11), 1.4);
    const review = coach.review();
    expect(review.openingHits).toBe(0);
    expect(review.feedback?.message).toBe('Stopped opening shot missed');
    expect(review.feedback?.tip).toContain('A single miss can still be weapon spread');
    expect(`${review.feedback?.message} ${review.feedback?.tip} ${review.tip}`).not.toMatch(/recoil|always tap|never crouch/i);
  });

  it.each([-8, 8])('does not call a wide strafe to x=%s an overpeek with one visible enemy', x => {
    const coach = new PrefireCoach(['Car', 'Pit']), self = {...player(), position: {x, y: 64 * UNIT, z: 0}, yaw: Math.atan2(x, 20)};
    coach.observe(.5, player(), []);
    coach.observe(1, {...self, velocity: {x: Math.sign(x) * 180 * UNIT, z: 0}}, [enemy()]);
    coach.observe(1.2, self, [enemy()]); coach.shot(self, 10, 1.21); coach.hit(hit(), 1.21);
    const review = coach.review();
    expect(review).toMatchObject({cleanEntries: 100, isolation: 100});
    expect(review.feedback?.message).toBe('Clean opening');
    expect(`${review.message} ${review.tip} ${review.feedback?.tip}`).not.toMatch(/overpeek|slice the pie|isolate a 1v1/i);
  });

  it('keeps stopping ahead of isolation and pre-aim when the opening has several issues', () => {
    const review = clearedOpening({pitch: -8 * DEG, velocity: {x: 215 * UNIT, z: 0}}, [enemy(), enemy(2)]);
    expect(review).toMatchObject({openingStopped: 0, readyAim: 0, cleanEntries: 0, isolation: 0});
    expect(review.message).toBe('Stop before the opening shot');
    expect(review.feedback?.message).toBe('Stop before the opening shot');
    expect(review.tip).not.toMatch(/crosshair placement|isolate/);
    expect(review.coaching?.evidence).toContain('1/1 openings had movement or air inaccuracy');
  });

  it('still coaches sustained multi-enemy exposure even without a multi-enemy opening shot', () => {
    const coach = new PrefireCoach(['Car', 'Pit']);
    for (let tick = 0; tick <= 40; tick++) coach.observe(tick * .05, player(), [enemy(), enemy(2)]);
    const review = coach.review();
    expect(review).toMatchObject({shots: 0, score: null, isolation: 0});
    expect(review.message).toBe('Isolate a 1v1');
    expect(review.tip).toContain('Slice the pie');
    expect(review.coaching?.evidence).toContain('2.0 s with multiple visible enemies');
    expect(review.coaching?.goal).toContain('isolate a 1v1');
  });

  it('keeps all live issue cues brief, measurement-free and safe for rebound controls', () => {
    const idle = new PrefireCoach(['Car']); idle.observe(1, player(), [enemy()]);
    const stationary = new PrefireCoach(['Car']); stationary.observe(1, player(), [enemy()]);
    stationary.shot(player(), 10, 1.2); stationary.hit(hit(), 1.2);
    const missed = opening().coach;
    const repeatedMoving = opening({velocity: {x: 215 * UNIT, z: 0}}).coach;
    repeatedMoving.observe(2, {...player(), velocity: {x: 215 * UNIT, z: 0}}, [enemy(2)]);
    repeatedMoving.shot({...player(), velocity: {x: 215 * UNIT, z: 0}}, 11, 2.01);
    const clean = new PrefireCoach(['Car']);
    clean.observe(1, {...player(), velocity: {x: 180 * UNIT, z: 0}}, [enemy()]);
    clean.observe(1.2, player(), [enemy()]); clean.shot(player(), 10, 1.21); clean.hit(hit(), 1.21);
    const spraying = opening();
    for (let id = 11; id <= 30; id++) spraying.coach.shot(spraying.self, id, 1.21 + (id - 10) * .1);
    spraying.coach.hit(hit(30), 3.21);
    const reviews = [idle.review(), stationary.review(), missed.review(), repeatedMoving.review(), clean.review(), spraying.coach.review(),
      clearedOpening(), clearedOpening({grounded: false}), clearedOpening({pitch: -8 * DEG}),
      clearedOpening({pitch: 8 * DEG}), clearedOpening({yaw: 10 * DEG}), clearedOpening({}, [enemy(), enemy(2)])];
    expect(clean.review().goalMet).toBe(true);
    for (const review of reviews) {
      const cues = [{message: review.message, tip: review.tip}, ...review.angles, ...(review.feedback ? [review.feedback] : [])];
      for (const cue of cues) {
        const text = `${cue.message}. ${cue.tip}`;
        expect(text.length, text).toBeLessThanOrEqual(220);
        expect((cue.tip.match(/[.!?](?:\s|$)/g) ?? []).length, cue.tip).toBeLessThanOrEqual(2);
        expect(text.replace(/1v1/g, ''), text).not.toMatch(/\d|%|\b(?:deg|ms|u\/s)\b/);
        expect(text).not.toMatch(/\bA\/D\b|\bWASD\b|\b(?:press|tap|hold) [ADWS]\b|\bKey[ADWS]\b/i);
        expect(text).not.toMatch(/always tap|never crouch|do not ban|you (?:counter-strafed|tapped)/i);
      }
    }
  });

  it('keeps setup instructions consistent with entry drills and mouse correction', () => {
    const source = readFileSync(new URL('./PrefireSetup.tsx', import.meta.url), 'utf8');
    expect(source).toContain('With rifles, pre-aim at head level before peeking. Counter-strafe, then fire; correct off-angles with your mouse');
    expect(source).toContain('not which keys you used');
    expect(source).toContain('Static shots are valid but are not entry reps; a wide swing into one enemy is not an overpeek.');
    expect(source).not.toContain('Make small corrections with movement');
  });
});
