import {describe, expect, it} from 'vitest';
import {defaults} from './config';
import {equipmentStats, SHELL_RELOAD_START, SHELL_RELOAD_FINISH, ZEUS_RECHARGE_SECONDS} from './equipment';
import {Simulation, STEP, UNIT, type Shot} from './simulation';
import {DuelWeaponState} from './duel/weapon-state';
import {randomStream} from './duel/rng';
import {idleCommand} from './duel/types';

const make = (weapon: Simulation['settings']['weapon'] = 'nova', spread = true) =>
  new Simulation({...defaults, mode: 'guided', weapon, spread, burst: 0});
const runTo = (sim: Simulation, until: number) => {while (sim.time + STEP <= until + 1e-9) sim.step(STEP);};

describe('native range discharge and ammo controller', () => {
  it.each(['nova', 'xm1014', 'mag7', 'sawedoff'] as const)('%s exposes all physical pellets while consuming one shell and recoil impulse', id => {
    const sim = make(id), shots: Shot[] = []; sim.onShot = shot => shots.push(shot);
    expect(sim.start()).toBe(true);
    const shot = shots[0];
    expect(shots).toHaveLength(1); expect(shot.pelletDirections).toHaveLength(equipmentStats(id).pellets);
    expect(shot).toMatchObject({kind: 'pellets', attack: 'primary', ordinal: 0, maxDistance: equipmentStats(id).range * UNIT});
    expect(shot.direction).toEqual(shot.pelletDirections![0]);
    expect(sim.loadedAmmo).toBe(equipmentStats(id).magazine - 1); expect(sim.recovery.index).toBe(1);
    for (const ray of shot.pelletDirections!) expect(Math.hypot(ray.x, ray.y, ray.z)).toBeCloseTo(1, 10);
    const origin = {...shot.origin}, rays = structuredClone(shot.pelletDirections);
    sim.position.z -= 10; sim.aim(500, 200); sim.equip(2);
    expect(shot.origin).toEqual(origin); expect(shot.pelletDirections).toEqual(rays);
  });
  it.each(['nova', 'negev', 'revolver'] as const)('%s uses the same weapon/mode/index spread inputs as Duel', id => {
    const sim = new Simulation({...defaults, mode: 'guided', weapon: id, spread: true}, randomStream(3, id));
    const duel = new DuelWeaponState(id, randomStream(3, id)), alternate = id === 'revolver';
    let shot: Shot | undefined; sim.onShot = fired => {shot = fired;};
    sim.yaw = .2; sim.pitch = .1; sim.start(false, alternate);
    const round = duel.advance(0, 0, {...idleCommand(), firePressed: true, fireHeld: true, secondaryPressed: alternate}, sim)!;
    expect(shot!.direction).toEqual(round.direction); expect(shot!.pelletDirections).toEqual(round.pelletDirections);
  });
  it('does not restock on a new trigger press, switch, or cancelled magazine reload', () => {
    const sim = make('ak47', false); sim.start(); sim.release('mouse');
    const state = sim.reloadState; expect(state.ammo).toBe(29);
    expect(sim.reload()).toBe(true); sim.step(.1); sim.equip(2); sim.equip(1);
    expect(sim.loadedAmmo).toBe(29); expect(sim.reserveAmmo).toBe(90); expect(sim.reloadPhase).toBe('idle');
    sim.equipReadyAt = sim.time; expect(sim.start()).toBe(true); sim.step(STEP);
    expect(sim.loadedAmmo).toBe(28);
    sim.reset(); expect(sim.loadedAmmo).toBe(30); expect(sim.reserveAmmo).toBe(90);
  });
  it('completes finite MAG-7 magazine reloads and cannot reload an exhausted reserve', () => {
    const sim = make('mag7'); sim.reloadState.ammo = 2; sim.reloadState.reserve = 1;
    expect(sim.reload()).toBe(true); expect(sim.start()).toBe(false);
    runTo(sim, equipmentStats('mag7').reload - STEP); expect(sim.loadedAmmo).toBe(2);
    runTo(sim, equipmentStats('mag7').reload); expect(sim.loadedAmmo).toBe(3); expect(sim.reserveAmmo).toBe(0);
    expect(sim.reload()).toBe(false); expect(sim.drainActionEvents().map(event => event.kind)).toEqual(['reload-start', 'reload-end']);
  });
  it('supports held-R silent reload and prospective mode changes', () => {
    const sim = make('ak47'); sim.reloadState.ammo = 0; sim.reloadHeld = true;
    sim.reload(); expect(sim.reloadSilent).toBe(true); expect(sim.primaryReloadAt).toBeCloseTo(sim.stats.reload * 2);
    sim.step(1); sim.reloadHeld = false; sim.step(.5);
    expect(sim.primaryReloadAt).toBeCloseTo(1.5 + sim.stats.reload - .75);
    sim.step(sim.primaryReloadAt - sim.time); expect(sim.loadedAmmo).toBe(30); expect(sim.reserveAmmo).toBe(60);
    expect(sim.drainActionEvents().map(event => event.kind)).toEqual(['reload-start', 'reload-mode', 'reload-end']);
  });
  it.each(['nova', 'xm1014', 'sawedoff'] as const)('%s queues an empty reload interruption until one shell and finish are complete', id => {
    const sim = make(id, false), shots: Shot[] = []; sim.onShot = shot => shots.push(shot);
    sim.reloadState.ammo = 0; sim.reload(); expect(sim.start()).toBe(true);
    sim.step(SHELL_RELOAD_START); expect(shots).toHaveLength(0);
    sim.step(sim.stats.reload); expect(sim.loadedAmmo).toBe(1); expect(sim.reloadPhase).toBe('finish');
    sim.step(SHELL_RELOAD_FINISH); expect(shots).toHaveLength(1); expect(sim.loadedAmmo).toBe(0); expect(sim.reserveAmmo).toBe(31);
    expect(sim.drainActionEvents().map(event => event.kind)).toEqual(['reload-start', 'reload-shell', 'reload-end']);
  });
  it('preserves the pump deadline when reload is interrupted by holstering', () => {
    const sim = make('nova', false), shots: Shot[] = []; sim.onShot = shot => shots.push(shot); sim.start();
    sim.reloadHeld = true; sim.reload(); sim.step(.1); sim.equip(2); sim.equip(1); sim.equipReadyAt = sim.time;
    expect(sim.start()).toBe(true); runTo(sim, .88); expect(shots).toHaveLength(1);
    sim.step(STEP); expect(shots).toHaveLength(2); expect(sim.reserveAmmo).toBe(32);
    expect(shots[1].at - shots[0].at).toBeGreaterThanOrEqual(.88);
  });
  it('recharges holstered Zeus and never advances its zero-duration generic recovery', () => {
    const sim = make('zeus'), shots: Shot[] = []; sim.onShot = shot => shots.push(shot); sim.start();
    expect(shots[0]).toMatchObject({kind: 'zeus', maxDistance: 120 * UNIT}); expect(sim.loadedAmmo).toBe(0);
    expect(sim.reload()).toBe(false); expect(sim.start()).toBe(false);
    sim.equip(2); sim.step(ZEUS_RECHARGE_SECONDS); sim.equip(1); sim.equipReadyAt = sim.time;
    expect(sim.loadedAmmo).toBe(1); sim.start(); expect(shots).toHaveLength(2);
    expect(Object.values(shots[1].direction).every(Number.isFinite)).toBe(true);
    expect(sim.predictedRecoil(true)).toEqual({yaw: 0, pitch: 0});
    expect(sim.drainActionEvents().map(event => event.kind)).toEqual(['zeus-discharge', 'zeus-ready', 'zeus-discharge']);
  });
  it('restocks only at explicit reset/configuration/new-drill practice boundaries', () => {
    const sim = make('nova'); sim.start(); expect(sim.loadedAmmo).toBe(7); sim.reset(); expect(sim.loadedAmmo).toBe(8);
    sim.configure({...sim.settings, mode: 'precision'}); sim.start(); expect(sim.loadedAmmo).toBe(7);
    sim.newDrill(); expect(sim.loadedAmmo).toBe(8); expect(sim.reserveAmmo).toBe(32);
  });
  it('exposes secondary knife range, first slash and hit-dependent recovery', () => {
    const sim = make(), shots: Shot[] = []; sim.equip(3); sim.onShot = shot => shots.push(shot);
    sim.start(); expect(shots[0]).toMatchObject({kind: 'melee', firstSlash: true, attack: 'primary', maxDistance: 48 * UNIT});
    sim.resolveMeleeHit(shots[0].ordinal, true); sim.step(.4); sim.start(); expect(shots[1].firstSlash).toBe(false);
    sim.step(.5); sim.start(false, true); expect(shots[2]).toMatchObject({attack: 'secondary', maxDistance: 32 * UNIT});
    sim.resolveMeleeHit(shots[2].ordinal, true); expect(sim.nextShot).toBeCloseTo(sim.time + 1.1);
  });
  it('accepts computed per-pellet residual damage without applying hitgroup/falloff twice', () => {
    const sim = make(); sim.configure({...sim.settings, mode: 'transfer'});
    sim.damageTarget(0, true, 10, 7); sim.damageTarget(0, false, 10, 12);
    expect(sim.targetHealth[0]).toBe(81); expect(sim.targetHealth[1]).toBe(100);
    sim.damageTarget(0, false, 10, -1); expect(sim.targetHealth[0]).toBe(81);
    sim.damageTarget(0, false, 10, 200); expect(sim.targetHealth[0]).toBe(0);
  });
});

