import {describe, expect, it, vi} from 'vitest';
import {Group} from 'three';
import fixture from './aim-punch-native-fixture.json';
import {DamagePunch, damagePunch, recoverDamagePunch} from './aim-punch';
import {DEG, STEP, UNIT} from './actor-physics';
import type {Hitgroup} from './duel/types';
import {defaults, gameData} from './config';
import {WeaponRecovery} from './ballistics';
import {direction, shotDirection} from './shot-model';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';
import {DuelSimulation} from './duel/simulation';
import {DuelWeaponState} from './duel/weapon-state';
import {PrefireSimulation} from './prefire/session';
import {sanitizePrefireConfig} from './prefire/config';
import {PrefireBotController} from './prefire/bot-controller';
import type {BotCollision} from './prefire/bot-behavior';
import type {PrefireMap} from './prefire/map';
import type {NativeMapCollision} from './prefire/native-collision';

describe('native damage punch', () => {
  it.each(fixture.cases.map((value, index) => [index, value] as const))('matches offline hitgroup fixture %s', (_, value) => {
    const punch = damagePunch({...value, group: value.group as Hitgroup}, () => value.random);
    for (const axis of ['pitch', 'yaw', 'roll'] as const) expect(punch[axis]).toBeCloseTo(value.angle[axis], 5);
  });

  it.each(fixture.recovery.map((value, index) => [index, value] as const))('matches offline recovery fixture %s', (_, value) => {
    const angle = recoverDamagePunch(value.before, STEP);
    for (const axis of ['pitch', 'yaw', 'roll'] as const) expect(angle[axis]).toBeCloseTo(value.after[axis], 5);
  });

  it('uses raw hit damage, retains a small armored torso punch, and suppresses helmet head punch', () => {
    const bare = damagePunch({group: 'chest', rawDamage: 36, armor: 0, helmet: false}, () => .5);
    const vest = damagePunch({group: 'chest', rawDamage: 36, armor: 100, helmet: true}, () => .5);
    expect(bare.pitch).toBeGreaterThan(vest.pitch * 6); expect(vest.pitch).toBeGreaterThan(0);
    expect(damagePunch({group: 'head', rawDamage: 144, armor: 100, helmet: true}, () => .5).pitch).toBe(0);
  });

  it('recovers all three axes together without reversing or drifting the base aim', () => {
    const punch = new DamagePunch(() => .8);
    punch.hit({group: 'head', rawDamage: 20, armor: 0, helmet: false});
    const original = {...punch.angle}, ratio = original.roll / original.pitch;
    for (let tick = 0; tick < 512; tick++) {
      const before = {...punch.angle}; punch.advance(STEP);
      expect(punch.angle.pitch).toBeLessThanOrEqual(before.pitch);
      expect(punch.angle.roll).toBeLessThanOrEqual(before.roll);
      if (punch.angle.pitch > .001) expect(punch.angle.roll / punch.angle.pitch).toBeCloseTo(ratio, 5);
      expect(punch.angle.pitch).toBeGreaterThanOrEqual(0);
    }
    expect(punch.angle).toEqual({pitch: 0, yaw: 0, roll: 0});
  });

  it('stacks successive hits and predicts a fraction without mutating authoritative punch', () => {
    const punch = new DamagePunch(() => .5), hit = {group: 'chest' as const, rawDamage: 36, armor: 100, helmet: true};
    punch.hit(hit); const first = {...punch.angle};
    punch.advance(STEP); punch.hit(hit); expect(punch.angle.pitch).toBeGreaterThan(first.pitch);
    const before = {...punch.angle};
    const midpoint = punch.predict(STEP / 2), next = recoverDamagePunch(before, STEP);
    expect(midpoint.pitch).toBeCloseTo(before.pitch + next.pitch, 5);
    expect(punch.angle).toEqual(before);
  });

  it('suppresses sub-threshold visible angles without discarding the recovery cache', () => {
    const punch = new DamagePunch(); punch.angle = {pitch: .02, yaw: 0, roll: .01};
    expect(punch.shot).toEqual({pitch: 0, yaw: 0, roll: 0});
    expect(punch.angle.pitch).toBe(.02);
  });

  it('recovers damage and recoil in one shared cache instead of subtracting linear decay twice', () => {
    const punch = new DamagePunch(), base = {pitch: 6, yaw: -4};
    punch.angle = {pitch: .54, yaw: 0, roll: .2};
    const expected = recoverDamagePunch({pitch: Math.fround(6 + .54), yaw: -4, roll: .2}, STEP);
    const withoutHit = recoverDamagePunch({...base, roll: 0}, STEP);
    const independent = recoverDamagePunch(punch.angle, STEP);
    punch.advance(STEP, base);
    expect(punch.angle.pitch + withoutHit.pitch).toBeCloseTo(expected.pitch, 5);
    expect(punch.angle.yaw + withoutHit.yaw).toBeCloseTo(expected.yaw, 5);
    expect(punch.angle.roll).toBeCloseTo(expected.roll, 5);
    expect(punch.angle.pitch).toBeGreaterThan(independent.pitch);
  });

  it('preserves zero-damage recoil exactly and retains small punch during an active spray', () => {
    const punch = new DamagePunch(), base = {pitch: 7, yaw: 3};
    punch.advance(STEP, base);
    expect(punch.shotFor(base)).toEqual({pitch: 0, yaw: 0, roll: 0});
    expect(base).toEqual({pitch: 7, yaw: 3});
    punch.angle.pitch = .02;
    expect(punch.shot.pitch).toBe(0);
    expect(punch.shotFor(base).pitch).toBeCloseTo(.04, 5);
  });

  it('adds physical punch once to the shot ray without altering recoil, spread recovery or old impacts', () => {
    const weapon = gameData.weapons.ak47, recovery = new WeaponRecovery(weapon);
    const aim = {yaw: .3, pitch: -.1, recoil: {yaw: .4, pitch: 1}, weapon, recovery,
      speedRatio: 0, walking: false, airborne: false, verticalSpeedUnits: 0, spread: false};
    const normal = shotDirection(aim), storedImpact = {...normal}, punch = {yaw: .2, pitch: 3};
    const punched = shotDirection({...aim, punch});
    expect(punched).toEqual(direction(.3 - .6 * DEG, -.1 + 4 * DEG));
    expect(punched.y).toBeGreaterThan(normal.y);
    expect(normal).toEqual(storedImpact); expect(recovery.recoil).toEqual({yaw: 0, pitch: 0});
  });

  it('rotates the spread plane with head-hit roll without changing cone size', () => {
    const weapon = gameData.weapons.ak47, recovery = new WeaponRecovery(weapon);
    const aim = {yaw: 0, pitch: 0, recoil: {yaw: 0, pitch: 0}, weapon, recovery,
      speedRatio: 0, walking: false, airborne: false, verticalSpeedUnits: 0, spread: true};
    const random = () => {let index = 0; return () => [0, 0, 1, 0][index++ % 4];};
    const horizontal = shotDirection(aim, random());
    const rolled = shotDirection({...aim, punch: {yaw: 0, pitch: 0, roll: 90}}, random());
    expect(horizontal.x).toBeGreaterThan(0); expect(horizontal.y).toBe(0);
    expect(rolled.x).toBeCloseTo(0, 8); expect(rolled.y).toBeCloseTo(horizontal.x, 8);
    expect(rolled.z).toBeCloseTo(horizontal.z, 8);
  });
});

