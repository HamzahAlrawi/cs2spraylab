import {describe, expect, it} from 'vitest';
import {DEG, STEP, UNIT} from '../actor-physics';
import {testArena, type Arena, type CoverLane} from './geometry';
import {gameData} from '../config';
import {aimStep, type AimMotorMode} from './motor';
import {createBotTraits} from './skill';
import {randomStream} from './rng';
import {tacticalPersonality} from './tactical-personality';
import {FlankPlan} from './flank-plan';
import {TacticalBrain} from './tactics';
import type {DuelActorSnapshot} from './types';

const point = {x: 8, y: 64 * UNIT, z: -8};
const selfActor = (): DuelActorSnapshot => ({id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 64 * UNIT, z: 0},
  feet: 0, grounded: true, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reserve: 90, reloading: false});
const lane = (x: number, role: CoverLane['role'] = 'entry'): CoverLane => ({side: x < 0 ? -1 : 1, role,
  anchor: {x, y: 0, z: 0}, edge: {x: x + 2, y: 0, z: 0}, retreat: {x, y: 0, z: 0}, watch: point});
function fixture(seed = 19, behavior: 'holder' | 'patient' = 'holder', primary: 'ak47' | 'awp' = 'ak47') {
  const arena: Arena = {...testArena(), lanes: [lane(0)],
    spawns: {player: {feet: {x: 0, y: 0, z: -8}, yaw: 0}, bots: [{feet: {x: 0, y: 0, z: 0}, yaw: 0, lane: 0}]}};
  const traits = {...createBotTraits(8, seed, 1), recognitionMedianMs: 200,
    endpointErrorDegrees: 0, preaimErrorDegrees: 0, lowAimTendency: 0};
  const brain = new TacticalBrain(traits, behavior, 1, randomStream(seed, 'context-test'), arena, 8, primary, 1);
  const self = {...selfActor(), equipment: primary};
  return {brain, self, traits, arena};
}

