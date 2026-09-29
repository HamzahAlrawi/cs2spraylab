import {describe, expect, it} from 'vitest';
import {STEP} from './actor-physics';
import {defaults, sanitizeSettings} from './config';
import {Simulation} from './simulation';
import {MovementLesson, demonstrationInput, demonstrationLesson} from './lesson-model';
import {FOOTSTEP_RANGE, curveGain, footstepGain, sampleIndex} from './sound-model';

describe('interactive movement lessons', () => {
  it.each([0, 1, 2])('demonstrates lesson %s without teleporting or bypassing the shot conditions', lesson => {
    const model = demonstrationLesson(lesson);
    for (let tick = 0; tick < 128 && !model.complete; tick++) {
      const x = model.x;
      model.update(STEP, demonstrationInput(model));
      expect(Math.abs(model.x - x)).toBeLessThanOrEqual(model.cap * STEP + 1e-8);
      if (model.time > .4 && model.settled && model.aligned) model.shoot();
    }
    expect(model.complete).toBe(true);
    expect(model.peak).toBeGreaterThan(model.cap * .65);
    expect(model.time - model.counterAt).toBeLessThan(.45);
  });
  it('rejects stationary, moving and covered shots with distinct advice', () => {
    const model = new MovementLesson(2);
    model.shoot(); expect(model.message).toContain('wall');
    model.x = 0; model.shoot(); expect(model.message).toContain('no counter-strafe');
    model.velocity = model.cap; model.shoot(); expect(model.message).toContain('still moving');
    expect(model.complete).toBe(false);
  });
});

describe('transfer configuration', () => {
  it('transfers on the configured bullet, limited to the current burst', () => {
    const sim = new Simulation({...defaults, mode: 'transfer', transferAfter: 7});
    expect(sim.targetForShot(6)).toBe(0); expect(sim.targetForShot(7)).toBe(1);
    sim.settings.burst = 5;
    expect(sim.targetForShot(3)).toBe(0); expect(sim.targetForShot(4)).toBe(1);
  });
  it('waits for actual damage to kill the first target, then resets its health for another attempt', () => {
    const sim = new Simulation({...defaults, mode: 'transfer', transferRule: 'kill', weapon: 'ak47'});
    sim.start();
    expect(sim.targetForShot(29)).toBe(0);
    sim.damageTarget(0, false, 12);
    expect(sim.targetHealth[0]).toBeGreaterThan(0); expect(sim.targetForShot(29)).toBe(0);
    sim.damageTarget(0, true, 12);
    expect(sim.targetHealth[0]).toBe(0); expect(sim.targetForShot(1)).toBe(1);
    sim.release('mouse'); sim.advance(.5); sim.start();
    expect(sim.targetHealth).toEqual([100, 100]); expect(sim.targetForShot()).toBe(0);
  });
  it('sanitizes transfer settings and uses mode-specific spread defaults without overriding an explicit choice', () => {
    expect(sanitizeSettings({transferAfter: 999, transferRule: 'bad'})).toMatchObject({transferAfter: 149, transferRule: 'bullet'});
    expect(sanitizeSettings({mode: 'guided'}).spread).toBe(false);
    expect(sanitizeSettings({mode: 'peek'}).spread).toBe(true);
    expect(sanitizeSettings({mode: 'guided', spread: true}).spread).toBe(true);
  });
});

describe('native audio event model', () => {
  it('range running emits steps, shift walking stays quiet, and jumping produces one landing', () => {
    const run = (walk: boolean) => {
      const sim = new Simulation({...defaults, mode: 'guided'}), sounds: boolean[] = [];
      sim.position.z = -60; sim.active = true; sim.onSound = landing => sounds.push(landing);
      sim.input.forward = 1; sim.input.walk = walk;
      for (let i = 0; i < 128; i++) sim.step(STEP);
      return {sim, sounds};
    };
    expect(run(true).sounds).toHaveLength(0);
    const {sim, sounds} = run(false); expect(sounds.length).toBeGreaterThan(1);
    sim.input.forward = 0; sim.input.jump = true;
    for (let i = 0; i < 128; i++) sim.step(STEP);
    expect(sounds.filter(landing => landing)).toHaveLength(1);
  });
  it('varies samples without immediately repeating and handles single-sample events', () => {
    for (let previous = 0; previous < 4; previous++) for (const random of [0, .2, .5, .999]) {
      const result = sampleIndex(4, previous, random);
      expect(result).not.toBe(previous); expect(result).toBeGreaterThanOrEqual(0); expect(result).toBeLessThan(4);
    }
    expect(sampleIndex(1, 0, .5)).toBe(0);
    expect(new Set([0, .3, .6, .99].map(r => sampleIndex(4, undefined, r))).size).toBe(4);
  });
  it('interpolates native attenuation knots and cuts off at 1100 Source units', () => {
    expect(curveGain(5, [[0, 1], [10, 0]])).toBe(.5);
    expect(curveGain(2, [])).toBe(1);
    expect(FOOTSTEP_RANGE).toBeCloseTo(27.94);
    expect(footstepGain(24)).toBeGreaterThan(.1);
    expect(footstepGain(FOOTSTEP_RANGE)).toBe(0);
    expect(footstepGain(40)).toBe(0);
  });
});