function combatFixture(mode: 'duel' | 'prefire') {
  let sim: DuelSimulation;
  if (mode === 'duel') sim = new DuelSimulation(sanitizeDuelConfig({health: 500, playerHealth: 500}), 42, testArena());
  else {
    const map: PrefireMap = {scene: new Group(), dispose() {}, settle: p => ({x: p[0] * UNIT, y: p[2] * UNIT, z: -p[1] * UNIT}),
      collision: {fits: () => true, sweep: (_from: unknown, to: unknown) => ({position: to, fraction: 1, startSolid: false}),
        vertical: (_p: unknown, _from: number, to: number) => ({feet: Math.max(0, to), grounded: to <= 0, ceiling: false}),
        ray: () => undefined} as unknown as NativeMapCollision};
    sim = new PrefireSimulation(map, sanitizePrefireConfig({population: 'all', botBehavior: 'static'}),
      {id: 'long-doors', name: 'Punch fixture', spawn: [0, 0, 0], look: [0, 400, 0], path: [],
        angles: [{name: 'Holder', position: [0, 400, 0]}]}, 42, defaults);
    // Isolate the inherited damage/weapon path from the separately owned bot motor.
    const controllers = (sim as unknown as {controllers: PrefireBotController[]}).controllers;
    vi.spyOn(controllers[0], 'command').mockImplementation((_time, actor) => (actor as typeof sim.actors[number]).command);
    vi.spyOn(controllers[0], 'verifyShot').mockReturnValue(true);
  }
  for (const actor of sim.actors) {
    actor.position = {x: 0, y: 64 * UNIT, z: actor.id === 0 ? 8 : -8};
    actor.feet = 0; actor.yaw = actor.id === 0 ? 0 : Math.PI; actor.pitch = 0;
    actor.health = 500; actor.weapon = new DuelWeaponState('ak47', () => 0, {spread: false});
    actor.punch = new DamagePunch(() => .6);
    sim.command(actor.id, {});
  }
  sim.start(); return sim;
}

