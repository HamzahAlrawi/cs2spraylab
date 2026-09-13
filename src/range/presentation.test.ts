import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { defaults, presets, sanitizeSettings, recoilPattern, weaponIds, gameData } from './config';
import { GUIDE_COLORS, layoutSprayPattern, mouseCompensation, sprayPlayback } from './spray-demonstration';
import { VIEWMODEL_FOV, viewmodelViewport } from './viewmodel';
import { Simulation, Vec } from './simulation';

describe('viewmodel presentation', () => {
  it.each([[1920, 1080], [1440, 1080], [1280, 1024], [3440, 1440], [390, 660], [844, 260]])('fits %i x %i without changing proportions or exposing the arm ends', (width, height) => {
    const view = viewmodelViewport(width, height);
    expect(view.x + view.width).toBeCloseTo(width);
    expect(view.y).toBe(0);
    expect(view.height).toBeLessThanOrEqual(height);
    expect(view.aspect).toBeGreaterThanOrEqual(4 / 3 - .0001);
    expect(view.aspect).toBeLessThanOrEqual(16 / 9 + .0001);
    const camera = new PerspectiveCamera(VIEWMODEL_FOV, view.aspect, .01, 10);
    const right = new Vector3(.1, 0, -1).project(camera);
    const up = new Vector3(0, .1, -1).project(camera);
    expect(right.x * view.width).toBeCloseTo(up.y * view.height);
  });
  it('converts a 68 degree horizontal reference to Three vertical FOV', () => {
    expect(2 * Math.atan(Math.tan(VIEWMODEL_FOV * Math.PI / 360) * 4 / 3) * 180 / Math.PI).toBeCloseTo(68);
  });
  it('uses thicker yellow Compact defaults, without overwriting saved custom strokes', () => {
    expect(defaults.crosshair.thickness).toBe(2);
    expect(presets.Compact.color).toBe('#ffeb55');
    expect(sanitizeSettings({ crosshair: {} }).crosshair.thickness).toBe(2);
    expect(sanitizeSettings({ crosshair: { thickness: 1.5 } }).crosshair.thickness).toBe(1.5);
    expect(new Set([GUIDE_COLORS.now, GUIDE_COLORS.next, defaults.crosshair.color]).size).toBe(3);
  });
});

describe('wall spray demonstration', () => {
  it.each(weaponIds)('fits every %s round in the plot, without mutating the shot profile', weapon => {
    const pattern = recoilPattern(weapon), original = structuredClone(pattern);
    const points = layoutSprayPattern(pattern);
    expect(points).toHaveLength(gameData.weapons[weapon].magazine);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(100); expect(p.x).toBeLessThanOrEqual(668);
      expect(p.y).toBeGreaterThanOrEqual(130); expect(p.y).toBeLessThanOrEqual(630);
    }
    expect(pattern).toEqual(original);
  });
  it('plots upward impacts, not downward compensation, and keeps left/right sign', () => {
    const points = layoutSprayPattern([{yaw: 0, pitch: 0}, {yaw: -2, pitch: 3}, {yaw: 2, pitch: 3}]);
    expect(points[1].y).toBeLessThan(points[0].y);
    expect(points[1].x).toBeLessThan(points[0].x);
    expect(points[2].x).toBeGreaterThan(points[0].x);
    expect(points[1].y).toBeCloseTo(points[2].y);
  });
  it('advances at the selected firing interval, holds the full pattern and loops', () => {
    expect(sprayPlayback(.25, 30, .1)).toEqual({index: 2, fraction: .5});
    expect(sprayPlayback(.25, 30, .05)).toEqual({index: 5, fraction: 0});
    expect(sprayPlayback(3.5, 30, .1).index).toBe(29);
    expect(sprayPlayback(4.401, 30, .1).index).toBe(0);
    expect(sprayPlayback(500, 30, .1, true)).toEqual({index: 29, fraction: 0});
  });
  it('handles a flat imported pattern and empty input without NaN', () => {
    expect(layoutSprayPattern([])).toEqual([]);
    expect(layoutSprayPattern([{yaw: 0, pitch: 0}])).toEqual([{x: 384, y: 380}]);
    expect(sprayPlayback(1, 0, 0)).toEqual({index: 0, fraction: 0});
  });
  it('plots the inverse angular mouse path and respects inverted Y', () => {
    const angles = [{yaw: 0, pitch: 0}, {yaw: -2, pitch: 3}, {yaw: 2, pitch: 6}];
    const normal = layoutSprayPattern(angles, 'mouse');
    const inverted = layoutSprayPattern(angles, 'mouse', true);
    expect(normal[1].x).toBeGreaterThan(normal[0].x);
    expect(normal[2].x).toBeLessThan(normal[0].x);
    expect(normal[2].y).toBeGreaterThan(normal[0].y);
    expect(normal[2].y - normal[0].y).toBeCloseTo(2 * (normal[1].y - normal[0].y));
    normal.forEach((p, i) => { expect(p.x).toBe(inverted[i].x); expect(p.y + inverted[i].y).toBeCloseTo(760); });
  });
  it('defaults both wall guides on and preserves independently disabled guides', () => {
    expect(sanitizeSettings({}).showImpactPattern).toBe(true);
    expect(sanitizeSettings({}).showMousePath).toBe(true);
    const saved = sanitizeSettings({showImpactPattern: false, showMousePath: true});
    expect(saved.showImpactPattern).toBe(false); expect(saved.showMousePath).toBe(true);
  });
  it.each(weaponIds)('the %s mouse path cancels every simulated recoil shot at different sensitivities', weapon => {
    for (const invertY of [false, true]) for (const sensitivity of [.5, 2]) {
      const sim = new Simulation({...defaults, weapon, invertY, sensitivity});
      const rays: Vec[] = []; sim.onShot = shot => rays.push(shot.direction); sim.start();
      let previous = {x: 0, y: 0};
      for (let i = 1; i < sim.pattern.length; i++) {
        const next = mouseCompensation(sim.pattern[i], invertY);
        sim.aim((next.x - previous.x) / (.022 * sensitivity), (next.y - previous.y) / (.022 * sensitivity));
        sim.fire(); previous = next;
      }
      expect(rays).toHaveLength(gameData.weapons[weapon].magazine);
      for (const ray of rays) { expect(ray.x).toBeCloseTo(0, 10); expect(ray.y).toBeCloseTo(0, 10); expect(ray.z).toBeCloseTo(-1, 10); }
    }
  });
});
