import {describe, expect, it} from 'vitest';
import {deathCameraGoal} from './death-camera';

describe('death chase camera', () => {
  const focus = {x: 0, y: .4, z: 0};
  it('uses the native chase distance when the space behind the victim is clear', () => {
    const goal = deathCameraGoal(focus, 0, (_, to) => to);
    expect(goal.x).toBe(0); expect(goal.y).toBeCloseTo(.95); expect(goal.z).toBeCloseTo(76 * .0254);
  });
  it('orbits to an open side rather than showing a wall at point-blank range', () => {
    const result = deathCameraGoal(focus, 0, (_, to) => to.z > .2 ? {...to, z: .2, x: to.x * .1} : to);
    expect(Math.abs(result.x)).toBeGreaterThan(1.8); expect(result.z).toBeLessThanOrEqual(.2);
  });
  it('keeps a finite clipped goal when every side is blocked', () => {
    expect(deathCameraGoal(focus, 2, () => focus).toArray()).toEqual([0, .4, 0]);
  });
});