describe.each(['duel', 'prefire'] as const)('%s physical damage punch', mode => {
  it.each([0, 1] as const)('handles armored and bare chest/head hits on actor %s without moving base aim', victimId => {
    for (const armor of [0, 100]) for (const group of ['chest', 'head'] as const) {
      const sim = combatFixture(mode), victim = sim.actors[victimId], attacker = sim.actors[1 - victimId];
      victim.armor = armor; victim.helmet = armor > 0;
      attacker.pitch = group === 'head' ? 0 : Math.atan2(1.2 - 64 * UNIT, 16);
      const base = {yaw: victim.yaw, pitch: victim.pitch};
      sim.command(attacker.id, {firePressed: true}); sim.step();
      const hit = sim.drainEvents().find(event => event.kind === 'hit');
      expect(hit).toMatchObject({victim: victimId, group, lethal: false});
      if (hit?.kind !== 'hit') throw new Error('Expected fixture hit');
      const rawDamage = hit.healthDamage + 2 * hit.armorDamage;
      const expected = group === 'head' ? armor ? 0 : Math.min(36, rawDamage * .6)
        : Math.min(12, rawDamage * (armor ? .015 : .099));
      expect(victim.punch.angle.pitch).toBeCloseTo(expected, 5);
      expect({yaw: victim.yaw, pitch: victim.pitch}).toEqual(base);
      const before = {...victim.punch.angle}, shot = victim.weapon.advance(sim.time, 0,
        {...victim.command, firePressed: true}, victim)!;
      const expectedRay = direction(base.yaw, base.pitch + expected * 2 * DEG);
      for (const axis of ['x', 'y', 'z'] as const) expect(shot.direction[axis]).toBeCloseTo(expectedRay[axis], 7);
      expect(victim.punch.angle).toEqual(before);
      expect(shot.accuracy?.recoil).toEqual({yaw: 0, pitch: 0});
    }
  });

  it('keeps a fired ray and world impact fixed through punch, view and distance changes', () => {
    const sim = combatFixture(mode), bot = sim.actors[1];
    sim.command(0, {firePressed: true}); sim.step();
    const events = sim.drainEvents(), fire = events.find(event => event.kind === 'fire'), hit = events.find(event => event.kind === 'hit');
    if (fire?.kind !== 'fire' || hit?.kind !== 'hit') throw new Error('Expected shot and impact');
    const saved = {origin: {...fire.origin}, direction: {...fire.direction}, point: {...hit.point}};
    bot.punch.hit({group: 'chest', rawDamage: 36, armor: 0, helmet: false});
    for (let i = 0; i < 32; i++) {
      bot.yaw += .05; bot.position.z -= .2; bot.punch.advance(STEP, bot.weapon.recovery.angle);
      sim.snapshot(); sim.renderSnapshot();
    }
    expect({origin: fire.origin, direction: fire.direction, point: hit.point}).toEqual(saved);
  });

  it('freezes damage/recoil and RNG on pause, resumes recovery, and resets new actors', () => {
    const sim = combatFixture(mode), player = sim.actors[0];
    player.punch.hit({group: 'chest', rawDamage: 36, armor: 100, helmet: true});
    player.weapon.recovery.fire(); player.weapon.recovery.advance(STEP);
    sim.accumulator = STEP / 2;
    const before = {punch: {...player.punch.angle}, recoil: {...player.weapon.recovery.angle},
      velocity: {...player.weapon.recovery.velocity}, index: player.weapon.recovery.index};
    sim.pause(); sim.advance(.25); sim.step();
    expect({punch: player.punch.angle, recoil: player.weapon.recovery.angle,
      velocity: player.weapon.recovery.velocity, index: player.weapon.recovery.index}).toEqual(before);
    sim.resume(); sim.advance(STEP);
    expect(player.punch.angle.pitch).toBeLessThan(before.punch.pitch);
    expect(combatFixture(mode).actors.every(actor => actor.punch.shot.pitch === 0)).toBe(true);
  });
});

