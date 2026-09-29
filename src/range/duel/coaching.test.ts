import {afterEach, describe, expect, it, vi} from 'vitest';
import {DuelCoach, damageBearing, loadDuelHistory} from './coaching';
import {DuelSimulation} from './simulation';
import type {DuelEvent} from './types';
import {UNIT} from '../actor-physics';
import {observeBot} from './perception';
import {testArena} from './geometry';

const player = () => new DuelSimulation().snapshot()[0];
const hit = (patch = {}): Extract<DuelEvent, {kind: 'hit'}> => ({kind: 'hit', tick: 1, shooter: 0, victim: 1,
  shotId: 1, group: 'head', point: {x: 0, y: 1.6, z: 0}, healthDamage: 20, armorDamage: 1, lethal: false, ...patch});
afterEach(() => vi.unstubAllGlobals());

describe('Duel coaching', () => {
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
    coach.shot(self); coach.hit(hit({group: 'chest', lethal: true}), 1.55);
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
