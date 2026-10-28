import {describe, expect, it} from 'vitest';
import {DEG, UNIT} from '../actor-physics';
import {DuelCoach} from './coaching';
import {DuelSimulation} from './simulation';
import {idleCommand, type DuelEvent} from './types';
import {emptyAimMetrics, eyeAngleChange, measureAim, mergeAimMetrics, readAimMetrics, timingValue,
  type AimEncounter, type AimMetrics, type AimShot} from './aim-metrics';
import {aimDimensions, aimProfile, practiceAimTargets} from './aim-profile';

const shot = (patch: Partial<AimShot> = {}): AimShot => ({at: 1.2, cycle: .1, equipment: 'ak47', target: 1,
  hit: false, hiddenHit: false, speed: 0, maxSpeed: 215, duck: 0, airborne: false, ...patch});
const contact = (patch: Partial<AimEncounter> = {}): AimEncounter => ({at: 1, yaw: 0, pitch: 0, reactionEligible: true, ...patch});
const player = () => ({...new DuelSimulation().snapshot()[0], position: {x: 0, y: 64 * UNIT, z: 0}, yaw: 0, pitch: 0,
  grounded: true, velocity: {x: 0, z: 0}});
const enemy = (id = 1) => ({id, position: {x: 0, y: 64 * UNIT, z: -20}, aimPoint: {x: 0, y: 64 * UNIT, z: -20},
  headPoint: {x: 0, y: 64 * UNIT, z: -20}});
const hit = (patch = {}): Extract<DuelEvent, {kind: 'hit'}> => ({kind: 'hit', tick: 1, shotId: 1, shooter: 0, victim: 1,
  group: 'head', healthDamage: 40, armorDamage: 0, lethal: false, point: enemy().position, ...patch});
const profileFixture = (): AimMetrics => ({...emptyAimMetrics(), weapons: ['ak47'],
  counts: {encounters: 8, damaged: 8, killed: 8, shots: 40, hits: 20, headHits: 4, headEligibleHits: 20,
    rifleShots: 40, stoppedRifleShots: 20, sprayShots: 15, sprayHits: 3, reactionExcluded: 0, reactionUnmeasured: 0},
  measurements: {firstShot: [250, 300, 350, 300, 400], reaction: [200, 200, 200, 200, 200],
    damage: [700, 750, 800, 750, 750], kill: [900, 1000, 1100], damageToKill: [200, 250, 300], correction: [10, 10, 10, 10, 10]}});

