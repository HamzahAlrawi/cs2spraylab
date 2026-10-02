import {expect,it} from 'vitest';
import {Color,Group,Matrix4,SphereGeometry,Vector3} from 'three';
import {ImpactCloud} from './impact-cloud';

it('batches persistent wall points without changing position on resizing', () => {
  const root = new Group(), geometry = new SphereGeometry(.018,6,4), cloud = new ImpactCloud(geometry,200,root);
  cloud.add(new Vector3(1,2,-100),2,1.5,new Color('#ff6259'));
  cloud.resize(4);
  const matrix = new Matrix4(); cloud.mesh.getMatrixAt(0,matrix);
  expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([1,2,-100]);
  expect(new Vector3().setFromMatrixScale(matrix).x).toBe(8);
  expect(root.children).toHaveLength(1); expect(cloud.mesh.count).toBe(1);
  cloud.dispose(); geometry.dispose(); expect(root.children).toHaveLength(0);
});
it('keeps target marks local and moves them only with the physical target', () => {
  const root = new Group(), geometry = new SphereGeometry(), cloud = new ImpactCloud(geometry,60,root);
  const point = new Vector3(.1,1.65,-.1);
  cloud.add(point,1,1,new Color('#51edee')); point.set(99,99,99);
  root.position.set(4,0,-90); root.updateMatrixWorld(true);
  const local = new Matrix4(); cloud.mesh.getMatrixAt(0,local);
  expect(new Vector3().setFromMatrixPosition(local).toArray()).toEqual([expect.closeTo(.1),expect.closeTo(1.65),expect.closeTo(-.1)]);
  const world = new Vector3().setFromMatrixPosition(local).applyMatrix4(root.matrixWorld);
  expect(world.x).toBeCloseTo(4.1); expect(world.z).toBeCloseTo(-90.1);
  cloud.dispose(); geometry.dispose();
});
it('overwrites oldest marks at a bounded capacity and resets all slots on clear', () => {
  const geometry = new SphereGeometry(), root = new Group(), cloud = new ImpactCloud(geometry,2,root);
  for (let i = 0; i < 3; i++) cloud.add(new Vector3(i,0,0),1,1,new Color(i === 2 ? '#ff0000' : '#00ff00'));
  expect(cloud.mesh.count).toBe(2);
  const matrix = new Matrix4(), color = new Color();cloud.mesh.getMatrixAt(0,matrix);cloud.mesh.getColorAt(0,color);
  expect(new Vector3().setFromMatrixPosition(matrix).x).toBe(2); expect(color.r).toBe(1);
  cloud.clear(); expect(cloud.mesh.count).toBe(0);
  cloud.add(new Vector3(5,0,0),1,1,new Color());cloud.mesh.getMatrixAt(0,matrix);
  expect(cloud.mesh.count).toBe(1);expect(new Vector3().setFromMatrixPosition(matrix).x).toBe(5);
  cloud.dispose();geometry.dispose();
});
