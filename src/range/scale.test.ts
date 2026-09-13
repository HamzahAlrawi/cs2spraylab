import {describe, expect, it} from 'vitest';
import {PerspectiveCamera, Vector3} from 'three';
import {defaults, gameData, weaponIds} from './config';
import {Simulation, UNIT, VERTICAL_FOV, DEG, STEP} from './simulation';

describe('Source-unit world scale', () => {
  it('uses 64/46 unit camera heights and the 90 degree 4:3 world FOV convention', () => {
    const sim = new Simulation(defaults);
    expect(sim.position.y).toBeCloseTo(64 * .0254);
    expect(2 * Math.atan(Math.tan(VERTICAL_FOV * DEG / 2) * 4 / 3) / DEG).toBeCloseTo(90);
    expect(2 * Math.atan(Math.tan(VERTICAL_FOV * DEG / 2) * 16 / 9) / DEG).toBeCloseTo(106.26020470831196);
    sim.active = true; sim.input.crouch = true;
    for (let i = 0; i < 256; i++) sim.advance(STEP);
    expect(sim.position.y).toBeCloseTo(46 * .0254, 6);
  });
  it.each([5, 12, 25, 50, 100])('projects a native-size player at %i metres exactly as the equivalent Source-unit scene', distance => {
    const camera = new PerspectiveCamera(VERTICAL_FOV, 16 / 9, .01, 10000);
    const height = 1.821905848570168;
    const pixels = (units: number) => {
      camera.position.set(0, 64 * UNIT / units, 0); camera.updateMatrixWorld(true);
      const top = new Vector3(0, height / units, -distance / units).project(camera);
      const foot = new Vector3(0, 0, -distance / units).project(camera);
      return (top.y - foot.y) * 1080 / 2;
    };
    expect(pixels(1)).toBeCloseTo(pixels(UNIT), 8);
    expect(pixels(1)).toBeCloseTo(height / distance * 720, 8);
  });
  it.each(weaponIds)('%s travels the installed weapon speed in the same units as target distance', weapon => {
    const sim = new Simulation({...defaults, weapon});
    sim.position.z = -50;
    sim.active = true; sim.input.forward = 1;
    for (let i = 0; i < 128; i++) sim.advance(STEP);
    const start = sim.position.z;
    for (let i = 0; i < 128; i++) sim.advance(STEP);
    expect(start - sim.position.z).toBeCloseTo(gameData.weapons[weapon].speed * UNIT, 8);
  });
});
