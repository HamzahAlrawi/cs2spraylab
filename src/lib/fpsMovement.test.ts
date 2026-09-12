import { describe, expect, it } from 'vitest';
import { cameraForwardFromYaw, cameraRightFromYaw, distanceBasedPatternScale, scaleRecoilPattern } from './fpsMovement';

const closeTo = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 5);

describe('FPS movement vectors', () => {
  it('moves forward along camera direction after a right turn', () => {
    const yawAfterMouseRight = -Math.PI / 2;
    const forward = cameraForwardFromYaw(yawAfterMouseRight);
    closeTo(forward.x, 1);
    closeTo(forward.z, 0);
  });

  it('keeps right strafe perpendicular to forward', () => {
    const yaw = -Math.PI / 2;
    const forward = cameraForwardFromYaw(yaw);
    const right = cameraRightFromYaw(yaw);
    closeTo(forward.x * right.x + forward.z * right.z, 0);
    closeTo(right.x, 0);
    closeTo(right.z, 1);
  });

  it('scales wall patterns linearly with target distance for angular spray projection', () => {
    expect(distanceBasedPatternScale(5)).toBeGreaterThanOrEqual(0.78);
    expect(distanceBasedPatternScale(10.25)).toBeCloseTo(1.62, 3);
    expect(distanceBasedPatternScale(40)).toBeLessThanOrEqual(2.35);
    expect(distanceBasedPatternScale(13.5)).toBeGreaterThan(distanceBasedPatternScale(7.6));
  });

  it('scales recoil points without changing timing', () => {
    const scaled = scaleRecoilPattern([{ bullet: 1, x: 10, y: 20, timeMs: 90 }], 1.25);
    expect(scaled[0]).toEqual({ bullet: 1, x: 12.5, y: 25, timeMs: 90 });
  });
});
