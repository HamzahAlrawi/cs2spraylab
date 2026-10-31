import {afterEach, describe, expect, it, vi} from 'vitest';
import {STEP} from '../actor-physics';
import type {Arena} from './geometry';
import type {DuelActorSnapshot} from './types';
import type {ThreatReport} from './trading';
import {BotUtilityPlanner} from './utility-tactics';
import {utilityInventory, type UtilityKind} from './utility-loadout';
import {UtilitySimulation, UTILITY_RULES, type UtilityEvent, type UtilityThrow} from './utilities';
import * as ballistics from './utility-ballistics';
import {nativeGrenadeReleaseAt} from './grenade-native-input';
import * as geometry from './geometry';
import * as flashVisibility from './grenade-flash-visibility';

const bot = (): DuelActorSnapshot => ({id: 1, generation: 0, side: 'enemy',
  position: {x: 0, y: 1.6256, z: 10}, feet: 0, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0,
  grounded: true, verticalVelocity: 0, crouched: false, duckAmount: 0, health: 100, armor: 100,
  helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const world = (): Arena => ({minX: -50, maxX: 50, minZ: -50, maxZ: 50,
  solids: [{center: {x: 0, y: .925, z: 8}, size: {x: 8, y: 1.85, z: .5}}]});
const evidence = (time = 3): ThreatReport => ({point: {x: 0, y: 1.6256, z: -14},
  observedAt: time, readyAt: time, source: 'sight'});
const context = (teammates: DuelActorSnapshot[] = []) => ({visible: false, lastShotAt: -Infinity, teammates});

function start(kind: UtilityKind = 'he', arena = world(), self = bot(), peers: DuelActorSnapshot[] = [],
  source: ThreatReport['source'] = 'sight') {
  const inventory = utilityInventory([kind]);
  for (let seed = 1; seed <= 32; seed++) {
    const planner = new BotUtilityPlanner(seed, self.id, 10);
    const command = planner.command(3, self, inventory, {...evidence(), source}, arena,
      {...context(peers), readyToThrow: false});
    if (command) return {planner, command, self, arena, inventory, peers, seed, source, time: 3};
  }
  throw new Error(`No safe ${kind} plan in deterministic cover fixture`);
}

function advance(state: ReturnType<typeof start>, until: number, readyAt = Infinity) {
  let command = state.command;
  while (state.time + STEP <= until + 1e-8) {
    state.self.yaw += command.yawDelta;
    state.self.pitch += command.pitchDelta;
    state.time += STEP;
    const next = state.planner.command(state.time, state.self, state.inventory, {...evidence(state.time), source: state.source}, state.arena,
      {...context(state.peers), readyToThrow: state.time >= readyAt});
    if (!next) return undefined;
    state.command = command = next;
    if (command.throw) break;
  }
  return command;
}

afterEach(() => vi.restoreAllMocks());

describe('bounded observed-contact utility policy (authored, not native bot parity)', () => {
  it('rejects a safe nearby HE burst if static cover shields the reported angle', () => {
    const state = start('he'), trace = geometry.traceSolid;
    let blockedBlastChecks = 0;
    vi.spyOn(geometry, 'traceSolid').mockImplementation((origin, direction, arena, limit = Infinity, environment) => {
      const hit = trace(origin, direction, arena, limit, environment);
      if (limit < 3 && direction.y > 0 && Math.hypot(origin.x - evidence().point.x, origin.z - evidence().point.z) < 2) {
        blockedBlastChecks++; return {...hit, distance: limit / 2};
      }
      return hit;
    });
    expect(new BotUtilityPlanner(state.seed, 1, 10).command(3, bot(), state.inventory, evidence(), world(),
      context())).toBeUndefined();
    expect(blockedBlastChecks).toBeGreaterThan(0);
  });
  it('rejects a self-safe flash that cannot reach the reported angle', () => {
    const self = {...bot(), position: {...bot().position, z: 11}}, state = start('flash', world(), self);
    const visibility = flashVisibility.nativeFlashVisibility;
    let blockedTargetChecks = 0;
    vi.spyOn(flashVisibility, 'nativeFlashVisibility').mockImplementation((eye, point, arena) => {
      if (Math.hypot(eye.x - evidence().point.x, eye.y - evidence().point.y, eye.z - evidence().point.z) < .01) {
        blockedTargetChecks++; return 0;
      }
      return visibility(eye, point, arena);
    });
    expect(new BotUtilityPlanner(state.seed, 1, 10).command(3, self, state.inventory, evidence(), world(),
      context())).toBeUndefined();
    expect(blockedTargetChecks).toBeGreaterThan(0);
  });
  it('keeps useful HE and fire throws available from real cover', () => {
    for (const kind of ['he', 'molotov', 'incendiary'] as const) {
      const state = start(kind);
      expect(advance(state, 5, 3.8)?.throw, kind).toBe(true);
      expect(state.planner.target()).toBeUndefined();
    }
  });

  it('holds the cached plan throughout draw/pin warmth, then commits once actually ready', () => {
    const state = start();
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    expect(advance(state, 4.3)?.throw).toBe(false);
    expect(throws).not.toHaveBeenCalled();
    expect(state.planner.target()).toBeDefined();
    expect(advance(state, 4.49, 4.5)?.throw).toBe(false);
    expect(advance(state, 4.7, 4.5)?.throw).toBe(true);
    expect(throws).toHaveBeenCalledTimes(1);
    const again = state.planner.command(state.time + STEP, state.self, state.inventory, evidence(state.time + STEP),
      state.arena, {...context(), readyToThrow: true});
    expect(again).toBeUndefined();
    expect(throws).toHaveBeenCalledTimes(1);
    expect(state.planner.target()).toBeUndefined();
  });
  it('finishes a native deploy after the caller stops publishing its short-lived sight report', () => {
    const state = start(); let command = state.command;
    while (state.time < 4.7 && !command.throw) {
      state.self.yaw += command.yawDelta; state.self.pitch += command.pitchDelta; state.time += STEP;
      const next = state.planner.command(state.time, state.self, state.inventory, state.time < 4.5 ? evidence() : null,
        state.arena, {...context(), readyToThrow: state.time >= 4.6});
      expect(next).toBeDefined(); command = next!;
    }
    expect(command.throw).toBe(true);
    expect(state.time).toBeGreaterThan(4.5);
  });
  it('expires the saved sight observation even when native deploy is still pending', () => {
    const state = start();
    expect(state.planner.command(6.01, state.self, state.inventory, null, state.arena,
      {...context(), readyToThrow: false})).toBeUndefined();
    expect(state.planner.target()).toBeUndefined();
  });

  it.each(['warming', 'ready'] as const)('cancels a %s plan on live sight before any gunshot', phase => {
    const state = start();
    if (phase === 'ready') expect(advance(state, 4.3)?.throw).toBe(false);
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    expect(state.planner.command(state.time + STEP, state.self, state.inventory, evidence(state.time + STEP), state.arena,
      {...context(), visible: true, readyToThrow: phase === 'ready'})).toBeUndefined();
    expect(state.planner.target()).toBeUndefined();
    expect(throws).not.toHaveBeenCalled();
  });

  it.each(['stale', 'future', 'unrecognized', 'moved', 'sound-downgrade'] as const)(
    'cancels immediately on %s evidence, between planning checks', failure => {
      const state = start();
      let report: ThreatReport | null = evidence(3.01);
      if (failure === 'stale') report!.observedAt = -1;
      if (failure === 'future') report!.observedAt = 4;
      if (failure === 'unrecognized') report!.readyAt = 4;
      if (failure === 'moved') report!.point.x += 3;
      if (failure === 'sound-downgrade') report!.source = 'sound';
      expect(state.planner.command(3.01, state.self, state.inventory, report, state.arena, context())).toBeUndefined();
      expect(state.planner.target()).toBeUndefined();
    });

  it('refuses exposure even when the visible flag has not recognized the contact', () => {
    const self = bot(), arena = world(), inventory = utilityInventory(['he', 'flash', 'smoke', 'molotov']);
    arena.solids = [];
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    for (let seed = 1; seed <= 16; seed++) {
      expect(new BotUtilityPlanner(seed, 1, 10).command(3, self, inventory, evidence(), arena, context())).toBeUndefined();
    }
    expect(throws).not.toHaveBeenCalled();
  });

  it('cancels cover loss, self movement, ally movement, or stock loss without a solver retry', () => {
    for (const cause of ['cover', 'self', 'ally', 'stock'] as const) {
      const peer = {...bot(), id: 2, position: {x: 12, y: 1.6256, z: 10}};
      const state = start('he', world(), bot(), [peer]);
      const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
      if (cause === 'cover') state.arena.solids = [];
      if (cause === 'self') state.self.position.x += .3;
      if (cause === 'ally') peer.position.z -= .3;
      if (cause === 'stock') state.inventory.he = 0;
      expect(state.planner.command(3.01, state.self, state.inventory, evidence(3.01), state.arena,
        context([peer]))).toBeUndefined();
      expect(throws).not.toHaveBeenCalled();
      throws.mockRestore();
    }
  });

  it('never treats sound as an exact damage or flash target', () => {
    const inventory = utilityInventory(['he', 'flash', 'molotov', 'incendiary']);
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    for (let seed = 1; seed <= 16; seed++) {
      const report = {...evidence(), source: 'sound' as const};
      expect(new BotUtilityPlanner(seed, 1, 10).command(3, bot(), inventory, report, world(), context())).toBeUndefined();
    }
    expect(throws).not.toHaveBeenCalled();
  });

  it('never substitutes an unobserved actor for a missing report', () => {
    const self = bot(), hidden = {...bot(), id: 0, side: 'player' as const, position: evidence().point};
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    expect(new BotUtilityPlanner(1, 1, 10).command(20, self, utilityInventory(['he', 'flash']), null,
      world(), context([hidden]))).toBeUndefined();
    expect(throws).not.toHaveBeenCalled();
  });

  it('caps candidate predictions and performs no per-tick re-solving while preparing', () => {
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    const solves = vi.spyOn(ballistics, 'solveUtilityThrow');
    const state = start();
    throws.mockClear(); solves.mockClear();
    expect(advance(state, 4.5)?.throw).toBe(false);
    expect(throws).not.toHaveBeenCalled();
    expect(solves).not.toHaveBeenCalled();
    state.planner.cancel(state.time);
    expect(advance(state, 4.6)).toBeUndefined();
    expect(throws).not.toHaveBeenCalled();
  });

  it('allows a flash that bursts beyond cover without flashing its thrower', () => {
    const state = start('flash', world(), {...bot(), position: {...bot().position, z: 11}});
    expect(advance(state, 5, 3.8)?.throw).toBe(true);
  });

  it('allows defensive smoke from cover', () => {
    const state = start('smoke', world(), {...bot(), health: 30});
    expect(advance(state, 5, 3.8)?.throw).toBe(true);
  });

  it.each(['he', 'molotov', 'incendiary', 'flash'] as const)('rejects %s endangering a teammate at the outcome', kind => {
    const self = kind === 'flash' ? {...bot(), position: {...bot().position, z: 11}} : bot();
    const baseline = start(kind, world(), self);
    const ally = {...bot(), id: 2, position: {...evidence().point}, yaw: Math.PI};
    const planner = new BotUtilityPlanner(baseline.seed, 1, 10);
    expect(planner.command(3, self, baseline.inventory, evidence(), world(), context([ally]))).toBeUndefined();
  });

  it('rejects a flash when low cover leaks exposure back to self', () => {
    const arena = world();
    arena.solids[0].size.y = 1.64;
    arena.solids[0].center.y = .82;
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    for (let seed = 1; seed <= 16; seed++) {
      expect(new BotUtilityPlanner(seed, 1, 10).command(3, bot(), utilityInventory(['flash']), evidence(), arena,
        context())).toBeUndefined();
    }
    expect(throws.mock.calls.length).toBeGreaterThan(0);
  });

  it('does not smoke a friendly clear firing lane to the observed contact', () => {
    const baseline = start('smoke', world(), {...bot(), health: 30});
    const ally = {...bot(), id: 2, position: {x: 2, y: 1.6256, z: 2}};
    expect(new BotUtilityPlanner(baseline.seed, 1, 10).command(3, baseline.self, baseline.inventory,
      evidence(), world(), context([ally]))).toBeUndefined();
  });

  it('allows fresh sound-area defensive smoke, but cancels on older sound evidence', () => {
    const state = start('smoke', world(), {...bot(), health: 30}, [], 'sound');
    const report = {...evidence(), source: 'sound' as const};
    expect(state.planner.command(5.01, state.self, state.inventory, report, state.arena,
      {...context(), readyToThrow: false})).toBeUndefined();
    expect(state.planner.target()).toBeUndefined();
    const freshState = start('smoke', world(), {...bot(), health: 30}, [], 'sound');
    expect(advance(freshState, 5, 3.8)?.throw).toBe(true);
  });

  it('reserves future fire spread beyond the initial flame cells', () => {
    const baseline = start('molotov');
    const ally = {...bot(), id: 2, position: {x: 3, y: 1.6256, z: -15}};
    const events: UtilityEvent[] = [];
    const realAdvance = UtilitySimulation.prototype.advance;
    vi.spyOn(UtilitySimulation.prototype, 'advance').mockImplementation(function (this: UtilitySimulation, ...args) {
      const result = realAdvance.apply(this, args); events.push(...result); return result;
    });
    expect(new BotUtilityPlanner(baseline.seed, 1, 10).command(3, bot(), baseline.inventory, evidence(), world(),
      context([ally]))).toBeUndefined();
    expect(events.some(event => event.type === 'detonate')).toBe(true);
    expect(events.some(event => event.type === 'damage')).toBe(false);
  });

  it('validates the exact tick-quantized release pose handed to the live projectile kernel', () => {
    const state = start();
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    const events: UtilityEvent[] = [];
    const realAdvance = UtilitySimulation.prototype.advance;
    vi.spyOn(UtilitySimulation.prototype, 'advance').mockImplementation(function (this: UtilitySimulation, ...args) {
      const result = realAdvance.apply(this, args); events.push(...result); return result;
    });
    expect(advance(state, 5, 3.8)?.throw).toBe(true);
    expect(throws).toHaveBeenCalledTimes(1);
    const input = throws.mock.calls[0][0];
    const releaseAt = Math.ceil(nativeGrenadeReleaseAt(state.time) / STEP) * STEP;
    expect(input.time).toBe(releaseAt);
    expect(input.time).toBeGreaterThan(nativeGrenadeReleaseAt(state.time));
    expect(state.command.yawDelta).toBe(0);
    expect(state.command.pitchDelta).toBe(0);
    expect(input.origin).toEqual(ballistics.utilityLaunchPose(state.self.position, state.self.yaw, state.self.pitch,
      state.arena).origin);
    const expected = events.find(event => event.type === 'detonate')!;
    const live = new UtilitySimulation(1);
    live.throw(input);
    let actual: UtilityEvent | undefined;
    for (let tick = 1; tick <= 1024 && !actual; tick++) {
      actual = live.advance(STEP, releaseAt + tick * STEP, state.arena, [state.self])
        .find(event => event.type === 'detonate');
    }
    expect(actual?.time).toBe(expected.time);
    expect(actual?.position).toEqual(expected.position);
    expect(Math.hypot(actual!.position.x - evidence().point.x, actual!.position.z - evidence().point.z)).toBeLessThan(2);
  });

  it('uses at most four candidates per attempt, tries HE/flash before second fire arcs, and throttles failures', () => {
    const baseline = start();
    const inventory = utilityInventory(['molotov', 'incendiary', 'he', 'flash']);
    const arena = world();
    arena.solids[0].size.y = 20;
    arena.solids[0].center.y = 10;
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    const planner = new BotUtilityPlanner(baseline.seed, 1, 10);
    expect(planner.command(3, bot(), inventory, evidence(), arena, context())).toBeUndefined();
    expect(throws.mock.calls.map(([input]) => input.kind)).toEqual(['molotov', 'incendiary', 'he', 'flash']);
    for (let tick = 1; tick <= 128; tick++) expect(planner.command(3 + tick * STEP, bot(), inventory,
      evidence(3 + tick * STEP), arena, context())).toBeUndefined();
    expect(throws).toHaveBeenCalledTimes(4);
  });

  it('expires warming plans even with continuously renewed evidence', () => {
    const state = start();
    expect(advance(state, 6.6)).toBeUndefined();
    expect(state.planner.target()).toBeUndefined();
  });

  it('preserves the undefined-readiness standalone API and does not trust a stale final replay', () => {
    const state = start();
    expect(advance(state, 4.2)?.throw).toBe(false);
    const realThrow = UtilitySimulation.prototype.throw;
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    throws.mockImplementation(function (this: UtilitySimulation, input: UtilityThrow) {
      // Simulate a changed launch outcome only at final handoff; the live kernel remains authoritative.
      return realThrow.call(this, {...input, direction: {x: 0, y: 0, z: 1}});
    });
    expect(state.planner.command(state.time, state.self, state.inventory, evidence(state.time), state.arena,
      context())).toBeUndefined();
    expect(throws).toHaveBeenCalledTimes(1);
    expect(state.planner.target()).toBeUndefined();
  });

  it('defaults standalone readiness to true after warm-up', () => {
    const state = start();
    expect(advance(state, 4.2)?.throw).toBe(false);
    expect(state.planner.command(state.time, state.self, state.inventory, evidence(state.time), state.arena,
      context())?.throw).toBe(true);
  });

  it('bounds synthetic search work and timing, and keeps 128 warm ticks free of trajectory replays', () => {
    const baseline = start();
    const inventory = utilityInventory(['molotov', 'incendiary', 'he', 'flash']);
    const arena = world();
    arena.solids[0].size.y = 20;
    arena.solids[0].center.y = 10;
    const advances = vi.spyOn(UtilitySimulation.prototype, 'advance');
    const throws = vi.spyOn(UtilitySimulation.prototype, 'throw');
    for (let index = 0; index < 16; index++) {
      advances.mockClear(); throws.mockClear();
      const before = performance.now();
      new BotUtilityPlanner(baseline.seed, 1, 10).command(3, bot(), inventory, evidence(), arena, context());
      expect(performance.now() - before).toBeLessThan(250);
      expect(throws).toHaveBeenCalledTimes(4);
      expect(advances.mock.calls.length).toBeLessThanOrEqual(4 * 64);
      expect(advances.mock.calls.every(([dt]) => dt <= 1 / 8)).toBe(true);
    }
    const warm = start();
    advances.mockClear(); throws.mockClear();
    const before = performance.now();
    expect(advance(warm, 4)?.throw).toBe(false);
    expect(performance.now() - before).toBeLessThan(100);
    expect(advances).not.toHaveBeenCalled();
    expect(throws).not.toHaveBeenCalled();
    // Four candidates * eight seconds * 128 kernel steps is the hard planning ceiling.
    expect(4 * UTILITY_RULES.projectileLifetime / UTILITY_RULES.step).toBe(4096);
  });
});
