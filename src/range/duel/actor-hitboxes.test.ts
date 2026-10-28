import {describe, expect, it} from 'vitest';
import {Bone, Group, Matrix4, Quaternion, Vector3} from 'three';
import {UNIT} from '../actor-physics';
import {NativeActorHitboxes, nativeActorCapsules, type ActorHitPose} from './actor-hitboxes';
import {rayCapsuleInterval, traceActor} from './geometry';
import {randomStream} from './rng';

const p = (x = 0, y = 0, z = 0) => ({x, y, z});
const head = (point0 = p(0, 1.6), point1 = p(0, 1.7), radius = 4.3 * UNIT): ActorHitPose =>
  ({capsules: [{point0, point1, radius, group: 'head'}]});

describe('native bone-attached actor capsules', () => {
  it('retains all 19 original Source capsules without widening the head', () => {
    expect(nativeActorCapsules).toHaveLength(19);
    expect(nativeActorCapsules[0]).toEqual({bone: 'head_0', radius: 4.3, point0: [-1, 1.8, 0], point1: [3.5, .2, 0], group: 'head'});
    const root = new Group();
    for (const definition of nativeActorCapsules) {const bone = new Bone(); bone.name = definition.bone; root.add(bone);}
    root.updateMatrixWorld(true);
    const hitboxes = new NativeActorHitboxes(root);
    expect(hitboxes.pose.capsules).toHaveLength(19);
    expect(hitboxes.pose.capsules[0].radius).toBeCloseTo(.10922, 8);
    expect(hitboxes.pose.capsules[0].point0).toEqual(p(-UNIT, 1.8 * UNIT));
    expect(hitboxes.pose.capsules[0].point1).toEqual(p(3.5 * UNIT, .2 * UNIT));
  });

  it('captures real transformed bone poses and keeps all objects stable between updates', () => {
    const root = new Group(), bone = new Bone(); bone.name = 'head_0'; bone.position.y = 1.6; root.add(bone);
    root.position.set(3, 4, -17); root.rotation.y = .8; root.updateMatrixWorld(true);
    const hitboxes = new NativeActorHitboxes(root), first = hitboxes.pose.capsules[0];
    const startPoint = first.point0, oldHead = hitboxes.headPoint()!;
    bone.rotation.x = .6; bone.position.y -= .45; root.position.z -= 2; root.updateMatrixWorld(true);
    expect(hitboxes.capture()).toBe(hitboxes.pose); expect(hitboxes.pose.capsules[0]).toBe(first);
    expect(first.point0).toBe(startPoint);
    expect(new Vector3().copy(oldHead).distanceTo(new Vector3().copy(hitboxes.headPoint()!))).toBeGreaterThan(2);
    const expected = new Vector3(-UNIT, 1.8 * UNIT, 0).applyMatrix4(bone.matrixWorld);
    expect(new Vector3().copy(first.point0).distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('preserves source radius under actor scaling without multiplying units twice', () => {
    const root = new Group(), bone = new Bone(); bone.name = 'head_0'; root.add(bone); root.scale.setScalar(1.5);
    root.updateMatrixWorld(true); const hitboxes = new NativeActorHitboxes(root);
    expect(hitboxes.pose.capsules[0].radius).toBeCloseTo(4.3 * UNIT * 1.5);
    expect(hitboxes.pose.capsules[0].point1.x).toBeCloseTo(3.5 * UNIT * 1.5);
  });

  it('does not invent a hit sphere for an empty or incomplete presented skeleton', () => {
    const hitboxes = new NativeActorHitboxes(new Group());
    expect(hitboxes.headPoint()).toBeUndefined(); expect(hitboxes.pose.capsules).toEqual([]);
    expect(traceActor(p(0, 1.62, 10), p(0, 0, -1), p(), false, Infinity, 0, hitboxes.pose).group).toBeUndefined();
    expect(traceActor(p(0, 1.62, 10), p(0, 0, -1), p(), false).group).toBe('head');
  });

  it('hits a measured live pitched running head rather than the zero-pitch proxy', () => {
    // Imported native SAS / run-strafe, duck=.25, yaw=pi/2, pitch=.6.
    const visible = p(-.4094973977, 1.3047887375, -14.9982545947);
    const pose = head(p(-.3739859225, 1.2888671003, -15.0167666682), p(-.4406529588, 1.3881036946, -15.0373507243));
    const origin = p(0, 64 * UNIT), direction = new Vector3().copy(visible).sub(new Vector3().copy(origin)).normalize();
    expect(traceActor(origin, direction, p(0, 0, -15), .25, 20, Math.PI / 2).group).toBeUndefined();
    expect(traceActor(origin, direction, p(0, 0, -15), .25, 20, Math.PI / 2, pose).group).toBe('head');
  });

  it('respects the native narrow head edge and actual map/world altitude at every range', () => {
    for (const range of [5, 15, 50, 100]) for (const altitude of [0, 3, 10]) {
      const pose = head(p(1, altitude + 1.6, -range), p(1, altitude + 1.7, -range));
      expect(traceActor(p(1, altitude + 1.65), p(0, 0, -1), p(1, altitude, -range), 0, range + 1, 0, pose).group).toBe('head');
      expect(traceActor(p(1 + .110, altitude + 1.65), p(0, 0, -1), p(1, altitude, -range), 0, range + 1, 0, pose).group).toBeUndefined();
    }
  });

  it('uses the closest actual capsule and does not substitute boxes through arm/leg gaps', () => {
    const pose: ActorHitPose = {capsules: [
      {point0: p(-.2, 1.2, -4), point1: p(.2, 1.2, -4), radius: .15, group: 'chest'},
      {point0: p(.4, .7, -4), point1: p(.4, 1.3, -4), radius: .08, group: 'arm'},
      {point0: p(0, 1.6, -4), point1: p(0, 1.7, -4), radius: .10922, group: 'head'},
    ]};
    expect(traceActor(p(.4, 1), p(0, 0, -1), p(0, 0, -4), 0, 5, 0, pose).group).toBe('arm');
    expect(traceActor(p(.4, .4), p(0, 0, -1), p(0, 0, -4), 0, 5, 0, pose).group).toBeUndefined();
    expect(traceActor(p(0, 1.65), p(0, 0, -1), p(0, 0, -4), 0, 3.8, 0, pose).group).toBeUndefined();
  });

  it('promotes a neck-to-head ray but never a neck-only or arm-to-head ray', () => {
    const neck = {point0: p(0, 1.6, -3), point1: p(0, 1.7, -3), radius: .1, group: 'chest' as const, neck: true};
    const skull = {point0: p(0, 1.6, -3.3), point1: p(0, 1.7, -3.3), radius: .1, group: 'head' as const};
    const arm = {point0: p(0, 1.6, -3.1), point1: p(0, 1.7, -3.1), radius: .1, group: 'arm' as const};
    expect(traceActor(p(0, 1.65), p(0, 0, -1), p(0, 0, -3), 0, Infinity, 0, {capsules: [neck, skull]}).group).toBe('head');
    expect(traceActor(p(0, 1.65), p(0, 0, -1), p(0, 0, -3), 0, Infinity, 0, {capsules: [neck]}).group).toBe('chest');
    expect(traceActor(p(0, 1.65), p(0, 0, -1), p(0, 0, -3), 0, Infinity, 0, {capsules: [neck, skull, arm]}).group).toBe('chest');
    expect(traceActor(p(0, 1.65), p(0, 0, -1), p(0, 0, -3), 0, 3.05, 0, {capsules: [neck, skull]}).group).toBe('chest');
  });
});

describe('finite capsule ray intervals', () => {
  it('retains entry, exit, hemisphere and tangent contacts for penetration', () => {
    expect(rayCapsuleInterval(p(0, .5, -3), p(0, 0, 1), p(), p(0, 1), .1)).toEqual({entryDistance: expect.closeTo(2.9), exitDistance: expect.closeTo(3.1)});
    expect(rayCapsuleInterval(p(0, -3), p(0, 1), p(), p(0, 1), .1)).toEqual({entryDistance: expect.closeTo(2.9), exitDistance: expect.closeTo(4.1)});
    expect(rayCapsuleInterval(p(.1, .5, -3), p(0, 0, 1), p(), p(0, 1), .1)).toEqual({entryDistance: 3, exitDistance: 3});
    expect(rayCapsuleInterval(p(0, .5, -3), p(0, 0, 1), p(), p(0, 1), .1, 2.95)?.exitDistance).toBeCloseTo(3.1);
    expect(rayCapsuleInterval(p(0, .5, -3), p(0, 0, 1), p(), p(0, 1), .1, 2.8)).toBeUndefined();
  });

  it('handles inside starts, a degenerate sphere and non-unit directions', () => {
    expect(rayCapsuleInterval(p(0, .5), p(0, 0, 1), p(), p(0, 1), .1)).toEqual({entryDistance: 0, exitDistance: expect.closeTo(.1)});
    expect(rayCapsuleInterval(p(0, 0, -3), p(0, 0, 2), p(), p(), .1)).toEqual({entryDistance: expect.closeTo(1.45), exitDistance: expect.closeTo(1.55)});
    expect(rayCapsuleInterval(p(0, -.2), p(0, 1), p(), p(0, 1), .1)?.entryDistance).toBeCloseTo(.1);
  });

  it('matches capsule boundary distances under arbitrary rigid transforms', () => {
    const random = randomStream(453, 'capsule-rays');
    for (let i = 0; i < 600; i++) {
      const transform = new Matrix4().compose(new Vector3((random() - .5) * 100, random() * 10, (random() - .5) * 100),
        new Quaternion().setFromAxisAngle(new Vector3(random(), random(), random()).normalize(), random() * Math.PI * 2), new Vector3(1, 1, 1));
      const point0 = new Vector3(0, 0, 0).applyMatrix4(transform), point1 = new Vector3(0, 1, 0).applyMatrix4(transform);
      const origin = new Vector3(0, .5, -3).applyMatrix4(transform);
      const direction = new Vector3(0, 0, 1).transformDirection(transform);
      const result = rayCapsuleInterval(origin, direction, point0, point1, .1)!;
      expect(result.entryDistance).toBeCloseTo(2.9, 8); expect(result.exitDistance).toBeCloseTo(3.1, 8);
    }
  });

  it('rejects malformed inputs rather than painting false contacts', () => {
    for (const radius of [0, -1, NaN, Infinity]) expect(rayCapsuleInterval(p(), p(0, 0, 1), p(), p(0, 1), radius)).toBeUndefined();
    expect(rayCapsuleInterval(p(), p(), p(), p(0, 1), .1)).toBeUndefined();
    expect(rayCapsuleInterval(p(NaN), p(0, 0, 1), p(), p(0, 1), .1)).toBeUndefined();
    expect(rayCapsuleInterval(p(), p(0, 0, 1), p(Infinity), p(0, 1), .1)).toBeUndefined();
    for (const distance of [-1, NaN]) expect(rayCapsuleInterval(p(), p(0, 0, 1), p(), p(0, 1), .1, distance)).toBeUndefined();
  });
});
