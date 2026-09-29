import {describe, expect, it} from 'vitest';
import {RoundFlow, deathView, deathFeet} from './round-flow';
import {sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';

describe('continuous duel sessions', () => {
  it('restarts only after a finished round and respects a 1-3 second delay', () => {
    const flow = new RoundFlow();
    expect(flow.advance(.25, false, 1)).toBe(false);
    for (const delay of [1, 2, 3]) {
      flow.finish();
      for (let frame = 0; frame < delay * 4 - 1; frame++) expect(flow.advance(.25, false, delay)).toBe(false);
      expect(flow.remaining(delay)).toBeCloseTo(.25);
      expect(flow.advance(.25, false, delay)).toBe(true);
      flow.reset(); expect(flow.ending).toBe(false);
    }
  });
  it('freezes the countdown on pause and does not skip it after a suspended tab', () => {
    const flow = new RoundFlow(); flow.finish();
    flow.advance(.25, false, 2);
    expect(flow.advance(90, true, 2)).toBe(false);
    expect(flow.remaining(2)).toBe(1.75);
    expect(flow.advance(90, false, 2)).toBe(false);
    expect(flow.remaining(2)).toBe(1.5);
  });
  it('loads health independently for the player and bots with bounded legacy defaults', () => {
    expect(sanitizeDuelConfig({}).playerHealth).toBe(100);
    const sim = new DuelSimulation(sanitizeDuelConfig({playerHealth: 275, health: 60}));
    expect(sim.snapshot().map(actor => actor.health)).toEqual([275, 60]);
    expect(sanitizeDuelConfig({playerHealth: NaN, feedbackSeconds: 10}).playerHealth).toBe(100);
    expect(sanitizeDuelConfig({playerHealth: 600, feedbackSeconds: 10})).toMatchObject({playerHealth: 500, feedbackSeconds: 3});
  });
  it('lowers the death camera smoothly and settles without a looping fall', () => {
    let height = 1.6256;
    for (let frame = 0; frame < 180; frame++) {
      const view = deathView(frame / 60, 1.6256);
      expect(view.height).toBeLessThanOrEqual(height + 1e-8);
      expect(view.height).toBeGreaterThanOrEqual(.28 - 1e-8);
      height = view.height;
    }
    expect(height).toBeCloseTo(.28);
    expect(deathView(2, 1.6256)).toEqual(deathView(3, 1.6256));
  });
  it('settles dead bodies and the player camera on cover instead of falling through it', () => {
    const cover = [{center: {x: 0, y: .5, z: 0}, size: {x: 2, y: 1, z: 2}}];
    const actor = {position: {x: 0, y: 2.6256, z: 0}, feet: 1};
    expect(deathFeet(actor, 3, cover)).toBe(1);
    expect(deathFeet({...actor, feet: 2}, .1, cover)).toBeGreaterThan(1);
    expect(deathFeet({...actor, feet: 2}, 3, cover)).toBe(1);
    expect(deathFeet({...actor, position: {x: 4, y: 3, z: 0}}, 3, cover)).toBe(0);
    expect(deathFeet({...actor, feet: 0}, 3, cover)).toBe(0);
  });
});