describe('common aim and engagement metrics', () => {
  it('separates contact-to-shot, reaction, damage, kill and first-damage-to-kill', () => {
    const data = measureAim([], [contact({responseAt: 1.25, firstShot: 1.3, firstDamage: 1.4, killedAt: 1.8, correction: 2})]);
    expect(timingValue(data, 'reaction')).toBeCloseTo(250);
    expect(timingValue(data, 'firstShot')).toBeCloseTo(300);
    expect(timingValue(data, 'damage')).toBeCloseTo(400);
    expect(timingValue(data, 'kill')).toBeCloseTo(800);
    expect(timingValue(data, 'damageToKill')).toBeCloseTo(400);
    expect(data.counts).toMatchObject({encounters: 1, damaged: 1, killed: 1});
  });
  it('keeps a one-shot kill at zero damage-to-kill without calling its total TTK zero', () => {
    const data = measureAim([], [contact({firstDamage: 1.4, killedAt: 1.4}), contact()]);
    expect(timingValue(data, 'kill')).toBeCloseTo(400);
    expect(timingValue(data, 'damageToKill')).toBe(0);
    expect(data.measurements.damage).toHaveLength(1);
    expect(data.counts.encounters).toBe(2);
  });
  it('excludes anticipation, long holds and unready input from response estimates, not raw shot latency', () => {
    const data = measureAim([], [contact({responseAt: 1.04, firstShot: 1.1}), contact({responseAt: 2.1}),
      contact({responseAt: 1.2, reactionEligible: false}), contact(), contact({responseAt: 1.3})]);
    expect(data.measurements.reaction).toHaveLength(1);
    expect(data.measurements.firstShot[0]).toBeCloseTo(100);
    expect(data.counts).toMatchObject({reactionExcluded: 3, reactionUnmeasured: 1});
  });
  it('retains slow TTD in raw metrics while excluding 1 s+ holds only from the Leetify-style component', () => {
    const data = measureAim([], [contact({firstDamage: 1.2}), contact({firstDamage: 1.8}), contact({firstDamage: 2}), contact({firstDamage: 4})]);
    expect(timingValue(data, 'damage')).toBeCloseTo(900);
    const dimension = aimDimensions(data).find(row => row.id === 'damage')!;
    expect(dimension.value).toBeCloseTo(500); expect(dimension.samples).toBe(2); expect(dimension.score).toBeNull();
  });
  it('measures wrapped eye-angle change to damage, not aim gap or total mouse path', () => {
    expect(eyeAngleChange({yaw: 179 * DEG, pitch: 0}, {yaw: -179 * DEG, pitch: 0})).toBeCloseTo(2);
    expect(eyeAngleChange({yaw: 0, pitch: 0}, {yaw: 3 * DEG, pitch: 4 * DEG})).toBeCloseTo(5);
  });
  it('counts only spotted gunshots and excludes AWP hits from head accuracy', () => {
    const data = measureAim([shot({hit: true, head: true}), shot({equipment: 'awp', hit: true, head: true}),
      shot({target: undefined}), shot({hit: false, hiddenHit: true})], []);
    expect(data.counts).toMatchObject({shots: 2, hits: 2, headHits: 1, headEligibleHits: 1});
  });
  it('uses the published uncrouched rifle speed rule, not opposite-input guesses or SMG penalties', () => {
    const data = measureAim([shot({speed: 70}), shot({speed: 100}), shot({duck: 1, speed: 100}),
      shot({equipment: 'mp9', speed: 220}), shot({airborne: true})], []);
    expect(data.counts).toMatchObject({rifleShots: 3, stoppedRifleShots: 1});
  });
  it('requires rifle sequences of three or more shots and breaks on weapon or target changes', () => {
    const data = measureAim([shot({at: 1, hit: true}), shot({at: 1.1}), shot({at: 1.2, hit: true}),
      shot({at: 1.3, target: 2}), shot({at: 1.4, equipment: 'deagle'}), shot({at: 1.5, equipment: 'deagle'}),
      shot({at: 1.6, equipment: 'deagle'})], []);
    expect(data.counts).toMatchObject({sprayShots: 3, sprayHits: 2});
  });
  it('pools raw samples and shot denominators rather than averaging round percentages or medians', () => {
    const a = measureAim([shot({hit: true})], [contact({firstDamage: 1.1})]);
    const b = measureAim(Array.from({length: 9}, () => shot()), Array.from({length: 3}, () => contact({firstDamage: 1.8})));
    const pooled = mergeAimMetrics([a, b]);
    expect(aimDimensions(pooled)[0].value).toBe(10);
    expect(timingValue(pooled, 'damage')).toBeCloseTo(800);
  });
  it('bounds persisted timing arrays and rejects impossible or poisoned optional metrics', () => {
    const data = measureAim([], Array.from({length: 1100}, () => contact({firstDamage: 1.2})));
    expect(data.measurements.damage).toHaveLength(1024); expect(readAimMetrics(data)).toBeDefined();
    expect(readAimMetrics({...data, counts: {...data.counts, hits: 4}})).toBeUndefined();
    expect(readAimMetrics({...data, measurements: {...data.measurements, reaction: [NaN]}})).toBeUndefined();
    expect(readAimMetrics({...data, weapons: ['constructor']})).toBeUndefined();
    expect(readAimMetrics({})).toBeUndefined();
  });
});

describe('live coach metric capture', () => {
  it('captures first purposeful response, eye-angle adjustment and lethal timing from actual shot events', () => {
    const coach = new DuelCoach(), self = player();
    coach.observe(1, {...self, yaw: .05}, [enemy()]);
    coach.observe(1.22, {...self, yaw: .05}, [enemy()]);
    coach.movement(1.25, self, {...idleCommand(), yawDelta: -.05});
    coach.observe(1.3, self, [enemy()]); coach.shot(self, 1, 1.3); coach.hit(hit(), 1.4);
    coach.observe(1.6, self, [enemy()]); coach.shot(self, 2, 1.6); coach.hit(hit({shotId: 2, lethal: true}), 1.6);
    const data = coach.review().aim!;
    expect(timingValue(data, 'reaction')).toBeCloseTo(250);
    expect(timingValue(data, 'damage')).toBeCloseTo(400);
    expect(timingValue(data, 'kill')).toBeCloseTo(600);
    expect(timingValue(data, 'correction')).toBeCloseTo(.05 / DEG);
    expect(coach.review().debrief?.fights[0].killedAt).toBe(1.6);
  });
  it('does not pretend a shot itself measures raw reaction when no input signal was captured', () => {
    const coach = new DuelCoach(), self = player(); coach.observe(1, self, [enemy()]);
    coach.shot(self, 1, 1.05); coach.hit(hit(), 1.05);
    expect(coach.review().aim!.measurements.reaction).toEqual([]);
    expect(coach.review().aim!.measurements.firstShot[0]).toBeCloseTo(50);
  });
  it('records a trigger response for one aimed enemy, not every visible bot', () => {
    const coach = new DuelCoach(), self = player(); coach.observe(1, self, [enemy(1), enemy(2)]);
    coach.observe(1.2, self, [enemy(1), enemy(2)]);
    coach.movement(1.22, self, {...idleCommand(), firePressed: true});
    expect(coach.review().aim!.measurements.reaction).toHaveLength(1);
  });
  it('excludes held-trigger and unready-weapon sightings from the response metric', () => {
    for (const readiness of [{weaponReady: false, triggerHeld: false}, {weaponReady: true, triggerHeld: true}]) {
      const coach = new DuelCoach(), self = player(); coach.observe(1, self, [enemy()], readiness);
      coach.observe(1.2, self, [enemy()], readiness); coach.movement(1.22, self, {...idleCommand(), firePressed: true});
      expect(coach.review().aim!.counts.reactionExcluded).toBe(1);
      expect(coach.review().aim!.measurements.reaction).toHaveLength(0);
    }
  });
  it('does not change an already-returned metric snapshot on a later hit or reaction', () => {
    const coach = new DuelCoach(), self = player(); coach.observe(1, self, [enemy()]); coach.shot(self, 1, 1.05);
    const before = coach.review().aim!; coach.hit(hit(), 1.08);
    expect(before.counts.hits).toBe(0); expect(coach.review().aim!.counts.hits).toBe(1);
  });
  it('does not record a zero-damage contact as time to damage', () => {
    const coach = new DuelCoach(), self = player(); coach.observe(1, self, [enemy()]); coach.shot(self, 1, 1.05);
    coach.hit(hit({healthDamage: 0, armorDamage: 0}), 1.05);
    expect(coach.review().aim!.measurements.damage).toEqual([]);
  });
});