describe('contextual finite aim motor', () => {
  it('clears more deliberately than acquired tracking without bypassing skill settling', () => {
    const turns = (mode: AimMotorMode, settlingMs: number) => {
      const motor = {yawRate: 0, pitchRate: 0}; let yaw = 0;
      for (let tick = 0; tick < 20; tick++) yaw += aimStep(motor, 90 * DEG - yaw, 0, settlingMs, mode).yawDelta;
      return yaw;
    };
    expect(turns('tracking', 180)).toBeGreaterThan(turns('acquiring', 180));
    expect(turns('acquiring', 180)).toBeGreaterThan(turns('clearing', 180));
    expect(turns('clearing', 180)).toBeGreaterThan(turns('holding', 180));
    expect(turns('tracking', 360)).toBeLessThan(turns('tracking', 180));
  });

  it('never snaps velocity or endpoints across context changes, tiny errors, reversals and reacquisition', () => {
    const motor = {yawRate: 350 * DEG, pitchRate: -100 * DEG};
    let yaw = 0, pitch = 0;
    for (let tick = 0; tick < 600; tick++) {
      const mode: AimMotorMode = tick < 10 ? 'holding' : tick < 35 ? 'acquiring' : 'tracking';
      const old = {...motor}, yawError = tick === 0 ? .00001 : (tick < 100 ? 30 : -20) * DEG - yaw;
      const result = aimStep(motor, yawError, -pitch, 220, mode);
      const acceleration = 350 * DEG / (.22 * .4);
      expect(Math.abs(motor.yawRate - old.yawRate)).toBeLessThanOrEqual(acceleration * STEP + 1e-10);
      expect(Math.abs(motor.pitchRate - old.pitchRate)).toBeLessThanOrEqual(acceleration * STEP + 1e-10);
      expect(result.yawDelta).toBeCloseTo(motor.yawRate * STEP, 12);
      if (tick === 0) expect(result.yawDelta).toBeGreaterThan(yawError);
      yaw += result.yawDelta; pitch += result.pitchDelta;
    }
    expect(yaw / DEG).toBeCloseTo(-20, 3); expect(pitch).toBeCloseTo(0, 6);
  });

  it('wires clearing/holding, unrecognized acquisition and acquired tracking into TacticalBrain, not stale evidence', () => {
    const {brain, self} = fixture();
    brain.phase = 'setup'; brain.perceive({time: 0, self, visible: null}); brain.command(self, 0);
    expect(brain.decisionSnapshot(0).motorMode).toBe('holding');
    brain.phase = 'expose'; brain.activePeek = 'shoulder'; brain.command(self, .01);
    expect(brain.decisionSnapshot(.01).motorMode).toBe('clearing');
    const visible = {id: 0, position: point, aimPoint: point};
    brain.perceive({time: .02, self, visible});
    expect(brain.command(self, .02).fireHeld).toBe(false);
    expect(brain.decisionSnapshot(.02)).toMatchObject({motorMode: 'acquiring', fireBlockedReason: 'reaction'});
    brain.perceive({time: .6, self, visible}); brain.command(self, .6);
    expect(brain.decisionSnapshot(.6).motorMode).toBe('tracking');
    expect(brain.command(self, .8).fireHeld).toBe(false);
    expect(brain.decisionSnapshot(.8).motorMode).not.toBe('tracking');
  });

  it('uses current sidearm/Zeus stats after primary switches, and safely traverses knife and back without phantom shots', () => {
    const {brain, self: initial} = fixture(19, 'holder', 'awp');
    const self: DuelActorSnapshot = initial;
    const visible = {id: 0, position: point, aimPoint: point};
    self.ammo = 5; brain.perceive({time: 0, self, visible}); brain.command(self, 0);
    for (const [index, equipment] of (['zeus', 'usp', 'knife', 'usp', 'ak47'] as const).entries()) {
      const time = .6 + index * .1;
      self.equipment = equipment; self.ammo = equipment === 'zeus' ? 1 : equipment === 'usp' ? 12 : 30;
      brain.perceive({time, self, visible});
      const command = brain.command(self, time, undefined, [], {weaponReadyAt: time + .2});
      expect(command.fireHeld).toBe(false); expect(command.secondaryHeld ?? false).toBe(false);
      expect(brain.decisionSnapshot(time).equipment).toBe(equipment);
      expect(brain['attackShots']).toBe(0);
      if (equipment !== 'knife') expect(brain['weapon']).toBe(equipment);
      if (equipment === 'zeus') {expect(brain.phase).toBe('close'); expect(command.reloadPressed).toBe(false);}
      if (equipment === 'usp') expect(brain.phase).not.toBe('close');
      expect(Number.isFinite(command.yawDelta)).toBe(true); expect(Number.isFinite(command.forward)).toBe(true);
    }
  });
});

