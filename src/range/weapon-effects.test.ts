import {describe, expect, it, vi} from 'vitest';
import {Color, Group, Object3D, Texture, Vector3} from 'three';
import {hasTracer, MuzzleFlashes, ShotEffects} from './weapon-effects';

describe('instant-shot cosmetic effects', () => {
  it('uses native tracer cadence, never a trace for suppressed firearms or knives', () => {
    expect([0, 1, 2, 3, 4, 5].map(i => hasTracer('ak47', i))).toEqual([true, false, false, true, false, false]);
    for (const gun of ['usp', 'm4a1s', 'mp5sd', 'knife'] as const)
      for (let shot = 0; shot < 30; shot++) expect(hasTracer(gun, shot)).toBe(false);
    expect(hasTracer('deagle', 0)).toBe(true);
  });
  it('keeps GPU allocations bounded during thousands of shots and resets without reallocating', () => {
    const parent = new Group(), fx = new ShotEffects(parent, 8, 12);
    const color = new Color('#fff0c9'), start = new Vector3(1, 1, 2), end = new Vector3(2, 1, -30);
    const geometry = fx.tracers.geometry, material = fx.tracers.material, array = geometry.getAttribute('position').array;
    const children = parent.children.length;
    for (let i = 0; i < 3000; i++) {
      fx.trace('deagle', i, start, end, i / 128, color); fx.impact(end, 1, color, i / 128); fx.update(i / 128);
    }
    expect(fx.tracers.geometry).toBe(geometry); expect(fx.tracers.material).toBe(material);
    expect(geometry.getAttribute('position').array).toBe(array);
    expect(parent.children).toHaveLength(children); expect(fx.impacts.count).toBe(12);
    fx.clear(); expect(fx.impacts.count).toBe(0); expect(fx.tracers.visible).toBe(false);
    fx.dispose(); expect(parent.children).toHaveLength(0);
  });
  it('copies physical endpoints immediately and never follows the camera or shooter', () => {
    const fx = new ShotEffects(new Group(), 4, 4), from = new Vector3(0, 1, 0), end = new Vector3(3, 2, -60);
    fx.trace('deagle', 0, from, end, 0, new Color('#ffffff'));
    fx.impact(end, 2, new Color('#ffffff'), 0);
    const array = Array.from(fx.tracers.geometry.getAttribute('position').array).slice(0, 6);
    expect(array).toEqual([0, 1, 0, 3, 2, -60]);
    from.set(30, 30, 30); end.set(50, 50, 50); fx.update(.01);
    expect(Array.from(fx.tracers.geometry.getAttribute('position').array).slice(0, 6)).toEqual(array);
    expect(Array.from(fx.impacts.instanceMatrix.array).slice(12, 15)).toEqual([3, 2, -60]);
    fx.update(.2); expect(fx.tracers.visible).toBe(false);
    fx.update(3); expect(fx.impacts.instanceMatrix.array[0]).toBe(0); fx.dispose();
  });
  it('shows at least one rendered flash even after a long frame and follows the animated muzzle', () => {
    const scene = new Group(), anchor = new Object3D(); scene.add(anchor);
    const texture = new Texture(), dispose = vi.spyOn(texture, 'dispose'), flashes = new MuzzleFlashes(scene, 2, texture);
    flashes.fire(anchor, 'ak47', 0); anchor.position.set(.2, -.1, -.7);
    flashes.update(.1); expect(flashes.sprites[0].visible).toBe(true);
    expect(flashes.sprites[0].position.toArray()).toEqual(anchor.position.toArray());
    flashes.update(.2); expect(flashes.sprites[0].visible).toBe(false);
    flashes.fire(anchor, 'knife', .3); expect(flashes.sprites.every(s => !s.visible)).toBe(true);
    flashes.fire(anchor, 'zeus', .3); expect(flashes.sprites.every(s => !s.visible)).toBe(true);
    flashes.fire(anchor, 'usp', .4); expect(flashes.sprites[1].scale.x).toBeLessThan(.04);
    flashes.clear(); expect(flashes.sprites.every(s => !s.visible)).toBe(true);
    flashes.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
  it('renders Zeus as two pooled electrical wires, not a firearm flame or bullet tracer',()=>{
    const fx=new ShotEffects(new Group(),4,4),from=new Vector3(1,1,1),to=new Vector3(1,1,-2);
    const geometry=fx.discharges.wires.geometry,positions=geometry.getAttribute('position').array;
    expect(fx.trace('zeus',0,from,to,0,new Color())).toBe(true);
    expect(fx.tracers.visible).toBe(false);expect(fx.discharges.wires.visible).toBe(true);
    expect(Array.from(positions).slice(0,3)).toEqual(from.toArray());
    expect(Array.from(positions).slice(69,72)).toEqual(to.toArray());
    from.set(9,9,9);fx.update(.2);expect(fx.discharges.wires.visible).toBe(true);
    fx.update(.3);expect(fx.discharges.wires.visible).toBe(false);
    for(let shot=1;shot<100;shot++)fx.trace('zeus',shot,from,to,shot/60,new Color());
    expect(fx.discharges.wires.geometry).toBe(geometry);expect(geometry.getAttribute('position').array).toBe(positions);
    fx.dispose();
  });
});
