import {describe, expect, it} from 'vitest';
import {bodyYawDelta, BodyTurnTimeline, LowerBodyTurn, type BodyTurnActor} from './body-turn';

const actor = (): BodyTurnActor => ({id: 1, generation: 1, alive: true, yaw: 0, velocity: {x: 0, z: 0}, grounded: true, duckAmount: 0});
describe('bounded lower body presentation', () => {
  it('handles velocity-based start, stop and reversal with bounded transition lifetimes', () => {
    const turn = new LowerBodyTurn(), a = actor(); turn.update(a, 0);
    a.velocity.x = 5; turn.update(a, 1 / 128); expect(turn.phase).toBe('start');
    for (let n = 0; n < 30; n++) turn.update(a, 1 / 128); expect(turn.phase).toBe('move');
    a.velocity.x = -5; turn.update(a, 1 / 128); expect(turn.phase).toBe('reverse');
    for (let n = 0; n < 30; n++) turn.update(a, 1 / 128); expect(turn.phase).toBe('move');
    a.velocity.x = 0; turn.update(a, 1 / 128); expect(turn.phase).toBe('stop');
    for (let n = 0; n < 30; n++) turn.update(a, 1 / 128); expect(turn.phase).toBe('idle');
  });
  it('turns across wrap, bounds spine lag, and never advances for zero-dt queries', () => {
    const turn = new LowerBodyTurn(), a = {...actor(), yaw: Math.PI - .02}; turn.update(a, 0);
    a.yaw = -Math.PI + .02; const yaw = turn.update(a, 1 / 128);
    expect(Math.abs(bodyYawDelta(yaw, a.yaw))).toBeLessThan(.05);
    a.yaw = 0; turn.update(a, 1 / 128);
    expect(Math.abs(bodyYawDelta(a.yaw, turn.bodyYaw))).toBeLessThanOrEqual(Math.PI / 4 + 1e-10);
    expect(turn.update(a, 0)).toBe(turn.bodyYaw);
    a.generation++; expect(turn.update(a, 0)).toBe(a.yaw);
  });
  it('samples absolute time independently of duplicate shots, render-ahead and sensor call ordering', () => {
    const timeline = new BodyTurnTimeline(), a = actor(); timeline.record(a, 0);
    const samples: BodyTurnActor[] = [];
    for (let n = 1; n <= 100; n++) {a.yaw = n / 100; timeline.record(a, n / 128); samples.push(structuredClone(a));}
    const query = samples[49], time = 50 / 128, before = timeline.sample(query, time);
    timeline.sample(samples[99], 101 / 128); timeline.sample(samples[24], 25 / 128);
    timeline.record(samples[99], 100 / 128);
    expect(timeline.sample(query, time)).toBe(before); expect(timeline.sample(query, time)).toBe(before);
    expect(timeline.sample({...query, generation: 2}, time)).toBe(query.yaw);
    expect(timeline.sample(query, -1)).toBe(query.yaw);
  });
  it('keeps pre-movement sensors on the previous tick and clamps a same-tick aim change without a write', () => {
    const timeline = new BodyTurnTimeline(), a = actor(); timeline.record(a, 0);
    const before = timeline.sample(a, 0), next = {...a, yaw: 1};
    timeline.sample(next, 1 / 128); timeline.record(next, 1 / 128);
    expect(timeline.sample(a, 0)).toBe(before);
    const changed = {...next, yaw: Math.PI};
    expect(Math.abs(bodyYawDelta(changed.yaw, timeline.sample(changed, 1 / 128)))).toBeLessThanOrEqual(Math.PI / 4 + 1e-10);
    expect(timeline.sample(a, 0)).toBe(before);
  });
});