describe('coherent seeded tactical preferences', () => {
  it('shares latent identity across archetypes without mutating skill or drawing from the combat RNG', () => {
    const traits = createBotTraits(1, 3, 1), before = {...traits};
    const patient = tacticalPersonality(traits, 'patient', 1), aggressive = tacticalPersonality(traits, 'aggressive', 1);
    expect(patient.tradeWillingness).toBe(aggressive.tradeWillingness);
    expect(patient.adaptation).toBe(aggressive.adaptation);
    expect(patient.flankCommitment).toBe(aggressive.flankCommitment);
    expect(patient.patience).toBeGreaterThan(aggressive.patience);
    expect(traits).toEqual(before); expect(Object.isFrozen(patient)).toBe(true);
    expect(patient).toEqual(tacticalPersonality(traits, 'patient', 1));
    expect(patient).not.toEqual(tacticalPersonality(traits, 'patient', 2));
  });

  it('keeps flank plans through nearby reports, expires them, and adapts only to fresh materially changed evidence', () => {
    const identity = tacticalPersonality(createBotTraits(8, 2, 1), 'patient', 1);
    for (const adaptation of [.8, 1.2]) {
      const plan = new FlankPlan({...identity, adaptation});
      plan.begin('flank-a', 1, .5, point);
      expect(plan.retains('flank-a', 2, 1.9, {...point, x: 9})).toBe(true);
      expect(plan.retains('flank-a', 2, .4, {...point, x: -10})).toBe(true);
      expect(plan.retains('flank-a', 2, 1.9, {...point, x: 4.4})).toBe(adaptation === .8);
      expect(plan.retains('flank-a', 2, 1.9, {...point, x: -10})).toBe(false);
      expect(plan.retains('flank-a', 10, .5, point)).toBe(false);
      expect(plan.retains('flank-a', 0, .5, point)).toBe(false);
      const snapshot = plan.snapshot()!; snapshot.point!.x = 100;
      expect(plan.snapshot()!.point!.x).toBe(8);
    }
  });

  it('actually retains a selected flank across conflicting nearby callouts, but interrupts for fresh danger and local sight', () => {
    const {self, arena} = fixture(19, 'patient');
    // The constructor consumes a copied lane catalog; construct the real catalog before the policy.
    arena.lanes = [lane(0, 'camp'), ...[-4, 4].map(x => ({...lane(x, 'flank'), edge: {x, y: 0, z: 1}}))];
    const policy = new TacticalBrain(createBotTraits(8, 19, 1), 'patient', 1, randomStream(19, 'flank-test'), arena, 8, 'ak47', 1);
    policy.teammateCallout({x: .5, y: 1.6, z: 10}, 0);
    policy.perceive({time: .7, self, visible: null}); policy.command(self, .7);
    expect(policy.decisionSnapshot(.7).flankPlan?.lane).toBe('4:0');
    policy.teammateCallout({x: -.5, y: 1.6, z: 10}, .9);
    policy.perceive({time: 1.6, self, visible: null}); policy.command(self, 1.6);
    expect(policy.decisionSnapshot(1.6).flankPlan?.lane).toBe('4:0');
    policy.teammateCallout({x: -10, y: 1.6, z: 10}, 2);
    policy.perceive({time: 2.7, self, visible: null}); policy.command(self, 2.7);
    expect(policy.decisionSnapshot(2.7).flankPlan?.lane).toBe('-4:0');
    policy.perceive({time: 3, self, visible: {id: 0, aimPoint: point, position: point}}); policy.command(self, 3);
    policy.perceive({time: 3.7, self, visible: {id: 0, aimPoint: point, position: point}}); policy.command(self, 3.7);
    expect(policy.decisionSnapshot(3.7).gazeOwner).toBe('combat');
    expect(policy.phase).toMatch(/attack|brake/);
  });

  it('trade willingness changes feasible trade commitment, not assigned timing, recognition or crouch traits', () => {
    const candidates = Array.from({length: 80}, (_, index) => fixture(index + 1));
    const reluctant = candidates.find(({brain}) => brain.decisionSnapshot().personality.tradeWillingness < .9)!;
    const willing = candidates.find(({brain}) => brain.decisionSnapshot().personality.tradeWillingness > 1.1)!;
    for (const {brain, self, traits} of [reluctant, willing]) {
      const before = {...traits}; brain.phase = 'expose'; brain.activePeek = 'shoulder'; brain['phaseAt'] = 1;
      brain.orderTrade({victimId: 2, generation: 1, source: 'sight', point, observedAt: 0, readyAt: 1,
        expiresAt: 1 + 2 / (gameData.weapons.ak47.speed * UNIT) + .3});
      brain.perceive({time: 1, self, visible: null}); brain.command(self, 1);
      expect(traits).toEqual(before);
    }
    expect(reluctant.brain.activePeek).toBe('shoulder'); expect(willing.brain.activePeek).toBe('quick');
  });
});
