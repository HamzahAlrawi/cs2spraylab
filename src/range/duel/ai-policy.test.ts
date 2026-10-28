import {describe, expect, it} from 'vitest';
import {arbitrateGaze, firingVeto, type AimIntent} from './aim-intent';
import {TravelProgress} from './travel-progress';
import {tacticalPersonality} from './tactical-personality';
import {createBotTraits} from './skill';

const point = {x: 0, y: 0, z: 0}, goal = {x: 4, y: 0, z: 0};
const intent = (owner: AimIntent['owner'], observedAt = 0, expiresAt = 2): AimIntent =>
  ({owner, point: {...goal}, observedAt, expiresAt, confidence: .7});
const gates = () => ({visible: true, stale: false, recognized: true, settled: true, ammo: 30, reloading: false,
  weaponReady: true, informationPeek: false, disengaging: false, closing: false, inRange: true,
  burstReady: true, firingPhase: true, aligned: true, accurateMovement: true, cycleReady: true});

describe('explicit gaze and firing arbitration', () => {
  it('keeps combat/repeek above travel, clearing and newer audio regardless of offer order', () => {
    const offers = [intent('travel', .9), intent('audio', .9), intent('clearing', .9), intent('repeek')];
    expect(arbitrateGaze(1, offers)?.owner).toBe('repeek');
    offers.unshift(intent('combat'));
    expect(arbitrateGaze(1, offers)?.owner).toBe('combat');
    expect(arbitrateGaze(1, offers.reverse())?.owner).toBe('combat');
  });

  it('expires evidence, rejects future/nonfinite points, and owns its diagnostic point', () => {
    const evidence = intent('combat', 0, 1);
    expect(arbitrateGaze(1, [evidence, intent('audio')])?.owner).toBe('audio');
    expect(arbitrateGaze(1, [intent('combat', 2), {...evidence, point: {...point, x: NaN}}])).toBeNull();
    expect(arbitrateGaze(.5, [{...evidence, expiresAt: NaN}])).toBeNull();
    const chosen = arbitrateGaze(.5, [evidence])!; chosen.point.x = 100;
    expect(evidence.point.x).toBe(4);
  });

  it('lets an eligible confirmed trade interrupt memory, but never current combat', () => {
    const offers = [intent('repeek'), intent('trade', .5)];
    expect(arbitrateGaze(1, offers)?.owner).toBe('trade');
    expect(arbitrateGaze(1, [...offers, intent('combat', .9)])?.owner).toBe('combat');
  });

  it.each([
    [{visible: false}, 'no-sight'], [{visible: false, stale: true}, 'stale-sensor'],
    [{recognized: false}, 'reaction'], [{settled: false}, 'settling'], [{ammo: 0}, 'empty'],
    [{reloading: true}, 'reload'], [{weaponReady: false}, 'weapon-not-ready'],
    [{informationPeek: true}, 'information-peek'], [{disengaging: true}, 'disengage'],
    [{closing: true}, 'closing'], [{inRange: false}, 'range'], [{burstReady: false}, 'burst-recovery'],
    [{firingPhase: false}, 'phase'], [{aligned: false}, 'alignment'],
    [{accurateMovement: false}, 'movement'], [{cycleReady: false}, 'cooldown'],
  ] as const)('reports the firing veto for %j', (change, reason) => {
    expect(firingVeto({...gates(), ...change})).toBe(reason);
    expect(firingVeto(gates())).toBeNull();
  });
});

describe('intent-gated waypoint progress', () => {
  it('never recovers a stationary camper or an arrived/reload hold', () => {
    const progress = new TravelProgress();
    for (let tick = 0; tick < 1280; tick++)
      expect(progress.update(tick / 128, point, goal, goal, false, true).stage).toBe('idle');
  });

  it('detects oscillating/sliding congestion, yields, backs off briefly, and rate-limits replans', () => {
    const progress = new TravelProgress(), replans: number[] = [], stages = new Set<string>();
    for (let tick = 0; tick < 1280; tick++) {
      const time = tick / 128;
      const result = progress.update(time, {...point, z: Math.sin(time * 10)}, goal, goal, true, true);
      stages.add(result.stage); if (result.stage === 'replan') replans.push(time);
    }
    expect(stages).toEqual(new Set(['travel', 'yield', 'backoff', 'replan']));
    expect(replans.length).toBeGreaterThan(1);
    for (let index = 1; index < replans.length; index++) expect(replans[index] - replans[index - 1]).toBeGreaterThanOrEqual(2);
  });

  it('counts slow useful progress, ramp height and new waypoints without false recovery', () => {
    for (const vertical of [false, true]) {
      const progress = new TravelProgress(), target = vertical ? {...point, y: 5} : goal;
      for (let tick = 0; tick < 1000; tick++) {
        const amount = tick / 128 * .2;
        const position = vertical ? {...point, y: amount} : {...point, x: amount};
        expect(progress.update(tick / 128, position, target, target, true, false).stage).toBe('travel');
      }
      expect(progress.snapshot().progress).toBeGreaterThan(1);
      expect(progress.update(8, point, target, {...target, z: 3}, true, false).stalledFor).toBe(0);
    }
  });

  it('resets after intent pauses and never counts time spent holding toward a stall', () => {
    const progress = new TravelProgress();
    progress.update(0, point, goal, goal, true, false);
    progress.update(1, point, goal, goal, false, false);
    expect(progress.update(20, point, goal, goal, true, false).stage).toBe('travel');
    expect(progress.update(20.1, point, goal, goal, true, false).stalledFor).toBeCloseTo(.1);
  });
});

describe('persistent tactical identity', () => {
  it('is deterministic and diverse without changing the existing skill traits', () => {
    const traits = createBotTraits(1, 17, 1), before = {...traits};
    expect(tacticalPersonality(traits, 'holder', 1)).toEqual(tacticalPersonality(traits, 'holder', 1));
    expect(tacticalPersonality(traits, 'holder', 1)).not.toEqual(tacticalPersonality(traits, 'holder', 2));
    expect(traits).toEqual(before);
    expect(tacticalPersonality(traits, 'holder', 1).patience).toBeGreaterThan(tacticalPersonality(traits, 'aggressive', 1).patience);
  });
});
