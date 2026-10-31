import {afterEach, describe, expect, it, vi} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';
import {BotUtilityPlanner} from './utility-tactics';
import type {ThreatReport} from './trading';
import {utilityNativeTiming} from './utility-presentation';
import {BotUtilityDefense} from './utility-defense';
import {utilityInventory} from './utility-loadout';
import {testArena} from './geometry';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const sim = new DuelSimulation(sanitizeDuelConfig({utilitiesEnabled: true, botUtilities: true, generatedMaps: true}));
  sim.command(1, {}); sim.start();
  const planner = vi.spyOn(BotUtilityPlanner.prototype, 'command').mockImplementation((_time, _self, _stock, _report, _arena, context) =>
    context.visible ? undefined : {kind: 'he', yawDelta: 0, pitchDelta: 0, throw: context.readyToThrow === true});
  const policy = (visible = false) => {
    const report: ThreatReport = {point: {x: 0, y: 1.6, z: 8}, observedAt: sim.time, readyAt: sim.time, source: 'sight'};
    return sim['applyBotCombatPolicy'](1, {fireHeld: false, firePressed: false}, report, visible);
  };
  const advance = (seconds: number) => {const end = sim.time + seconds; while (sim.time < end) sim.step();};
  return {sim, planner, policy, advance};
}

describe('bot utility decision to native action handoff', () => {
  it('can complete a real sensed-contact HE setup after gunfire without fabricated refreshed sightings', () => {
    let released = false;
    for (let seed = 1; seed <= 16 && !released; seed++) {
      const arena = {...testArena(), minX: -50, maxX: 50, minZ: -50, maxZ: 50,
        solids: [{center: {x: 0, y: .925, z: 8}, size: {x: 8, y: 1.85, z: .5}}]};
      const sim = new DuelSimulation(sanitizeDuelConfig({utilitiesEnabled: true, botUtilities: true}), seed, arena);
      sim.command(1, {}); sim.actors[1].position = {x: 0, y: 64 * UNIT, z: 10}; sim.actors[1].yaw = 0;
      sim.actors[0].position = {x: 0, y: 64 * UNIT, z: -14}; sim.actors[0].health = 10000;
      sim['utilityStocks'].set(1, utilityInventory(['he'])); sim.start();
      while (sim.time < 3) sim.step();
      sim['lastShotAt'].set(1, 3);
      const report: ThreatReport = {point: {...sim.actors[0].position}, observedAt: 3, readyAt: 3, source: 'sight'};
      while (sim.time < 6) {
        const command = sim['applyBotCombatPolicy'](1, {fireHeld: false, firePressed: false}, sim.time < 4.5 ? report : null, false);
        sim.command(1, command); sim.step();
        if (sim.drainEvents().some(event => event.kind === 'utility' && event.actorId === 1 && event.action === 'throw')) {
          expect(sim.time).toBeGreaterThan(4.5);
          expect(sim.utilityInventory(1).he).toBe(0); released = true; break;
        }
      }
    }
    expect(released).toBe(true);
  });
  it('keeps the draw cancellable instead of queuing an irreversible release before readiness', () => {
    const {sim, planner, policy, advance} = fixture();
    policy();
    expect(sim.utilityPresentation(1)?.releaseAt).toBeUndefined();
    expect(planner.mock.calls[planner.mock.calls.length - 1][5].readyToThrow).toBe(false);
    advance(.2); policy();
    expect(sim.utilityPresentation(1)?.releaseAt).toBeUndefined();
    policy(true);
    expect(sim.utilityPresentation(1)).toBeUndefined();
    expect(sim.utilityInventory(1).he).toBe(1);
    expect(sim.utilities.projectiles).toHaveLength(0);
  });
  it('commits only after native deploy readiness, then completes one release even if contact appears', () => {
    const {sim, policy, advance} = fixture();
    policy();
    const ready = sim.utilityPresentation(1)!.readyAt;
    expect(ready).toBeCloseTo(sim.time + utilityNativeTiming('he').deployDuration);
    while (sim.time + STEP < ready) {advance(STEP); policy();}
    expect(sim.utilityPresentation(1)?.releaseAt).toBeUndefined();
    while (sim.time < ready) advance(STEP);
    policy();
    const release = sim.utilityPresentation(1)!.releaseAt!;
    expect(release).toBeGreaterThan(ready);
    policy(true);
    expect(sim.utilityPresentation(1)?.releaseAt).toBe(release);
    advance(release - sim.time + STEP);
    expect(sim.utilityInventory(1).he).toBe(0);
    expect(sim.drainEvents().filter(event => event.kind === 'utility' && event.action === 'throw')).toHaveLength(1);
  });
  it('puts the grenade away after taking damage even without a visual contact', () => {
    const {sim, planner, policy} = fixture(); policy();
    sim['lastHurtAt'].set(1, sim.time); planner.mockClear(); policy();
    expect(planner).not.toHaveBeenCalled();
    expect(sim.utilityPresentation(1)).toBeUndefined();
    expect(sim.utilityInventory(1).he).toBe(1);
  });
  it('does not let an anti-flash or fire-escape command erase an already committed release', () => {
    const {sim, policy, advance} = fixture(); policy();
    advance(sim.utilityPresentation(1)!.readyAt); policy();
    const release = sim.utilityPresentation(1)!.releaseAt!;
    const defense = vi.spyOn(BotUtilityDefense.prototype, 'command').mockReturnValue({side: 1, yawDelta: .2});
    advance(STEP);
    expect(defense).not.toHaveBeenCalled();
    expect(sim.utilityPresentation(1)?.releaseAt).toBe(release);
    advance(release - sim.time + STEP);
    expect(sim.utilityInventory(1).he).toBe(0);
    expect(sim.drainEvents().filter(event => event.kind === 'utility' && event.action === 'throw')).toHaveLength(1);
    advance(STEP); expect(defense).toHaveBeenCalled();
  });
});
