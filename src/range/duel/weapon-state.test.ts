import {describe, expect, it} from 'vitest';
import {STEP, UNIT, idleInput} from '../actor-physics';
import {defaults, gameData, weaponIds} from '../config';
import {Simulation} from '../simulation';
import {DuelWeaponState} from './weapon-state';
import {idleCommand, type DuelEvent} from './types';
import {REVOLVER_WINDUP} from '../weapon-actions';
import {sourceRandom} from '../recoil';
import {nativeReloadTiming} from '../native-view-actions';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {sampleShotState} from './shot-time';

const actor = () => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
  pitch: 0, feet: 0, verticalVelocity: 0, duckAmount: 0});

describe('duel AK reload slot/deploy integration', () => {
  type Fire = Extract<DuelEvent, {kind:'fire'}>;
  const tickAt = (time:number) => Math.ceil(time / STEP - 1e-8) * STEP;
  const step = (sim:DuelSimulation, shots:Fire[]) => {
    sim.step();
    shots.push(...sim.drainEvents().filter((event):event is Fire => event.kind === 'fire' && event.actorId === 0));
  };
  const runTo = (sim:DuelSimulation, shots:Fire[], time:number) => {
    while (sim.time + STEP <= time + 1e-9) step(sim, shots);
  };
  const setup = (empty:boolean) => {
    const sim = new DuelSimulation(sanitizeDuelConfig({botCount:1, playerHealth:500, health:500, radarEnabled:false, tradeEnabled:false}));
    sim.command(1, {}); sim.actors[0].pitch = .6;
    const ak = sim.actors[0].weapon, shots:Fire[] = [], timing = nativeReloadTiming('ak47', empty)!;
    ak.ammo = empty ? 0 : 11;
    const total = ak.ammo + ak.reserve;
    sim.start(); sim.command(0, {reloadPressed:true}); step(sim, shots);
    expect(ak.reload.active).toBe(true); expect(ak.reloadEmpty).toBe(empty);
    return {sim, ak, shots, total, commitAt:sim.time + timing.ammoAt, floor:sim.time + timing.attackLock};
  };

  for (const route of ['early', 'late'] as const) it.each([false, true])(
    `${route} knife/back emits no shot before max(retained AK floor, deploy) (empty=%s)`, empty => {
      const {sim, ak, shots, total, commitAt, floor} = setup(empty);
      runTo(sim, shots, tickAt(commitAt) + (route === 'late' ? .75 : 0));
      expect(ak.ammo).toBe(30); expect(ak.ammo + ak.reserve).toBe(total);
      expect(ak.reloadEmpty).toBe(empty); expect(ak.reload.active).toBe(true);
      sim.equipPlayer(3); sim.equipPlayer(1);
      expect(sim.actors[0].weapon).toBe(ak); expect(ak.reload.active).toBe(false);
      expect(ak.reload.fireReadyAt).toBeCloseTo(floor);
      const deployAt = sim.actors[0].equipReadyAt, readyAt = Math.max(floor, deployAt);
      expect(route === 'early' ? deployAt < floor : deployAt > floor).toBe(true);
      sim.command(0, {fireHeld:true, firePressed:true});
      runTo(sim, shots, tickAt(readyAt) - STEP);
      expect(shots).toHaveLength(0); expect(ak.ammo).toBe(30); expect(ak.ammo + ak.reserve).toBe(total);
      step(sim, shots); expect(shots).toHaveLength(1); expect(shots[0].equipment).toBe('ak47');
      expect(shots[0].tick * STEP).toBeCloseTo(tickAt(readyAt), 8);
      expect(shots[0].tick * STEP + 1e-9).toBeGreaterThanOrEqual(readyAt);
      expect(ak.ammo + ak.reserve).toBe(total - 1);

      const waiting = setup(empty);
      waiting.sim.command(0, {fireHeld:true, firePressed:true});
      runTo(waiting.sim, waiting.shots, tickAt(waiting.floor) - STEP);
      expect(waiting.shots).toHaveLength(0); expect(waiting.ak.ammo).toBe(30);
      step(waiting.sim, waiting.shots); expect(waiting.shots).toHaveLength(1);
      expect(waiting.shots[0].tick * STEP).toBeCloseTo(tickAt(waiting.floor), 8);
      expect(waiting.ak.ammo).toBe(ak.ammo); expect(waiting.ak.reserve).toBe(ak.reserve);
      if (route === 'early') expect(shots[0].tick).toBe(waiting.shots[0].tick);
      else expect(shots[0].tick).toBeGreaterThan(waiting.shots[0].tick);
    });

  it.each([false, true])('precommit knife/back discards only unfinished ammo and clears the old floor (empty=%s)', empty => {
    const {sim, ak, shots, commitAt, floor} = setup(empty), ammo = ak.ammo, reserve = ak.reserve;
    runTo(sim, shots, tickAt(commitAt) - STEP);
    expect(ak.ammo).toBe(ammo); sim.equipPlayer(3); sim.equipPlayer(1);
    expect(sim.actors[0].weapon).toBe(ak); expect(ak.reload.active).toBe(false);
    expect(ak.reload.fireReadyAt).toBe(0);
    const deployAt = sim.actors[0].equipReadyAt;
    runTo(sim, shots, tickAt(deployAt) - STEP);
    expect(ak.ammo).toBe(ammo); expect(ak.reserve).toBe(reserve); expect(shots).toHaveLength(0);
    if (!empty) {
      sim.command(0, {fireHeld:true, firePressed:true}); step(sim, shots);
      expect(shots).toHaveLength(1); expect(shots[0].tick * STEP).toBeCloseTo(tickAt(deployAt), 8);
      expect(shots[0].tick * STEP).toBeLessThan(floor);
      expect(ak.ammo).toBe(ammo - 1); expect(ak.reserve).toBe(reserve);
    } else {
      runTo(sim, shots, tickAt(floor));
      expect(ak.ammo).toBe(0); expect(ak.reserve).toBe(reserve); expect(ak.reload.active).toBe(true);
      expect(ak.reload.startedAt).toBeCloseTo(tickAt(deployAt), 8);
      sim.command(0, {fireHeld:true, firePressed:true}); step(sim, shots);
      expect(shots).toHaveLength(0); expect(ak.reload.active).toBe(true);
      expect(ak.reload.startedAt).toBeCloseTo(tickAt(deployAt), 8); expect(ak.reserve).toBe(reserve);
    }
  });

  for (const slot of [2, 3] as const) it.each([false, true])(
    `slot ${slot} can fire at its own deploy deadline before the AK floor (empty=%s)`, empty => {
      const {sim, ak, shots, commitAt, floor} = setup(empty);
      runTo(sim, shots, tickAt(commitAt)); sim.equipPlayer(slot);
      const active = sim.actors[0].weapon, deployAt = sim.actors[0].equipReadyAt;
      expect(active.id).toBe(slot === 2 ? 'usp' : 'knife'); expect(active.reload.fireReadyAt).toBe(0);
      expect(ak.reload.fireReadyAt).toBeCloseTo(floor);
      sim.command(0, {fireHeld:true, firePressed:true});
      runTo(sim, shots, tickAt(deployAt) - STEP); expect(shots).toHaveLength(0);
      // A semi-auto trigger pressed during deploy is not queued by the actor.
      sim.command(0, {firePressed:true});
      step(sim, shots); expect(shots).toHaveLength(1); expect(shots[0].equipment).toBe(active.id);
      expect(shots[0].tick * STEP).toBeCloseTo(tickAt(deployAt), 8);
      expect(shots[0].tick * STEP).toBeLessThan(floor);
      expect(ak.ammo).toBe(30); expect(ak.reserve).toBe(empty ? 60 : 71);
    });
});

