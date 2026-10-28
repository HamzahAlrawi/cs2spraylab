import {describe, expect, it, vi} from 'vitest';
import {STEP} from '../actor-physics';
import {testArena, type Arena} from './geometry';
import * as navigation from './navigation';
import {createBotTraits} from './skill';
import {randomStream} from './rng';
import {TacticalBrain} from './tactics';
import type {DuelActorSnapshot} from './types';
import type {VisibleEnemy} from './perception';

const home = {x: 0, y: 0, z: 0}, point = {x: 0, y: 1.6, z: -8};
const actor = (): DuelActorSnapshot => ({id: 2, generation: 1, side: 'enemy', position: {...home, y: 1.6}, feet: 0,
  grounded: true, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
function fixture(staticHold = false) {
  const arena: Arena = {...testArena(), solids: [], lanes: [{side: 1, role: 'camp', anchor: home,
    edge: staticHold ? home : {x: 2, y: 0, z: 0}, retreat: home, watch: point}]};
  if (staticHold) arena.native = {ray: () => undefined, fits: () => true,
    sweep: () => {throw new Error('Static hold must not request a sweep');},
    vertical: (_position, from) => ({feet: from, grounded: true, ceiling: false})};
  const brain = new TacticalBrain({...createBotTraits(8, 19, 2), recognitionMedianMs: 200, motorSettlingMs: 150,
    endpointErrorDegrees: 0, preaimErrorDegrees: 0, lowAimTendency: 0, stopTendency: 1},
    'holder', 1, randomStream(19, 'research-tactics'), arena, 8, 'ak47', 2);
  return {brain, self: actor(), arena};
}
const see = (brain: TacticalBrain, self: DuelActorSnapshot, time: number, visible: VisibleEnemy | null =
  {id: 0, position: point, aimPoint: point}) => brain.perceive({time, self, visible});

describe('research tactical arbitration integration', () => {
  it('keeps visible threat gaze through reaction, braking, deliberate retreat and travel', () => {
    for (const phase of ['approach', 'setup', 'push', 'investigate', 'expose', 'return'] as const) {
      const {brain, self} = fixture(); brain.phase = phase;
      see(brain, self, 0); const command = brain.command(self, 0);
      expect(brain.decisionSnapshot(0).gazeOwner, phase).toBe('combat');
      expect(brain.decisionSnapshot(0).aimIntent?.point).toEqual(point);
      expect(brain.decisionSnapshot(0).fireBlockedReason).toBe('reaction');
      expect(command.fireHeld).toBe(false);
    }
  });

  it('holds a recent re-peek above newer hostile audio and never fires on stale sight', () => {
    const {brain, self} = fixture();
    see(brain, self, 0); brain.command(self, 0);
    brain.hear({x: 8, y: 0, z: 0}, .1, 'gunshot', false);
    brain.command(self, .4);
    expect(brain.decisionSnapshot(.4)).toMatchObject({gazeOwner: 'repeek', fireBlockedReason: 'stale-sensor', sensorAge: .4});
    expect(brain.decisionSnapshot(.4).aimIntent?.point).toEqual(point);
    see(brain, self, .5, null); expect(brain.command(self, .5).fireHeld).toBe(false);
    expect(brain.decisionSnapshot(.5).gazeOwner).toBe('repeek');
    brain.command(self, .8); expect(brain.decisionSnapshot(.8).gazeOwner).toBe('audio');
  });

  it('reports readiness, information peeks and disengagement without relaxing the shot gates', () => {
    const {brain, self} = fixture();
    see(brain, self, 0); brain.command(self, 0);
    see(brain, self, .6);
    expect(brain.command(self, .6, undefined, [], {weaponReadyAt: 1}).fireHeld).toBe(false);
    expect(brain.decisionSnapshot(.6).fireBlockedReason).toBe('weapon-not-ready');
    for (const peek of ['shoulder', 'jump'] as const) {
      brain.phase = 'expose'; brain.activePeek = peek; see(brain, self, .61);
      expect(brain.command(self, .61).fireHeld).toBe(false);
      expect(brain.decisionSnapshot(.61)).toMatchObject({gazeOwner: 'combat', fireBlockedReason: 'information-peek'});
    }
    brain.phase = 'return'; brain.activePeek = 'quick'; self.position.x = 3;
    brain['phaseAt'] = .61; brain['forceReposition'] = true;
    see(brain, self, .62); brain.command(self, .62);
    expect(brain.phase).toBe('return');
    expect(brain.decisionSnapshot(.62).fireBlockedReason).toBe('disengage');
  });

  it('retains weapon-selected visible aim points after an elapsed spray while supporting legacy observations', () => {
    for (const candidate of [false, true]) {
      const {brain, self} = fixture();
      const body = {...point, y: 1};
      const visible: VisibleEnemy = {id: 0, position: point, aimPoint: point, bodyPoint: body,
        ...(candidate ? {aimCandidate: {point, group: 'head' as const, exposure: 1, exposureMargin: .1, observedAt: .6}} : {})};
      see(brain, self, 0, visible); brain.command(self, 0);
      brain.phase = 'attack'; brain['attackFiredAt'] = .2; brain['attackShots'] = 1;
      brain['attackWait'] = 2; brain['attackRounds'] = 20;
      see(brain, self, .6, visible); brain.command(self, .6);
      expect(brain.decisionSnapshot(.6).aimIntent?.point).toEqual(candidate ? point : body);
    }
  });

  it('preserves deliberate low aim even when perception offers a head candidate', () => {
    const {brain, self} = fixture(), bodyPoint = {...point, y: 1};
    const visible: VisibleEnemy = {id: 0, position: point, aimPoint: point, bodyPoint,
      aimCandidate: {point, group: 'head', exposure: 1, exposureMargin: .1, observedAt: 0}};
    see(brain, self, 0, visible); brain['bodyAim'] = true; brain.command(self, 0);
    expect(brain.decisionSnapshot(0).aimIntent?.point).toEqual(bodyPoint);
  });

  it('leaves static camping/reload waits alone, including beside a teammate', () => {
    const {brain, self} = fixture(true), peer = {...actor(), id: 1, position: {...self.position, x: .5}};
    for (let tick = 0; tick < 4 / STEP; tick++) {
      const time = tick * STEP; see(brain, self, time, null);
      const command = brain.command(self, time, undefined, [peer]);
      expect(command.forward).toBeCloseTo(0); expect(command.side).toBeCloseTo(0);
      expect(brain.decisionSnapshot(time).routeProgress.stage).toBe('idle');
    }
    self.ammo = 0; self.reloading = true;
    brain.command(self, 4.1, undefined, [peer]);
    expect(brain.decisionSnapshot(4.1)).toMatchObject({fireBlockedReason: 'reload', routeProgress: {stage: 'idle'}});
  });

  it('recovers a corner/door wedge through collision-tested input without changing task, gaze, position or velocity', () => {
    const {brain, self, arena} = fixture();
    const goal = {x: 6, y: 0, z: 0}, peer = {...actor(), id: 1, position: {...self.position, x: .8}};
    const before = structuredClone(self), clear = vi.spyOn(navigation, 'clearSegment').mockReturnValue(false);
    try {
      for (let tick = 0; tick < 2.5 / STEP; tick++) {
        brain['recoverTravel'](self, goal, goal, tick * STEP, true, [peer]);
      }
      expect(clear.mock.calls.length).toBeLessThanOrEqual(6);
      expect(brain.decisionSnapshot().routeProgress.stage).toMatch(/travel|replan/);
      expect(brain.phase).toBe('approach'); expect(self).toEqual(before);
      expect(arena.lanes![0].anchor).toEqual(home);
      const blocked = brain['recoverTravel'](self, goal, goal, 4, true, [peer]);
      if (blocked) expect(blocked).toEqual(self.position);
    } finally {clear.mockRestore();}
  });

  it('keeps visible threat gaze during doorway yield/backoff and resumes the original peek', () => {
    const {brain, self} = fixture(), before = structuredClone(self);
    const peer = {...actor(), id: 1, position: {...self.position, x: .8}};
    brain.phase = 'expose'; brain.activePeek = 'shoulder';
    const stages = new Set<string>(); let backedOff = false, resumed = false;
    for (let tick = 0; tick < 2.6 / STEP; tick++) {
      const time = tick * STEP; see(brain, self, time);
      const command = brain.command(self, time, undefined, [peer]);
      const decision = brain.decisionSnapshot(time);
      stages.add(decision.routeProgress.stage);
      expect(decision.gazeOwner).toBe('combat'); expect(command.fireHeld).toBe(false);
      expect(brain.phase).toBe('expose');
      backedOff ||= decision.routeProgress.stage === 'backoff' && (command.side ?? 0) < -.5;
      resumed ||= backedOff && decision.routeProgress.stage === 'travel' && (command.side ?? 0) > 0;
      expect(Math.hypot(command.forward ?? 0, command.side ?? 0)).toBeLessThanOrEqual(1.000001);
    }
    expect(stages).toContain('yield'); expect(stages).toContain('replan');
    expect(backedOff).toBe(true); expect(resumed).toBe(true);
    expect(self).toEqual(before);
  });

  it('suspends stuck accounting across an airborne jump link and resumes the same goal', () => {
    const {brain, self} = fixture(), goal = {x: 6, y: 2, z: 0};
    self.grounded = false;
    for (let tick = 0; tick < 400; tick++) brain['recoverTravel'](self, goal, goal, tick * STEP, true, []);
    expect(brain.decisionSnapshot().routeProgress.stage).toBe('idle');
    self.grounded = true; brain['recoverTravel'](self, goal, goal, 4, true, []);
    expect(brain.decisionSnapshot().routeProgress).toMatchObject({stage: 'travel', stalledFor: 0});
  });
});
