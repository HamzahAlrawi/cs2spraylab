import {describe, expect, it} from 'vitest';
import {defaults} from './config';
import {CS2_PITCH, CS2_YAW, calibratedCountScale, cmPer360, mouseCountScale, mouseLookDelta} from './input-sensitivity';
import {DEG, Simulation} from './simulation';

describe('CS2 mouse-count matching', () => {
  it('uses .022 degrees/count on yaw AND pitch at sensitivity 1, with correct camera signs', () => {
    expect(CS2_YAW).toBe(.022); expect(CS2_PITCH).toBe(.022);
    const delta = mouseLookDelta(1000, 1000, {...defaults, sensitivity: .5});
    expect(delta.yawDelta / DEG).toBeCloseTo(-11, 10);
    expect(delta.pitchDelta / DEG).toBeCloseTo(-11, 10);
    expect(mouseLookDelta(0, 1000, {...defaults, sensitivity: .5, invertY: true}).pitchDelta / DEG).toBeCloseTo(11, 10);
  });
  it('never applies DPI to deltas, and does not depend on viewport, display scale or frame time', () => {
    expect(mouseLookDelta(400, -100, {...defaults, dpi: 400})).toEqual(mouseLookDelta(400, -100, {...defaults, dpi: 3200}));
    expect(cmPer360(.5, 800)).toBeCloseTo(103.9090909091, 8);
    expect(cmPer360(.5, 1600)).toBeCloseTo(cmPer360(.5, 800) / 2, 10);
    const one = mouseLookDelta(1000, 0, defaults).yawDelta;
    expect(mouseLookDelta(250, 0, defaults).yawDelta * 4).toBeCloseTo(one, 12);
  });
  it.each([90, 40, 10])('agrees between range and duel at %s FOV with nondefault zoom/calibration', fov => {
    const settings = {...defaults, sensitivity: 1.23, zoomSensitivity: .8, mouseCalibration: 1.25};
    const sim = new Simulation({...settings, weapon: fov === 90 ? settings.weapon : 'awp'});
    if (fov !== 90) sim.actions.zoom = fov === 40 ? 1 : 2;
    const yaw = sim.yaw, pitch = sim.pitch, scale = mouseCountScale(settings, fov !== 90);
    sim.aim(100 * scale, 50 * scale);
    const duel = mouseLookDelta(100, 50, settings, fov);
    expect(sim.yaw - yaw).toBeCloseTo(duel.yawDelta, 12);
    expect(sim.pitch - pitch).toBeCloseTo(duel.pitchDelta, 12);
  });
  it('applies the explicit zoom ratio only once, only while scoped', () => {
    const normal = mouseLookDelta(100, 100, defaults, 40);
    const zoom = {...defaults, zoomSensitivity: 2};
    expect(mouseLookDelta(100, 100, zoom, 40).yawDelta).toBeCloseTo(normal.yawDelta * 2, 12);
    expect(mouseLookDelta(100, 100, zoom, 90)).toEqual(mouseLookDelta(100, 100, defaults, 90));
  });
  it('uses only an explicit user-measured calibration and rejects invalid measurements', () => {
    expect(calibratedCountScale(1, 180)).toBe(2);
    expect(calibratedCountScale(2, 360)).toBe(2);
    expect(calibratedCountScale(1, 90, 180)).toBe(2);
    for (const n of [0, -1, NaN, Infinity, .001]) expect(calibratedCountScale(1, n)).toBeNull();
    expect(mouseLookDelta(1, 1, {...defaults, mouseCalibration: 2}).yawDelta).toBe(mouseLookDelta(1, 1, defaults).yawDelta * 2);
  });
});
