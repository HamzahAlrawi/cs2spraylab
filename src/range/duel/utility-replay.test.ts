import {describe, expect, it} from 'vitest';
import {CombatReplay, recordingActors, type CombatRecording} from './combat-replay';
import {copyUtilityEvent, copyUtilityState, replayUtilityPose, replayUtilityThrow, sampleReplayUtilities, UTILITY_REPLAY_LIMITS} from './utility-replay';
import {UTILITY_RULES, type UtilityEffect, type UtilityProjectile} from './utilities';
import {MAX_SMOKE_CELLS} from './smoke-volume';

const projectile = (): UtilityProjectile => ({id: 1, actorId: 0, side: 'player', kind: 'he', position: {x: 0, y: 2, z: 0},
  velocity: {x: 2, y: 1, z: 0}, thrownAt: 0, radius: .05, bounces: 0, resting: false});
const effect = (): UtilityEffect => ({id: 2, actorId: 0, side: 'player', kind: 'smoke', type: 'smoke', position: {x: 0, y: 2, z: 0},
  radius: 4, startedAt: 0, expiresAt: 20, cells: [], holes: []});

describe('utility replay capture and absolute-time sampling', () => {
  it('bounds allowlisted nested state and rejects invalid geometry without retaining aliases', () => {
    const p = projectile(), e = {...effect(), type: 'fire' as const, nextTick: Infinity, foreign: 'not serialized'};
    e.cells = Array.from({length: 100}, () => ({x: 1, y: 0, z: 2}));
    e.holes = Array.from({length: 100}, () => ({from: {x: 0, y: 0, z: 0}, to: {x: 1, y: 1, z: 1}, radius: 1, startedAt: 0, expiresAt: 2}));
    const state = copyUtilityState(Array.from({length: 100}, () => p), Array.from({length: 100}, () => e));
    expect(state.projectiles).toHaveLength(UTILITY_RULES.maxProjectiles); expect(state.effects).toHaveLength(UTILITY_RULES.maxEffects);
    expect(state.effects[0].cells).toHaveLength(UTILITY_REPLAY_LIMITS.cells); expect(state.effects[0].holes).toHaveLength(UTILITY_RULES.maxHoles);
    expect(state.effects[0]).not.toHaveProperty('nextTick'); expect(state.effects[0]).not.toHaveProperty('foreign');
    p.position.x = 99; e.holes[0].from.x = 99;
    expect(state.projectiles[0].position.x).toBe(0); expect(state.effects[0].holes[0].from.x).toBe(0);
    expect(copyUtilityState([{...p, position: {x: NaN, y: 0, z: 0}}], [{...e, expiresAt: Infinity}])).toEqual({projectiles: [], effects: []});
  });

  it('interns unchanged effects and retains active pre-window smoke in detached JSON exports', () => {
    const replay = new CombatReplay(1), cloud = effect();
    for (let tick = 0; tick <= 128 * 15; tick += 4) {replay.frame(tick, tick / 128, []); replay.utility(tick, tick / 128, [], [cloud]);}
    const source = replay.export();
    expect(source.utilities!.effects).toHaveLength(1);
    expect(sampleReplayUtilities(source.utilities, 6).effects[0].startedAt).toBe(0);
    expect(JSON.stringify(source).length).toBeLessThan(90000);
    cloud.position.x = 999; source.utilities!.effects[0].position.x = 42;
    expect(replay.export().utilities!.effects[0].position.x).toBe(0);
    const released = replay.release(); expect(released.utilities!.effects).toHaveLength(1);
    expect(replay.export().utilities).toBeUndefined();
    replay.utility(0, 0, [], [cloud]); expect(released.utilities!.effects[0].position.x).toBe(0);
  });

  it('copies the full bounded smoke grid once per effect definition even while holes change every sample', () => {
    const replay = new CombatReplay(1), smoke = effect(); let reads = 0;
    smoke.cells = Array.from({length: MAX_SMOKE_CELLS + 88}, (_, x) => ({get x() {reads++; return x;}, y: 0, z: 1}));
    replay.utility(0, 0, [], [smoke]); const initialReads = reads;
    for (let tick = 4; tick <= 1280; tick += 4) {
      smoke.holes = [{from: {x: tick, y: 1, z: 0}, to: {x: tick + 1, y: 1, z: 0}, radius: .3, startedAt: tick / 128, expiresAt: tick / 128 + 1}];
      replay.utility(tick, tick / 128, [], [smoke]);
    }
    expect(reads).toBe(initialReads);
    const data = replay.export().utilities!;
    expect(data.cells).toHaveLength(1); expect(data.cells[0]).toHaveLength(MAX_SMOKE_CELLS);
    expect(data.effects.length).toBeGreaterThan(1); expect(data.effects.every(e => e.cells === 0)).toBe(true);
    const sample = sampleReplayUtilities(data, 5);
    expect(sample.effects[0].cells).toHaveLength(MAX_SMOKE_CELLS); expect(sample.effects[0].holes).toHaveLength(1);
    expect(JSON.stringify(data).length).toBeLessThan(240000);
  });

  it('captures optional drops, discrete pickup/removal and replacement cell definitions without aliases', () => {
    const replay = new CombatReplay(1), smoke = effect(), drop = {id: 3, utility: 'he' as const, position: {x: 1, y: 0, z: 2}, picked: false, owner: 0};
    smoke.cells = [{x: 1, y: 0, z: 0}];
    replay.utility(0, 0, [], [smoke], true, [drop]);
    smoke.cells = [{x: 2, y: 0, z: 0}]; drop.position.x = 10; drop.picked = true;
    replay.utility(128, 1, [], [smoke], true, [drop]); replay.utility(256, 2, [], [], true, []);
    const data = replay.export().utilities!;
    expect(data.cells).toHaveLength(2);
    expect(sampleReplayUtilities(data, .5)).toMatchObject({drops: [{position: {x: 1}, picked: false}], effects: [{cells: [{x: 1}]}]});
    expect(sampleReplayUtilities(data, 1)).toMatchObject({drops: [{position: {x: 10}, picked: true}], effects: [{cells: [{x: 2}]}]});
    expect(sampleReplayUtilities(data, 2).drops).toEqual([]);
    // Multiple hooks in one simulation tick coalesce rather than evicting replay history.
    replay.utility(256, 2, [], [], true, [drop]); expect(replay.export().utilities!.frames).toHaveLength(3);
  });

  it('samples flight without crossing bounces or anticipating spawns, holes or extinguishing', () => {
    const replay = new CombatReplay(1), p = projectile(), cloud = effect();
    replay.utility(0, 0, [p], [cloud]);
    p.position.x = 2;
    cloud.holes.push({from: {x: 0, y: 0, z: 0}, to: {x: 1, y: 1, z: 1}, radius: 1, startedAt: 1, expiresAt: 2});
    replay.utility(128, 1, [p], [cloud]);
    replay.utility(256, 2, [], []);
    const source = JSON.parse(JSON.stringify(replay.export())) as CombatRecording, before = structuredClone(source);
    expect(sampleReplayUtilities(source.utilities, -.01)).toEqual({projectiles: [], effects: []});
    expect(sampleReplayUtilities(source.utilities, .5).projectiles[0].position.x).toBe(1);
    expect(sampleReplayUtilities(source.utilities, .5).effects[0].holes).toHaveLength(0);
    expect(sampleReplayUtilities(source.utilities, 1).effects[0].holes).toHaveLength(1);
    expect(sampleReplayUtilities(source.utilities, 2).effects).toHaveLength(0);
    expect(sampleReplayUtilities(source.utilities, .5).projectiles[0].position.x).toBe(1);
    source.utilities!.frames[1].projectiles[0].bounces++;
    expect(sampleReplayUtilities(source.utilities, .5).projectiles[0].position.x).toBe(0);
    source.utilities!.frames[1].projectiles[0].bounces--;
    expect(source).toEqual(before);
  });

  it('retains bounded events and terminal snapshots without mutating or leaking into the next round', () => {
    const replay = new CombatReplay(1), p = projectile();
    for (let tick = 0; tick < 6000; tick++) {
      replay.utility(tick, tick / 128, [p], [], true);
      replay.utilityEvent({type: 'bounce', time: tick / 128, actorId: 0, side: 'player', kind: 'he', utilityId: 1, position: p.position, normal: {x: 0, y: 1, z: 0}});
    }
    const recording = replay.release();
    expect(recording.utilities!.frames.length).toBeLessThanOrEqual(UTILITY_REPLAY_LIMITS.frames);
    expect(recording.utilities!.events.length).toBeLessThanOrEqual(UTILITY_REPLAY_LIMITS.events);
    expect(recording.utilities!.events.every(e => e.time >= 5999 / 128 - 11)).toBe(true);
    expect(replay.export().utilities).toBeUndefined();
  });

  it('records exact throw, flash, damage, decoy and expiry events and removes detonated projectiles on seek', () => {
    const replay = new CombatReplay(1), p = projectile(); replay.utility(0, 0, [p], []);
    const base = {time: .5, actorId: 0, side: 'player' as const, kind: 'he' as const, utilityId: 1, position: p.position};
    replay.utilityEvent({kind: 'utility', tick: 0, actorId: 0, utility: 'he', action: 'throw', point: p.position, strength: .1});
    replay.utilityEvent({...base, type: 'detonate'});
    replay.utilityEvent({...base, type: 'flash', targetId: 1, exposure: .5, duration: 2});
    replay.utilityEvent({...base, type: 'sound', sound: 'decoy', radius: 35});
    replay.utilityEvent({...base, type: 'damage', targetId: 1, shooter: 0, victim: 1, damage: 30, cause: 'he', healthDamage: 20, armorDamage: 5,
      point: {x: 1, y: 2, z: 3}, direction: {x: 1, y: 0, z: 0}});
    replay.utilityEvent({...base, type: 'expire'});
    const source = replay.export();
    expect(source.utilities!.events).toHaveLength(6);
    expect(sampleReplayUtilities(source.utilities, .49).projectiles).toHaveLength(1);
    expect(sampleReplayUtilities(source.utilities, .5).projectiles).toHaveLength(0);
    expect(replayUtilityPose(undefined, replayUtilityThrow(source.utilities, 0, .1))).toMatchObject({action: 'throw-low', startedAt: expect.closeTo(-.1,7)});
    expect(replayUtilityThrow(source.utilities, 0, -1)).toBeUndefined();
    expect(copyUtilityEvent({...base, time: NaN, type: 'expire'})).toBeUndefined();
  });

  it('accepts old recordings with no utility payload or camera actor', () => {
    expect(sampleReplayUtilities(undefined, 1)).toEqual({projectiles: [], effects: []});
    expect(recordingActors(new CombatReplay(1).export(), 1)).toEqual([]);
  });
  it('keeps queued draw separate from pinning and preserves the exact throw action clock',()=>{
    const state={kind:'smoke' as const,selectedAt:1,readyAt:2,primedAt:2,throwStartedAt:2.8,releaseAt:2.9};
    expect(replayUtilityPose(state,undefined,1.5)).toMatchObject({action:'draw',startedAt:1});
    expect(replayUtilityPose({...state,primedAt:undefined,throwStartedAt:undefined,releaseAt:undefined},undefined,3)).toMatchObject({action:'idle',startedAt:2});
    expect(replayUtilityPose(state,undefined,2.5)).toMatchObject({action:'pullpin',startedAt:2});
    expect(replayUtilityPose(state,undefined,2.85)).toMatchObject({action:'throw-high',startedAt:2.8});
    const thrown=copyUtilityEvent({kind:'utility',tick:384,actorId:0,utility:'smoke',action:'throw',point:{x:0,y:1,z:0},throwStartedAt:2.9});
    expect(replayUtilityPose(undefined,thrown,3)).toMatchObject({action:'throw-high',startedAt:2.9});
  });
});
