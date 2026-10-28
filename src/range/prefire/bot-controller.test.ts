import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import * as THREE from 'three';
import {advanceActor, DEG, stanceCurve, STEP, UNIT, type ActorKinematics} from '../actor-physics';
import {defaults} from '../config';
import {DuelWeaponState} from '../duel/weapon-state';
import {actorHeadPoint} from '../duel/geometry';
import {actorVisibilitySamples} from '../duel/actor-visibility';
import {aimStep} from '../duel/motor';
import {PrefireBotController} from './bot-controller';
import {createPrefireBotPlan, hasPrefireSight, prefireBotKey, prefireRouteViews, type BotCollision, type PrefireBotPlan} from './bot-behavior';
import {prefireCandidates} from './occupancy';
import {sanitizePrefireConfig} from './config';
import {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import {prefireRoutes} from './routes';
import {PrefireSimulation} from './session';

const fixtureCollision = (ray: BotCollision['ray'] = () => undefined): BotCollision => ({
  vertical: p => ({feet: p.y, grounded: true, ceiling: false}), fits: () => true,
  sweep: (_from, to) => ({position: to, fraction: 1, startSolid: false}), ray,
});
const blocked: BotCollision['ray'] = () => ({distance: .5, normal: {x: 1, y: 0, z: 0}, surfaceId: 0});
const coveredLane = fixtureCollision(origin => origin.x < .3 ? blocked(origin, {x: 1, y: 0, z: 0}, 1) : undefined);
const planFor = (kind: PrefireBotPlan['kind'] = 'hold', key = 'fixture/1'): PrefireBotPlan => ({
  key, kind, anchor: {x: 0, y: 0, z: 0}, sourceCrouched: false,
  ...(kind === 'move-out' || kind === 'periodic-peek' ? {exposure: {x: 48 * UNIT, y: 0, z: 0}} : {}),
});
const actorFor = (): ActorKinematics & {pitch: number; weapon: DuelWeaponState} => ({
  position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0, yaw: 0, pitch: 0, velocity: {x: 0, z: 0},
  grounded: true, duckAmount: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false,
  weapon: new DuelWeaponState('m4a4', () => .5),
});
const player = () => ({position: {x: 0, y: 64 * UNIT, z: -10}, alive: true});
const combat = {returnFire: true, reactionMs: 300};
const silent = {...combat, returnFire: false};

function run(kind: PrefireBotPlan['kind'], seed = 42, seconds = 25, firing = false, key = 'fixture/1',
  patch: Partial<PrefireBotPlan> = {}, terrain = fixtureCollision(firing ? undefined : blocked)) {
  const plan = {...planFor(kind, key), ...patch}, controller = new PrefireBotController(plan, seed, 0, 0);
  let actor = actorFor();
  const rows = [];
  for (let tick = 0; tick < seconds / STEP; tick++) {
    const time = tick * STEP, before = {...actor, position: {...actor.position}, velocity: {...actor.velocity}};
    const command = controller.command(time, actor, player(), terrain, firing ? combat : silent);
    actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
    actor = {...actor, ...advanceActor(actor, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
    const shot = actor.weapon.advance(time, STEP, command, actor);
    rows.push({time, before, actor: {...actor, position: {...actor.position}, velocity: {...actor.velocity}},
      command, decision: controller.snapshot(), fired: !!shot, shotDirection: shot?.direction});
  }
  return {rows, plan};
}

describe('seeded angle-specific state machines using the shared movement motor', () => {
  it('uses running-speed wide swings and physical counterstrafes instead of shift-walking every peek', () => {
    const {rows} = run('move-out', 42, 12, false, 'wide/1',
      {peekStyle: 'wide', exposure: {x: 112 * UNIT, y: 0, z: 0}});
    expect(rows.every(row => !row.command.walk)).toBe(true);
    expect(Math.max(...rows.map(row => Math.hypot(row.actor.velocity.x, row.actor.velocity.z))) / UNIT).toBeCloseTo(225, 5);
    expect(rows.some(row => row.before.velocity.x > 1 && row.command.side < -.9)).toBe(true);
    expect(rows.some(row => row.decision.phase === 'exposed')).toBe(true);
    expect(rows.some(row => row.decision.phase === 'retreating')).toBe(true);
    expect(rows.filter((row, i) => i && row.decision.phase === 'outbound' && rows[i - 1].decision.phase === 'waiting').length).toBeGreaterThan(1);
  });
  it('retreats first when the unchanged source sample is the fighting end of a peek', () => {
    const {rows, plan} = run('periodic-peek', 42, 15, false, 'reverse/1', {attackFromAnchor: true});
    expect(rows[0].decision.phase).toBe('retreating');
    const settled = rows.filter((row, i) => i > 32 && row.decision.phase === rows[i - 32].decision.phase &&
      ['waiting', 'exposed'].includes(row.decision.phase));
    expect(settled.some(row => row.decision.phase === 'exposed')).toBe(true);
    expect(settled.some(row => row.decision.phase === 'waiting')).toBe(true);
    for (const row of settled) {
      const endpoint = row.decision.phase === 'exposed' ? plan.anchor : plan.exposure!;
      expect(Math.hypot(row.actor.position.x - endpoint.x, row.actor.position.z - endpoint.z)).toBeLessThan(.14);
    }
  });
  it('runs a crouch peek standing, then completes the real crouch transition before firing', () => {
    const {rows} = run('periodic-peek', 42, 15, true, 'crouch/1', {peekStyle: 'crouch'}, coveredLane);
    expect(rows.some(row => row.decision.phase === 'outbound' && row.actor.duckAmount === 0)).toBe(true);
    const firing = rows.filter(row => row.fired);
    expect(firing.length).toBeGreaterThan(0);
    expect(firing.every(row => row.before.duckAmount! >= .95 && Math.hypot(row.before.velocity.x, row.before.velocity.z) < .12)).toBe(true);
  });
  it.each(['hold', 'crouch-hide', 'periodic-peek', 'move-out'] as const)('%s has real stance/movement phases and no settled endpoint jitter', kind => {
    const {rows, plan} = run(kind), phases = new Set(rows.map(row => row.decision.phase));
    expect(rows.every(row => row.actor.grounded)).toBe(true);
    expect(rows.every(row => !row.command.fireHeld && !row.command.firePressed)).toBe(true);
    expect(rows.every(row => row.command.yawDelta === 0 && row.command.pitchDelta === 0)).toBe(true);
    if (kind === 'hold' || kind === 'crouch-hide') {
      expect(rows.every(row => row.actor.position.x === 0 && row.actor.position.z === 0)).toBe(true);
      if (kind === 'hold') expect([...phases]).toEqual(['holding']);
      else {
        expect(phases).toEqual(new Set(['waiting', 'exposed']));
        expect(rows.some(row => row.actor.duckAmount === 1)).toBe(true);
        expect(rows.some(row => row.actor.duckAmount === 0 && row.decision.phase === 'exposed')).toBe(true);
      }
    } else {
      expect(phases).toEqual(new Set(['waiting', 'outbound', 'exposed', 'retreating']));
      expect(Math.max(...rows.map(row => row.actor.position.x))).toBeGreaterThan(32 * UNIT);
      expect(rows.filter((row, i) => i && row.decision.phase === 'waiting' &&
        rows[i - 1].decision.phase === 'retreating').length).toBeGreaterThanOrEqual(2);
      const settled = rows.filter((row, i) => i > 32 && row.decision.phase === rows[i - 32].decision.phase &&
        ['waiting', 'exposed'].includes(row.decision.phase));
      expect(settled.length).toBeGreaterThan(100);
      for (const row of settled) {
        expect(Math.hypot(row.actor.velocity.x, row.actor.velocity.z)).toBeLessThan(.12);
        const endpoint = row.decision.phase === 'waiting' ? plan.anchor : plan.exposure!;
        expect(Math.hypot(row.actor.position.x - endpoint.x, row.actor.position.z - endpoint.z)).toBeLessThan(.14);
        expect(Math.hypot(row.actor.position.x - row.before.position.x, row.actor.position.z - row.before.position.z)).toBeLessThan(.001);
      }
    }
  });
  it('replays identical seeds, varies seed/key streams, and does not use a fixed metronome', () => {
    const transitions = (seed: number, key = 'fixture/1') => run('periodic-peek', seed, 35, false, key).rows
      .filter((row, i, rows) => !i || row.decision.phase !== rows[i - 1].decision.phase)
      .map(row => ({time: row.time, phase: row.decision.phase, until: row.decision.until}));
    const first = transitions(42);
    expect(transitions(42)).toEqual(first); expect(transitions(43)).not.toEqual(first);
    expect(transitions(42, 'fixture/2')).not.toEqual(first);
    const starts = first.filter(row => row.phase === 'outbound').map(row => row.time);
    expect(starts.length).toBeGreaterThan(4);
    expect(new Set(starts.slice(1).map((time, i) => Math.round((time - starts[i]) * 128))).size).toBeGreaterThan(2);
    const moveOut = run('move-out').rows, peek = run('periodic-peek').rows;
    expect(moveOut.filter(row => row.decision.phase === 'exposed').length).toBeGreaterThan(peek.filter(row => row.decision.phase === 'exposed').length);
  });
  it('counterstrafes in world space while turning, and never shoots moving or airborne', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -2.5]) {
      const actor = actorFor(); actor.yaw = yaw; actor.velocity = {x: 2, z: -1};
      const controller = new PrefireBotController(planFor(), 42, yaw, 0);
      const command = controller.command(2, actor, player(), fixtureCollision(), combat);
      const heading = actor.yaw + command.yawDelta;
      const wish = {x: command.side * Math.cos(heading) - command.forward * Math.sin(heading),
        z: -command.side * Math.sin(heading) - command.forward * Math.cos(heading)};
      expect(wish.x * actor.velocity.x + wish.z * actor.velocity.z).toBeLessThan(-2);
      expect(command.fireHeld).toBe(false);
    }
    const actor = actorFor(), controller = new PrefireBotController(planFor(), 42, 0, 0);
    controller.command(0, actor, player(), fixtureCollision(), combat);
    controller.command(.2, actor, player(), fixtureCollision(), combat);
    actor.grounded = false;
    expect(controller.command(1, actor, player(), fixtureCollision(), combat).fireHeld).toBe(false);
  });
  it('fights from a genuine waiting hold without walking away or adding a peek timer to reaction', () => {
    const {rows} = run('periodic-peek', 42, 3, true);
    expect(rows.some(row => row.fired)).toBe(true);
    expect(rows.every(row => row.decision.phase === 'waiting')).toBe(true);
    expect(rows.every(row => row.command.forward === 0 && row.command.side === 0)).toBe(true);
    const first = rows.find(row => row.fired)!;
    expect(first.time - first.decision.seenAt!).toBeGreaterThanOrEqual(combat.reactionMs / 1000);
    expect(first.time - first.decision.seenAt!).toBeLessThan(combat.reactionMs / 1000 + STEP * 2);
  });
  it('rechecks active angles frequently, with settled pauses instead of nonstop micro-shifting', () => {
    const {rows} = run('periodic-peek', 42, 60);
    const waiting = rows.filter(row => row.decision.phase === 'waiting');
    expect(waiting.length / rows.length).toBeGreaterThan(.2);
    expect(waiting.every(row => row.command.forward === 0 && row.command.side === 0)).toBe(true);
    const checks = rows.filter((row, i) => i && row.decision.phase === 'outbound' && rows[i - 1].decision.phase !== 'outbound').length;
    expect(checks).toBeGreaterThan(18); expect(checks).toBeLessThan(45);
  });
  it('honors an optional authored take-angle intent without changing legacy plan contracts', () => {
    const {rows} = run('periodic-peek', 42, 12, false, 'intent/1', {intent: 'take-angle'});
    expect(rows.some(row => row.decision.phase === 'outbound')).toBe(true);
    expect(rows.filter(row => row.time > 3).every(row => row.decision.phase === 'exposed')).toBe(true);
    expect(rows.some(row => row.decision.phase === 'retreating')).toBe(false);
  });
  it.each([180, 225, 250])('brakes a tagged %su weapon with its physical speed, without an opposite-key oscillation', weaponSpeed => {
    const actor = actorFor();
    actor.velocity = {x: weaponSpeed * UNIT * .55, z: -weaponSpeed * UNIT * .2};
    actor.velocityModifier = .35;
    const pawn = {...actor, weapon: {ammo: 30, reserve: 90, ordinal: 0, nextShotAt: 0, reloadUntil: 0,
      actions: {stats: {speed: weaponSpeed}}}};
    const controller = new PrefireBotController(planFor(), 42, 0, 0);
    let moving = pawn;
    const initialDirection = {...actor.velocity};
    for (let tick = 0; tick < .5 / STEP; tick++) {
      const command = controller.command(tick * STEP, moving, player(), fixtureCollision(), silent);
      expect(command.walk).toBe(false);
      moving.yaw += command.yawDelta; moving.pitch += command.pitchDelta;
      moving = {...moving, ...advanceActor(moving, command, weaponSpeed * UNIT, STEP,
        undefined, undefined, undefined, {solids: [], floor: 0})};
      expect(moving.velocity.x * initialDirection.x + moving.velocity.z * initialDirection.z).toBeGreaterThanOrEqual(-1e-10);
    }
    expect(Math.hypot(moving.velocity.x, moving.velocity.z)).toBe(0);
  });
  it('pre-aims a validated route point without querying or following a hidden player', () => {
    const actor = actorFor(), target = player(), watchPoint = {x: 4, y: 64 * UNIT, z: -8};
    const controller = new PrefireBotController({...planFor('periodic-peek'), watchPoint}, 42, 0, 0);
    const first = controller.command(.1, actor, target, fixtureCollision(blocked), combat);
    target.position = {x: -20, y: 20, z: 20};
    const changed = controller.command(.3, actor, target, fixtureCollision(blocked), combat);
    expect(changed.yawDelta).toBe(first.yawDelta); expect(changed.pitchDelta).toBe(first.pitchDelta);
    const expected = aimStep({yawRate: 0, pitchRate: 0}, -Math.atan2(4, 8), 0, 170);
    expect(changed.yawDelta).toBeCloseTo(expected.yawDelta, 12); expect(changed.fireHeld).toBe(false);
    expect(controller.snapshot().seenAt).toBeUndefined();
  });
  it('backs off a blocked lane and physically recovers its return when the obstruction clears', () => {
    const actor = actorFor(), controller = new PrefireBotController(planFor('periodic-peek'), 42, 0, 0);
    actor.position.x = .5;
    const original = {...actor.position};
    let blockedAt = 0;
    for (let tick = 0; tick < 8 / STEP; tick++) {
      controller.command(tick * STEP, actor, player(), fixtureCollision(blocked), silent);
      if (tick && controller.snapshot().phase === 'holding') {blockedAt = tick * STEP; break;}
    }
    expect(blockedAt).toBeGreaterThan(0); expect(actor.position).toEqual(original);
    let moving = actor, returned = false, maxDisplacement = 0;
    for (let tick = 1; tick < 5 / STEP; tick++) {
      const command = controller.command(blockedAt + tick * STEP, moving, player(), fixtureCollision(blocked), silent);
      const next = {...moving, ...advanceActor(moving, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
      maxDisplacement = Math.max(maxDisplacement, Math.hypot(next.position.x - moving.position.x, next.position.z - moving.position.z));
      moving = next;
      if (controller.snapshot().phase === 'waiting') {returned = true; break;}
    }
    expect(returned).toBe(true); expect(Math.abs(moving.position.x)).toBeLessThan(.14);
    expect(maxDisplacement).toBeGreaterThan(0); expect(maxDisplacement).toBeLessThan(225 * UNIT * STEP);
  });
  it('abandons a persistently blocked excursion instead of commanding endless exposed A/D retries', () => {
    const actor = actorFor(), controller = new PrefireBotController(planFor('periodic-peek'), 42, 0, 0);
    actor.position.x = .5;
    const original = {...actor.position};
    let returnStarts = 0, previous = controller.snapshot().phase;
    for (let tick = 0; tick < 30 / STEP; tick++) {
      const time = tick * STEP, command = controller.command(time, actor, player(), fixtureCollision(blocked), silent);
      const phase = controller.snapshot().phase;
      if (phase === 'retreating' && phase !== previous) returnStarts++;
      previous = phase;
      if (time > 15) {
        expect(phase).toBe('holding'); expect(command.side).toBe(0); expect(command.forward).toBe(0);
      }
      expect(actor.position).toEqual(original);
    }
    expect(returnStarts).toBeGreaterThan(0); expect(returnStarts).toBeLessThanOrEqual(3);
  });
});

describe('return fire safety and shot accounting', () => {
  it.each([300, 1000, 2500])('uses the shared acceleration-limited motor and settles at reaction setting %sms', reactionMs => {
    const actor = actorFor(), target = player(), controller = new PrefireBotController(planFor(), 42, 0, 0);
    target.position = {x: 6, y: actor.position.y + 1, z: -10};
    const yaw = -Math.atan2(6, 10), pitch = Math.atan2(1, Math.hypot(6, 10));
    const motor = {yawRate: 0, pitchRate: 0}, settling = Math.max(160, Math.min(240, 140 + reactionMs * .1));
    const maxAcceleration = 350 * DEG / Math.max(.06, settling / 1000 * .4);
    let lastYawRate = 0, lastPitchRate = 0, peakRate = 0;
    for (let tick = 0; tick < 1.5 / STEP; tick++) {
      const expected = aimStep(motor, yaw - actor.yaw, pitch - actor.pitch, settling);
      const command = controller.command(tick * STEP, actor, target, fixtureCollision(), {returnFire: false, reactionMs});
      expect(command.yawDelta).toBeCloseTo(expected.yawDelta, 12); expect(command.pitchDelta).toBeCloseTo(expected.pitchDelta, 12);
      const yawRate = command.yawDelta / STEP, pitchRate = command.pitchDelta / STEP;
      expect(Math.abs(yawRate - lastYawRate)).toBeLessThanOrEqual(maxAcceleration * STEP + 1e-8);
      expect(Math.abs(pitchRate - lastPitchRate)).toBeLessThanOrEqual(maxAcceleration * STEP + 1e-8);
      peakRate = Math.max(peakRate, Math.abs(yawRate)); lastYawRate = yawRate; lastPitchRate = pitchRate;
      actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta; expect(command.fireHeld).toBe(false);
    }
    expect(peakRate).toBeGreaterThan(100 * DEG); expect(peakRate).toBeLessThanOrEqual(350 * DEG);
    expect(Math.abs(actor.yaw - yaw)).toBeLessThan(.05 * DEG); expect(Math.abs(actor.pitch - pitch)).toBeLessThan(.05 * DEG);
    expect(Math.abs(lastYawRate)).toBeLessThan(.05 * DEG);
  });
  it('does not keep hiding on a timer when the crouched bot already sees a player', () => {
    const actor = actorFor(); actor.duckAmount = 1; actor.eyeHeight = 46 * UNIT; actor.position.y = actor.eyeHeight;
    const controller = new PrefireBotController(planFor('crouch-hide'), 42, 0, 0);
    controller.command(.1, actor, player(), fixtureCollision(), {...combat, reactionMs: 1000});
    expect(controller.snapshot().seenAt).toBe(.1);
    expect(controller.snapshot().until).toBeLessThanOrEqual(.28);
    const command = controller.command(.3, actor, player(), fixtureCollision(), {...combat, reactionMs: 1000});
    expect(controller.snapshot().phase).toBe('exposed'); expect(command.crouch).toBe(false);
    expect(command.fireHeld).toBe(false);
  });
  it('aims above or below its eye correctly and controls recoil during stopped bursts', () => {
    for (const height of [46, 96]) {
      const target = player(); target.position.y = height * UNIT;
      const controller = new PrefireBotController(planFor(), 42, 0, 0);
      let actor = actorFor(); actor.weapon = new DuelWeaponState('m4a4', () => .5, {spread: false});
      const errors: number[] = [];
      for (let tick = 0; tick < 2 / STEP; tick++) {
        const time = tick * STEP, command = controller.command(time, actor, target, fixtureCollision(), combat);
        actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
        actor = {...actor, ...advanceActor(actor, command, 225 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: 0})};
        const shot = actor.weapon.advance(time, STEP, command, actor);
        if (!shot) continue;
        const delta = {x: target.position.x - shot.origin.x, y: target.position.y - shot.origin.y, z: target.position.z - shot.origin.z};
        const distance = Math.hypot(delta.x, delta.y, delta.z);
        const cosine = (shot.direction.x * delta.x + shot.direction.y * delta.y + shot.direction.z * delta.z) / distance;
        errors.push(Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI);
      }
      expect(errors.length).toBeGreaterThan(3);
      expect(Math.max(...errors)).toBeLessThan(.5);
    }
  });
  it.each([300, 1000, 2500])('waits the full %sms reaction after first sight and again after LOS reacquisition', reactionMs => {
    const actor = actorFor(), controller = new PrefireBotController(planFor(), 42, 0, 0), options = {...combat, reactionMs};
    let firstShot: number | undefined;
    for (let tick = 0; tick < 4 / STEP; tick++) {
      const time = tick * STEP, command = controller.command(time, actor, player(), fixtureCollision(), options);
      if (command.fireHeld) {firstShot = time; break;}
    }
    const seenAt = controller.snapshot().seenAt!;
    expect(firstShot).toBeDefined(); expect(firstShot! - seenAt).toBeGreaterThanOrEqual(reactionMs / 1000);
    controller.command(5, actor, player(), fixtureCollision(blocked), options);
    expect(controller.snapshot().visible).toBe(false); expect(controller.snapshot().seenAt).toBeUndefined();
    controller.command(6, actor, player(), fixtureCollision(), options);
    for (let tick = 1; tick < reactionMs / 1000 / STEP; tick++) {
      expect(controller.command(6 + tick * STEP, actor, player(), fixtureCollision(), options).fireHeld).toBe(false);
    }
  });
  it('synchronously rechecks LOS on a firing opportunity before the next periodic perception', () => {
    const actor = actorFor(), controller = new PrefireBotController(planFor(), 42, 0, 0);
    controller.command(.1, actor, player(), fixtureCollision(), combat);
    expect(controller.command(1, actor, player(), fixtureCollision(), combat).fireHeld).toBe(true);
    expect(controller.command(1 + STEP, actor, player(), fixtureCollision(blocked), combat).fireHeld).toBe(false);
    expect(controller.snapshot().seenAt).toBeUndefined();
  });
  it('post-movement verification resets reaction on LOS loss and cannot reuse the old timer', () => {
    const actor = actorFor(), controller = new PrefireBotController(planFor(), 42, 0, 0);
    controller.command(.1, actor, player(), fixtureCollision(), combat);
    expect(controller.command(1, actor, player(), fixtureCollision(), combat).fireHeld).toBe(true);
    expect(controller.verifyShot(1 + STEP, actor, player(), fixtureCollision(blocked), 300)).toBe(false);
    expect(controller.snapshot().visible).toBe(false); expect(controller.snapshot().seenAt).toBeUndefined();
    expect(controller.verifyShot(2, actor, player(), fixtureCollision(), 300)).toBe(false);
    expect(controller.verifyShot(2.2, actor, player(), fixtureCollision(), 300)).toBe(false);
    expect(controller.verifyShot(2.31, actor, player(), fixtureCollision(), 300)).toBe(true);
  });
  it('remembers an immutable last-seen point, never tracks a hidden moving player, and expires memory', () => {
    const actor = actorFor(), target = player(), controller = new PrefireBotController(planFor(), 42, .7, .2);
    controller.command(.1, actor, target, fixtureCollision(), combat);
    actor.yaw = 0; actor.pitch = 0;
    target.position.x = 10; target.position.y += 3;
    const hidden = controller.command(.3, actor, target, fixtureCollision(blocked), combat);
    expect(hidden.yawDelta).toBeCloseTo(0, 12); expect(hidden.pitchDelta).toBeCloseTo(0, 12); expect(hidden.fireHeld).toBe(false);
    const remembered = controller.command(2.5, actor, target, fixtureCollision(blocked), combat);
    expect(remembered.yawDelta).toBeCloseTo(0, 12); expect(remembered.pitchDelta).toBeCloseTo(0, 12);
    const area = controller.command(4, actor, target, fixtureCollision(blocked), combat);
    expect(area.yawDelta).toBeCloseTo(0, 12); expect(area.fireHeld).toBe(false);
    const expired = controller.command(13, actor, target, fixtureCollision(blocked), combat);
    expect(expired.yawDelta).toBeGreaterThan(0); expect(expired.pitchDelta).toBeGreaterThan(0);
    expect(controller.snapshot().visible).toBe(false); expect(controller.snapshot().seenAt).toBeUndefined();
  });
  it('uses actual weapon ordinals for bounded bursts and cooldown gaps rather than command counts', () => {
    const {rows} = run('hold', 42, 15, true), times = rows.filter(row => row.fired).map(row => row.time);
    const bursts: number[][] = [];
    for (const time of times) {
      const last = bursts[bursts.length - 1];
      if (!last || time - last[last.length - 1] > .3) bursts.push([]);
      bursts[bursts.length - 1].push(time);
    }
    expect(bursts.length).toBeGreaterThan(4);
    for (const burst of bursts.slice(0, -1)) {expect(burst.length).toBeGreaterThanOrEqual(2); expect(burst.length).toBeLessThanOrEqual(4);}
    expect(rows.filter(row => row.command.fireHeld).length).toBeGreaterThan(times.length);
    expect(rows.every(row => !row.command.firePressed)).toBe(true);
    for (const row of rows.filter(row => row.fired)) {
      expect(Math.hypot(row.before.velocity.x, row.before.velocity.z)).toBeLessThan(.12);
      expect(row.decision.visible).toBe(true);
    }
  });
  it('finishes a stopped shooting burst then returns home, and never fires outbound/retreating', () => {
    const {rows} = run('periodic-peek', 42, 25, true, 'covered/1', {}, coveredLane);
    expect(rows.some(row => row.fired)).toBe(true);
    expect(rows.some((row, i) => i && row.decision.phase === 'retreating' && rows[i - 1].decision.phase === 'exposed')).toBe(true);
    for (const row of rows) if (['outbound', 'retreating', 'waiting'].includes(row.decision.phase)) expect(row.command.fireHeld).toBe(false);
  });
  it('does not shoot through crouch-to-stand transitions and reloads only after returning to safety', () => {
    const {rows} = run('crouch-hide', 42, 15, true);
    expect(rows.some(row => row.fired)).toBe(true);
    for (const row of rows.filter(row => row.fired)) expect(row.before.duckAmount).toBeLessThan(.05);
    const actor = actorFor(), controller = new PrefireBotController(planFor('move-out'), 42, 0, 0);
    controller.command(2, actor, player(), coveredLane, combat);
    actor.position.x = 1; actor.weapon.ammo = 0;
    expect(controller.command(2.1, actor, player(), fixtureCollision(), combat).reloadPressed).toBe(false);
    expect(controller.snapshot().phase).toBe('retreating');
    actor.position.x = 0;
    expect(controller.command(2.2, actor, player(), fixtureCollision(), combat).reloadPressed).toBe(true);
  });
  it('disabling return fire preserves perception and follows visible movement without firing', () => {
    const actor = actorFor(), target = player(), controller = new PrefireBotController(planFor(), 42, .4, .2), ray = vi.fn(() => undefined);
    controller.command(.1, actor, target, fixtureCollision(), silent);
    target.position.x = 4;
    const command = controller.command(1, actor, target, fixtureCollision(ray), silent);
    expect(command.yawDelta).toBeLessThan(0); expect(command.fireHeld).toBe(false);
    expect(ray).toHaveBeenCalled(); expect(controller.snapshot().seenAt).toBe(.1);
    expect(controller.command(2, actor, {...player(), alive: false}, fixtureCollision(), combat).fireHeld).toBe(false);
  });
  it('recognizes an exposed torso when the head is behind cover and never targets the blocked head', () => {
    const actor = actorFor(), target = {...player(), feet: 0, duckAmount: 0, yaw: 0};
    const controller = new PrefireBotController(planFor(), 42, 0, 0);
    const cover = fixtureCollision((_origin, direction) => direction.y > -.02 ? blocked(_origin, direction, 1) : undefined);
    const command = controller.command(.1, actor, target, cover, silent);
    expect(controller.snapshot().visible).toBe(true);
    expect(command.pitchDelta).toBeLessThan(0); expect(command.fireHeld).toBe(false);
  });
  it('keeps the last encountered approach after a cover break without using the hidden player position', () => {
    const actor = actorFor(), target = player(); target.position.x = 4;
    const oldEntrance = {x: -5, y: actor.position.y, z: -10}, recentApproach = {...target.position};
    const controller = new PrefireBotController({...planFor(), watchPoint: oldEntrance,
      approachViews: [oldEntrance, recentApproach]}, 42, 0, 0);
    controller.command(.1, actor, target, fixtureCollision(), silent);
    target.position = {x: -10, y: 20, z: 10};
    const remembered = controller.command(7, actor, target, fixtureCollision(blocked), silent);
    expect(remembered.yawDelta).toBeLessThan(0); expect(remembered.pitchDelta).toBe(0); expect(remembered.fireHeld).toBe(false);
    expect(controller.snapshot().visible).toBe(false);
    const expired = controller.command(13, actor, target, fixtureCollision(blocked), silent);
    expect(expired.yawDelta).toBeGreaterThan(0); expect(expired.fireHeld).toBe(false);
  });
  it('aims before shooting at long range rather than accepting several degrees of error', () => {
    const actor = actorFor(), target = player(), controller = new PrefireBotController(planFor(), 42, 0, 0);
    target.position = {x: -1, y: 64 * UNIT, z: -50};
    controller.command(0, actor, target, fixtureCollision(), combat);
    expect(controller.command(1, actor, target, fixtureCollision(), combat).fireHeld).toBe(false);
    actor.yaw = Math.atan2(1, 50);
    expect(controller.command(1.1, actor, target, fixtureCollision(), combat).fireHeld).toBe(true);
  });
  it('does not postpone hearing a sustained burst on every additional shot', () => {
    const actor = actorFor(), controller = new PrefireBotController(planFor(), 42, 0, 0);
    for (let time = 0; time <= .4; time += .08) controller.hear({x: 5, y: actor.position.y, z: -10}, time, 300, false);
    const command = controller.command(.4, actor, player(), fixtureCollision(blocked), silent);
    expect(command.yawDelta).toBeLessThan(0); expect(command.fireHeld).toBe(false);
  });
  it('keeps idle perception bounded independently of the 128Hz motor', () => {
    const actor = actorFor(), controller = new PrefireBotController(planFor(), 42, 0, 0), ray = vi.fn(blocked);
    for (let tick = 0; tick < 10 / STEP; tick++) controller.command(tick * STEP, actor, player(), fixtureCollision(ray), combat);
    expect(ray.mock.calls.length).toBeGreaterThan(80); expect(ray.mock.calls.length).toBeLessThan(140);
  });
  it('never acquires a hidden or rear player just because their coordinates are available', () => {
    const actor = actorFor(), target = player(), controller = new PrefireBotController(planFor(), 42, 0, 0);
    target.position.z = 10;
    const ray = vi.fn(() => undefined);
    for (let tick = 0; tick < 2 / STEP; tick++) {
      const command = controller.command(tick * STEP, actor, target, fixtureCollision(ray), combat);
      expect(command.fireHeld).toBe(false); expect(command.yawDelta).toBeCloseTo(0, 12);
    }
    expect(ray).not.toHaveBeenCalled(); expect(controller.snapshot().seenAt).toBeUndefined();
  });
});

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('joint native Prefire controller integration', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    collision = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => collision?.dispose());
  const map = () => ({scene: new THREE.Group(), collision, settle: (point: Parameters<typeof placePrefireTarget>[1]) => placePrefireTarget(collision, point), dispose() {}});
  it('does not shoot the occluded head on a native edge, but retains legitimate torso/shoulder contact', () => {
    const original = prefireRoutes.find(route => route.angles.some(angle => prefireBotKey(angle) === 'ct_push_lower/14'))!;
    const angle = original.angles.find(angle => angle.source?.profile === 'ct_push_lower' && angle.source.index === 14)!;
    // Captured from the 180-second seed-42 audit, not a mocked collision edge.
    const point = {x: -34.9008239133053, y: .926062575059334, z: -27.744403126686674};
    const route = {...original, spawn: [point.x / UNIT, -point.z / UNIT, point.y / UNIT] as const, angles: [angle], alternatives: []};
    const sim = new PrefireSimulation(map(), sanitizePrefireConfig({population: 'all', botBehavior: 'static', returnFire: true, reactionMs: 300}), route, 42, defaults);
    const player = sim.actors[0], bot = sim.actors[1]; player.health = 1e9;
    bot.yaw = Math.atan2(-(player.position.x - bot.position.x), -(player.position.z - bot.position.z));
    sim.start();
    for (let tick = 0; tick < .4 / STEP; tick++) {sim.step(); sim.drainEvents();}
    while (bot.weapon.nextShotAt > sim.time + STEP) {sim.step(); sim.drainEvents();}
    const nativeSight = () => {
      const dx = player.position.x - bot.position.x, dy = player.position.y - bot.position.y, dz = player.position.z - bot.position.z;
      const distance = Math.hypot(dx, dy, dz);
      return !collision.ray(bot.position, {x: dx / distance, y: dy / distance, z: dz / distance}, distance - .01);
    };
    expect(nativeSight()).toBe(true);
    player.yaw = Math.PI / 2; player.velocity = {x: -2.85, z: 0}; player.velocityModifier = 1; player.flinchStack = 1;
    sim.command(0, {forward: 1, side: 0, walk: true});
    const before = {...player.position}; sim.step();
    expect(player.position.x).toBeLessThan(before.x); expect(nativeSight()).toBe(false);
    expect(sim.drainEvents().filter(event => event.kind === 'fire' && event.actorId > 0)).toHaveLength(0);
    const bodyVisible = () => {
      return actorVisibilitySamples({...player, duckAmount: player.duckAmount ?? 0}, bot.position)
        .some(({point}) => hasPrefireSight(collision, bot.position, point));
    };
    expect(bodyVisible()).toBe(true); expect(sim.prefireBotDecision(1)?.visible).toBe(true);
    let fullyHidden = false;
    for (let tick = 0; tick < 128; tick++) {
      sim.step(); const events = sim.drainEvents();
      if (!bodyVisible()) {
        fullyHidden = true;
        expect(events.filter(event => event.kind === 'fire' && event.actorId > 0)).toHaveLength(0);
        expect(sim.prefireBotDecision(1)?.visible).toBe(false); expect(sim.prefireBotDecision(1)?.seenAt).toBeUndefined();
      }
    }
    expect(fullyHidden).toBe(true);
  }, 15000);
  it('caches native plans by collision/route/mode across repeat seeds and random occupancy', () => {
    const route = {...prefireRoutes.find(route => route.angles.some(angle => prefireBotKey(angle) === 'a_long/19'))!};
    const practice = sanitizePrefireConfig({botBehavior: 'angle-specific', population: 'all'});
    const ray = vi.spyOn(collision, 'ray'), sweep = vi.spyOn(collision, 'sweep');
    try {
      const first = new PrefireSimulation(map(), practice, route, 7, defaults);
      expect(ray.mock.calls.length).toBeGreaterThan(0); expect(sweep.mock.calls.length).toBeGreaterThan(0);
      ray.mockClear(); sweep.mockClear();
      const repeat = new PrefireSimulation(map(), practice, route, 42, defaults);
      expect(ray).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled();
      const random = new PrefireSimulation(map(), {...practice, population: 'random'}, route, 2026, defaults);
      ray.mockClear(); sweep.mockClear();
      new PrefireSimulation(map(), {...practice, population: 'random'}, route, 2026, defaults);
      expect(ray).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled();
      expect(repeat.actors).toHaveLength(first.actors.length); expect(random.actors.length).toBeGreaterThan(1);
      for (const actor of random.actors.slice(1)) {
        const source = prefireCandidates(route).find(angle => prefireBotKey(angle) === random.prefireBotDecision(actor.id)?.key)!;
        const feet = placePrefireTarget(collision, source.position, source.crouched);
        expect(actor.position.x).toBe(feet.x); expect(actor.position.z).toBe(feet.z);
        expect(actor.duckAmount).toBe(Number(source.crouched));
      }
      const staticSim = new PrefireSimulation(map(), {...practice, botBehavior: 'static'}, route, 42, defaults);
      expect(staticSim.actors.slice(1).every(actor => staticSim.prefireBotDecision(actor.id)?.kind === 'hold')).toBe(true);
      ray.mockClear(); sweep.mockClear();
      new PrefireSimulation(map(), {...practice, botBehavior: 'static'}, route, 2026, defaults);
      expect(ray).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled();
      new PrefireSimulation(map(), practice, {...route}, 42, defaults);
      expect(ray.mock.calls.length).toBeGreaterThan(0); expect(sweep.mock.calls.length).toBeGreaterThan(0);
      const independent = new Proxy(collision, {get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      ray.mockClear(); sweep.mockClear();
      new PrefireSimulation({...map(), collision: independent}, practice, route, 42, defaults);
      expect(ray.mock.calls.length).toBeGreaterThan(0); expect(sweep.mock.calls.length).toBeGreaterThan(0);
      expect(route.angles.map((_, i) => repeat.prefireBotDecision(i + 1)?.kind).some(kind => kind !== 'hold')).toBe(true);
    } finally {ray.mockRestore(); sweep.mockRestore();}
  }, 15000);
  for (const route of prefireRoutes) it.each([7, 42])(`${route.id}: jointly supported moving bots, seed %s`, seed => {
    const sim = new PrefireSimulation(map(), sanitizePrefireConfig({botBehavior: 'angle-specific', population: 'all', returnFire: false}), route, seed, defaults);
    const starts = sim.actors.slice(1).map(actor => ({x: actor.position.x, y: actor.feet, z: actor.position.z}));
    const excursion = sim.actors.slice(1).map(() => 0), views = prefireRouteViews([route.spawn, ...route.path], collision);
    const plans = route.angles.map(angle => createPrefireBotPlan(collision, angle, true, views, starts));
    sim.start();
    for (let tick = 0; tick < 10 / STEP; tick++) {
      sim.step(); sim.drainEvents();
      for (const [i, actor] of sim.actors.slice(1).entries()) {
        const detail = `${route.id}/${prefireBotKey(route.angles[i])} seed ${seed} tick ${tick}`;
        expect(actor.alive, detail).toBe(true); expect(actor.grounded, detail).toBe(true);
        excursion[i] = Math.max(excursion[i], Math.hypot(actor.position.x - starts[i].x, actor.position.z - starts[i].z));
        if (tick % 32 === 0) {
          const height = (72 - 18 * stanceCurve(actor.duckAmount ?? 0)) * UNIT;
          expect(collision.fits(actor.position, actor.feet, height), detail).toBe(true);
        }
        for (const other of sim.actors.slice(actor.id + 1)) if (Math.abs(actor.feet - other.feet) < 54 * UNIT) {
          expect(Math.max(Math.abs(actor.position.x - other.position.x), Math.abs(actor.position.z - other.position.z)), detail).toBeGreaterThanOrEqual(32 * UNIT - .002);
        }
      }
    }
    for (const [i, plan] of plans.entries()) {
      if (plan.kind === 'periodic-peek' || plan.kind === 'move-out') {
        expect(excursion[i], `${route.id}/${plan.key}`).toBeGreaterThan(16 * UNIT);
      }
      else expect(excursion[i]).toBeLessThan(.001);
    }
  }, 20000);
});