describe('combat empty-magazine idle auto-reload', () => {
  it('reloads a passively held empty firearm without a prior trigger attempt', () => {
    const weapon = new DuelWeaponState('ak47', () => 0); weapon.ammo = 0;
    expect(weapon.advance(0, 0, idleCommand(), actor())).toBeUndefined();
    expect(weapon.reload.active).toBe(true); expect(weapon.reload.startedAt).toBe(0);
    expect(weapon.drainActionEvents().map(event => event.kind)).toEqual(['reload-start']);
  });

  it.each(['primary', 'secondary', 'pressed-only'] as const)('%s input suppresses automatic reload until released', input => {
    const weapon = new DuelWeaponState('revolver', () => 0); weapon.ammo = 0;
    const command = {...idleCommand(), fireHeld: input === 'primary',
      secondaryHeld: input === 'secondary', firePressed: input === 'pressed-only'};
    expect(weapon.advance(0, 0, command, actor())).toBeUndefined();
    expect(weapon.reload.active).toBe(false); expect(weapon.pendingPress).toBe(false);
    weapon.advance(2, 2, command, actor()); expect(weapon.reload.active).toBe(false);
    weapon.advance(2 + STEP, STEP, idleCommand(), actor());
    expect(weapon.reload.startedAt).toBe(2 + STEP); expect(weapon.reload.active).toBe(true);
  });

  it('waits for the last bullet cycle after release, not an additional idle delay', () => {
    const weapon = new DuelWeaponState('ak47', () => 0); weapon.ammo = 1;
    expect(weapon.advance(0, 0, {...idleCommand(), fireHeld: true}, actor())).toBeDefined();
    const cycle = weapon.nextShotAt;
    weapon.advance(cycle - 1e-6, cycle - 1e-6, idleCommand(), actor());
    expect(weapon.reload.active).toBe(false);
    weapon.advance(cycle, 1e-6, idleCommand(), actor());
    expect(weapon.reload.active).toBe(true); expect(weapon.reload.startedAt).toBe(cycle);
    expect(weapon.ammo).toBe(0); expect(weapon.reserve).toBe(90);
  });

  it('combines deploy, secondary-mode, pump/cycle and retained reload gates', () => {
    const weapon = new DuelWeaponState('ak47', () => 0); weapon.ammo = 0;
    weapon.actions.readyAt = 1.25; weapon.nextShotAt = 1.75;
    const equippedActor = {...actor(), equipReadyAt: 1.5};
    for (const time of [0, 1.25, 1.5, 1.75 - 1e-6]) {
      weapon.advance(time, 0, idleCommand(), equippedActor); expect(weapon.reload.active).toBe(false);
    }
    weapon.advance(1.75, 0, idleCommand(), equippedActor);
    expect(weapon.reload.startedAt).toBe(1.75);
  });

  it('does not restart an active magazine reload, even on an empty trigger pull', () => {
    const weapon = new DuelWeaponState('ak47', () => 0); weapon.ammo = 0;
    weapon.advance(0, 0, idleCommand(), actor());
    weapon.advance(.1, .1, {...idleCommand(), fireHeld: true, firePressed: true}, actor());
    weapon.advance(.2, .1, idleCommand(), actor());
    expect(weapon.reload.startedAt).toBe(0);
    expect(weapon.drainActionEvents().map(event => event.kind)).toEqual(['reload-start']);
    const timing = nativeReloadTiming('ak47', true)!;
    weapon.advance(timing.ammoAt, timing.ammoAt - .2, idleCommand(), actor());
    expect(weapon.ammo).toBe(30); expect(weapon.reserve).toBe(60);
    expect(weapon.reload.active).toBe(true); expect(weapon.reload.fireReadyAt).toBeCloseTo(timing.attackLock);
    weapon.advance(timing.attackLock, timing.attackLock - timing.ammoAt, idleCommand(), actor());
    expect(weapon.reload.active).toBe(false);
    expect(weapon.drainActionEvents().map(event => event.kind)).toEqual(['reload-end']);
  });

  it('does not start reloads for holstered passive updates or zero reserves', () => {
    const weapon = new DuelWeaponState('ak47', () => 0); weapon.ammo = 0;
    weapon.holster(); weapon.advancePassive(5, 5);
    expect(weapon.reload.active).toBe(false);
    weapon.reserve = 0; weapon.advance(6, 1, idleCommand(), actor());
    expect(weapon.reload.active).toBe(false); expect(weapon.ammo).toBe(0);
  });

  it.each(['knife', 'zeus'] as const)('never starts generic auto-reload for %s', id => {
    const weapon = new DuelWeaponState(id, () => 0); weapon.ammo = 0; weapon.reserve = 90;
    weapon.advance(1, 1, idleCommand(), actor());
    expect(weapon.reload.active).toBe(false); expect(weapon.drainActionEvents()).toEqual([]);
  });

  it('leaves manual reload available while the trigger is held', () => {
    const weapon = new DuelWeaponState('ak47', () => 0); weapon.ammo = 0;
    weapon.advance(0, 0, {...idleCommand(), fireHeld: true, reloadPressed: true}, actor());
    expect(weapon.reload.active).toBe(true);
  });

  it('does not strand an exhausted burst, and does not restart a shell reload', () => {
    const burst = new DuelWeaponState('famas', () => 0); burst.actions.burst = true; burst.ammo = 1;
    expect(burst.advance(0, 0, {...idleCommand(), fireHeld: true}, actor())).toBeDefined();
    burst.advance(1, 1, idleCommand(), actor());
    expect(burst.reload.active).toBe(true);
    const shell = new DuelWeaponState('nova', () => 0); shell.ammo = 0;
    shell.advance(0, 0, idleCommand(), actor());
    shell.advance(.1, .1, idleCommand(), actor());
    expect(shell.reloadPhase).toBe('start'); expect(shell.reload.startedAt).toBe(0);
    shell.advance(.5, .4, idleCommand(), actor());
    expect(shell.reloadPhase).toBe('shell');
    expect(shell.drainActionEvents().filter(event => event.kind === 'reload-start')).toHaveLength(1);
  });
});

