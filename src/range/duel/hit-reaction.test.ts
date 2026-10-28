import {describe, expect, it} from 'vitest';
import {HIT_REACTION_LIMITS, sampleHitReaction, type HitReactionEvent, type HitReactionRegion} from './hit-reaction';

const regions: HitReactionRegion[] = ['head', 'chest', 'stomach', 'arm', 'leg'];
const hit = (overrides: Partial<HitReactionEvent> = {}): HitReactionEvent =>
  ({time: 10, region: 'chest', actorYaw: 0, incoming: {x: 0, z: 1}, ...overrides});
const magnitude = (v: {x: number; y: number; z: number}) => Math.hypot(v.x, v.y, v.z);
const neutral = () => sampleHitReaction([], 10);

describe('presentation-only absolute-time hit reactions', () => {
  it.each(regions)('%s starts immediately, decays quickly and settles exactly', region => {
    const events = [hit({region})];
    expect(sampleHitReaction(events, 9.999)).toEqual(neutral());
    const onset = sampleHitReaction(events, 10);
    expect(magnitude(onset.spine.rotation)).toBeGreaterThan(0);
    expect(magnitude(sampleHitReaction(events, 10.1).spine.rotation))
      .toBeLessThan(magnitude(onset.spine.rotation) * .31);
    expect(sampleHitReaction(events, 10.22)).toEqual(neutral());
    expect(sampleHitReaction(events, 100)).toEqual(neutral());
  });

  it('gives head hits a distinct snap; a helmet attenuates and shortens only head reactions', () => {
    const head = sampleHitReaction([hit({region: 'head'})], 10);
    for (const region of regions.filter(region => region !== 'head')) {
      const body = sampleHitReaction([hit({region})], 10);
      expect(magnitude(head.head.rotation)).toBeGreaterThan(magnitude(body.head.rotation) * 4);
      expect(sampleHitReaction([hit({region, helmet: true})], 10)).toEqual(body);
    }
    const helmet = [hit({region: 'head', helmet: true})];
    expect(magnitude(sampleHitReaction(helmet, 10).head.rotation)).toBeCloseTo(.16 * .65);
    expect(sampleHitReaction(helmet, 10.17)).toEqual(neutral());
    expect(magnitude(sampleHitReaction([hit({region: 'head'})], 10.17).head.rotation)).toBeGreaterThan(0);
  });

  it('distinguishes stomach/leg pelvis movement and lateral arm twist from chest', () => {
    const pelvis = (region: HitReactionRegion) => sampleHitReaction([hit({region})], 10).pelvis;
    expect(magnitude(pelvis('stomach').rotation)).toBeGreaterThan(magnitude(pelvis('chest').rotation));
    expect(pelvis('leg').position.y).toBeLessThan(pelvis('stomach').position.y);
    const twist = (region: HitReactionRegion) =>
      sampleHitReaction([hit({region, incoming: {x: 1, z: 0}})], 10).spine.rotation.y;
    expect(twist('arm')).toBeGreaterThan(twist('chest'));
  });

  it('resolves front/back and left/right travel in actor-local coordinates', () => {
    const front = sampleHitReaction([hit()], 10);
    const rear = sampleHitReaction([hit({incoming: {x: 0, z: -1}})], 10);
    expect(front.spine.rotation.x).toBeGreaterThan(0);
    expect(rear.spine.rotation.x).toBe(-front.spine.rotation.x);
    expect(front.spine.position.z).toBeGreaterThan(0);
    const right = sampleHitReaction([hit({incoming: {x: 1, z: 0}})], 10);
    const left = sampleHitReaction([hit({incoming: {x: -1, z: 0}})], 10);
    expect(right.head.rotation.z).toBeLessThan(0);
    expect(left.head.rotation.z).toBe(-right.head.rotation.z);
    expect(right.pelvis.position.x).toBeGreaterThan(0);
    const turned = sampleHitReaction([hit({actorYaw: Math.PI / 2, incoming: {x: 1, z: 0}})], 10);
    expect(turned.spine.rotation.x).toBeCloseTo(front.spine.rotation.x);
    expect(turned.spine.rotation.z).toBeCloseTo(0);
    const wrapped = sampleHitReaction([hit({actorYaw: Math.PI * 2})], 10);
    expect(wrapped.spine.rotation.x).toBeCloseTo(front.spine.rotation.x);
    expect(sampleHitReaction([hit({incoming: {x: 0, z: 100}})], 10)).toEqual(front);
  });

  it('caps dense repeated hits by joint vector magnitude, including diagonal impacts', () => {
    const events = Array.from({length: 500}, (_, index) => hit({
      time: 10 + (index % 4) * .001, region: regions[index % regions.length], incoming: {x: 1, z: 1},
    }));
    for (const time of [10, 10.004, 10.05, 10.15]) {
      const pose = sampleHitReaction(events, time);
      for (const joint of ['pelvis', 'spine', 'head'] as const) {
        expect(magnitude(pose[joint].rotation)).toBeLessThanOrEqual(HIT_REACTION_LIMITS[joint].rotation + 1e-12);
        expect(magnitude(pose[joint].position)).toBeLessThanOrEqual(HIT_REACTION_LIMITS[joint].position + 1e-12);
      }
    }
    expect(magnitude(sampleHitReaction(events, 10.004).head.rotation)).toBeCloseTo(.20);
    expect(sampleHitReaction(events, 11)).toEqual(neutral());
  });

  it('never integrates across repeated, out-of-order or mutated-result queries', () => {
    const events = [hit(), hit({region: 'head', time: 10.05})];
    const original = structuredClone(events);
    const expected = sampleHitReaction(events, 10.08);
    for (const time of [11, 10.08, 9, 10.01, 10.2, 10.08]) sampleHitReaction(events, time);
    expect(sampleHitReaction(events, 10.08)).toEqual(expected);
    const changed = sampleHitReaction(events, 10.08);
    changed.head.rotation.x = 999;
    expect(sampleHitReaction(events, 10.08)).toEqual(expected);
    expect(events).toEqual(original);
    expect(sampleHitReaction(events, 10.01)).toEqual(sampleHitReaction([events[0]], 10.01));
    expect(sampleHitReaction([hit({time: 110})], 110.08).spine.rotation.x)
      .toBeCloseTo(sampleHitReaction([hit()], 10.08).spine.rotation.x);
  });

  it('ignores invalid timestamps, yaw and degenerate directions without emitting NaNs', () => {
    for (const time of [NaN, Infinity, -Infinity]) expect(sampleHitReaction([hit()], time)).toEqual(neutral());
    const invalid = [hit({time: NaN}), hit({time: Infinity}), hit({actorYaw: NaN}),
      hit({incoming: {x: 0, z: 0}}), hit({incoming: {x: Infinity, z: 1}}),
      hit({incoming: {x: NaN, z: 1}})];
    expect(sampleHitReaction(invalid, 10)).toEqual(neutral());
    expect(sampleHitReaction([...invalid, hit()], 10)).toEqual(sampleHitReaction([hit()], 10));
  });
});
