import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {ViewAnimation} from './view-animation';
import {Simulation} from './simulation';
import {defaults} from './config';
import {MovementLesson} from './lesson-model';
import {groundVelocity, STEP} from './actor-physics';
import {createScenario, angleTo, exposedHead} from './drills';

describe('reload and lesson continuity', () => {
  it('maps native reload motion to the weapon duration and restores idle on interruption', () => {
    const root = new THREE.Group(), hand = new THREE.Object3D(); hand.name = 'hand'; root.add(hand);
    const idle = new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('hand.position[x]', [0, 1], [0, 0])]);
    const reload = new THREE.AnimationClip('reload', 2, [new THREE.NumberKeyframeTrack('hand.position[x]', [0, 1, 2], [0, .4, 0])]);
    const animation = new ViewAnimation(root, [idle, reload]);
    animation.update(1.5, 3); expect(hand.position.x).toBeCloseTo(.4);
    animation.update(0, 3); expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('blocks range fire during reload and cancels reload when changing slots', () => {
    const sim = new Simulation({...defaults, mode: 'spray'}); sim.active = true;
    expect(sim.reload()).toBe(true); expect(sim.start()).toBe(false);
    for (let n = 0; n < 400; n++) sim.step(STEP);
    expect(sim.primaryReloadAt).toBe(0); expect(sim.start()).toBe(true);
    sim.reload(); sim.equip(2); expect(sim.primaryReloadAt).toBe(0);
  });
  it('keeps tutorial braking identical to the range instead of freezing at the accuracy threshold', () => {
    const lesson = new MovementLesson(0); let speed = 0;
    for (let tick = 0; tick < 100; tick++) {
      const input = tick < 46 ? 1 : speed > .02 ? -1 : 0;
      speed = groundVelocity(speed, 0, lesson.complete ? 0 : input, 0, lesson.cap, STEP).x;
      lesson.update(STEP, input);
      expect(lesson.velocity).toBeCloseTo(speed, 9);
    }
    expect(lesson.complete).toBe(true); expect(Math.abs(lesson.velocity)).toBe(0);
  });
  it.each([1, 2])('allows manual lesson %s to finish with readable persistent feedback', id => {
    const m = new MovementLesson(id);
    while (m.x < -.25) m.update(STEP, 1);
    while (m.velocity > .02) m.update(STEP, -1);
    m.update(.2, 0); m.shoot();
    expect(m.complete).toBe(true);
    const message = m.message;
    for (let n = 0; n < 1000; n++) m.update(STEP, 0);
    expect(m.message).toBe(message);
  });
  it('starts peeking near head height, but requires a small vertical mouse correction', () => {
    for (const r of [.1, .4, .6, .9]) {
      const s = createScenario('peek', 0, 'common', () => r);
      const exact = angleTo({...s.spawn, x: s.spawn.x + s.side * 2.05}, exposedHead(s));
      expect(Math.abs(s.pitch - exact.pitch) * 180 / Math.PI).toBeGreaterThan(.6);
      expect(Math.abs(s.pitch - exact.pitch) * 180 / Math.PI).toBeLessThan(1.2);
    }
  });
});