describe('transparent aim skill and personal form', () => {
  it('equally weights the six documented categories, not all-shot accuracy, kills or reaction time', () => {
    const data = profileFixture(), profile = aimProfile(data);
    expect(profile.covered).toBe(6);
    expect(profile.score).toBe(Math.round(profile.dimensions.reduce((sum, row) => sum + row.score!, 0) / 6));
    const other = {...data, measurements: {...data.measurements, reaction: [900], kill: [100000]}};
    expect(aimProfile(other).score).toBe(profile.score);
    expect(profile.dimensions.map(row => row.id)).toEqual(['spotted', 'head', 'stop', 'spray', 'placement', 'damage']);
  });
  it('ranks measured weaknesses with actual values, authored targets and actionable practice', () => {
    const profile = aimProfile(profileFixture());
    expect(profile.score).toBeLessThan(75); expect(profile.weaknesses).toHaveLength(3);
    expect(profile.weaknesses[0].score).toBeLessThanOrEqual(profile.weaknesses[2].score!);
    expect(profile.dimensions.find(row => row.id === 'damage')?.action).toContain('response input starts quickly');
    expect(profile.weaknesses.every(row => row.samples >= row.required && row.target === practiceAimTargets[row.id])).toBe(true);
  });
  it('does not assign aim weakness, zero skill, or a population percentile to insufficient evidence', () => {
    const data = emptyAimMetrics(), profile = aimProfile(data);
    expect(profile).toMatchObject({score: null, weaknesses: [], form: null, covered: 0});
    expect(profile.dimensions.every(row => row.value === null)).toBe(true);
  });
  it('omits unmeasured spray and rifle stop components for an AWP-only sample', () => {
    const data = profileFixture(); data.counts.sprayShots = data.counts.sprayHits = data.counts.rifleShots = data.counts.stoppedRifleShots = 0;
    data.counts.headHits = data.counts.headEligibleHits = 0; data.weapons = ['awp'];
    const profile = aimProfile(data);
    expect(profile.covered).toBe(3); expect(profile.score).not.toBeNull();
    expect(profile.weaknesses.some(row => ['head', 'stop', 'spray'].includes(row.id))).toBe(false);
  });
  it('keeps the head statistic but does not prescribe head hunting for body-focused weapons', () => {
    const data = profileFixture(); data.weapons = ['zeus'];
    const head = aimProfile(data).dimensions.find(row => row.id === 'head')!;
    expect(head.value).toBe(20); expect(head.applicable).toBe(false); expect(head.score).toBeNull();
    expect(aimProfile(data).weaknesses.some(row => row.id === 'head')).toBe(false);
  });
  it('uses a real personal baseline with 50 at its mean and correct better/worse direction', () => {
    const base = profileFixture(), baseline = Array.from({length: 5}, () => base);
    expect(aimProfile(base, baseline).form).toBe(50);
    const better = profileFixture(); better.counts.hits = 30; better.counts.headHits = 12; better.counts.headEligibleHits = 30;
    better.counts.stoppedRifleShots = 39; better.counts.sprayHits = 10;
    better.measurements.damage = [400, 400, 400, 400, 400]; better.measurements.correction = [2, 2, 2, 2, 2];
    expect(aimProfile(better, baseline).form).toBeGreaterThan(50);
    expect(aimProfile(base, [base]).form).toBeNull();
  });
});
