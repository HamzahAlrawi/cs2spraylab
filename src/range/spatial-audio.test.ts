import {describe, expect, it} from 'vitest';
import {listenerOrientation} from './spatial-audio';

describe('world-space audio listener', () => {
  it('uses the same forward direction as the camera and ballistic model', () => {
    expect(listenerOrientation(0, 0).forward.z).toBe(-1);
    expect(listenerOrientation(Math.PI / 2, 0).forward.x).toBeCloseTo(-1);
    expect(listenerOrientation(0, Math.PI / 4).forward.y).toBeCloseTo(Math.SQRT1_2);
  });
  it('keeps listener up orthogonal during turns and crouch-height changes', () => {
    for (const yaw of [0, .7, Math.PI, 7]) for (const pitch of [-1.3, 0, 1.2]) {
      const {forward: f, up: u} = listenerOrientation(yaw, pitch);
      expect(f.x * u.x + f.y * u.y + f.z * u.z).toBeCloseTo(0);
      expect(Math.hypot(f.x, f.y, f.z)).toBeCloseTo(1);
      expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1);
    }
  });
});
