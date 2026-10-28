import {describe, expect, it, vi} from 'vitest';
import {DuelEngine} from './DuelEngine';
import type {DuelEvent} from './types';

function harness() {
  const actor = {alive: true, position: {x: 0, y: 1, z: 0}, weapon: {id: 'ak47'}, command: {}};
  const sim = {selectedUtility: undefined as 'he' | 'smoke' | undefined, actors: [actor, {...actor}], time: 1,
    phase: 'fighting', playable: true, loadout: {}, command: vi.fn(), equipPlayer: vi.fn(),
    selectUtility: vi.fn((kind: 'he' | 'smoke' | null) => {sim.selectedUtility = kind ?? undefined;}), throwUtility: vi.fn(() => true),queueUtilityThrow:vi.fn(()=>true),
    snapshot: () => [actor]};
  const audio = {cancelAction: vi.fn(),cancelUtilityCues:vi.fn(), playUtility: vi.fn(), playHit: vi.fn(),preloadUtilityCues:vi.fn().mockResolvedValue(undefined)};
  const state = {sim, audio, paused: false, loadingMap: false, report: vi.fn(),
    renderer: {domElement: {focus: vi.fn()}}, viewAnimation: {cancel: vi.fn(), playInspect: vi.fn()},
    utilityRenderer: {cancelHeld: vi.fn(), inspect: vi.fn(()=>true), throw: vi.fn()}, utilityThrownAt: new Map(), utilitySounds:new Map(),
    settings: {volume: 1}, animationClock: 1, soundLocation: vi.fn(point => ({position: point})),
    xpDamage: new Map(), deaths: new Map(), animationTimes: new Map(), killFeed: {push: vi.fn()},
    characterHits: {emit: vi.fn()}, damageFeedback: {hit: vi.fn()}, kills: 0, damage: 0,
  };
  const engine = Object.assign(Object.create(DuelEngine.prototype) as object, state) as unknown as DuelEngine;
  const process = (events: DuelEvent[]) => (engine as unknown as {processEvents(events: DuelEvent[]): void}).processEvents(events);
  return {engine, state, sim, process};
}

describe('duel utility input and event routing', () => {
  it('selects a separate utility stance and cancels firearm presentation', () => {
    const {engine, state, sim} = harness();
    engine.selectUtility('he');
    expect(sim.selectUtility).toHaveBeenCalledWith('he');
    expect(sim.command).toHaveBeenCalledWith(0, {fireHeld: false, secondaryHeld: false});
    expect(state.viewAnimation.cancel).toHaveBeenCalled(); expect(state.audio.cancelAction).toHaveBeenCalledWith(0);
    expect(sim.actors[0].weapon.id).toBe('ak47');
  });

  it('clears utility stance when equipping the current gun, including ready mode', () => {
    const {engine, sim} = harness(); sim.selectedUtility = 'smoke'; sim.phase = 'ready';
    engine.equip(1);
    expect(sim.selectedUtility).toBeUndefined();
    expect(sim.command).toHaveBeenCalledWith(0, {equipSlot: 1, fireHeld: false, secondaryHeld: false});
    expect(sim.equipPlayer).toHaveBeenCalledWith(1);
  });

  it('offers a full throw and a lob without activating scope or weapon secondary modes', () => {
    const {engine, sim} = harness(); sim.selectedUtility = 'he';
    engine.throwUtility(); expect(sim.queueUtilityThrow).toHaveBeenLastCalledWith(0, 1);
    engine.secondary(); expect(sim.queueUtilityThrow).toHaveBeenLastCalledWith(0, 0);
    expect(sim.command).not.toHaveBeenCalled();
    sim.selectedUtility = undefined; engine.secondary();
    expect(sim.command).toHaveBeenCalledWith(0, {secondaryPressed: true});
  });

  it('routes grenade inspect to its native assembly and ignores utility commands while paused', () => {
    const {engine, state, sim} = harness(); sim.selectedUtility = 'he';
    engine.inspect(); expect(state.viewAnimation.playInspect).not.toHaveBeenCalled();
    expect(state.utilityRenderer.inspect).toHaveBeenCalledWith(sim.time);
    Object.assign(engine, {paused: true});
    engine.selectUtility('smoke'); engine.throwUtility();
    expect(sim.selectUtility).not.toHaveBeenCalled(); expect(sim.throwUtility).not.toHaveBeenCalled();
  });

  it('plays one supplied utility sound and keeps bare detonation events silent', () => {
    const {process, state} = harness();
    const base = {kind: 'utility' as const, tick: 1, actorId: 0, utility: 'he' as const, point: {x: 1, y: 2, z: 3}};
    process([{...base, action: 'detonate'}, {...base, action: 'detonate', sound: 'he'}]);
    expect(state.audio.playUtility).toHaveBeenCalledTimes(1);
    expect(state.audio.playUtility).toHaveBeenCalledWith('he', 'detonate', .65, {position: base.point}, 'he');
    process([{...base, action: 'throw'}]); expect(state.audio.playUtility).toHaveBeenCalledTimes(2);
  });

  it('routes self utility damage as incoming damage without awarding kills, damage, XP, blood or bullet audio', () => {
    const {engine, state, process} = harness();
    process([{kind: 'hit', tick: 1, shooter: 0, victim: 0, shotId: 100, utility: 'he', group: 'chest',
      point: {x: 0, y: 1, z: 0}, healthDamage: 100, armorDamage: 0, lethal: true}]);
    expect(state.damageFeedback.hit).toHaveBeenCalled();
    expect(state.xpDamage.size).toBe(0);
    expect((engine as unknown as {kills: number; damage: number}).kills).toBe(0);
    expect((engine as unknown as {damage: number}).damage).toBe(0);
    expect(state.characterHits.emit).not.toHaveBeenCalled(); expect(state.audio.playHit).not.toHaveBeenCalled();
    expect(state.killFeed.push).toHaveBeenCalledWith(expect.objectContaining({utility: 'he', shooter: 0, victim: 0, headshot: false}), 1);
  });

  it('retains enemy utility damage credit but uses a utility caption and no bullet hit feedback', () => {
    const {engine, state, process} = harness();
    process([{kind: 'hit', tick: 1, shooter: 0, victim: 1, shotId: 100, utility: 'molotov', group: 'chest',
      point: {x: 1, y: 1, z: 0}, healthDamage: 8, armorDamage: 0, lethal: false}]);
    expect(state.xpDamage.get(1)).toBe(8);
    expect((engine as unknown as {caption: string}).caption).toBe('Molotov HIT');
    expect(state.characterHits.emit).not.toHaveBeenCalled(); expect(state.audio.playHit).not.toHaveBeenCalled();
  });
});