describe('duel and range ballistic parity', () => {
  it.each(['ak47', 'm4a4', 'm4a1s', 'mp9'] as const)('%s has identical spread in Range and combat through running, braking, ducking and jumping', weapon => {
    const range = new Simulation({...defaults, mode: 'spray', weapon, spread: true, burst: 0}, sourceRandom(813));
    range.position.z = -60;
    const duel = new DuelWeaponState(weapon, sourceRandom(813));
    const shots: {at: number; direction: {x: number; y: number; z: number}}[] = [];
    range.onShot = shot => shots.push(shot);
    range.start(true);
    expect(duel.advance(0, 0, {...idleCommand(), fireHeld: true}, range)?.direction).toEqual(shots[0].direction);
    let count = 1;
    for (let tick = 1; tick < 200; tick++) {
      range.input = {...idleInput(), side: tick < 36 ? 1 : tick < 48 ? -1 : 0,
        crouch: tick >= 55 && tick < 110, jump: tick >= 125 && tick < 127, walk: tick >= 170};
      const before={...range,position:{...range.position},velocity:{...range.velocity}};
      range.step(STEP);
      const shot = duel.advance(tick * STEP, STEP, {...idleCommand(), ...range.input, fireHeld: true},
        {...range,sampleAt:at=>sampleShotState(before,range,at,tick*STEP)});
      if (shot) {
        expect(shot.direction).toEqual(shots[count].direction); count++;
      }
      expect(duel.recovery.penalty).toBeCloseTo(range.recovery.penalty, 12);
    }
    expect(count).toBe(shots.length); expect(count).toBeGreaterThan(15);
  });

  for (const weapon of weaponIds.filter(id => gameData.weapons[id].fullAuto)) it(`${weapon}: preserves fractional automatic cadence and shared recoil`, () => {
    const range = new Simulation({...defaults, mode: 'guided', weapon, spread: false, burst: 0});
    const duel = new DuelWeaponState(weapon, () => 0, {spread: false});
    const command = {...idleCommand(), fireHeld: true, firePressed: true};
    const rangeShots: {time: number; direction: {x: number; y: number; z: number}}[] = [];
    const duelShots: typeof rangeShots = [];
    range.onShot = shot => rangeShots.push({time: shot.at, direction: shot.direction});
    range.active = true; range.start(true);
    for (let tick = 0; tick < Math.ceil(gameData.weapons[weapon].magazine * gameData.weapons[weapon].cycle / STEP); tick++) {
      const time = tick * STEP;
      if (tick) range.step(STEP);
      const shot = duel.advance(time, tick ? STEP : 0, command, actor());
      command.firePressed = false;
      if (shot) duelShots.push({time:shot.at??time, direction: shot.direction});
      if (duel.ammo === 0) break;
    }
    expect(duelShots).toHaveLength(gameData.weapons[weapon].magazine);
    expect(rangeShots).toHaveLength(duelShots.length);
    duelShots.forEach((shot, i) => {
      const windup = weapon === 'revolver' ? REVOLVER_WINDUP : 0;
      expect(shot.time - windup - i * gameData.weapons[weapon].cycle).toBeGreaterThanOrEqual(-1e-8);
      expect(shot.time - windup - i * gameData.weapons[weapon].cycle).toBeLessThan(STEP + 1e-8);
      expect(shot.time).toBeCloseTo(rangeShots[i].time, 8);
      for (const axis of ['x', 'y', 'z'] as const) expect(shot.direction[axis]).toBeCloseTo(rangeShots[i].direction[axis], 7);
    });
  });

  it.each(weaponIds.filter(id => !gameData.weapons[id].fullAuto))('%s preserves range/duel recoil through a manually tapped magazine', weapon => {
    const range = new Simulation({...defaults, mode: 'guided', weapon, spread: false, burst: 0});
    const duel = new DuelWeaponState(weapon, () => 0, {spread: false}), stats = gameData.weapons[weapon];
    const rangeShots: {time: number; direction: {x: number; y: number; z: number}}[] = [];
    const duelShots: typeof rangeShots = [];
    const period = Math.ceil(stats.cycle / STEP) + 1;
    range.onShot = shot => rangeShots.push({time: shot.at, direction: shot.direction});
    for (let tick = 0; tick < period * stats.magazine; tick++) {
      if (tick) range.step(STEP);
      const pressed = tick % period === 0;
      if (pressed) expect(range.start()).toBe(true);
      const shot = duel.advance(tick * STEP, tick ? STEP : 0,
        {...idleCommand(), fireHeld: pressed, firePressed: pressed}, actor());
      if (shot) duelShots.push({time: tick * STEP, direction: shot.direction});
    }
    expect(duelShots).toHaveLength(stats.magazine);
    expect(rangeShots).toHaveLength(stats.magazine);
    expect(duel.ammo).toBe(0);
    duelShots.forEach((shot, index) => {
      expect(shot.time).toBeCloseTo(index * period * STEP, 8);
      expect(shot.time).toBeCloseTo(rangeShots[index].time, 8);
      for (const axis of ['x', 'y', 'z'] as const)
        expect(shot.direction[axis]).toBeCloseTo(rangeShots[index].direction[axis], 7);
    });
  });

  it.each(weaponIds.filter(id => !gameData.weapons[id].fullAuto && id !== 'zeus'))('%s does not repeat on hold and respects cooldown for a queued press', weapon => {
    const duel = new DuelWeaponState(weapon, () => 0), stats = gameData.weapons[weapon];
    const command = {...idleCommand(), fireHeld: true, firePressed: true};
    expect(duel.advance(0, 0, command, actor())).toBeDefined();
    command.firePressed = false;
    const heldTicks = Math.ceil(stats.cycle * 3 / STEP);
    for (let tick = 1; tick <= heldTicks; tick++)
      expect(duel.advance(tick * STEP, STEP, command, actor())).toBeUndefined();
    expect(duel.ammo).toBe(stats.magazine - 1);
    const pressedAt = (heldTicks + 1) * STEP;
    expect(duel.advance(pressedAt, STEP, {...command, firePressed: true}, actor())).toBeDefined();
    const intervalTicks = Math.ceil(stats.cycle / STEP);
    for (let tick = 1; tick < intervalTicks; tick++)
      expect(duel.advance(pressedAt + tick * STEP, STEP, {...command, firePressed: tick === 1}, actor())).toBeUndefined();
    expect(duel.advance(pressedAt + intervalTicks * STEP, STEP, command, actor())).toBeDefined();
    expect(duel.ammo).toBe(stats.magazine - 3);
    for (let tick = intervalTicks + 1; tick < intervalTicks * 3; tick++)
      expect(duel.advance(pressedAt + tick * STEP, STEP, command, actor())).toBeUndefined();
  });

  it('does not bank shots across a trigger gap or reload', () => {
    const duel = new DuelWeaponState('ak47', () => 0);
    const command = {...idleCommand(), fireHeld: true};
    duel.advance(0, 0, command, actor());
    command.fireHeld = false;
    for (let i = 1; i <= 128; i++) duel.advance(i * STEP, STEP, command, actor());
    command.fireHeld = true;
    expect(duel.advance(129 * STEP, STEP, command, actor())).toBeDefined();
    expect(duel.nextShotAt).toBeCloseTo(129 * STEP + gameData.weapons.ak47.cycle);
    command.reloadPressed = true;
    duel.advance(130 * STEP, STEP, command, actor());
    command.reloadPressed = false;
    for (let i = 131; i < 600; i++) {
      if (duel.advance(i * STEP, STEP, command, actor())) {
        expect(duel.nextShotAt).toBeCloseTo(i * STEP + gameData.weapons.ak47.cycle); break;
      }
    }
  });

  it('keeps shot cadence and recoil continuous through a wide strafe, brake, crouch and retreat', () => {
    const range = new Simulation({...defaults, mode: 'guided', weapon: 'ak47', spread: false});
    range.position.z = -60;
    const duel = new DuelWeaponState('ak47', () => 0), command = {...idleCommand(), fireHeld: true};
    const shots: {at: number; direction: {x: number; y: number; z: number}; origin: {x: number; y: number; z: number}}[] = [];
    range.onShot = shot => shots.push(shot); range.start(true);
    duel.advance(0, 0, command, range);
    for (let tick = 1; tick <= 160; tick++) {
      range.input = {...idleInput(), side: tick < 40 ? 1 : tick < 57 ? -1 : tick > 95 ? -1 : 0, crouch: tick >= 52};
      const before={...range,position:{...range.position},velocity:{...range.velocity}};
      range.step(STEP);
      const shot = duel.advance(tick * STEP, STEP, {...command, ...range.input},
        {...range,sampleAt:at=>sampleShotState(before,range,at,tick*STEP)});
      if (shot) {
        expect(shot.origin).toEqual(shots[shots.length - 1].origin);
        for (const axis of ['x','y','z'] as const) expect(shot.direction[axis]).toBeCloseTo(shots[shots.length - 1].direction[axis], 7);
      }
      expect(duel.recovery.recoil).toEqual(range.recovery.recoil);
    }
    expect(shots).toHaveLength(13);
    expect(shots[shots.length - 1].origin.y).toBeCloseTo(46 * UNIT, 6);
    shots.forEach((shot, i) => expect(shot.at - i * .1).toBeLessThan(STEP + 1e-8));
  });
});