describe('range movement state continuity', () => {
  it('consumes a timestamped jump press once and preserves its clock and landing history', () => {
    const sim = make('ak47'); sim.active = true; sim.input.jump = true; sim.input.jumpPressed = true; sim.input.jumpPressOffset = STEP / 2;
    sim.step(STEP); const press = sim.lastJumpPressTime;
    expect(press).toBeCloseTo(STEP / 2); expect(sim.input.jumpPressed).toBe(false); expect(sim.input.jumpPressOffset).toBe(0);
    sim.step(STEP); expect(sim.lastJumpPressTime).toBe(press); expect(sim.movementTime).toBeCloseTo(sim.time);
    runTo(sim, 1); expect(sim.landedAt).toBeDefined(); expect(sim.landingVelocity).toBeLessThan(0);
    expect(sim.moveMode).toBe('ground'); expect(sim.grounded).toBe(true);
  });
  it('clears new movement history at reset without moving the player or rewinding the clock', () => {
    const sim = make(); sim.step(1); const position = {...sim.position};
    sim.lastJumpPressTime = .9; sim.pendingJumpPressTime = 1; sim.landedAt = .8; sim.landingVelocity = 4;
    sim.landingVelocityXY = {x: 1, z: 2}; sim.velocityModifier = .3; sim.supportId = 'old'; sim.moveMode = 'ladder'; sim.waterLevel = 2; sim.ladderDetached = true;
    sim.reset(); expect(sim.position).toEqual(position); expect(sim.movementTime).toBe(sim.time); expect(sim.velocityModifier).toBe(1);
    expect(sim.lastJumpPressTime).toBeUndefined(); expect(sim.pendingJumpPressTime).toBeUndefined(); expect(sim.landedAt).toBeUndefined();
    expect(sim.landingVelocity).toBeUndefined(); expect(sim.landingVelocityXY).toBeUndefined(); expect(sim.supportId).toBeUndefined();
    expect(sim.moveMode).toBe('ground'); expect(sim.waterLevel).toBe(0); expect(sim.ladderDetached).toBe(false);
  });
});
