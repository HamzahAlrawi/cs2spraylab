import {describe, expect, it} from 'vitest';
import {UNIT} from '../actor-physics';
import {StepView} from './step-view';

const actor = (feet = 0, eye = 64 * UNIT) => ({position: {x: 0, y: feet + eye, z: 0}, feet,
  grounded: true, alive: true, generation: 0});

describe('native-map stair presentation', () => {
  it.each([1, -1])('approaches a %s-direction step at 150u/s without changing the actor', sign => {
    const view = new StepView(); view.update(actor(), 0);
    const a = actor(sign * 18 * UNIT), copy = structuredClone(a);
    const y = view.update(a, .02);
    expect(y).toBeCloseTo((64 + sign * 3) * UNIT, 10);
    expect(a).toEqual(copy);
    expect(view.update(a, .12)).toBeCloseTo(a.position.y, 10);
  });
  it('caps lag at one step and does not carry it into jumping, ducking, support movement or respawns', () => {
    const view = new StepView(); view.update(actor(), 0);
    const upper = actor(40 * UNIT);
    expect(upper.position.y - view.update(upper, .001)).toBeCloseTo(18 * UNIT, 10);
    const airborne = {...upper, grounded: false};
    expect(view.update(airborne, .01)).toBe(airborne.position.y);
    view.reset(); view.update(actor(), 0);
    const crouched = actor(10 * UNIT, 60 * UNIT);
    expect(view.update(crouched, .01)).toBe(crouched.position.y);
    const carried = {...actor(20 * UNIT), supportingActor: 1};
    expect(view.update(carried, .01)).toBe(carried.position.y);
    const respawn = {...actor(4), generation: 1};
    expect(view.update(respawn, .01)).toBe(respawn.position.y);
  });
  it('resets for teleporting and death and never smooths horizontal input', () => {
    const view = new StepView(); view.update(actor(), 0);
    const moved = {...actor(10 * UNIT), position: {x: 5, y: 74 * UNIT, z: 0}};
    expect(view.update(moved, .01)).toBe(moved.position.y);
    expect(moved.position.x).toBe(5);
    expect(view.update({...actor(20 * UNIT), alive: false}, .01)).toBe(84 * UNIT);
  });
});
