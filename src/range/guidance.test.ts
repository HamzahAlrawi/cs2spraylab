import {describe, expect, it} from 'vitest';
import {guidanceAngles} from './guidance';
import {DEG} from './actor-physics';
import {direction} from './shot-model';
import {HEAD_HEIGHT} from './drills';
import {recoilView} from './view-recoil';

describe('guidance and physical head trajectory', () => {
  for (const distance of [4, 12, 90]) for (const eye of [46, 55, 64]) {
    it(`centers on the head at ${distance}m and ${eye}u eye height during recoil`, () => {
      const origin = {x: 2, y: eye * .0254, z: distance}, target = {x: -1, y: .5, z: 0};
      const recoil = {yaw: 1.4, pitch: 5.8};
      const guide = guidanceAngles(origin, target, recoil);
      const offset = recoilView(0, 0, recoil);
      const raw = {yaw: guide.yaw - offset.yaw, pitch: guide.pitch - offset.pitch};
      const shot = direction(raw.yaw - recoil.yaw * DEG, raw.pitch + recoil.pitch * DEG);
      const t = -origin.z / shot.z;
      expect(origin.x + shot.x * t).toBeCloseTo(target.x, 9);
      expect(origin.y + shot.y * t).toBeCloseTo(target.y + HEAD_HEIGHT, 9);
      const follow = guidanceAngles(origin, target, recoil, recoil, true);
      const followed = direction(follow.yaw, follow.pitch);
      for (const axis of ['x', 'y', 'z'] as const) expect(followed[axis]).toBeCloseTo(shot[axis], 12);
    });
  }
});

it.each([false, true])('compensates scheduled recoil separately from current camera/crosshair recoil (follow=%s)', follow => {
  const origin = {x: -2, y: 1.2, z: 25}, target = {x: 1, y: 0, z: 0};
  const shotRecoil = {yaw: 1.6, pitch: 6.2}, shown = {yaw: -.5, pitch: 3.1};
  const guide = guidanceAngles(origin, target, shotRecoil, shown, follow);
  const fraction = follow ? 1 : .45;
  const raw = {yaw: guide.yaw + shown.yaw * DEG * fraction, pitch: guide.pitch - shown.pitch * DEG * fraction};
  const ray = direction(raw.yaw - shotRecoil.yaw * DEG, raw.pitch + shotRecoil.pitch * DEG);
  const t = (target.z - origin.z) / ray.z;
  expect(origin.x + ray.x * t).toBeCloseTo(target.x, 10);
  expect(origin.y + ray.y * t).toBeCloseTo(HEAD_HEIGHT, 10);
});