describe('damage punch during weapon recovery', () => {
  it('lets the parent Prefire motor respond to its punched view without instantly cancelling a head hit', () => {
    const punch = new DamagePunch(() => .5), actor = {position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0,
      yaw: 0, pitch: 0, velocity: {x: 0, z: 0}, grounded: true, duckAmount: 0,
      weapon: new DuelWeaponState('m4a4', () => .5), punch};
    const point = {x: 0, y: 64 * UNIT, z: -10};
    const controller = new PrefireBotController({key: 'punch-motor', kind: 'hold', anchor: {x: 0, y: 0, z: 0},
      sourceCrouched: false, watchPoint: point}, 42, 0, 0);
    const collision: BotCollision = {fits: () => true, sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}),
      vertical: p => ({feet: p.y, grounded: true, ceiling: false}), ray: () => undefined};
    const options = sanitizePrefireConfig({returnFire: false});
    expect(controller.command(0, actor, {position: point, alive: true}, collision, options).pitchDelta).toBe(0);
    punch.hit({group: 'head', rawDamage: 20, armor: 0, helmet: false});
    const displaced = punch.shot.pitch * DEG;
    const command = controller.command(STEP, actor, {position: point, alive: true}, collision, options);
    expect(command.pitchDelta).toBeLessThan(0);
    expect(Math.abs(command.pitchDelta)).toBeLessThan(displaced);
    expect(Math.abs(command.pitchDelta)).toBeLessThanOrEqual(.025);
    expect(command.fireHeld).toBe(false); expect(actor.pitch).toBe(0);
    expect(punch.shot.pitch * DEG).toBe(displaced);
  });

  it('does not consume head-roll or weapon randomness during recovery and presentation', () => {
    const random = vi.fn(() => .6), punch = new DamagePunch(random);
    punch.hit({group: 'chest', rawDamage: 36, armor: 100, helmet: true});
    punch.hit({group: 'head', rawDamage: 20, armor: 100, helmet: true});
    expect(random).not.toHaveBeenCalled();
    punch.hit({group: 'head', rawDamage: 20, armor: 0, helmet: false});
    expect(random).toHaveBeenCalledTimes(1);
    for (let tick = 0; tick < 16; tick++) {
      punch.shotFor({yaw: 2, pitch: 6}); punch.predict(STEP / 2, {yaw: 2, pitch: 6});
      punch.advance(STEP, {yaw: 2, pitch: 6});
    }
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('samples active recoil plus damage exactly once without perturbing the weapon stream', () => {
    const clean = new DuelWeaponState('ak47', () => .5, {spread: false});
    const hit = new DuelWeaponState('ak47', () => .5, {spread: false});
    const punch = new DamagePunch(() => .5), actor = {position: {x: 0, y: 64 * UNIT, z: 0},
      yaw: .8, pitch: -.2, velocity: {x: 0, z: 0}, feet: 0, verticalVelocity: 0, grounded: true};
    const command = {forward: 0, side: 0, crouch: false, walk: false, jump: false, fireHeld: true,
      firePressed: true, reloadPressed: false, yawDelta: 0, pitchDelta: 0};
    for (const weapon of [clean, hit]) {weapon.recovery.fire(); weapon.recovery.advance(.1);}
    punch.hit({group: 'chest', rawDamage: 36, armor: 100, helmet: true});
    punch.advance(STEP, hit.recovery.angle);
    const normal = clean.advance(.2, STEP, command, actor)!, punched = hit.advance(.2, STEP, command, {...actor, punch})!;
    const extra = punch.shotFor(hit.recovery.angle), recoil = punched.accuracy!.recoil;
    expect(punched.direction).toEqual(direction(actor.yaw - (recoil.yaw + extra.yaw) * DEG,
      actor.pitch + (recoil.pitch + extra.pitch) * DEG));
    expect(punched.direction.y).toBeGreaterThan(normal.direction.y);
    expect(punched.accuracy).toEqual(normal.accuracy);
    expect(hit.recovery.angle).toEqual(clean.recovery.angle);
    expect(hit.recovery.velocity).toEqual(clean.recovery.velocity);
    expect(hit.ammo).toBe(clean.ammo); expect(hit.ordinal).toBe(clean.ordinal);
  });

  it('retains fixture-sized armored punch without adding a cosmetic floor or stretching its lifetime', () => {
    const armored = new DamagePunch(), bare = new DamagePunch();
    armored.hit({group: 'chest', rawDamage: 36, armor: 100, helmet: true});
    bare.hit({group: 'chest', rawDamage: 36, armor: 0, helmet: false});
    expect(armored.shot.pitch).toBeCloseTo(1.08, 5); expect(bare.shot.pitch).toBeCloseTo(7.128, 5);
    for (let tick = 0; tick < 4; tick++) {armored.advance(STEP); bare.advance(STEP);}
    expect(armored.shot.pitch).toBe(0); expect(bare.shot.pitch).toBeGreaterThan(4);
  });
});
