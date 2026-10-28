import {describe, expect, it, vi} from 'vitest';
import {DuelCoach} from './coaching';
import {fightDebrief, median, readDuelDebrief, type FeedbackShot, type FightTrace, type ShotEvidence} from './fight-feedback';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {DuelWeaponState} from './weapon-state';
import {DEG, STEP, UNIT} from '../actor-physics';
import {equipmentStats} from '../equipment';
import {idleCommand, type DuelActorSnapshot, type DuelEvent} from './types';

const evidence = (patch: Partial<ShotEvidence> = {}): ShotEvidence => ({aimOnTarget: true, rayOnTarget: true,
  stoppedByCover: false, recoilDegrees: 0, recovering: false, ...patch});
const fight = (patch: Partial<FightTrace> = {}): FightTrace => ({enemy: 1, started: 1, firstShot: 1.3, range: 20, speed: 0,
  entered: false, oppositeInput: false, prepared: true, low: false, shots: 1, hits: 0, heads: 0, damage: 0,
  killed: false, openingHit: false, visibleEnemies: 1, ...patch});
const shot = (f: FightTrace, patch: Partial<FeedbackShot> = {}): FeedbackShot => ({id: 1, at: 1.3, equipment: 'ak47',
  cycle: .1, target: 1, appropriate: true, airborne: false, hit: false, hiddenHit: false, evidence: evidence(), fight: f, ...patch});
const self = (): DuelActorSnapshot => ({...new DuelSimulation().snapshot()[0], position: {x: 0, y: 64 * UNIT, z: 0},
  feet: 0, grounded: true, yaw: 0, pitch: 0, velocity: {x: 0, z: 0}});
const target = () => ({id: 1, position: {x: 0, y: 64 * UNIT, z: -20}, aimPoint: {x: 0, y: 64 * UNIT, z: -20},
  headPoint: {x: 0, y: 64 * UNIT, z: -20}});
const hit = (patch = {}): Extract<DuelEvent, {kind: 'hit'}> => ({kind: 'hit', tick: 1, shotId: 1, shooter: 0,
  victim: 1, group: 'head', healthDamage: 40, armorDamage: 0, lethal: false, point: target().position, ...patch});

