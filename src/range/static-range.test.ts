import {expect,it,vi} from 'vitest';
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
it('batches indexed and non-indexed props separately without losing geometry or logging merge errors',()=>{
  const root=new Group(),material=new MeshBasicMaterial(),errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    for(let i=0;i<4;i++) {
      const geometry=i<2?new BoxGeometry():new BoxGeometry().toNonIndexed();
      const mesh=new Mesh(geometry,material);mesh.position.x=i*3;root.add(mesh);
    }
    batchStaticMeshes(root);root.updateMatrixWorld(true);
    expect(root.children).toHaveLength(2);expect(errors).not.toHaveBeenCalled();
    for(let i=0;i<4;i++) expect(new Raycaster(new Vector3(i*3,0,3),new Vector3(0,0,-1)).intersectObject(root,true).length).toBeGreaterThan(0);
  } finally {errors.mockRestore();}
});
it('keeps different vertex attribute layouts in compatible batches',()=>{
  const root=new Group(),material=new MeshBasicMaterial(),errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    for(let i=0;i<4;i++) {
      const geometry=new BoxGeometry();if(i>=2)geometry.deleteAttribute('uv');root.add(new Mesh(geometry,material));
    }
    batchStaticMeshes(root);
    expect(root.children).toHaveLength(2);expect(errors).not.toHaveBeenCalled();
    expect(root.children.map(mesh=>!!(mesh as Mesh).geometry.getAttribute('uv')).sort()).toEqual([false,true]);
  } finally {errors.mockRestore();}
});
