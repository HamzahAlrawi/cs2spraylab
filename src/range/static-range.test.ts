import {expect,it} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {batchStaticMeshes} from './duel/render-resources';

it('retains collision positions when static range fixtures are render-batched',()=>{
  const root=new Group(),material=new MeshBasicMaterial();
  const wall=new Mesh(new BoxGeometry(2,3,.3),material),other=new Mesh(new BoxGeometry(2,3,.3),material);
  wall.position.set(4,1.5,-10);other.position.set(-4,1.5,-10);root.add(wall,other);root.updateMatrixWorld(true);
  const ray=new Raycaster(new Vector3(4,1.5,0),new Vector3(0,0,-1));
  const before=ray.intersectObject(wall)[0].point.clone();
  batchStaticMeshes(root,new Set([wall,other]));root.updateMatrixWorld(true);
  expect(root.children).toHaveLength(1);expect(wall.parent).toBeNull();
  expect(ray.intersectObject(wall)[0].point).toEqual(before);
  expect(ray.intersectObject(root,true)[0].point.distanceTo(before)).toBeLessThan(.000001);
});
it('does not merge different shadow flags or render orders',()=>{
  const root=new Group(),material=new MeshBasicMaterial();
  const roof=new Mesh(new BoxGeometry(),material),label=new Mesh(new BoxGeometry(),material);roof.castShadow=true;
  root.add(roof,label);batchStaticMeshes(root);
  expect(root.children).toHaveLength(2);expect(roof.castShadow).toBe(true);expect(label.castShadow).toBe(false);
});