describe('evidence-based duel debrief', () => {
  it('separates aim/recoil misses, random dispersion, cover and unknown without blaming blind shots', () => {
    const f = fight();
    const rows = [shot(f, {id: 1, evidence: evidence({aimOnTarget: false, rayOnTarget: false})}),
      shot(f, {id: 2, evidence: evidence({rayOnTarget: false})}), shot(f, {id: 3, evidence: evidence({stoppedByCover: true})}),
      shot(f, {id: 4, evidence: undefined}), shot(f, {id: 5, target: undefined}),
      shot(f, {id: 6, hiddenHit: true})];
    expect(fightDebrief(rows, [f]).misses).toEqual({aim: 1, spread: 1, cover: 1, unclassified: 1});
  });
  it('ranks repeated bad opening timing above one airborne shot', () => {
    const f = fight({speed: 210});
    const rows = Array.from({length: 10}, (_, i) => shot(f, {id: i, appropriate: false, airborne: i === 9}));
    const debrief = fightDebrief(rows, [f]);
    expect(debrief.findings[0].key).toBe('movement');
    expect(debrief.findings[0].evidence).toContain('210 u/s');
    expect(debrief.findings).toHaveLength(2);
  });
  it('does not criticize first-bullet timing when only the follow-up shots moved', () => {
    const f = fight();
    const result = fightDebrief([shot(f, {hit: true}), shot(f, {id: 2, at: 1.4, appropriate: false})], [f]);
    expect(result.findings[0].title).toBe('Stop before the follow-up shot');
    expect(result.findings[0].action).toContain('Your opening stop was clean');
  });
  it('does not call a dispersion miss bad aim or lower its aim-line score', () => {
    const coach = new DuelCoach(), player = self(); coach.observe(1, player, [target()]);
    coach.shot(player, 1, 1.1); coach.shotEvidence(1, evidence({rayOnTarget: false}));
    const review = coach.review();
    expect(review.accuracy).toBe(0); expect(review.score).toBe(100);
    expect(review.coaching?.focus).toBe('These misses were not all aim errors');
    expect(review.debrief?.misses.spread).toBe(1);
  });
  it('recognizes follow-up aim leaving the model, not generic low hit rate', () => {
    const f = fight(), rows = Array.from({length: 9}, (_, i) => shot(f, {id: i, at: 1.3 + i * .1,
      hit: i < 3, evidence: evidence({aimOnTarget: i < 3, rayOnTarget: i < 3, recoilDegrees: i})}));
    expect(fightDebrief(rows, [f]).findings[0]).toMatchObject({key: 'control', title: 'Your follow-up aim left the target'});
    expect(fightDebrief(rows, [f]).findings[0].evidence).toContain('6/6 later rifle bullets');
  });
  it('counts a successful held opening as a strength, not an instruction to move or aim faster', () => {
    const f = fight({openingHit: true, killed: true});
    const result = fightDebrief([shot(f, {hit: true})], [f]);
    expect(result.findings[0].key).toBe('strength');
    expect(result.findings[0].evidence).toContain('1/1 opening shots hit');
    expect(result.firstShotMs).toBeCloseTo(300);
  });
  it('describes measured reload punishment and ignores stale visibility rather than inventing awareness errors', () => {
    const result = fightDebrief([], [], [{amount: 80, lethal: true, reloading: true, visible: null, visibleCount: 0}]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({key: 'reload'});
    expect(result.findings[0].evidence).toContain('80 damage taken during reload');
  });
  it('records actual opposite movement input separately from being stationary at the shot', () => {
    const coach = new DuelCoach(), hold = new DuelCoach(), player = self();
    coach.movement(.9, {...player, velocity: {x: 200 * UNIT, z: 0}}, {...idleCommand(), side: -1});
    for (const c of [coach, hold]) {
      c.observe(1, player, [target()]); c.shot(player, 1, 1.05); c.shotEvidence(1, evidence()); c.hit(hit(), 1.05);
    }
    expect(coach.review().debrief?.fights[0]).toMatchObject({entered: true, oppositeInput: true, speed: 0});
    expect(hold.review().debrief?.fights[0]).toMatchObject({entered: false, oppositeInput: false, speed: 0});
    expect(coach.review().score).toBe(hold.review().score);
  });
  it('keeps compensated sprays associated with the target using the pre-spread ray, not the pulled-down crosshair', () => {
    const coach = new DuelCoach(), player = self(); coach.observe(1, player, [target()]);
    coach.shot({...player, pitch: -20 * DEG}, 1, 1.05, {stats: equipmentStats('ak47'), walking: false,
      aimDirection: {x: 0, y: 0, z: -1}});
    expect(coach.shotTarget(1)).toBe(1);
  });
  it('updates the diagnosis after damage even if no player shot followed', () => {
    const coach = new DuelCoach(), player = self(); coach.observe(1, player, []);
    const before = coach.review().coaching;
    coach.hit(hit({shooter: 1, victim: 0, healthDamage: 80, lethal: true}), 1.05, false, {reloading: true});
    expect(coach.review().coaching).not.toBe(before);
    expect(coach.review().message).toBe('Break line of sight before reloading');
    expect(coach.review().score).toBeNull();
  });
  it('retains per-fight damage and opening result without counting collateral as another hit on that enemy', () => {
    const coach = new DuelCoach(), player = self(); coach.observe(1, player, [target()]); coach.shot(player, 1, 1.05);
    coach.hit(hit(), 1.05); coach.hit(hit({victim: 2}), 1.05);
    coach.shot(player, 2, 1.1); coach.hit(hit({shotId: 2, group: 'chest', lethal: true}), 1.1);
    expect(coach.review().debrief?.fights[0]).toMatchObject({shots: 2, hits: 2, heads: 1, damage: 80,
      killed: true, openingHit: true, firstDamage: 1.05});
  });
  it('bounds persisted fight details and rejects malformed optional history safely', () => {
    const f = fight(), result = fightDebrief([shot(f)], [f]);
    expect(readDuelDebrief({...result, findings: [null, {title: 'undefined'}], fights: [null]})).toMatchObject({findings: [], fights: []});
    expect(readDuelDebrief({...result, misses: {aim: NaN}})).toBeUndefined();
    expect(readDuelDebrief({...result, openingHits: 3})).toBeUndefined();
    expect(median([900, 100, 300])).toBe(300);
  });
  it('counts a later head pellet and collateral-first hit once per fight shot', () => {
    const coach = new DuelCoach(), player = self(); coach.observe(1, player, [target(), {...target(), id: 2}]);
    coach.shot(player, 1, 1.05);
    coach.hit(hit({victim: 2}), 1.05);
    coach.hit(hit({group: 'chest'}), 1.05);
    coach.hit(hit(), 1.05); coach.hit(hit(), 1.05);
    expect(coach.review().debrief?.fights[0]).toMatchObject({shots: 1, hits: 1, heads: 1, damage: 120});
  });
  it('timestamps pre-step visibility at the pre-step time, retaining fractional native shots', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({health: 500}), 41, {...testArena(), minZ: -80});
    sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 0}; sim.actors[0].yaw = 0;
    sim.actors[1].position = {x: 0, y: 64 * UNIT, z: -20};
    sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0, {spread: false});
    sim.command(1, {}); sim.start(); sim.command(0, {fireHeld: true});
    const observed = vi.spyOn(sim.coach, 'observe'), fired = vi.spyOn(sim.coach, 'shot');
    for (let i = 0; i < 128; i++) sim.step();
    expect(observed.mock.calls[0][0]).toBe(0);
    expect(fired.mock.calls.length).toBeGreaterThan(5);
    expect(sim.coach.review().coaching?.metrics.find(metric => metric.label === 'Visible-target accuracy')?.value)
      .toContain(`/${fired.mock.calls.length} (`);
    expect(sim.coach.review().debrief?.fights[0].shots).toBe(fired.mock.calls.length);
    expect(sim.coach.review().debrief?.misses.unclassified).toBe(0);
    expect(observed.mock.calls[1][0]).toBeCloseTo(4 * STEP);
  });
  it('uses the resolved animated capsule pose, not an enlarged static coaching target', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({health: 500}), 41, {...testArena(), minZ: -80});
    sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 0}; sim.actors[0].yaw = 0;
    sim.actors[1].position = {x: 0, y: 64 * UNIT, z: -20};
    sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0, {spread: false});
    sim.actorHitPose = actor => ({capsules: [{point0: {...actor.position, x: 1}, point1: {...actor.position, x: 1}, radius: .1, group: 'head'}]});
    sim.command(1, {}); sim.start(); sim.command(0, {firePressed: true}); sim.step();
    expect(sim.coach.review().debrief?.misses).toEqual({aim: 1, spread: 0, cover: 0, unclassified: 0});
    expect(sim.coach.review().score).toBe(75);
  });
  it('diagnoses a previously visible target now behind a blocking edge from the actual penetration result', () => {
    const arena = {...testArena(), minZ: -80};
    const sim = new DuelSimulation(sanitizeDuelConfig({health: 500}), 41, arena);
    sim.actors[0].position = {x: 0, y: 64 * UNIT, z: 0}; sim.actors[0].yaw = 0;
    sim.actors[1].position = {x: 0, y: 64 * UNIT, z: -20};
    sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0, {spread: false});
    sim.command(1, {}); sim.start(); sim.step();
    sim.arena.solids.push({center: {x: 0, y: 1.5, z: -10}, size: {x: 3, y: 3, z: 4}, material: 'concrete'});
    sim.command(0, {firePressed: true}); sim.step();
    expect(sim.coach.review().debrief?.misses.cover).toBe(1);
    expect(sim.coach.review().message).toBe('Wait for a hittable exposure');
    expect(sim.coach.review().score).toBe(75);
    expect(sim.coach.review().debrief?.misses.aim).toBe(0);
  });
});
