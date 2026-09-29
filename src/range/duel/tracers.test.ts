import {describe, expect, it} from 'vitest';
import {BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3} from 'three';
import {VIEWMODEL_FOV, viewmodelViewport} from '../viewmodel';
import {muzzleAnchor, viewMuzzleToWorld} from './tracers';

describe('cosmetic muzzle presentation', () => {
  it('finds the barrel end in weapon space, ignoring hands and parent transforms', () => {
    const root = new Group(); root.position.set(4, 1, 8); root.rotation.y = Math.PI;
    const gun = new Mesh(new BoxGeometry(.08, .1, .8), new MeshBasicMaterial());
    gun.name = 'held_weapon_ak47.002'; gun.position.set(.2, -.1, .3); root.add(gun);
    const hand = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()); root.add(hand);
    const muzzle = muzzleAnchor(root)!;
    expect(muzzle.position.x).toBeCloseTo(.2);
    expect(muzzle.position.y).toBeCloseTo(-.1);
    expect(muzzle.position.z).toBeCloseTo(.7);
    expect(muzzle.getWorldPosition(new Vector3()).z).toBeCloseTo(7.3);
  });

  it.each([[1920, 1080, 16 / 9], [1920, 1080, 4 / 3], [3440, 1440, 3440 / 1440], [390, 844, 390 / 844]])(
    'aligns the visible barrel and tracer for %dx%d, world aspect %s', (width, height, aspect) => {
      const viewport = viewmodelViewport(width, height);
      const view = new PerspectiveCamera(VIEWMODEL_FOV, viewport.aspect, .01, 10);
      const world = new PerspectiveCamera(74, aspect, .03, 100);
      world.position.set(4, 1.6, 9); world.rotation.set(.15, .7, 0, 'YXZ'); world.updateMatrixWorld();
      const muzzle = new Vector3(.17, -.08, -.65);
      const viewPoint = muzzle.clone().project(view);
      const expectedX = (viewport.x + (viewPoint.x + 1) * viewport.width / 2) / width * 2 - 1;
      const expectedY = (viewport.y + (viewPoint.y + 1) * viewport.height / 2) / height * 2 - 1;
      const start = viewMuzzleToWorld(muzzle, view, world, width, height);
      expect(start.clone().sub(world.position).dot(world.getWorldDirection(new Vector3()))).toBeGreaterThan(.3);
      const actual = start.project(world);
      expect(actual.x).toBeCloseTo(expectedX, 6); expect(actual.y).toBeCloseTo(expectedY, 6);
      expect(muzzle.toArray()).toEqual([.17, -.08, -.65]);
    });
});
