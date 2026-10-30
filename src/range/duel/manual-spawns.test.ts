import {describe, expect, it, vi} from 'vitest';
import {applyManualLineup, exportManualLineups, importManualLineups, loadManualLineups, mergeManualLineups,
  parseManualLineup, saveManualLineups, validateManualLineup, type ManualLineup} from './manual-spawns';
import {chooseRealMapCourse, chooseRealMapStart, type RoundCourse} from './real-map-rounds';
import {sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';
import {testArena} from './geometry';
import {UNIT} from '../actor-physics';

const context = {mapId: 'de_dust2', chunkId: 'dust2-long-doors', collisionSha256: 'a'.repeat(64)};
const lineup = (): ManualLineup => ({...context, id: 'my-entry', name: 'Long clear', allowImmediateSight: false,
  entry: {id: 'entry', name: 'Player', feet: {x: 10, y: 0, z: -10}, yaw: .4, pitch: -.1},
  bots: [{id: 'hold', name: 'Pit', feet: {x: 12, y: 0, z: -10}, yaw: -.8, pitch: .12}]});
const collision = () => ({...context, fits: vi.fn(() => true), vertical: vi.fn(() => ({feet: 0, grounded: true})),
  ray: vi.fn(() => ({distance: .1})), sweep: vi.fn()}) as unknown as Parameters<typeof validateManualLineup>[2];

describe('local, revision-bound manual Duel lineups', () => {
  it('round-trips typed poses, stores locally and merges without mutating existing points', () => {
    const value = lineup(), original = structuredClone(value);
    const text = exportManualLineups([value]); expect(importManualLineups(text)).toEqual([value]);
    const storage = {getItem: vi.fn(() => text), setItem: vi.fn()};
    expect(loadManualLineups(storage).lineups).toEqual([value]); saveManualLineups(storage, [value]);
    expect(storage.setItem).toHaveBeenCalledWith('spraylab.duel.manual-spawns.v1', text);
    expect(mergeManualLineups([value], [{...value, name: 'Edited'}])[0].name).toBe('Edited');
    expect(value).toEqual(original);
  });
  it('rejects unbounded/malformed imports, duplicate IDs and invalid coordinates', () => {
    for (const value of [{...lineup(), bots: []}, {...lineup(), bots: Array(6).fill(lineup().bots[0])},
      {...lineup(), entry: {...lineup().entry, yaw: Infinity}}, {...lineup(), collisionSha256: 'invalid'}])
      expect(parseManualLineup(value)).toBeUndefined();
    expect(() => importManualLineups(JSON.stringify({version: 1, lineups: [lineup(), lineup()]}))).toThrow();
    expect(() => importManualLineups(' '.repeat(192 * 1024 + 1))).toThrow(/192/);
    const storage = {getItem: () => '{bad', setItem: vi.fn()};
    expect(loadManualLineups(storage).error).toBeDefined(); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('validates current collision revision, chunk bounds, floor, hulls, overlap and sightlines', () => {
    expect(validateManualLineup(lineup(), context, collision()).errors).toEqual([]);
    expect(validateManualLineup({...lineup(), collisionSha256: 'b'.repeat(64)}, context, collision()).errors.join()).toMatch(/revision/);
    expect(validateManualLineup({...lineup(), entry: {...lineup().entry, feet: {x: -100, y: 0, z: 0}}}, context, collision()).errors.join()).toMatch(/outside/);
    const unsupported = {...collision(), fits: () => false};
    expect(validateManualLineup(lineup(), context, unsupported).errors.join()).toMatch(/hull/);
    const overlap = lineup(); overlap.bots[0].feet = {...overlap.entry.feet};
    expect(validateManualLineup(overlap, context, collision()).errors.join()).toMatch(/overlaps/);
    const open = {...collision(), ray: () => undefined};
    expect(validateManualLineup(lineup(), context, open).errors.join()).toMatch(/sightlines/);
    expect(validateManualLineup({...lineup(), allowImmediateSight: true}, context, open).errors).toEqual([]);
  });
  it('preserves exact captured feet and view and clears stale/manual setups on map or generator changes', () => {
    const value = lineup(), arena = applyManualLineup(testArena(), value);
    expect(arena.spawns!.player.feet).toEqual(value.entry.feet);
    expect(arena.spawns!.bots[0]).toMatchObject({yaw: -.8, pitch: .12, feet: value.bots[0].feet});
    arena.spawns!.player.feet.x++; expect(value.entry.feet.x).toBe(10);
    expect(sanitizeDuelConfig({realMapChunk: context.chunkId, manualLineup: value}).manualLineup).toEqual(value);
    expect(sanitizeDuelConfig({realMapChunk: 'random', manualLineup: value}).manualLineup).toBeNull();
    expect(sanitizeDuelConfig({realMapChunk: context.chunkId, manualLineup: value, generatedMaps: true}).manualLineup).toBeNull();
  });
  it('walk mode keeps shared movement but cannot fire, hurt actors or finish rounds', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1, roundSeconds: 30}), 1, testArena());
    sim.setSpawnAuthoring(true); sim.start(); const initial = sim.snapshot();
    sim.command(0, {forward: 1, fireHeld: true, firePressed: true});
    for (let i = 0; i < 128 * 35; i++) sim.step();
    expect(sim.actors[0].health).toBe(initial[0].health); expect(sim.actors[1].health).toBe(initial[1].health);
    expect(sim.actors[0].weapon.ammo).toBe(initial[0].ammo); expect(sim.phase).toBe('fighting');
    expect(sim.drainEvents().some(event => ['fire', 'hit', 'round'].includes(event.kind))).toBe(false);
    expect(sim.actors[0].position).not.toEqual(initial[0].position);
  });
});

describe('coherent authored entry selection', () => {
  const start = (viewIndex: number) => ({viewIndex, feet: {x: viewIndex * UNIT, y: 0, z: 0}, holds: []});
  const courses = [{id: 'long', starts: [start(6), start(1), start(4)]}, {id: 'pit', starts: [start(2)]}] as unknown as RoundCourse[];
  it('defaults to a standard course and its earliest validated covered entry across seeds', () => {
    for (let seed = 0; seed < 16; seed++) {
      const course = chooseRealMapCourse(courses, 'long', 'standard', seed);
      expect(course.id).toBe('long'); expect(chooseRealMapStart(course, 'standard', seed).viewIndex).toBe(1);
    }
  });
  it('retains deterministic shuffle variety as an explicit option', () => {
    const selected = new Set();
    for (let seed = 0; seed < 32; seed++) selected.add(chooseRealMapCourse(courses, 'long', 'shuffle', seed).id);
    expect(selected.size).toBe(2);
    expect(chooseRealMapCourse(courses, 'long', 'pit', 1).id).toBe('pit');
    expect(() => chooseRealMapCourse(courses, 'long', 'unknown', 1)).toThrow();
  });
});
