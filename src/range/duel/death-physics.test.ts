import {describe, expect, it} from 'vitest';
import {DeathPhysics} from './death-physics';

describe('cosmetic skeletal contact solver', () => {
  it('uses the shared native 800-unit gravity, not Earth gravity', () => {
    const rag = new DeathPhysics([{name: 'head', position: {x: 0, y: 2, z: 0}, radius: .12}], []);
    rag.step(1 / 120); expect(rag.point('head')!.y).toBeCloseTo(2 - 800 * .0254 / 120 ** 2, 10);
  });
  it('settles against the floor without penetrating and freezes the solved pose', () => {
    const rag = new DeathPhysics([{name: 'head', position: {x: 0, y: 2, z: 0}, radius: .12} ], []);
    const contacts = [];
    for (let n = 0; n < 600; n++) contacts.push(...rag.step(1 / 60));
    expect(rag.point('head')!.y).toBeCloseTo(.12); expect(rag.sleeping).toBe(true);
    expect(contacts.length).toBeGreaterThan(0); expect(contacts.length).toBeLessThan(8);
    expect(contacts[0].point.y).toBeCloseTo(0); expect(contacts[0].normal).toEqual({x: 0, y: 1, z: 0});
    const final = [...rag.positions]; rag.step(5); expect([...rag.positions]).toEqual(final);
  });
  it('lands on arbitrary prop tops and sweeps thin side walls', () => {
    const world = {boxes: [{center: {x: 0, y: .5, z: 0}, size: {x: 3, y: 1, z: 3}}]};
    const rag = new DeathPhysics([{name: 'hip', position: {x: 0, y: 3, z: 0}, radius: .12}], []);
    for (let n = 0; n < 300; n++) rag.step(1 / 60, world);
    expect(rag.point('hip')!.y).toBeCloseTo(1.12);
    const moving = new DeathPhysics([{name: 'hip', position: {x: -.3, y: 1, z: 0}, radius: .04}], [], {x: 8, y: 0, z: 0});
    const walls = [];
    for (let n = 0; n < 10; n++) walls.push(...moving.step(1 / 120, {boxes: [{center: {x: 0, y: 1, z: 0}, size: {x: .01, y: 5, z: 5}}]}));
    expect(moving.point('hip')!.x).toBeLessThanOrEqual(-.045 + 1e-8);
    expect(walls[0].solid).toBe(0); expect(walls[0].point.x).toBeCloseTo(-.005);
    expect(walls[0].normal.x).toBe(-1);
  });
  it('preserves link lengths, is deterministic across render rates, and does not mutate initial poses', () => {
    const bodies = [{name: 'hip', position: {x: 0, y: 2, z: 0}, radius: .12},
      {name: 'head', position: {x: 0, y: 2.7, z: .05}, radius: .12}];
    const links = [{a: 'hip', b: 'head'}];
    const a = new DeathPhysics(bodies, links), b = new DeathPhysics(bodies, links);
    a.impulse('head', {x: 2, y: -.5, z: 1}); b.impulse('head', {x: 2, y: -.5, z: 1});
    for (let n = 0; n < 120; n++) a.step(1 / 60);
    for (let n = 0; n < 240; n++) b.step(1 / 120);
    expect([...a.positions]).toEqual([...b.positions]); expect(bodies[0].position.y).toBe(2);
    const hip = a.point('hip')!, head = a.point('head')!;
    expect(Math.hypot(head.x - hip.x, head.y - hip.y, head.z - hip.z)).toBeCloseTo(Math.hypot(.7, .05), 2);
  });
  it('bounds catch-up after pauses and rejects invalid or oversized skeletons', () => {
    const a = new DeathPhysics([{name: 'hip', position: {x: 0, y: 2, z: 0}, radius: .1}], []);
    a.step(Infinity); a.step(NaN); expect(a.point('hip')!.y).toBe(2);
    a.step(100); expect(a.point('hip')!.y).toBeGreaterThan(1.9);
    expect(() => new DeathPhysics([{name: 'hip', position: {x: NaN, y: 0, z: 0}, radius: .1}], [])).toThrow();
    expect(() => new DeathPhysics(Array.from({length: 25}, (_, i) => ({name: String(i), position: {x: 0, y: 1, z: 0}, radius: .1})), [])).toThrow();
    expect(() => new DeathPhysics(a.bodies, [{a: 'hip', b: 'missing'}])).toThrow();
  });
});
